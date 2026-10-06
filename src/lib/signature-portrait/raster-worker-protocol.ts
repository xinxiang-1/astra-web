import type { Placement, SignatureLayoutOptions } from './layout'

export type RasterTemplate = { width: number; height: number; pixels: ImageData }
export type RasterScene = {
  placements: Placement[]
  templates: RasterTemplate[]
  layoutW: number
  layoutH: number
  colorWash?: ImageData
  options: Pick<SignatureLayoutOptions, 'background' | 'colorize' | 'coverFill' | 'underlay'>
}
export type RasterRequest = {
  type: 'paint'
  id: number
  width: number
  height: number
  stampMaxLong: number
  region?: { x: number; y: number; w: number; h: number }
  tileSize?: number
}
export type RasterResponse =
  | { type: 'progress'; id: number; done: number; total: number }
  | { type: 'complete'; id: number; pixels: ImageData }
  | { type: 'error'; id: number; error: string }
