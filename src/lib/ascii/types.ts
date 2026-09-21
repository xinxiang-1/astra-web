import {
  ASCII_ASPECT_PRESETS,
  ASCII_CHARSETS,
  ASCII_FONT_PRESETS,
  ASCII_RESOLUTIONS,
} from './constants'

export type AsciiCharsetKey = keyof typeof ASCII_CHARSETS
export type AsciiResolutionKey = keyof typeof ASCII_RESOLUTIONS
export type AsciiAspectPresetKey = keyof typeof ASCII_ASPECT_PRESETS
export type AsciiFontPresetKey = keyof typeof ASCII_FONT_PRESETS

/** Shared tone pipeline (charset + phrase), aligned with asciify-engine. */
export type AsciiToneOptions = {
  invert?: boolean
  /**
   * Exposure bias in stops (-2 … +2). Positive = brighter image.
   * Combined with a soft brightness shift before contrast.
   */
  exposure?: number
  /**
   * Contrast around midtones (−1 … +1). `0` = unchanged.
   * Default in the UI is a light boost (~0.2).
   */
  contrast?: number
  /**
   * Stretch frame luminance so darkest→lightest fills the charset.
   * Helps muted / low-contrast photos.
   */
  normalize?: boolean
  /**
   * Bayer 4×4 dither strength on luminance (0 … 1).
   * Softens banding on flat gradients.
   */
  ditherStrength?: number
}

export type AsciiConvertOptions = {
  /** Output columns (character width). */
  columns: number
  charset: string
  /**
   * Vertical sampling scale vs image aspect.
   * Must equal display cell (glyphWidth / lineHeight) or shapes stretch.
   * Consolas ≈ 0.55; higher values add rows and make output look taller.
   */
  charAspect?: number
  /** Attach per-cell RGB for colored preview/PNG. */
  withColors?: boolean
} & AsciiToneOptions

export type MonoCellMetrics = {
  fontFamily: string
  fontSize: number
  /** Glyph advance of sample character. */
  advance: number
  /** Line box height (font bounding box when available). */
  lineHeight: number
  /** advance / lineHeight — use as sampling `charAspect`. */
  aspect: number
}

export type AsciiConvertResult = {
  text: string
  columns: number
  rows: number
  /** Optional RGB triples (row-major) for colored paint. Length = cols*rows*3. */
  colors?: Uint8ClampedArray
}

export type AsciiMode = 'charset' | 'phrase'

export type AsciiPhraseOptions = {
  columns: number
  /** Text to cycle through ink pixels, e.g. 我爱你中国. */
  phrase: string
  /**
   * Ink if brightness ≤ threshold (after invert). Default 0.55.
   * Lower = only darker regions keep characters.
   */
  threshold?: number
  charAspect?: number
  /** When true, every cell gets a phrase char (no silhouette spaces). */
  fillAll?: boolean
  /** Attach per-cell RGB for colored preview/PNG. */
  withColors?: boolean
} & AsciiToneOptions

export type AsciiMediaKind = 'image' | 'video'

export type AsciiFrameSource = {
  source: CanvasImageSource
  width: number
  height: number
}

export type AsciiPngOptions = {
  fontSize?: number
  lineHeight?: number
  /** Lock paint cell to sampling aspect (advance / lineHeight). */
  charAspect?: number
  padding?: number
  background?: string
  foreground?: string
  fontFamily?: string
  /** Glyph used to measure cell width (中 for CJK). */
  metricGlyph?: string
  /** Per-cell RGB (row-major, length cols*rows*3). */
  colors?: Uint8ClampedArray
}

export type AsciiPaintOptions = {
  fontSize: number
  background: string
  foreground: string
  padding?: number
  fontFamily?: string
  /** Explicit line advance in CSS px. Default = measured font bounding box. */
  lineHeight?: number
  /**
   * When set, line height = glyphAdvance / charAspect so preview matches
   * the sampling grid (avoids flatten/stretch at tiny zoomed fonts).
   */
  charAspect?: number
  devicePixelRatio?: number
  metricGlyph?: string
  /** Per-cell RGB (row-major). Enables colored character paint. */
  colors?: Uint8ClampedArray
}

export type AsciiPaintSize = {
  cssWidth: number
  cssHeight: number
  charWidth: number
  charHeight: number
}

export type FitZoomOptions = {
  /** ASCII columns after conversion. */
  columns: number
  /** ASCII rows after conversion. */
  rows: number
  /** Base font size in px (before zoom). */
  fontSize: number
  /** Preview frame / viewport width in CSS px. */
  frameWidth: number
  /** Preview frame / viewport height in CSS px. */
  frameHeight: number
  /** Font used to size the preview cells. */
  fontFamily?: string
  /** Same sampling aspect used for conversion (locks fit size to paint). */
  charAspect?: number
  metricGlyph?: string
  /** Inner padding reserved around the art. */
  padding?: number
  /** Fit scale headroom so content is not edge-flush (0–1). */
  margin?: number
  minZoom?: number
  maxZoom?: number
  step?: number
}

/** One cached ASCII video frame from prerender. */
export type PrerenderFrame = {
  text: string
  colors: Uint8ClampedArray | null
  columns: number
  rows: number
  time: number
}
