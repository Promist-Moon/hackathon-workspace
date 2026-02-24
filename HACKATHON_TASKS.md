# Hackathon Tasks - DICOM Annotation Viewer

**Atomorphic Mini Hackathon - NUS Q1 2026**  
**Duration**: 2 hours (16:00–18:00) + 30 min report writing (18:00–18:30)

---

## Overview

You have a working DICOM viewer built with Cornerstone3D. Your mission is to implement the four task buttons in the toolbar and, if time permits, one or both bonus features.

**Where to code**: `src/App.tsx` — look for the `handle*` functions with TODO markers

**Tasks to implement**:

| Task | Description |
|------|-------------|
| Task 1 | Study Selector Panel |
| Task 2 | Load & Display Ground Truth |
| Task 3 | Run AI Segmentation Model |
| Task 4 | Load & Display AI Segmentation |
| Bonus A | AI-Assisted Segmentation |
| Bonus B | UI Polish & Extra Tools |

**Partial credit is awarded.** Even incomplete implementations earn credit — show your thinking.

---

## Task 1: Study Selector Panel

**Goal**: Build a panel that lists all available LIDC studies and loads the selected study's CT slices into the viewer when clicked.

### What to build

- Display the list of LIDC studies in the Studies panel (left sidebar)
- When a study is clicked, load its CT slices into the viewer
- Show which study is currently active (highlight or label)

### What's available

`LIDC_STUDIES` (exported from `./core/loader`) is an array of study metadata objects, each with `id`, `slices`, and `xml` fields. `loadStudy(caseId)` (also in `./core/loader`) loads the CT slices for a given case ID into the viewer.

### Hints

- The Studies panel placeholder is already in the JSX — find the `Task 1: implement study selector` comment and replace it with your implementation
- `LIDC_STUDIES` and `loadStudy` are available from `./core/loader` — import `loadStudy` alongside `LIDC_STUDIES` if you haven't already
- Use `activeStudy` state (already defined) to track and highlight the selected study
- Tasks 2–4 should use `activeStudy` to know which study's annotations and segmentations to load

### What to include in your report

1. How did you structure the panel and manage the active study state?
2. What edge cases did you consider (e.g. switching studies while annotations are loaded)?
3. If you used AI: what did it get wrong and what did you have to fix?

---

## Task 2: Load Ground Truth Annotations

**Goal**: When "Load GT" is clicked, load the LIDC XML annotations for the active study and display nodule contours as freehand overlays on the correct slices.

### What to build

- Fetch the XML file for the active study from `data/<activeStudy>/annotations/<xml>`
- Parse the XML to extract per-slice nodule contours
- Display each contour as a `PlanarFreehandROI` annotation on the matching slice

### Hints

- The LIDC XML uses a default namespace (`xmlns="http://www.nih.gov"`). Standard `getElementsByTagName` will not find elements — you need namespace-aware querying. See [MDN: getElementsByTagNameNS](https://developer.mozilla.org/en-US/docs/Web/API/Element/getElementsByTagNameNS).
- Each `<roi>` has an `<imageZposition>` (Z in mm) and a list of `<edgeMap>` elements with `<xCoord>` / `<yCoord>` in image pixel coordinates.
- Cornerstone3D annotations use **world coordinates** (mm), not pixel indices. There is a utility in `@cornerstonejs/core` that converts image pixel coordinates to world coordinates — look at the `utilities` export. Its signature is `(imageId, [row, col])` — note the order: row first, then column (i.e. `[yCoord, xCoord]` from the LIDC `<edgeMap>`).
- The Z coordinate comes directly from `<imageZposition>` — it is already in mm.
- To add annotations programmatically, use `annotation.state.addAnnotation()` from `@cornerstonejs/tools`. See [Cornerstone3D docs](https://www.cornerstonejs.org/docs/).
- `scripts/parse_lidc_xml.py` shows the XML structure in Python if you want to study it first.

### What to include in your report

1. What approach did you take to match XML contours to the correct DICOM slices?
2. What was confusing or unexpected about the coordinate conversion?
3. If you used AI: what did it get wrong and what did you have to fix?

---

## Task 3: Run AI Segmentation Model

**Goal**: When "Run AI" is clicked, trigger an AI segmentation model on the active study's CT data and retrieve the segmentation result.

### What to build

Run **TotalSegmentator** on the CT data in `data/<activeStudy>/ct/` and produce a DICOM SEG file that Task 4 can display. How you connect the frontend to the Python backend is up to you.

### Approach is open-ended

There is no single correct solution. Some options:

- Start `scripts/segment_server.py` (a FastAPI server already provided) and have the button POST to its `/segment` endpoint
- Run the pipeline manually in a terminal and implement a "poll for results" UI that detects when the output file appears
- Implement a drag-and-drop fallback that accepts a segmentation file the user pre-generated

Any working progress toward automation earns credit.

### Scripts available

- `scripts/run_totalsegmentator.py` — runs TotalSegmentator (`lung_nodules` task) directly on the CT DICOM directory, outputs a DICOM SEG file in one step
- `scripts/lidc_xml_to_seg.py` — converts LIDC annotation XML → DICOM SEG (this is how the pre-computed `_Combined_SEG.dcm` files were generated)
- `scripts/segment_server.py` — FastAPI server that wraps `run_totalsegmentator.py` behind a `POST /segment` endpoint
- `scripts/requirements.txt` — Python dependency list for all of the above

The TotalSegmentator pipeline is a **single step** — it accepts a DICOM directory as input and emits a DICOM SEG directly:

```
CT DICOM directory  →  TotalSegmentator  →  DICOM SEG output
```

### Python setup

Set up a Python virtual environment from the provided requirements file:

```bash
python -m venv .venv
source .venv/bin/activate          # Linux/macOS
# .venv\Scripts\activate           # Windows

# Install PyTorch (CPU-only build is much smaller):
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Install remaining dependencies:
pip install -r scripts/requirements.txt
```

### Running the pipeline manually

```bash
source .venv/bin/activate

python scripts/run_totalsegmentator.py \
    data/LIDC-IDRI-0001/ct \
    data/LIDC-IDRI-0001/annotations/LIDC-IDRI-0001_lung_nodules_seg.dcm \
    --fast
```

`--fast` uses lower resolution and is roughly 3× faster on CPU with minimal quality loss.

### Running the segmentation API server

```bash
source .venv/bin/activate
python scripts/segment_server.py
```

The server starts on `http://localhost:8000`. Test it:

```bash
curl -s -X POST http://localhost:8000/segment \
     -H "Content-Type: application/json" \
     -d '{"case_id": "LIDC-IDRI-0001"}'
# → {"seg_path": "data/LIDC-IDRI-0001/annotations/LIDC-IDRI-0001_lung_nodules_seg.dcm", "status": "ok"}
```

If the DICOM SEG already exists, it is returned immediately without re-running the model — use this during frontend integration development so you don't have to wait.

### Model timing (CPU)

| Mode | Approximate time |
|------|-----------------|
| `--fast` | ~5–10 min |
| Full resolution | ~15–30 min |

Pre-computed results are already in `data/<activeStudy>/annotations/` — use them for Task 4 if you want to skip the wait.

### Hints

- The key design question is: how does the frontend know when the model is done? Polling? Promise? Manual trigger?
- `segment_server.py` returns the pre-computed file immediately if it already exists, so frontend integration testing is fast even without running the model
- The `seg_path` returned by the server is relative to the workspace root; prepend `/` to use it as a browser URL
- Think about error handling: what should the UI show if the server is not running?

### What to include in your report

1. What integration approach did you choose and why?
2. What was the hardest part of connecting the Python model to the browser?
3. If you used AI: what did it get wrong and what did you have to fix?

---

## Task 4: Load & Display AI Segmentation

**Goal**: When "Show AI Seg" is clicked, load a DICOM SEG segmentation file and display it as a coloured overlay on the CT images.

### What to build

- Load a DICOM SEG file (from Task 3's output, or from the pre-computed fallback below)
- Display it as a labelmap overlay using Cornerstone3D's segmentation API
- Show the segment names and colours in the Segments panel (right sidebar)

### Pre-computed fallback

Even if Task 3 is not complete, you can use these files directly:

```
data/LIDC-IDRI-0001/annotations/LIDC-IDRI-0001_lung_nodules_seg.dcm   ← TotalSegmentator output
data/LIDC-IDRI-0001/annotations/LIDC-IDRI-0001_Combined_SEG.dcm       ← LIDC nodule masks
```

### Hints

- DICOM SEG is a multi-frame binary format — more complex than a standard DICOM image. Look at [dcmjs](https://github.com/dcmjs-org/dcmjs) for JavaScript-side DICOM SEG decoding.
- Cornerstone3D's `@cornerstonejs/tools` has a `segmentation` module. Look at the API docs for `addSegmentations` and `addLabelmapRepresentationToViewportMap`. The representation type is `Labelmap`.
- The overlay must align with the CT slices. If segments appear on the wrong slice, the coordinate mapping is wrong.
- Populating the Segments panel with segment names and colours earns additional credit.

### What to include in your report

1. How did you load and decode the DICOM SEG file?
2. Did the overlay align correctly with the CT? If not, what did you do to fix it?
3. If you used AI: what did it get wrong and what did you have to fix?

---

## Bonus A: AI-Assisted Segmentation

**Goal**: Add a button that calls a segmentation API endpoint, receives the result, and immediately displays it as an overlay on the current study — all in one click with appropriate loading feedback.

### What to build

- A button (e.g. "AI Assist") that POSTs the active study ID to a local segmentation API
- While waiting, show a loading indicator in the status bar or UI
- On success, load the returned segmentation and display it as a labelmap overlay (reuse your Task 4 display logic)
- On failure, show a clear error message

### API contract

`scripts/segment_server.py` provides this API at `http://localhost:8000`:

```
GET  /health
     → { "status": "ok" }

POST /segment
     Body: { "case_id": "LIDC-IDRI-0001" }
     Response: { "seg_path": "data/LIDC-IDRI-0001/annotations/LIDC-IDRI-0001_lung_nodules_seg.dcm",
                 "status": "ok" }
```

Start the server before testing (see Task 3 for setup instructions).

### Hints

- This bonus builds on Task 4 — get the overlay display working first, then wire up the API call
- The server returns the pre-computed file immediately if the segmentation already exists — use this during development so you don't have to wait for the model
- Think carefully about UX: the model may take minutes on CPU. How will the user know it's running?
- Consider disabling the button while a request is in flight to prevent duplicate submissions
- The `seg_path` returned by the server is relative to the workspace root; prefix it with `/` to form a URL the browser can fetch (e.g. `/data/LIDC-IDRI-0001/annotations/…`)

### What to include in your report

1. How did you handle the latency between clicking the button and receiving the result?
2. What did you build for the server side?
3. If you used AI: what did it get wrong and what did you have to fix?

---

## Bonus B: UI Polish & Extra Features

**Goal**: Implement one well-executed improvement that makes the viewer more useful.

### Ideas

- Slice slider — a range input for scrubbing through slices visually
- Keyboard shortcuts (`W` = W/L, `P` = Pan, `Z` = Zoom, arrow keys = prev/next slice)
- DICOM metadata panel — show patient name, study date, pixel spacing from the loaded scan
- Segment visibility toggles — checkboxes to show/hide individual segmentation labels
- Annotation labels — show tool name and slice number on each annotation
- Loading progress bar

### Judging

One well-implemented, genuinely useful feature scores higher than five half-finished ones. Quality and visual polish matter.

---

## Tips for Success

1. **Start with Task 1** — it unlocks the rest of the tasks
2. **Pre-computed files exist** — Task 4 is independently achievable even if Task 3 is incomplete
3. **Partial solutions earn credit** — don't get stuck; move on and return
4. **Use your AI agent** — but verify what it produces; the coordinate systems are a common gotcha
5. **Commit frequently** — show your progress even if incomplete

---

## Submission

When time is up (18:00):

1. Commit and push to **your fork**:
   ```bash
   git add .
   git commit -m "Hackathon submission"
   git push
   ```
   > If you haven't forked yet: go to [github.com/atomorphic/hackathon-workspace](https://github.com/atomorphic/hackathon-workspace), click **Fork**, then clone your fork.
2. **Grant repo access** to `atomorphic@gmail.com` on your fork (Settings → Collaborators)
3. **Email** `team@atomorphic.ai` with your GitHub repo link and confirmation that access is granted
4. **Write your report** (18:00–18:30) using `REPORT_TEMPLATE.md`

---

## Evaluation

We evaluate overall performance holistically — there is no fixed point allocation visible to you. We look at:

- **Functionality** — does it work?
- **Code quality** — is it clean and well-structured?
- **Understanding** — can you explain your decisions? (this is probed in the follow-up interview)
- **AI agility** — did you use AI tools effectively while maintaining your own understanding?

Partial implementations are valued. A working Task 1 with a clear explanation of what you attempted on Tasks 2–4 is much better than silence.

---

**Good luck!**
