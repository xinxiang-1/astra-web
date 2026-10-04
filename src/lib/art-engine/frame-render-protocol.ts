import type { ArtFrame, ArtRenderOptions } from './types'

export type FrameRenderRequest = {
  id: number
  frame: Omit<ArtFrame, 'glyphs'>
  glyphs?: { char: string; coverage: number; pixels: ImageData }[]
  options: ArtRenderOptions
}
export type FrameRenderResponse =
  | { id: number; bitmap: ImageBitmap; renderMs: number; interactionActive: boolean }
  | { id: number; error: string }
