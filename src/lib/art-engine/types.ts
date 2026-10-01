export type ArtMode = 'density' | 'color' | 'phrase' | 'contour' | 'braille' | 'halftone'
export type ArtMotion = 'none' | 'breathe' | 'wave' | 'assemble' | 'current' | 'reform' | 'caustics'
export type ArtHover =
  'displace' | 'light' | 'ripple' | 'trail' | 'water' | 'silk' | 'vortex' | 'contour' | 'dissolve'
export type ArtSettings = {
  mode: ArtMode
  columns: number
  phrase: string
  charset: string
  background: string
  ink: string
  colored: boolean
  normalize: boolean
  contrast: number
  exposure: number
  invert: boolean
  fillAll: boolean
  threshold: number
  fontFamily?: string
  charAspect?: number
  ditherStrength?: number
  /** Optional validated density / color profiles; omitted settings preserve classic output. */
  fontWeight?: 400 | 600
  rasterQuality?: 'legacy' | 'high' | 'supersampled'
  /** Bounded glyph alpha area raster, supported for monochrome density and color mode. */
  softwareRaster?: boolean
  /** Color intensity is applied once, only with the software color profile. */
  colorFidelity?: boolean
}
export type ArtGlyph = { char: string; coverage: number; tile: HTMLCanvasElement }
export type ArtFrame = {
  version: string
  columns: number
  rows: number
  width: number
  height: number
  glyphs: ArtGlyph[]
  indices: Uint16Array
  alpha: Float32Array
  colors: Uint8ClampedArray
  settings: ArtSettings
  cellWidth: number
  cellHeight: number
  text: string
  statistics: { nonEmpty: number; preparationMs: number; maxCoverage: number }
}
export type ArtRenderOptions = {
  longEdge?: number
  transparent?: boolean
  time?: number
  motion?: ArtMotion
  hover?: ArtHover
  /** Explicit new effects; absent preserves previously exported/classic visuals. */
  effectProfile?: 'classic' | 'expressive'
  motionSpeed?: number
  motionStrength?: number
  hoverRadius?: number
  /** Independent interaction clock keeps hover alive while ambient motion is paused. */
  hoverTime?: number
  pointer?: { x: number; y: number; strength: number }
}
