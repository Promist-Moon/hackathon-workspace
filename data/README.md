# Data Directory

This directory contains 3 LIDC-IDRI chest CT cases with radiologist annotations and pre-computed AI segmentations.

## Structure

```
data/
├── LIDC-IDRI-0001/
│   ├── ct/                              # CT DICOM slices (1-001.dcm … 1-133.dcm)
│   └── annotations/
│       ├── 069.xml                      # LIDC radiologist XML annotations
│       ├── LIDC-IDRI-0001_Combined_SEG.dcm      # LIDC nodule masks (DICOM SEG)
│       └── LIDC-IDRI-0001_lung_nodules_seg.dcm  # TotalSegmentator output (DICOM SEG)
├── LIDC-IDRI-0002/                      # Same structure
├── LIDC-IDRI-0003/                      # Same structure
└── README.md
```

## Cases

| Patient | CT Slices | XML File | Nodules |
|---------|-----------|----------|---------|
| LIDC-IDRI-0001 | 133 | 069.xml | 10 |
| LIDC-IDRI-0002 | 261 | 071.xml | 23 |
| LIDC-IDRI-0003 | 140 | 072.xml | 13 |

## How the Viewer Accesses Data

Vite serves `public/data` → `../data` via a symlink, so all files are accessible at:

```
/data/LIDC-IDRI-0001/ct/1-001.dcm
/data/LIDC-IDRI-0001/annotations/069.xml
/data/LIDC-IDRI-0001/annotations/LIDC-IDRI-0001_Combined_SEG.dcm
...
```

The viewer does not auto-load any study on startup. Use the Studies panel (Task 1) to select a case, which loads its CT slices into the viewer.

## Annotation Format

The XML files follow the LIDC-IDRI schema. Each `<roi>` element contains:
- `<imageZposition>` — Z coordinate in mm
- `<imageSOP_UID>` — which DICOM slice this contour belongs to
- `<edgeMap>` elements — pixel (x, y) coordinates of the contour

## Segmentation Files

- `*_Combined_SEG.dcm` — DICOM SEG rasterized from the LIDC XML contours (binary, per-annotator)
- `*_lung_nodules_seg.dcm` — TotalSegmentator lung nodule segmentation output
