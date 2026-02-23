// =============================================================================
// DICOM Loading
// =============================================================================

import { type Types } from '@cornerstonejs/core'
import * as dicomLoader from '@cornerstonejs/dicom-image-loader'
import { getRenderingEngine, VIEWPORT_ID } from './init'

let imageIds: string[] = []

export function getImageIds() { return imageIds }

// The 3 LIDC-IDRI studies included in this repository
export const LIDC_STUDIES = [
  { id: 'LIDC-IDRI-0001', slices: 133, xml: '069.xml' },
  { id: 'LIDC-IDRI-0002', slices: 261, xml: '071.xml' },
  { id: 'LIDC-IDRI-0003', slices: 140, xml: '072.xml' },
]

// Load a LIDC study by case ID (e.g. 'LIDC-IDRI-0001').
// CT slices are served at /data/<caseId>/ct/1-001.dcm … 1-NNN.dcm
// Returns the number of images loaded.
export async function loadStudy(
  caseId: string,
  onProgress?: (loaded: number, total: number) => void
): Promise<number> {
  const study = LIDC_STUDIES.find(s => s.id === caseId)
  if (!study) throw new Error(`Unknown study: ${caseId}`)

  imageIds = Array.from({ length: study.slices }, (_, i) => {
    const n = String(i + 1).padStart(3, '0')
    return `wadouri:/data/${caseId}/ct/1-${n}.dcm`
  })

  const re = getRenderingEngine()
  const vp = re.getViewport(VIEWPORT_ID) as Types.IStackViewport
  const mid = Math.floor(imageIds.length / 2)

  onProgress?.(0, imageIds.length)
  await vp.setStack(imageIds, mid)
  vp.render()
  onProgress?.(imageIds.length, imageIds.length)

  return imageIds.length
}

// Load File objects into the viewport.
// onProgress(loaded, total) is called with progress updates.
// Returns the number of images loaded (0 if none).
export async function loadDicomFiles(
  files: File[],
  onProgress?: (loaded: number, total: number) => void
): Promise<number> {
  if (files.length === 0) return 0

  imageIds = []
  for (const file of files) {
    if (file.name.endsWith('.dcm') || !file.name.includes('.')) {
      const id = dicomLoader.wadouri.fileManager.add(file)
      imageIds.push(id)
    }
  }

  if (imageIds.length === 0) return 0

  const re = getRenderingEngine()
  const vp = re.getViewport(VIEWPORT_ID) as Types.IStackViewport
  const mid = Math.floor(imageIds.length / 2)

  onProgress?.(0, imageIds.length)
  await vp.setStack(imageIds, mid)
  vp.render()
  onProgress?.(imageIds.length, imageIds.length)

  return imageIds.length
}
