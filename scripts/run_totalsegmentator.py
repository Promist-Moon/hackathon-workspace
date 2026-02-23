#!/usr/bin/env python3
"""
TotalSegmentator Runner
=======================
Runs TotalSegmentator (lung_nodules task) directly on a DICOM CT series and
writes the result as a DICOM SEG file.

Usage:
    python run_totalsegmentator.py <dicom_dir> <output_seg.dcm> [--fast]

Example:
    python run_totalsegmentator.py \\
        data/LIDC-IDRI-0001/ct \\
        data/LIDC-IDRI-0001/annotations/LIDC-IDRI-0001_lung_nodules_seg.dcm \\
        --fast

Arguments:
    dicom_dir    : Directory containing the CT DICOM slices (1-001.dcm … 1-NNN.dcm)
    output_seg   : Output DICOM SEG file path
    --fast       : Use fast (lower-resolution) mode — roughly 3× faster on CPU

Requirements:
    pip install TotalSegmentator torch

Notes:
    - TotalSegmentator >= 2.x accepts DICOM directories as direct input and can
      write DICOM SEG output natively via --output_type dicom_seg.
    - First run downloads model weights (~1.5 GB).
    - On CPU without --fast: expect 15–30 minutes per case.
    - On CPU with    --fast: expect  5–10 minutes per case.
    - GPU reduces this to under 1 minute.
"""

import sys
import subprocess
from pathlib import Path


def _has_cuda() -> bool:
    try:
        import torch

        return torch.cuda.is_available()
    except ImportError:
        return False


def run_totalsegmentator(dicom_dir: str, output_path: str, fast: bool = False) -> bool:
    """
    Run TotalSegmentator (lung_nodules task) on a DICOM directory.

    TotalSegmentator >= 2.x can accept a DICOM directory directly as input
    and emit a DICOM SEG file — no intermediate NIfTI conversion required.

    Args:
        dicom_dir   : Path to directory containing CT DICOM slices
        output_path : Output DICOM SEG file path (.dcm)
        fast        : Enable fast (lower-resolution) mode

    Returns:
        True if successful, False otherwise
    """
    dicom_path = Path(dicom_dir)
    if not dicom_path.exists():
        print(f"ERROR: DICOM directory not found: {dicom_dir}")
        return False

    dcm_files = list(dicom_path.glob("*.dcm"))
    if not dcm_files:
        print(f"ERROR: No .dcm files found in {dicom_dir}")
        return False

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    device = "gpu" if _has_cuda() else "cpu"

    print(f"Input  : {dicom_dir}  ({len(dcm_files)} slices)")
    print(f"Output : {output_path}")
    print(f"Task   : lung_nodules")
    print(f"Fast   : {fast}")
    print(f"Device : {device}")
    print()
    print("Running TotalSegmentator…")
    print("(First run downloads model weights — this may take a few minutes)")
    print()

    cmd = [
        "TotalSegmentator",
        "-i",
        str(dicom_path),
        "-o",
        str(output_file),
        "-ta",
        "lung_nodules",
        "--device",
        device,
        "--output_type",
        "dicom_seg",
        "--statistics",
    ]
    if fast:
        cmd.append("--fast")

    result = subprocess.run(cmd, check=False)

    if result.returncode != 0:
        print(f"ERROR: TotalSegmentator exited with code {result.returncode}")
        return False

    if not output_file.exists():
        print(f"ERROR: Expected output file not found: {output_file}")
        return False

    print()
    print(f"SUCCESS: DICOM SEG saved to {output_path}")
    return True


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    dicom_dir = sys.argv[1]
    output_path = sys.argv[2]
    fast = "--fast" in sys.argv

    success = run_totalsegmentator(dicom_dir, output_path, fast)
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
