#!/usr/bin/env python3
"""
Segmentation API Server
=======================
A minimal FastAPI server that exposes a /segment endpoint for the hackathon
Bonus A task. Receives a LIDC case ID, runs TotalSegmentator on the CT data,
and returns the path to the resulting DICOM SEG file.

Pipeline (single step):
    CT DICOM directory → TotalSegmentator → DICOM SEG output
    (TotalSegmentator >= 2.x handles the full conversion internally)

Usage:
    # Install dependencies (activate your venv first)
    pip install fastapi uvicorn TotalSegmentator torch

    # Start the server (from hackathon-workspace root)
    python scripts/segment_server.py

    # Or with uvicorn directly
    uvicorn scripts.segment_server:app --host 0.0.0.0 --port 8000 --reload

API:
    GET  /health
         → { "status": "ok" }

    POST /segment
         Body:     { "case_id": "LIDC-IDRI-0001" }
         Response: { "seg_path": "data/LIDC-IDRI-0001/annotations/LIDC-IDRI-0001_lung_nodules_seg.dcm",
                     "status": "ok" }

Notes:
    - If the output DICOM SEG already exists it is returned immediately, so you
      can test the frontend without waiting for the model to finish.
    - TotalSegmentator downloads ~1.5 GB of model weights on first use.
    - On CPU with --fast: ~5–10 minutes per case.
    - CORS is enabled for localhost:3000 (the Vite dev server).
"""

import sys
import logging
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
WORKSPACE_ROOT = SCRIPT_DIR.parent
DATA_DIR = WORKSPACE_ROOT / "data"

# Ensure scripts/ is on the path so run_totalsegmentator can be imported
# whether this module is run directly or loaded via uvicorn.
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

try:
    from fastapi import FastAPI, HTTPException
    from fastapi.middleware.cors import CORSMiddleware
    from pydantic import BaseModel
    import uvicorn
except ImportError:
    print("ERROR: FastAPI / uvicorn not installed.")
    print("Install with: pip install fastapi uvicorn")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

KNOWN_STUDIES = {"LIDC-IDRI-0001", "LIDC-IDRI-0002", "LIDC-IDRI-0003"}

app = FastAPI(title="Segmentation API", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class SegmentRequest(BaseModel):
    case_id: str


class SegmentResponse(BaseModel):
    seg_path: str
    status: str = "ok"


def run_pipeline(case_id: str) -> str:
    """
    Run TotalSegmentator on the CT DICOM directory for the given case.

    TotalSegmentator >= 2.x accepts a DICOM directory directly as input and
    writes a DICOM SEG file when --output_type dicom_seg is specified.

    Returns the seg_path relative to the workspace root, or raises RuntimeError.
    """
    ct_dir = DATA_DIR / case_id / "ct"
    annotations_dir = DATA_DIR / case_id / "annotations"
    output_dcm = annotations_dir / f"{case_id}_lung_nodules_seg.dcm"

    if not ct_dir.exists():
        raise RuntimeError(f"CT directory not found: {ct_dir}")

    # Return pre-computed result immediately if it exists
    if output_dcm.exists():
        log.info(f"Pre-computed segmentation found: {output_dcm}")
        return str(output_dcm.relative_to(WORKSPACE_ROOT))

    annotations_dir.mkdir(parents=True, exist_ok=True)

    log.info(f"[{case_id}] Running TotalSegmentator (lung_nodules, CPU, fast)…")
    from run_totalsegmentator import run_totalsegmentator

    ok = run_totalsegmentator(str(ct_dir), str(output_dcm), fast=True)
    if not ok:
        raise RuntimeError("TotalSegmentator failed — check server logs for details")

    log.info(f"[{case_id}] Done → {output_dcm}")
    return str(output_dcm.relative_to(WORKSPACE_ROOT))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/segment", response_model=SegmentResponse)
def segment(req: SegmentRequest):
    case_id = req.case_id.strip()
    log.info(f"POST /segment  case_id={case_id}")

    if case_id not in KNOWN_STUDIES:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown case_id '{case_id}'. Valid: {sorted(KNOWN_STUDIES)}",
        )

    try:
        seg_path = run_pipeline(case_id)
    except RuntimeError as exc:
        log.error(f"Pipeline failed for {case_id}: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        log.exception(f"Unexpected error for {case_id}")
        raise HTTPException(status_code=500, detail=str(exc))

    return SegmentResponse(seg_path=seg_path)


if __name__ == "__main__":
    log.info(f"Workspace root : {WORKSPACE_ROOT}")
    log.info(f"Data directory : {DATA_DIR}")
    log.info("Starting server on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
