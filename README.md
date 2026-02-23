# Atomorphic Mini Hackathon - DICOM Annotation Workspace

Welcome to the Atomorphic Mini Hackathon! This workspace contains a working DICOM viewer built with Cornerstone3D. Your challenge is to extend it with a study selector, annotation display, and AI segmentation features.

## Quick Start

```bash
# Clone the workspace
git clone https://github.com/atomorphic/hackathon-workspace.git
cd hackathon-workspace

# Install dependencies
npm install

# Start development server
npm run dev
```

Open http://localhost:3000 in your browser.

## What's Already Working

- DICOM image loading (drag & drop or file picker)
- Image navigation (scroll through slices)
- Window/Level adjustment
- Pan and zoom
- Basic annotation tools (Length, Rectangle, Freehand)
- Export annotations to JSON

## Your Hackathon Tasks

Implement the handler functions in `src/App.tsx` (look for the TODO markers):

| Task | Button / Location | Description |
|------|-------------------|-------------|
| Task 1 | Studies panel (left sidebar) | Build a study selector that lists all LIDC cases and loads the selected one |
| Task 2 | **Load GT** button | Parse the LIDC XML annotations and display nodule contours |
| Task 3 | **Run AI** button | Run TotalSegmentator or MONAI Label on the active study |
| Task 4 | **Show AI Seg** button | Load and display the segmentation result as a coloured overlay |
| Bonus A | **AI Assist** button | Call a segmentation API and display the result end-to-end |
| Bonus B | *(open-ended)* | UI polish and extra viewer tools |

See `HACKATHON_TASKS.md` for full specifications and hints for each task.

## Project Structure

```
hackathon-workspace/
├── src/
│   ├── main.tsx             # React entry point
│   ├── App.tsx              # Main React component — YOUR TASKS ARE HERE
│   ├── core/
│   │   ├── init.ts          # Cornerstone3D initialisation (do not modify)
│   │   └── loader.ts        # DICOM loading + LIDC_STUDIES metadata + loadStudy()
│   └── styles.css           # Application styles
├── data/
│   └── LIDC-IDRI-000X/      # 3 patient cases included (0001–0003)
│       ├── ct/              # CT DICOM slices (1-001.dcm … 1-NNN.dcm)
│       └── annotations/     # XML + pre-computed DICOM SEG files
├── scripts/
│   ├── run_totalsegmentator.py  # Run TotalSegmentator on a DICOM CT dir → DICOM SEG
│   ├── lidc_xml_to_seg.py       # Convert LIDC annotation XML → DICOM SEG
│   ├── parse_lidc_xml.py        # Parse LIDC XML (reference/study for Task 2)
│   ├── segment_server.py        # FastAPI server wrapping TotalSegmentator (Task 3 / Bonus A)
│   └── requirements.txt         # Python dependencies for all scripts
├── public/
│   └── data/                # Symlink → ../data (served at /data/ by Vite)
├── index.html               # Vite HTML entry
├── package.json             # Node.js dependencies
├── vite.config.ts           # Vite bundler configuration
└── tsconfig.json            # TypeScript configuration
```

## Key File to Modify

### `src/App.tsx`

Four task stubs + one bonus stub, each with a TODO comment:

```typescript
// TASK 1 — implement this:
const handleSelectStudy = useCallback(async (caseId: string) => {
  // TODO: load CT slices for the selected study, update activeStudy state
}, [])

// TASK 2 — implement this:
const handleLoadGT = useCallback(async () => {
  // TODO: fetch LIDC XML for activeStudy, parse, display as PlanarFreehandROI annotations
}, [])

// TASK 3 — implement this:
const handleRunAI = useCallback(async () => {
  // TODO: trigger AI segmentation model on activeStudy's CT data
}, [])

// TASK 4 — implement this:
const handleShowAISeg = useCallback(async () => {
  // TODO: load DICOM SEG result and display as labelmap overlay
}, [])

// BONUS A — implement this:
const handleAIAssist = useCallback(async () => {
  // TODO: POST to segmentation API, await result, display overlay
}, [])
```

### `src/core/loader.ts`

Exports you will need:

| Export | Description |
|--------|-------------|
| `LIDC_STUDIES` | Array of `{ id, slices, xml }` for all 3 cases |
| `loadStudy(caseId, onProgress?)` | Loads CT slices for a given case ID into the viewer |
| `loadDicomFiles(files, onProgress?)` | Loads File objects into the viewer |
| `getImageIds()` | Returns the currently loaded image ID array |

## Data Files

Three LIDC-IDRI cases are included in the repository. All data is served under `/data/` at runtime (via the `public/data` symlink).

### CT Slices
```
/data/LIDC-IDRI-000X/ct/1-001.dcm  …  1-NNN.dcm
```

### Ground Truth XML
```
/data/LIDC-IDRI-000X/annotations/<xml-file>.xml
```

### Pre-computed Segmentations (DICOM SEG)
```
/data/LIDC-IDRI-000X/annotations/LIDC-IDRI-000X_Combined_SEG.dcm        ← LIDC nodule masks (from XML)
/data/LIDC-IDRI-000X/annotations/LIDC-IDRI-000X_lung_nodules_seg.dcm    ← TotalSegmentator output
```

See `data/README.md` for the case list with slice counts and XML filenames.

## Python Environment (Task 3 / Bonus A)

Set up a self-contained virtual environment using the provided requirements file:

```bash
python -m venv .venv
source .venv/bin/activate          # Linux/macOS
# .venv\Scripts\activate           # Windows

# Install PyTorch first (CPU-only build is much smaller):
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Install remaining script dependencies:
pip install -r scripts/requirements.txt
```

Then start the segmentation API server:

```bash
python scripts/segment_server.py   # starts on http://localhost:8000
```

See `HACKATHON_TASKS.md § Task 3` for the full pipeline walkthrough.

## Useful References

- [Cornerstone3D docs](https://www.cornerstonejs.org/docs/) — viewports, tools, annotations, segmentation API
- [MDN: DOMParser](https://developer.mozilla.org/en-US/docs/Web/API/DOMParser) — browser XML parsing
- [MDN: getElementsByTagNameNS](https://developer.mozilla.org/en-US/docs/Web/API/Element/getElementsByTagNameNS) — namespace-aware XML lookup
- [dcmjs](https://github.com/dcmjs-org/dcmjs) — JavaScript DICOM SEG decoding
- [TotalSegmentator](https://github.com/wasserth/TotalSegmentator) — CLI and Python API reference

## Tips for Success

1. **Start with Task 1** — it unlocks the rest (Tasks 2–4 depend on `activeStudy`)
2. **Pre-computed SEG files exist** — Task 4 is independently achievable even if Task 3 is incomplete
3. **Partial solutions earn credit** — don't get stuck; move on and return
4. **Use your AI agent** — but verify what it produces; coordinate systems are a common gotcha
5. **Commit frequently** — show your progress even if incomplete

## Troubleshooting

### "Cannot find module" errors
```bash
rm -rf node_modules package-lock.json
npm install
```

### CORS errors
Make sure you're accessing via `http://localhost:3000`, not `file://`

### Viewport is black
- Check browser console for errors
- Ensure a study has been loaded (Task 1)
- Try the Reset button

### Segmentation overlay doesn't appear on the right slices
The coordinate systems between DICOM pixel space, canvas space, and world space are different. See `HACKATHON_TASKS.md` hints and the Cornerstone3D docs on `utilities.imageToWorldCoords`.

### Script errors — missing Python packages
Set up the virtual environment first:
```bash
python -m venv .venv
source .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r scripts/requirements.txt
```
