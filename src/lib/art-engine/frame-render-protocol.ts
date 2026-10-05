import type { ArtFrame, ArtRenderOptions } from './types'
import type { ArtRendererCacheStats } from './canvas'

export type FrameRenderRequest = {
  id: number
  frame: Omit<ArtFrame, 'glyphs'>
  glyphs?: { char: string; coverage: number; pixels: ImageData }[]
  options: ArtRenderOptions
}
export type FrameRenderResponse =
  | {
      id: number
      bitmap: ImageBitmap
      renderMs: number
      interactionActive: boolean
      cacheStats: ArtRendererCacheStats
    }
  | { id: number; completedCells: number; totalCells: number }
  | { id: number; error: string }
