import type { SignatureLayoutOptions } from './layout'

export type RasterTemplate = {
  width: number
  height: number
  pixels: ImageData
  vector?: import('./trace').StampVector | null
}
export type RasterScene = {
  placements: Float64Array
  templates: RasterTemplate[]
  layoutW: number
  layoutH: number
  colorWash?: ImageData
  options: Pick<
    SignatureLayoutOptions,
    'background' | 'colorize' | 'coverFill' | 'underlay' | 'inkStyle'
  >
}
export type RasterRequest = {
  type: 'paint' | 'png'
  id: number
  width: number
  height: number
  stampMaxLong: number
  region?: { x: number; y: number; w: number; h: number }
  tileSize?: number
}
export type RasterResponse =
  | { type: 'progress'; id: number; done: number; total: number; stage?: 'render' | 'encode' }
  | { type: 'complete'; id: number; pixels: ImageData }
  | { type: 'encoded'; id: number; blob: Blob }
  | { type: 'error'; id: number; error: string }
