#!/usr/bin/env python3
"""
LIDC XML → DICOM SEG Converter
================================
Converts LIDC-IDRI gold-standard XML annotation files into DICOM SEG files.
Each radiologist's nodule contours are rasterised into a binary mask and
packed into a single multi-frame DICOM SEG object using highdicom.

Both large nodules (polygon contours) and small/non-nodules (point-mass
circles) are supported.

Usage:
    python lidc_xml_to_seg.py <ct_dir> <xml_file> <output_seg.dcm> [--format FORMAT]

Example:
    python lidc_xml_to_seg.py \\
        data/LIDC-IDRI-0001/ct \\
        data/LIDC-IDRI-0001/annotations/069.xml \\
        data/LIDC-IDRI-0001/annotations/LIDC-IDRI-0001_Combined_SEG.dcm \\
        --format combined

Arguments:
    ct_dir       : Directory containing the CT DICOM slices
    xml_file     : Path to the LIDC annotation XML file
    output_seg   : Output DICOM SEG file path
    --format     : "combined" (all annotators in one file, default),
                   "per_annotator" (one file per radiologist),
                   "both"

Requirements:
    pip install pydicom highdicom numpy scikit-image

Notes:
    - The XML uses namespace http://www.nih.gov — standard getElementsByTagName
      will not find elements.  This script uses namespace-aware findall().
    - Contour coordinates from <edgeMap> are in image pixel space (col, row).
      They are rasterised with skimage.draw.polygon before being stored.
    - Small nodules (<nonNodule>) have only a single locus point; a disk of
      radius POINT_RADIUS_PX pixels is drawn instead.
    - The output DICOM SEG copies StudyInstanceUID / FrameOfReferenceUID from
      the source CT so that viewers can align it correctly.
"""

import sys
import xml.etree.ElementTree as ET
from pathlib import Path

try:
    import numpy as np
    import pydicom
    from pydicom.uid import generate_uid
    from skimage.draw import polygon, disk
    from highdicom.seg import (
        Segmentation,
        SegmentAlgorithmTypeValues,
        SegmentationTypeValues,
        SegmentDescription,
    )
    from highdicom.sr.coding import CodedConcept
    from highdicom.color import CIELabColor
except ImportError as e:
    print(f"ERROR: Missing dependency — {e}")
    print("Install with: pip install pydicom highdicom numpy scikit-image")
    sys.exit(1)


# ── Constants ─────────────────────────────────────────────────────────────────

NS = "http://www.nih.gov"

# Radius (pixels) for small-nodule / non-nodule point-mass circles
POINT_RADIUS_PX = 6

# High-contrast CIELab colour palette — one entry per annotator
PALETTE = [
    [53, 80, 67],  # Red
    [88, -86, -14],  # Cyan
    [46, -51, 50],  # Green
    [97, -21, 94],  # Yellow
    [60, 98, -60],  # Magenta
    [67, 43, 74],  # Orange
    [30, 20, -50],  # Deep Blue/Purple
    [80, -70, 70],  # Lime
]
PALETTE_NAMES = [
    "Red",
    "Cyan",
    "Green",
    "Yellow",
    "Magenta",
    "Orange",
    "Deep Blue",
    "Lime",
]
NON_NODULE_COLOR = [75, 45, 70]


def _tag(name: str) -> str:
    return f"{{{NS}}}{name}"


# ── DICOM loading ─────────────────────────────────────────────────────────────


def load_and_sort_dicoms(ct_dir: str) -> list:
    """Load all DICOM slices from ct_dir, sorted by ImagePositionPatient Z."""
    dicoms = []
    for f in sorted(Path(ct_dir).glob("*.dcm")):
        try:
            dicoms.append(pydicom.dcmread(str(f)))
        except Exception as exc:
            print(f"  Warning: could not read {f.name}: {exc}")

    if not dicoms:
        raise ValueError(f"No DICOM files found in {ct_dir}")

    def sort_key(ds):
        if hasattr(ds, "ImagePositionPatient"):
            return (0, float(ds.ImagePositionPatient[2]))
        if hasattr(ds, "InstanceNumber"):
            return (1, int(ds.InstanceNumber))
        return (2, 0)

    dicoms.sort(key=sort_key)
    return dicoms


def filter_to_xml_sops(dicoms: list, xml_sops: set) -> list:
    """Keep only the DICOM slices referenced by the XML, in spatial order."""
    if not xml_sops:
        return dicoms
    filtered = [ds for ds in dicoms if getattr(ds, "SOPInstanceUID", None) in xml_sops]
    if not filtered:
        print("  Warning: no DICOMs matched XML SOP UIDs; using all slices")
        return dicoms
    return filtered


# ── XML parsing ───────────────────────────────────────────────────────────────


def _extract_xml_sop_uids(root: ET.Element) -> set:
    sops = set()
    for el in root.iter():
        if el.tag.endswith("imageSOP_UID") and el.text:
            sops.add(el.text.strip())
    return sops


def parse_xml_annotations(xml_path: str) -> list:
    """
    Parse an LIDC XML file and return a flat list of annotation dicts.

    Each dict has:
        category  : "large" (polygon nodule) | "small" (point-mass non-nodule)
        annotator : radiologist ID string
        local_id  : nodule / non-nodule ID string
        rois      : list of ROI dicts, each with
                        type : "polygon" or "point"
                        sop  : SOPInstanceUID string
                        x, y : list of ints (polygon) or single int (point)
    """
    tree = ET.parse(xml_path)
    root = tree.getroot()

    annotations = []

    for session in root.findall(f".//{_tag('readingSession')}"):
        ann_el = session.find(_tag("servicingRadiologistID"))
        annotator = (
            ann_el.text.strip() if (ann_el is not None and ann_el.text) else "Unknown"
        )

        # Large nodules — polygon contours
        for nodule in session.findall(_tag("unblindedReadNodule")):
            nid_el = nodule.find(_tag("noduleID"))
            if nid_el is None or not nid_el.text:
                continue
            nid = nid_el.text.strip()

            rois = []
            for roi in nodule.findall(_tag("roi")):
                sop_el = roi.find(_tag("imageSOP_UID"))
                if sop_el is None or not sop_el.text:
                    continue
                sop = sop_el.text.strip()
                edges = roi.findall(_tag("edgeMap"))
                if not edges:
                    continue

                def _int_coord(edge, tag_name):
                    el = edge.find(_tag(tag_name))
                    return int(el.text) if (el is not None and el.text) else 0

                xs = [_int_coord(e, "xCoord") for e in edges]
                ys = [_int_coord(e, "yCoord") for e in edges]
                if len(xs) >= 3:
                    rois.append({"type": "polygon", "sop": sop, "x": xs, "y": ys})

            if rois:
                annotations.append(
                    {
                        "category": "large",
                        "annotator": annotator,
                        "local_id": nid,
                        "rois": rois,
                    }
                )

        # Non-nodules — single point
        for non_nod in session.findall(_tag("nonNodule")):
            nid_el = non_nod.find(_tag("nonNoduleID"))
            if nid_el is None or not nid_el.text:
                continue
            nid = nid_el.text.strip()
            sop_el = non_nod.find(_tag("imageSOP_UID"))
            locus_el = non_nod.find(_tag("locus"))
            if sop_el is None or not sop_el.text or locus_el is None:
                continue
            sop = sop_el.text.strip()
            x_el = locus_el.find(_tag("xCoord"))
            y_el = locus_el.find(_tag("yCoord"))
            if x_el is None or not x_el.text or y_el is None or not y_el.text:
                continue
            x = int(x_el.text)
            y = int(y_el.text)
            annotations.append(
                {
                    "category": "small",
                    "annotator": annotator,
                    "local_id": nid,
                    "rois": [{"type": "point", "sop": sop, "x": x, "y": y}],
                }
            )

    return annotations


# ── Rasterisation ─────────────────────────────────────────────────────────────


def rasterise_annotations(annotations: list, dicoms: list) -> tuple:
    """
    Build a 4-D boolean pixel array (frames, rows, cols, segments) and a
    matching list of SegmentDescription objects.

    Returns (pixel_array, descriptions) or (None, []) if no masks were generated.
    """
    if not annotations:
        return None, []

    rows = dicoms[0].Rows
    cols = dicoms[0].Columns
    n_frames = len(dicoms)
    n_segs = len(annotations)

    sop_to_z = {ds.SOPInstanceUID: i for i, ds in enumerate(dicoms)}

    # shape: (n_segs, n_frames, rows, cols)
    masks = np.zeros((n_segs, n_frames, rows, cols), dtype=bool)

    # Assign stable annotator indices
    annotator_idx: dict = {}
    _next_ann = 1

    descriptions = []

    for seg_i, ann in enumerate(annotations):
        annot = ann["annotator"]
        if annot not in annotator_idx:
            annotator_idx[annot] = _next_ann
            _next_ann += 1
        a_seq = annotator_idx[annot]

        is_large = ann["category"] == "large"
        label = (
            f"ann{a_seq}_nod_{ann['local_id']}"
            if is_large
            else f"ann{a_seq}_small_{ann['local_id']}"
        )

        if is_large:
            lab = PALETTE[(a_seq - 1) % len(PALETTE)]
        else:
            lab = NON_NODULE_COLOR
        color = CIELabColor(lab[0], lab[1], lab[2])

        desc = SegmentDescription(
            segment_number=seg_i + 1,
            segment_label=label,
            segmented_property_category=CodedConcept(
                "91723000", "SCT", "Anatomical Structure"
            ),
            segmented_property_type=CodedConcept("55603005", "SCT", "Lung Nodule"),
            algorithm_type=SegmentAlgorithmTypeValues.MANUAL,
            display_color=color,
        )
        descriptions.append(desc)

        voxels = 0
        for roi in ann["rois"]:
            sop = roi["sop"]
            if sop not in sop_to_z:
                continue
            z = sop_to_z[sop]

            if roi["type"] == "polygon":
                rr, cc = polygon(roi["y"], roi["x"], shape=(rows, cols))
                if len(rr):
                    masks[seg_i, z, rr, cc] = True
                    voxels += len(rr)
            elif roi["type"] == "point":
                rr, cc = disk(
                    (roi["y"], roi["x"]), radius=POINT_RADIUS_PX, shape=(rows, cols)
                )
                if len(rr):
                    masks[seg_i, z, rr, cc] = True
                    voxels += len(rr)

        if voxels == 0:
            print(f"  Warning: {label} — no voxels rasterised (SOP mismatch?)")

    # Move segment axis to last: (n_frames, rows, cols, n_segs)
    pixel_array = np.moveaxis(masks, 0, -1)
    return pixel_array, descriptions


# ── DICOM SEG writing ─────────────────────────────────────────────────────────


def save_dicom_seg(
    dicoms: list,
    pixel_array,
    descriptions: list,
    output_path: str,
    series_description: str = "LIDC Annotation",
) -> bool:
    """Write a DICOM SEG file using highdicom."""
    if pixel_array is None or not descriptions:
        print("ERROR: no masks to save")
        return False

    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    seg = Segmentation(
        source_images=dicoms,
        pixel_array=pixel_array.astype(np.uint8),
        segmentation_type=SegmentationTypeValues.BINARY,
        segment_descriptions=descriptions,
        series_instance_uid=generate_uid(),
        series_number=900,
        sop_instance_uid=generate_uid(),
        instance_number=1,
        manufacturer="LIDC_Pipeline",
        manufacturer_model_name="Python_HighDicom",
        software_versions="1.0",
        device_serial_number="001",
        series_description=series_description,
        omit_empty_frames=True,
    )

    # Carry over patient metadata
    for attr in (
        "PatientID",
        "PatientName",
        "PatientSex",
        "PatientAge",
        "PatientBirthDate",
    ):
        if hasattr(dicoms[0], attr):
            setattr(seg, attr, getattr(dicoms[0], attr))

    seg.save_as(output_path)
    print(f"SUCCESS: DICOM SEG saved to {output_path}")
    return True


# ── Top-level conversion ──────────────────────────────────────────────────────


def lidc_xml_to_seg(
    ct_dir: str, xml_file: str, output_path: str, fmt: str = "combined"
) -> bool:
    """
    Full pipeline: load CT → parse XML → rasterise → write DICOM SEG.

    Args:
        ct_dir      : CT DICOM directory
        xml_file    : LIDC annotation XML path
        output_path : Output DICOM SEG path (used for "combined"; per_annotator
                      files are named <output_stem>_ann1.dcm etc.)
        fmt         : "combined" | "per_annotator" | "both"

    Returns:
        True on success, False on failure.
    """
    print(f"Loading CT from: {ct_dir}")
    dicoms = load_and_sort_dicoms(ct_dir)
    print(f"  {len(dicoms)} slices loaded")

    print(f"Parsing XML: {xml_file}")
    tree = ET.parse(xml_file)
    xml_sops = _extract_xml_sop_uids(tree.getroot())
    dicoms = filter_to_xml_sops(dicoms, xml_sops)
    print(f"  {len(dicoms)} slices matched XML SOPs")

    annotations = parse_xml_annotations(xml_file)
    print(f"  {len(annotations)} annotations found")

    if not annotations:
        print("ERROR: no annotations in XML")
        return False

    fmt = fmt.lower().strip()
    output_stem = Path(output_path).with_suffix("").with_suffix("")  # strip .dcm

    ok = True

    if fmt in ("combined", "both"):
        pixel_array, descriptions = rasterise_annotations(annotations, dicoms)
        out = (
            str(output_path)
            if fmt == "combined"
            else str(output_stem) + "_Combined_SEG.dcm"
        )
        ok &= save_dicom_seg(
            dicoms,
            pixel_array,
            descriptions,
            out,
            f"LIDC Combined — {Path(xml_file).stem}",
        )

    if fmt in ("per_annotator", "both"):
        # Group by annotator
        by_annotator: dict = {}
        for ann in annotations:
            by_annotator.setdefault(ann["annotator"], []).append(ann)

        for idx, (annot, anns) in enumerate(sorted(by_annotator.items()), start=1):
            pixel_array, descriptions = rasterise_annotations(anns, dicoms)
            out = str(output_stem) + f"_ann{idx}_SEG.dcm"
            ok &= save_dicom_seg(
                dicoms,
                pixel_array,
                descriptions,
                out,
                f"LIDC Ann{idx} — {Path(xml_file).stem}",
            )

    return ok


# ── CLI ───────────────────────────────────────────────────────────────────────


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(1)

    ct_dir = sys.argv[1]
    xml_file = sys.argv[2]
    output_path = sys.argv[3]
    fmt = "combined"
    if "--format" in sys.argv:
        i = sys.argv.index("--format")
        if i + 1 < len(sys.argv):
            fmt = sys.argv[i + 1]

    if not Path(ct_dir).exists():
        print(f"ERROR: CT directory not found: {ct_dir}")
        sys.exit(1)
    if not Path(xml_file).exists():
        print(f"ERROR: XML file not found: {xml_file}")
        sys.exit(1)

    success = lidc_xml_to_seg(ct_dir, xml_file, output_path, fmt)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
