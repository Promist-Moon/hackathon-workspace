// =============================================================================
// DICOM Annotation Viewer — Main Application
// Atomorphic Mini Hackathon
// =============================================================================
//
// This viewer is ALREADY WORKING (load DICOM, scroll, W/L, draw annotations).
// Your four hackathon tasks are to ADD NEW FEATURES using the skeleton
// functions below — look for the TODO markers!
//
// Tasks summary:
//   Task 1 — Study Selector          → handleSelectStudy()
//   Task 2 — Load Ground Truth        → handleLoadGT()
//   Task 3 — Run AI Segmentation      → handleRunAI()
//   Task 4 — Show AI Segmentation     → handleShowAISeg()
//   Bonus A — AI-Assisted Segmentation → handleAIAssist()
//   Bonus B — UI Polish / Extra Tools
//
// See HACKATHON_TASKS.md for full specifications and hints.
// =============================================================================

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  initCornerstone,
  initViewport,
  initTools,
  setActiveTool,
  getRenderingEngine,
  setupResizeObserver,
  VIEWPORT_ID,
} from './core/init'
import { loadDicomFiles, loadStudy, getImageIds, LIDC_STUDIES } from './core/loader'
import {
  WindowLevelTool,
  PanTool,
  ZoomTool,
  LengthTool,
  RectangleROITool,
  PlanarFreehandROITool,
  annotation,
  segmentation as csSegmentation,
} from '@cornerstonejs/tools'
import {
  Enums as CoreEnums,
  cache,
  imageLoader,
  metaData,
  utilities as coreUtils,
} from '@cornerstonejs/core'
import { Enums as ToolEnums } from '@cornerstonejs/tools'
import dcmjs from 'dcmjs'

// ─── Types ────────────────────────────────────────────────────────────────────
type NavTool  = 'WindowLevel' | 'Pan' | 'Zoom'
type DrawTool = 'Length' | 'RectangleROI' | 'Freehand'
type ActiveTool = NavTool | DrawTool

interface SegmentEntry { index: number; label: string; color: number[] }
interface AnnotationEntry { uid: string; type: string }
interface Info { slice: string; total: string; wl: string }
interface SegmentApiResponse { seg_path?: string; status?: string; detail?: string }

// =============================================================================
export default function App() {
  const viewportRef  = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [ready,       setReady]       = useState(false)
  const [status,      setStatus]      = useState('Initialising...')
  const [activeTool,  setActiveToolUI] = useState<ActiveTool>('WindowLevel')
  const [activeStudy, setActiveStudy] = useState<string | null>(null)
  const [info,        setInfo]        = useState<Info>({ slice: '--', total: '--', wl: '--' })
  const [segments,    setSegments]    = useState<SegmentEntry[]>([])
  const [annotations, setAnnotations] = useState<AnnotationEntry[]>([])
  const [aiSegPath,   setAiSegPath]   = useState<string | null>(null)
  const [runningAI,   setRunningAI]   = useState(false)
  const loadedAISegmentationIdsRef = useRef<string[]>([])

  // ── Initialise Cornerstone once the viewport div is mounted ────────────────
  useEffect(() => {
    if (!viewportRef.current) return
    const el = viewportRef.current

    let cleanupResize: (() => void) | undefined

    ;(async () => {
      try {
        setStatus('Initialising Cornerstone3D…')
        await initCornerstone()
        initViewport(el)
        initTools()
        cleanupResize = setupResizeObserver(el)
        setReady(true)
        setStatus('Ready — select a study from the panel to begin')
      } catch (err) {
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`)
      }
    })()

    return () => { cleanupResize?.() }
  }, [])

  // ── Slice change listener ──────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !viewportRef.current) return
    const el = viewportRef.current

    const handleSlice = () => {
      const re = getRenderingEngine()
      if (!re) return
      const vp = re.getViewport(VIEWPORT_ID) as any
      const idx = vp?.getCurrentImageIdIndex?.() ?? 0
      setInfo(prev => ({ ...prev, slice: String(idx + 1), total: String(getImageIds().length) }))
    }

    el.addEventListener(CoreEnums.Events.STACK_VIEWPORT_SCROLL, handleSlice)
    return () => el.removeEventListener(CoreEnums.Events.STACK_VIEWPORT_SCROLL, handleSlice)
  }, [ready])

  // ── W/L change listener ────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !viewportRef.current) return
    const el = viewportRef.current

    const handleVOI = (evt: Event) => {
      const { range } = (evt as CustomEvent).detail ?? {}
      if (!range) return
      const W = Math.round(range.upper - range.lower)
      const L = Math.round((range.upper + range.lower) / 2)
      setInfo(prev => ({ ...prev, wl: `${W} / ${L}` }))
    }

    el.addEventListener(CoreEnums.Events.VOI_MODIFIED, handleVOI)
    return () => el.removeEventListener(CoreEnums.Events.VOI_MODIFIED, handleVOI)
  }, [ready])

  // ── Annotation change listener ─────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !viewportRef.current) return
    const el = viewportRef.current

    const refresh = () => {
      const all = annotation.state.getAllAnnotations()
      setAnnotations(all.map(a => ({ uid: a.annotationUID ?? '', type: a.metadata?.toolName ?? '' })))
    }

    el.addEventListener(ToolEnums.Events.ANNOTATION_COMPLETED, refresh)
    el.addEventListener(ToolEnums.Events.ANNOTATION_REMOVED,   refresh)
    return () => {
      el.removeEventListener(ToolEnums.Events.ANNOTATION_COMPLETED, refresh)
      el.removeEventListener(ToolEnums.Events.ANNOTATION_REMOVED,   refresh)
    }
  }, [ready])

  // ── File loading ───────────────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setStatus(`Loading ${files.length} file(s)…`)
    const n = await loadDicomFiles(Array.from(files), (loaded, total) =>
      setStatus(`Loading… ${loaded}/${total}`)
    )
    if (n === 0) { setStatus('No DICOM files found'); return }
    setInfo(prev => ({ ...prev, slice: String(Math.floor(n / 2) + 1), total: String(n) }))
    setStatus(`Loaded ${n} image${n !== 1 ? 's' : ''}`)
  }, [])

  // ── Navigation tool switch ─────────────────────────────────────────────────
  const handleNavTool = useCallback((tool: NavTool) => {
    const name = tool === 'WindowLevel' ? WindowLevelTool.toolName
               : tool === 'Pan'         ? PanTool.toolName
                                        : ZoomTool.toolName
    setActiveTool(name)
    setActiveToolUI(tool)
  }, [])

  // ── Annotation tool switch ─────────────────────────────────────────────────
  const handleDrawTool = useCallback((tool: DrawTool) => {
    const name = tool === 'Length'       ? LengthTool.toolName
               : tool === 'RectangleROI' ? RectangleROITool.toolName
                                         : PlanarFreehandROITool.toolName
    setActiveTool(name)
    setActiveToolUI(tool)
  }, [])

  // ── Reset view ─────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    const re = getRenderingEngine()
    if (!re) return
    const vp = re.getViewport(VIEWPORT_ID) as any
    vp?.resetCamera?.()
    vp?.render?.()
    setStatus('View reset')
  }, [])

  // ── Export JSON (built-in utility) ─────────────────────────────────────────
  const handleExportJSON = useCallback(() => {
    const all = annotation.state.getAllAnnotations()
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'annotations.json'; a.click()
    URL.revokeObjectURL(url)
    setStatus('Exported annotations.json')
  }, [])

  // ===========================================================================
  // HACKATHON TASKS — implement the functions below
  // ===========================================================================

  // ---------------------------------------------------------------------------
  // TASK 1 — Study Selector
  // ---------------------------------------------------------------------------
  // Build a data panel that lists the available LIDC studies and loads the
  // selected study's CT slices into the viewer.
  //
  // LIDC_STUDIES (imported from ./core/loader) is an array of study metadata.
  // loadStudy(caseId) (also in ./core/loader) fetches and loads the CT slices.
  //
  // See HACKATHON_TASKS.md § Task 1 for hints.
  //
  const handleSelectStudy = useCallback(async (caseId: string) => {
    if (!ready) return

    try {
      setStatus(`Loading ${caseId}…`)
      const n = await loadStudy(caseId, (loaded, total) =>
        setStatus(`Loading ${caseId}… ${loaded}/${total}`)
      )

      setActiveStudy(caseId)
      setAnnotations([])
      setSegments([])
      setAiSegPath(null)
      setInfo(prev => ({ ...prev, slice: String(Math.floor(n / 2) + 1), total: String(n) }))
      setStatus(`Loaded ${caseId} (${n} slices)`)
    } catch (err) {
      setStatus(`Failed to load ${caseId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [ready])

  // ---------------------------------------------------------------------------
  // TASK 2 — Load Ground Truth Annotations
  // ---------------------------------------------------------------------------
  // Load the LIDC XML file for the active study and render the
  // radiologist-drawn nodule contours as PlanarFreehandROI annotations
  // on the correct slices.
  //
  // See HACKATHON_TASKS.md § Task 2 for hints.
  //
  const handleLoadGT = useCallback(async () => {
    if (!ready) return
    if (!activeStudy) {
      setStatus('Select a study before loading GT')
      return
    }

    const study = LIDC_STUDIES.find(s => s.id === activeStudy)
    if (!study) {
      setStatus(`Study metadata not found for ${activeStudy}`)
      return
    }

    const imageIds = getImageIds()
    if (imageIds.length === 0) {
      setStatus('Load a study first before loading GT')
      return
    }

    const re = getRenderingEngine()
    if (!re || !viewportRef.current) {
      setStatus('Viewport not ready')
      return
    }

    const vp = re.getViewport(VIEWPORT_ID) as any
    const viewRef = vp?.getViewReference?.() ?? {}
    const GT_SOURCE = 'LIDC_GT_XML'

    try {
      setStatus(`Loading GT XML (${study.xml})…`)
      const res = await fetch(`/data/${activeStudy}/annotations/${study.xml}`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const xmlText = await res.text()
      const xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml')
      if (xmlDoc.querySelector('parsererror')) {
        throw new Error('Invalid XML format')
      }

      const slices = imageIds
        .map((imageId, index) => {
          const plane = metaData.get('imagePlaneModule', imageId) as any
          const sop = metaData.get('sopCommonModule', imageId) as any
          const z = Number(plane?.imagePositionPatient?.[2])
          return {
            imageId,
            index,
            z: Number.isFinite(z) ? z : null,
            sopUID: typeof sop?.sopInstanceUID === 'string' ? sop.sopInstanceUID.trim() : '',
          }
        })
      const slicesWithZ = slices.filter(
        (v): v is { imageId: string; index: number; z: number; sopUID: string } => v.z !== null
      )
      const slicesBySopUID = new Map<string, { imageId: string; index: number; z: number | null; sopUID: string }>()
      for (const s of slices) {
        if (s.sopUID) slicesBySopUID.set(s.sopUID, s)
      }

      if (slicesWithZ.length === 0) {
        throw new Error('Could not read slice Z metadata from loaded images')
      }

      const ns = 'http://www.nih.gov'
      const roiNodes = Array.from(xmlDoc.getElementsByTagNameNS(ns, 'roi'))
      const pendingContours: Array<{ imageId: string; index: number; worldPoints: [number, number, number][] }> = []

      for (const roi of roiNodes) {
        const inclusionText = roi.getElementsByTagNameNS(ns, 'inclusion')[0]?.textContent?.trim().toUpperCase()
        if (inclusionText && inclusionText !== 'TRUE') continue

        const roiSopUID = roi.getElementsByTagNameNS(ns, 'imageSOP_UID')[0]?.textContent?.trim() ?? ''
        const zText = roi.getElementsByTagNameNS(ns, 'imageZposition')[0]?.textContent ?? ''
        const roiZ = Number.parseFloat(zText)

        let best = roiSopUID ? slicesBySopUID.get(roiSopUID) : undefined
        if (!best) {
          if (!Number.isFinite(roiZ)) continue
          let bestByZ = slicesWithZ[0]
          let bestDist = Math.abs(bestByZ.z - roiZ)
          for (let i = 1; i < slicesWithZ.length; i++) {
            const d = Math.abs(slicesWithZ[i].z - roiZ)
            if (d < bestDist) {
              bestByZ = slicesWithZ[i]
              bestDist = d
            }
          }
          best = bestByZ
        }

        const edgeNodes = Array.from(roi.getElementsByTagNameNS(ns, 'edgeMap'))
        if (edgeNodes.length < 3) continue

        const worldPoints = edgeNodes
          .map(edge => {
            const xText = edge.getElementsByTagNameNS(ns, 'xCoord')[0]?.textContent ?? ''
            const yText = edge.getElementsByTagNameNS(ns, 'yCoord')[0]?.textContent ?? ''
            const x = Number.parseFloat(xText)
            const y = Number.parseFloat(yText)
            if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined
            // imageToWorldCoords expects [row, col] = [y, x].
            return coreUtils.imageToWorldCoords(best.imageId, [y, x])
          })
          .filter((p): p is [number, number, number] => Boolean(p))

        if (worldPoints.length < 3) continue

        pendingContours.push({
          imageId: best.imageId,
          index: best.index,
          worldPoints,
        })
      }

      if (pendingContours.length === 0) {
        setStatus(`No drawable GT contours found in ${study.xml}`)
        return
      }

      // Replace old GT overlays only after new contours are ready.
      const existing = annotation.state.getAllAnnotations()
      for (const a of existing) {
        const isLegacyAutoGT =
          a.autoGenerated &&
          a.metadata?.toolName === PlanarFreehandROITool.toolName
        const isTaggedGT =
          a.metadata?.toolName === PlanarFreehandROITool.toolName &&
          (a.metadata as any)?.annotationSource === GT_SOURCE

        if ((isLegacyAutoGT || isTaggedGT) && a.annotationUID) {
          annotation.state.removeAnnotation(a.annotationUID)
        }
      }

      const contourStrengthBySlice = new Map<number, number>()
      const addedBySlice = new Map<number, string[]>()

      for (const contour of pendingContours) {
        const uid = annotation.state.addAnnotation({
          highlighted: false,
          autoGenerated: true,
          invalidated: false,
          isLocked: false,
          isVisible: true,
          metadata: {
            ...viewRef,
            toolName: PlanarFreehandROITool.toolName,
            referencedImageId: contour.imageId,
            ...({ annotationSource: GT_SOURCE } as any),
          },
          data: {
            handles: {
              points: contour.worldPoints,
              activeHandleIndex: null,
            },
            contour: {
              polyline: contour.worldPoints,
              closed: true,
            },
          },
        }, viewportRef.current)

        // Force high-contrast display for GT overlays.
        annotation.config.style.setAnnotationStyles(uid, {
          color: 'rgb(255, 255, 0)',
          colorAutoGenerated: 'rgb(255, 255, 0)',
          lineWidth: '3',
          lineWidthAutoGenerated: '3',
          textBoxColor: 'rgb(255, 255, 0)',
          textBoxLinkLineColor: 'rgb(255, 255, 0)',
          textbox: false,
        } as any)

        contourStrengthBySlice.set(
          contour.index,
          (contourStrengthBySlice.get(contour.index) ?? 0) + contour.worldPoints.length
        )
        const uids = addedBySlice.get(contour.index) ?? []
        uids.push(uid)
        addedBySlice.set(contour.index, uids)
      }

      const bestSlice = Array.from(contourStrengthBySlice.entries()).sort((a, b) => b[1] - a[1])[0]
      if (bestSlice) {
        const targetIndex = bestSlice[0]
        await vp?.setImageIdIndex?.(targetIndex)
        const firstUID = addedBySlice.get(targetIndex)?.[0]
        if (firstUID) {
          annotation.selection.deselectAnnotation()
          annotation.selection.setAnnotationSelected(firstUID, true, false)
        }
      }

      vp?.render?.()
      const all = annotation.state.getAllAnnotations()
      setAnnotations(all.map(a => ({ uid: a.annotationUID ?? '', type: a.metadata?.toolName ?? '' })))

      if (bestSlice) {
        const slice = bestSlice[0] + 1
        setInfo(prev => ({ ...prev, slice: String(slice), total: String(imageIds.length) }))
        setStatus(`Loaded GT: ${pendingContours.length} contour${pendingContours.length !== 1 ? 's' : ''} from ${study.xml}. Jumped to slice ${slice}`)
        return
      }

      setStatus(`Loaded GT: ${pendingContours.length} contour${pendingContours.length !== 1 ? 's' : ''} from ${study.xml}`)
    } catch (err) {
      setStatus(`Failed to load GT: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [activeStudy, ready])

  // ---------------------------------------------------------------------------
  // TASK 3 — Run AI Segmentation Model
  // ---------------------------------------------------------------------------
  // Trigger TotalSegmentator or MONAI Label on the active study's CT data and
  // retrieve the segmentation result so Task 4 can display it.
  //
  // See HACKATHON_TASKS.md § Task 3 for hints and available scripts.
  //
  const handleRunAI = useCallback(async () => {
    if (!activeStudy) {
      setStatus('Select a study before running AI')
      return
    }
    if (getImageIds().length === 0) {
      setStatus('Load CT slices first before running AI')
      return
    }

    setRunningAI(true)
    setStatus(`Running AI segmentation for ${activeStudy}…`)

    try {
      const res = await fetch('http://localhost:8000/segment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: activeStudy }),
      })

      const data = await res.json() as SegmentApiResponse
      if (!res.ok) {
        throw new Error(data?.detail || `HTTP ${res.status}`)
      }
      if (!data.seg_path) {
        throw new Error('No seg_path returned by server')
      }

      const browserPath = `/${data.seg_path.replace(/^\/+/, '')}`
      setAiSegPath(browserPath)
      setStatus(`AI complete for ${activeStudy}. SEG ready at ${browserPath}. Click "Show AI Seg".`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('Failed to fetch')) {
        setStatus('Failed to reach AI server at http://localhost:8000. Start scripts/segment_server.py first.')
      } else {
        setStatus(`AI segmentation failed: ${msg}`)
      }
    } finally {
      setRunningAI(false)
    }
  }, [activeStudy])

  // ---------------------------------------------------------------------------
  // TASK 4 — Display AI Segmentation Overlay
  // ---------------------------------------------------------------------------
  // Load a DICOM SEG file (from Task 3, or the pre-computed fallback in
  // data/<activeStudy>/annotations/) and display it as a coloured labelmap
  // overlay using Cornerstone3D's segmentation API.
  //
  // See HACKATHON_TASKS.md § Task 4 for hints.
  //
  const handleShowAISeg = useCallback(async () => {
    if (!ready) return
    if (!activeStudy) {
      setStatus('Select a study before showing AI segmentation')
      return
    }

    const imageIds = getImageIds()
    if (imageIds.length === 0) {
      setStatus('Load CT slices first before showing segmentation')
      return
    }

    try {
      for (const segmentationId of loadedAISegmentationIdsRef.current) {
        csSegmentation.removeSegmentationRepresentations(VIEWPORT_ID, { segmentationId })
        csSegmentation.removeSegmentation(segmentationId)
      }
      loadedAISegmentationIdsRef.current = []

      const fallbackSegPath = `/data/${activeStudy}/annotations/${activeStudy}_lung_nodules_seg.dcm`
      const segUrl = aiSegPath ?? fallbackSegPath

      setStatus(`Loading SEG from ${segUrl}…`)
      const segRes = await fetch(segUrl)
      if (!segRes.ok) {
        throw new Error(`SEG not found (${segRes.status})`)
      }
      const segBuffer = await segRes.arrayBuffer()

      const dicomData = (dcmjs as any).data.DicomMessage.readFile(segBuffer)
      const segDataset = (dcmjs as any).data.DicomMetaDictionary.naturalizeDataset(dicomData.dict)
      const refSeriesSeq = segDataset?.ReferencedSeriesSequence
      const referencedSeriesInstanceUID = Array.isArray(refSeriesSeq)
        ? refSeriesSeq[0]?.SeriesInstanceUID
        : refSeriesSeq?.SeriesInstanceUID

      setStatus('Preparing CT metadata for SEG alignment…')
      await Promise.all(
        imageIds.map(imageId => imageLoader.loadAndCacheImage(imageId).catch(() => null))
      )

      const metadataProvider = {
        get: (type: string, imageId: string) => {
          const existing = metaData.get(type, imageId) as any
          if (existing) return existing

          if (type === 'imagePlaneModule') {
            const image = cache.getImage(imageId)
            const idx = imageIds.indexOf(imageId)
            return {
              rowCosines: [1, 0, 0],
              columnCosines: [0, 1, 0],
              imageOrientationPatient: [1, 0, 0, 0, 1, 0],
              imagePositionPatient: [0, 0, idx >= 0 ? idx : 0],
              rows: image?.rows ?? 512,
              columns: image?.columns ?? 512,
              rowPixelSpacing: image?.rowPixelSpacing ?? 1,
              columnPixelSpacing: image?.columnPixelSpacing ?? 1,
              pixelSpacing: [image?.rowPixelSpacing ?? 1, image?.columnPixelSpacing ?? 1],
            }
          }

          if (type === 'generalSeriesModule') {
            return {
              modality: 'CT',
              seriesInstanceUID: referencedSeriesInstanceUID ?? '',
            }
          }

          if (type === 'sopCommonModule') {
            return {
              sopInstanceUID: '',
            }
          }

          return existing
        },
      }
      const adapter = (dcmjs as any)?.adapters?.Cornerstone?.Segmentation
      if (!adapter?.generateToolState) {
        throw new Error('dcmjs Cornerstone Segmentation adapter not available')
      }

      const toolState = adapter.generateToolState(imageIds, segBuffer, metadataProvider)
      const labelmapBufferArray = toolState?.labelmapBufferArray as ArrayBuffer[] | undefined
      if (!labelmapBufferArray?.length) {
        throw new Error('No labelmap data decoded from DICOM SEG')
      }

      const firstImage = cache.getImage(imageIds[0])
      const rows = firstImage?.rows
      const cols = firstImage?.columns
      if (!rows || !cols) {
        throw new Error('Unable to read CT dimensions from loaded images')
      }
      const sliceLength = rows * cols

      const segMetadata = toolState?.segMetadata?.data ?? []
      const colorFromSegment = (segmentIndex: number): number[] => {
        const segment = segMetadata[segmentIndex]
        const cielab = segment?.RecommendedDisplayCIELabValue
        if (Array.isArray(cielab) && cielab.length >= 3) {
          const rgb = (dcmjs as any)?.data?.Colors?.dicomlab2RGB?.(cielab)
          if (Array.isArray(rgb) && rgb.length >= 3) {
            return rgb.slice(0, 3).map((v: number) => Math.max(0, Math.min(255, Math.round(v))))
          }
        }
        const hue = (segmentIndex * 137.508) % 360
        const x = 1 - Math.abs(((hue / 60) % 2) - 1)
        let r = 1, g = 1, b = 1
        if (hue < 60) [r, g, b] = [1, x, 0]
        else if (hue < 120) [r, g, b] = [x, 1, 0]
        else if (hue < 180) [r, g, b] = [0, 1, x]
        else if (hue < 240) [r, g, b] = [0, x, 1]
        else if (hue < 300) [r, g, b] = [x, 0, 1]
        else [r, g, b] = [1, 0, x]
        return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
      }

      const segmentEntries: SegmentEntry[] = []
      const colorLUT: number[][] = [[0, 0, 0, 0]]
      for (let i = 1; i < segMetadata.length; i++) {
        const label = segMetadata[i]?.SegmentLabel || `Segment ${i}`
        const color = colorFromSegment(i)
        segmentEntries.push({ index: i, label, color })
        colorLUT[i] = [color[0], color[1], color[2], 220]
      }
      const colorLUTIndex = csSegmentation.config.color.addColorLUT(colorLUT as any)

      const representationInputs: Array<{ segmentationId: string; type: ToolEnums.SegmentationRepresentations; config: { colorLUTOrIndex: number } }> = []

      labelmapBufferArray.forEach((labelmapBuffer, labelmapIndex) => {
        const segmentationId = `ai-seg-${activeStudy}-${labelmapIndex}`
        const derived = imageLoader.createAndCacheDerivedLabelmapImages(imageIds)
        const derivedImageIds = derived.map(img => img.imageId)

        const source = new Uint16Array(labelmapBuffer)
        for (let i = 0; i < derivedImageIds.length; i++) {
          const image = cache.getImage(derivedImageIds[i])
          const pixels = image?.getPixelData() as Uint8Array | undefined
          if (!pixels) continue
          const offset = i * sliceLength
          for (let p = 0; p < sliceLength; p++) {
            pixels[p] = Math.min(255, source[offset + p] || 0)
          }
        }

        const configSegments: Record<number, { label?: string }> = {}
        for (const entry of segmentEntries) {
          configSegments[entry.index] = { label: entry.label }
        }

        csSegmentation.addSegmentations([
          {
            segmentationId,
            representation: {
              type: ToolEnums.SegmentationRepresentations.Labelmap,
              data: { imageIds: derivedImageIds },
            },
            config: {
              label: `${activeStudy} AI SEG`,
              segments: configSegments,
            },
          },
        ])

        representationInputs.push({
          segmentationId,
          type: ToolEnums.SegmentationRepresentations.Labelmap,
          config: { colorLUTOrIndex: colorLUTIndex },
        })
        loadedAISegmentationIdsRef.current.push(segmentationId)
      })

      csSegmentation.addLabelmapRepresentationToViewportMap({
        [VIEWPORT_ID]: representationInputs,
      })

      const re = getRenderingEngine()
      const vp = re?.getViewport(VIEWPORT_ID) as any
      vp?.render?.()

      setSegments(segmentEntries)
      setStatus(`Loaded AI SEG with ${segmentEntries.length} segment${segmentEntries.length === 1 ? '' : 's'}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setStatus(`Failed to load AI SEG: ${msg}`)
    }
  }, [activeStudy, aiSegPath, ready])

  // ---------------------------------------------------------------------------
  // BONUS A — AI-Assisted Segmentation
  // ---------------------------------------------------------------------------
  // POST the active study ID to a local segmentation API at localhost:8000,
  // receive the resulting DICOM SEG path, and display it as a labelmap overlay.
  // Show loading feedback while the model runs and handle errors gracefully.
  //
  // API: POST http://localhost:8000/segment  { case_id: string }
  //      → { seg_path: string }
  //
  // See HACKATHON_TASKS.md § Bonus A for hints.
  //
  const handleAIAssist = useCallback(async () => {
    // TODO Bonus A — implement handleAIAssist()
    console.warn('Bonus A not yet implemented')
    setStatus('Bonus A: AI-Assisted Segmentation — not yet implemented')
  }, [activeStudy])

  // ==========================================================================
  return (
    <div id="app">

      {/* Header */}
      <header className="header">
        <h1>DICOM Annotation Viewer</h1>
        <span className="subtitle">Atomorphic Mini Hackathon</span>
      </header>

      {/* Toolbar */}
      <div className="toolbar">

        {/* File loading */}
        <div className="tool-group">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".dcm"
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
          />
          <button disabled={!ready} onClick={() => fileInputRef.current?.click()}>
            Load DICOM
          </button>
        </div>

        <div className="divider" />

        {/* Navigation tools */}
        <div className="tool-group">
          {(['WindowLevel', 'Pan', 'Zoom'] as NavTool[]).map(tool => (
            <button
              key={tool}
              disabled={!ready}
              className={activeTool === tool ? 'active' : ''}
              onClick={() => handleNavTool(tool)}
            >
              {tool === 'WindowLevel' ? 'W/L' : tool}
            </button>
          ))}
        </div>

        <div className="divider" />

        {/* Annotation drawing tools */}
        <div className="tool-group">
          {([
            ['Length',       'Length'],
            ['RectangleROI', 'Rect'],
            ['Freehand',     'Freehand'],
          ] as [DrawTool, string][]).map(([tool, label]) => (
            <button
              key={tool}
              disabled={!ready}
              className={activeTool === tool ? 'active' : ''}
              onClick={() => handleDrawTool(tool)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="divider" />

        {/* Utility */}
        <div className="tool-group">
          <button disabled={!ready} onClick={handleReset}>Reset</button>
          <button disabled={!ready} onClick={handleExportJSON}>Export JSON</button>
        </div>

        <div className="divider" />

        {/* ── HACKATHON TASK BUTTONS ── */}
        <div className="tool-group hackathon-tasks">
          <button disabled={!ready} onClick={handleLoadGT}>
            Load GT
          </button>
          <button disabled={!ready || runningAI} onClick={handleRunAI}>
            {runningAI ? 'Running AI…' : 'Run AI'}
          </button>
          <button disabled={!ready} onClick={handleShowAISeg}>
            Show AI Seg
          </button>
          <button disabled={!ready} onClick={handleAIAssist}>
            AI Assist
          </button>
        </div>

      </div>

      {/* Main content */}
      <div className="main-content">

        {/* Left panel — image info + study selector */}
        <div className="panel">
          <h3>Image Info</h3>
          <div className="list-content">
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <tbody>
                {[
                  ['Slice',  `${info.slice} / ${info.total}`],
                  ['W / L',  info.wl],
                ].map(([label, value]) => (
                  <tr key={label}>
                    <td style={{ color: 'var(--text-dim)', paddingBottom: 6 }}>{label}</td>
                    <td style={{ paddingBottom: 6 }}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── TASK 1: Study Selector — implement handleSelectStudy() ── */}
          <h3 style={{ borderTop: '1px solid var(--border)' }}>Studies</h3>
          <div className="list-content">
            {LIDC_STUDIES.map(study => (
              <button
                key={study.id}
                disabled={!ready}
                className={`study-item ${activeStudy === study.id ? 'active' : ''}`}
                onClick={() => handleSelectStudy(study.id)}
              >
                <span>{study.id}</span>
                <span className="study-slices">{study.slices} slices</span>
              </button>
            ))}
          </div>
        </div>

        {/* Viewport */}
        <div className="viewport-container">
          <div className="viewport">
            <div ref={viewportRef} style={{ width: '100%', height: '100%' }} />
          </div>
        </div>

        {/* Right panel — annotations + segments */}
        <div className="panel right-panel">
          <h3>Annotations</h3>
          <div className="list-content">
            {annotations.length === 0
              ? <p className="empty">No annotations</p>
              : annotations.map(a => (
                  <div key={a.uid} className="annotation-item">
                    <span className="annotation-type">{a.type}</span>
                  </div>
                ))
            }
          </div>

          <h3 style={{ borderTop: '1px solid var(--border)' }}>Segments</h3>
          <div className="list-content">
            {segments.length === 0
              ? <p className="empty">No segmentation loaded</p>
              : segments.map(s => (
                  <div key={s.index} className="segment-item">
                    <span
                      className="segment-color"
                      style={{ background: `rgb(${s.color[0]},${s.color[1]},${s.color[2]})` }}
                    />
                    <span className="segment-label">{s.label}</span>
                  </div>
                ))
            }
          </div>
        </div>

      </div>

      {/* Status bar */}
      <footer className="status-bar">{status}</footer>

    </div>
  )
}
