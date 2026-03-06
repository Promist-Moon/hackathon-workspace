// =============================================================================
// Cornerstone3D Initialisation
// =============================================================================

import {
  init as coreInit,
  RenderingEngine,
  Enums,
} from '@cornerstonejs/core'

import {
  init as toolsInit,
  addTool,
  ToolGroupManager,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  StackScrollTool,
  LengthTool,
  RectangleROITool,
  EllipticalROITool,
  PlanarFreehandROITool,
  Enums as ToolEnums,
  type Types as ToolTypes,
} from '@cornerstonejs/tools'

import * as dicomLoader from '@cornerstonejs/dicom-image-loader'

export const ENGINE_ID    = 'hackathonEngine'
export const VIEWPORT_ID  = 'mainViewport'
export const TOOLGROUP_ID = 'hackathonToolGroup'

let renderingEngine: RenderingEngine
let toolGroup: ToolTypes.IToolGroup
let initialised = false
let initPromise: Promise<void> | null = null

export function getRenderingEngine() { return renderingEngine }
export function getToolGroup()       { return toolGroup }

// ─── Initialise all three Cornerstone3D packages ─────────────────────────────
export async function initCornerstone() {
  if (initialised) return
  if (!initPromise) {
    initPromise = (async () => {
      await coreInit()
      await dicomLoader.init()
      await toolsInit()
      initialised = true
    })().finally(() => { initPromise = null })
  }
  await initPromise
}

// ─── Create the Stack viewport ───────────────────────────────────────────────
export function initViewport(element: HTMLDivElement) {
  // Destroy any previous engine (handles React StrictMode double-invoke)
  try { renderingEngine?.destroy() } catch { /* ok */ }
  renderingEngine = new RenderingEngine(ENGINE_ID)
  renderingEngine.enableElement({
    viewportId: VIEWPORT_ID,
    element,
    type: Enums.ViewportType.STACK,
  })
}

// ─── Resize observer: keep viewport canvas in sync with its container ─────────
// Returns a cleanup function — call it from useEffect's return.
export function setupResizeObserver(element: HTMLDivElement): () => void {
  const observer = new ResizeObserver(() => {
    try { renderingEngine?.resize(true, false) } catch { /* ok */ }
  })
  observer.observe(element)
  return () => observer.disconnect()
}

// ─── Register tools and configure defaults ───────────────────────────────────
export function initTools() {
  // addTool is idempotent — wrap in try/catch for safety
  const tools = [WindowLevelTool, PanTool, ZoomTool, StackScrollTool,
                 LengthTool, RectangleROITool, EllipticalROITool, PlanarFreehandROITool]
  tools.forEach(t => { try { addTool(t) } catch { /* already registered */ } })

  // Destroy previous tool group if it exists (handles StrictMode re-init)
  try { ToolGroupManager.destroyToolGroup(TOOLGROUP_ID) } catch { /* ok */ }
  toolGroup = ToolGroupManager.createToolGroup(TOOLGROUP_ID)!

  toolGroup.addTool(WindowLevelTool.toolName)
  toolGroup.addTool(PanTool.toolName)
  toolGroup.addTool(ZoomTool.toolName)
  toolGroup.addTool(StackScrollTool.toolName)
  toolGroup.addTool(LengthTool.toolName)
  toolGroup.addTool(RectangleROITool.toolName)
  toolGroup.addTool(EllipticalROITool.toolName)
  toolGroup.addTool(PlanarFreehandROITool.toolName)

  toolGroup.addViewport(VIEWPORT_ID, ENGINE_ID)

  toolGroup.setToolActive(WindowLevelTool.toolName, {
    bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
  })
  toolGroup.setToolActive(StackScrollTool.toolName, {
    bindings: [{ mouseButton: ToolEnums.MouseBindings.Wheel }],
  })
}

// ─── Switch the active tool ───────────────────────────────────────────────────
export function setActiveTool(toolName: string) {
  // Passivate all tools EXCEPT StackScrollTool — it must keep its Wheel binding
  const switchableTools = [
    WindowLevelTool.toolName,
    PanTool.toolName,
    ZoomTool.toolName,
    LengthTool.toolName,
    RectangleROITool.toolName,
    EllipticalROITool.toolName,
    PlanarFreehandROITool.toolName,
  ]
  switchableTools.forEach(t => { try { toolGroup.setToolPassive(t) } catch { /* ok */ } })
  toolGroup.setToolActive(toolName, {
    bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
  })
}
