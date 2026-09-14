/** Browser-side image → ASCII (no network). */

export const ASCII_CHARSETS = {
  dense: '@%#*+=-:. ',
  blocks: '█▓▒░ ',
  simple: '#Oo*. ',
  binary: '10 ',
} as const

export type AsciiCharsetKey = keyof typeof ASCII_CHARSETS

/** Output resolution presets → character columns (sampling rate). */
export const ASCII_RESOLUTIONS = {
  low: { label: '低清', columns: 80, hint: '快预览' },
  medium: { label: '标清', columns: 120, hint: '常用' },
  high: { label: '高清', columns: 180, hint: '更细' },
  ultra: { label: '超清', columns: 240, hint: '很细' },
  max: { label: '极清', columns: 360, hint: '最细' },
} as const

export type AsciiResolutionKey = keyof typeof ASCII_RESOLUTIONS

export type AsciiConvertOptions = {
  /** Output columns (character width). */
  columns: number
  charset: string
  invert?: boolean
  /**
   * Vertical sampling scale vs image aspect.
   * Must equal display cell (glyphWidth / lineHeight) or shapes stretch.
   * Consolas ≈ 0.55; higher values add rows and make output look taller.
   */
  charAspect?: number
  /**
   * Exposure bias in stops (-2 … +2). Positive = brighter image.
   * Applied as brightness *= 2^exposure.
   */
  exposure?: number
  /** Attach per-cell RGB for colored preview/PNG. */
  withColors?: boolean
}

/** Presets for plain-text paste vs on-screen monospace cells. */
export const ASCII_ASPECT_PRESETS = {
  /** Original on-page preview cell (Consolas-like). */
  consolas: { label: 'Consolas', value: 0.55, hint: '页面预览默认' },
  /** Match this PC's Notepad face (Microsoft YaHei ≈ 0.74). */
  notepad: { label: '记事本', value: 0.74, hint: '微软雅黑字格，对齐本机记事本' },
  detail: { label: '细密', value: 0.9, hint: '更多行，画面会偏高' },
} as const

export type AsciiAspectPresetKey = keyof typeof ASCII_ASPECT_PRESETS

/** Preview default: original Consolas-style cell. */
export const DEFAULT_CHAR_ASPECT = ASCII_ASPECT_PRESETS.consolas.value
/** Export / Notepad default: Microsoft YaHei cell. */
export const EXPORT_CHAR_ASPECT = ASCII_ASPECT_PRESETS.notepad.value

/**
 * On-page preview font (original mono look).
 */
export const PREVIEW_MONO_FONT =
  'Consolas, "Cascadia Mono", "Courier New", monospace'

/**
 * Export / Notepad font from this machine's settings
 * (`Microsoft YaHei` / 微软雅黑).
 */
export const NOTEPAD_MONO_FONT =
  '"Microsoft YaHei", "微软雅黑", Cascadia Mono, Consolas, "Courier New", monospace'

export const EXPORT_MONO_FONT = NOTEPAD_MONO_FONT

/** Configurable font profiles for preview vs download. */
export const ASCII_FONT_PRESETS = {
  consolas: {
    label: 'Consolas',
    family: PREVIEW_MONO_FONT,
    aspect: ASCII_ASPECT_PRESETS.consolas.value,
    hint: '页面预览默认等宽',
  },
  yahei: {
    label: '微软雅黑',
    family: NOTEPAD_MONO_FONT,
    aspect: ASCII_ASPECT_PRESETS.notepad.value,
    hint: '本机记事本默认',
  },
} as const

export type AsciiFontPresetKey = keyof typeof ASCII_FONT_PRESETS

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
  invert?: boolean
  charAspect?: number
  /** Exposure bias in stops (-2 … +2). */
  exposure?: number
  /** When true, every cell gets a phrase char (no silhouette spaces). */
  fillAll?: boolean
  /** Attach per-cell RGB for colored preview/PNG. */
  withColors?: boolean
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function hasCjkText(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text)
}

/** Pick a glyph that represents cell width (CJK vs Latin mono). */
export function pickMetricGlyph(text?: string): string {
  if (text && hasCjkText(text)) return '中'
  return 'M'
}

/** Measure the display cell for a given font stack. */
export function measureMonoCellMetrics(
  fontSize = 12,
  fontFamily = PREVIEW_MONO_FONT,
  sampleGlyph = 'M',
): MonoCellMetrics {
  const size = Math.max(0.5, fontSize)
  const glyph = sampleGlyph || 'M'
  const ctx = document.createElement('canvas').getContext('2d')
  if (!ctx) {
    const fallbackAspect = glyph === 'M' ? DEFAULT_CHAR_ASPECT : 1
    return {
      fontFamily,
      fontSize: size,
      advance: size * fallbackAspect,
      lineHeight: size,
      aspect: fallbackAspect,
    }
  }
  ctx.font = `${size}px ${fontFamily}`
  const m = ctx.measureText(glyph)
  const advance = Math.max(1, m.width)
  const bbox =
    (m.fontBoundingBoxAscent ?? 0) + (m.fontBoundingBoxDescent ?? 0) ||
    (m.actualBoundingBoxAscent ?? 0) + (m.actualBoundingBoxDescent ?? 0)
  const lineHeight = Math.max(size, bbox || size)
  const aspect = clamp(advance / lineHeight, 0.35, 1.2)
  return { fontFamily, fontSize: size, advance, lineHeight, aspect }
}

/** Measure browser cell width/height (= advance / line box). */
export function measureMonoCellAspect(
  fontSize = 12,
  fontFamily = PREVIEW_MONO_FONT,
  sampleGlyph = 'M',
): number {
  return measureMonoCellMetrics(fontSize, fontFamily, sampleGlyph).aspect
}

/** Draw `source` into an offscreen canvas at the sampling size. */
export function sampleImageData(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  columns: number,
  charAspect = DEFAULT_CHAR_ASPECT,
): ImageData {
  const cols = clamp(Math.round(columns), 20, 520)
  const rows = Math.max(
    1,
    Math.round((sourceHeight / sourceWidth) * cols * charAspect),
  )

  const canvas = document.createElement('canvas')
  canvas.width = cols
  canvas.height = rows
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D unavailable')

  ctx.drawImage(source, 0, 0, cols, rows)
  return ctx.getImageData(0, 0, cols, rows)
}

function pixelBrightness(
  data: Uint8ClampedArray,
  i: number,
  invert: boolean,
  exposure = 0,
): number {
  const r = data[i] ?? 0
  const g = data[i + 1] ?? 0
  const b = data[i + 2] ?? 0
  const a = data[i + 3] ?? 255
  let brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  if (a < 16) brightness = invert ? 1 : 0
  if (invert) brightness = 1 - brightness
  if (exposure !== 0) {
    brightness = clamp(brightness * 2 ** exposure, 0, 1)
  }
  return brightness
}

export function imageDataToAscii(
  image: ImageData,
  charset: string,
  invert = false,
  exposure = 0,
  withColors = false,
): AsciiConvertResult {
  const chars = charset.length > 0 ? charset : ASCII_CHARSETS.dense
  const { width: columns, height: rows, data } = image
  const lines: string[] = []
  const colors = withColors
    ? new Uint8ClampedArray(columns * rows * 3)
    : undefined

  for (let y = 0; y < rows; y++) {
    let line = ''
    for (let x = 0; x < columns; x++) {
      const i = (y * columns + x) * 4
      const brightness = pixelBrightness(data, i, invert, exposure)
      const idx = clamp(
        Math.floor(brightness * chars.length),
        0,
        chars.length - 1,
      )
      const ch = chars[idx] ?? ' '
      line += ch
      if (colors && ch !== ' ') {
        const ci = (y * columns + x) * 3
        colors[ci] = data[i] ?? 0
        colors[ci + 1] = data[i + 1] ?? 0
        colors[ci + 2] = data[i + 2] ?? 0
      }
    }
    lines.push(line)
  }

  return {
    text: lines.join('\n'),
    columns,
    rows,
    colors,
  }
}

/**
 * Silhouette + phrase fill (e.g. 我爱你中国.txt):
 * dark (or light if inverted) pixels get the next char from `phrase`;
 * background stays spaces. Phrase cursor only advances on ink.
 */
export function imageDataToPhraseAscii(
  image: ImageData,
  options: {
    phrase: string
    threshold?: number
    invert?: boolean
    fillAll?: boolean
    withColors?: boolean
    exposure?: number
  },
): AsciiConvertResult {
  const raw = Array.from(options.phrase).filter((ch) => !/\s/.test(ch))
  const phrase = raw.length > 0 ? raw : Array.from('我爱你中国')
  const threshold = clamp(options.threshold ?? 0.55, 0, 1)
  const invert = options.invert ?? false
  const fillAll = options.fillAll ?? false
  const withColors = options.withColors ?? false
  const exposure = options.exposure ?? 0

  const { width: columns, height: rows, data } = image
  const lines: string[] = []
  const colors = withColors
    ? new Uint8ClampedArray(columns * rows * 3)
    : undefined
  let cursor = 0

  for (let y = 0; y < rows; y++) {
    let line = ''
    for (let x = 0; x < columns; x++) {
      const i = (y * columns + x) * 4
      const brightness = pixelBrightness(data, i, invert, exposure)
      const ink = fillAll || brightness <= threshold
      if (ink) {
        const ch = phrase[cursor % phrase.length] ?? '·'
        cursor += 1
        line += ch
        if (colors) {
          const ci = (y * columns + x) * 3
          colors[ci] = data[i] ?? 0
          colors[ci + 1] = data[i + 1] ?? 0
          colors[ci + 2] = data[i + 2] ?? 0
        }
      } else {
        line += ' '
      }
    }
    lines.push(line)
  }

  return {
    text: lines.join('\n'),
    columns,
    rows,
    colors,
  }
}

export async function fileToImageBitmap(file: File): Promise<ImageBitmap> {
  if (!file.type.startsWith('image/')) {
    throw new Error('请选择图片文件')
  }
  return createImageBitmap(file)
}

export function convertBitmapToAscii(
  bitmap: ImageBitmap,
  options: AsciiConvertOptions,
): AsciiConvertResult {
  const sampled = sampleImageData(
    bitmap,
    bitmap.width,
    bitmap.height,
    options.columns,
    options.charAspect ?? DEFAULT_CHAR_ASPECT,
  )
  return imageDataToAscii(
    sampled,
    options.charset,
    options.invert ?? false,
    options.exposure ?? 0,
    options.withColors ?? false,
  )
}

export function convertBitmapToPhraseAscii(
  bitmap: ImageBitmap,
  options: AsciiPhraseOptions,
): AsciiConvertResult {
  const sampled = sampleImageData(
    bitmap,
    bitmap.width,
    bitmap.height,
    options.columns,
    options.charAspect ?? (hasCjkText(options.phrase) ? 1 : DEFAULT_CHAR_ASPECT),
  )
  return imageDataToPhraseAscii(sampled, {
    phrase: options.phrase,
    threshold: options.threshold,
    invert: options.invert,
    fillAll: options.fillAll,
    withColors: options.withColors,
    exposure: options.exposure,
  })
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

/**
 * Paint ASCII on a canvas:
 * - char width = measureText(metricGlyph)
 * - line height = advance / charAspect when provided, else font box / lineHeight
 */
export function paintAsciiToCanvas(
  canvas: HTMLCanvasElement,
  text: string,
  options: AsciiPaintOptions,
): AsciiPaintSize {
  const fontSize = Math.max(0.5, options.fontSize)
  const padding = options.padding ?? 12
  const dpr = options.devicePixelRatio ?? 1
  const fontFamily = options.fontFamily ?? PREVIEW_MONO_FONT
  const metricGlyph =
    options.metricGlyph ?? pickMetricGlyph(text.slice(0, 64))
  const metrics = measureMonoCellMetrics(fontSize, fontFamily, metricGlyph)
  const charWidth = metrics.advance
  const aspect = options.charAspect
  const charHeight = Math.max(
    0.5,
    options.lineHeight ??
      (aspect && aspect > 0
        ? charWidth / aspect
        : metrics.lineHeight),
  )
  const font = `${fontSize}px ${fontFamily}`
  const colors = options.colors

  const lines = text.length > 0 ? text.split('\n') : ['']
  let maxCols = 1
  for (const line of lines) maxCols = Math.max(maxCols, line.length || 1)

  const cssWidth = Math.ceil(maxCols * charWidth + padding * 2)
  const cssHeight = Math.ceil(lines.length * charHeight + padding * 2)

  canvas.width = Math.max(1, Math.ceil(cssWidth * dpr))
  canvas.height = Math.max(1, Math.ceil(cssHeight * dpr))
  canvas.style.width = `${cssWidth}px`
  canvas.style.height = `${cssHeight}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.fillStyle = options.background
  ctx.fillRect(0, 0, cssWidth, cssHeight)
  ctx.font = font
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'

  // Always paint on a fixed cell grid so mono vs colored only differs by color.
  // Whole-line fillText uses proportional space widths and packs CJK together.
  const colorCols = colors
    ? Math.max(1, Math.floor(colors.length / 3 / Math.max(1, lines.length)))
    : maxCols

  for (let y = 0; y < lines.length; y++) {
    const line = lines[y] ?? ''
    const top = padding + y * charHeight
    for (let x = 0; x < line.length; x++) {
      const ch = line[x] ?? ' '
      if (ch === ' ') continue
      if (colors) {
        const ci = (y * colorCols + x) * 3
        const r = colors[ci] ?? 0
        const g = colors[ci + 1] ?? 0
        const b = colors[ci + 2] ?? 0
        ctx.fillStyle = `rgb(${r},${g},${b})`
      } else {
        ctx.fillStyle = options.foreground
      }
      ctx.fillText(ch, padding + x * charWidth, top)
    }
  }

  return { cssWidth, cssHeight, charWidth, charHeight }
}

/** Render ASCII text onto a PNG blob for download. */
export async function asciiToPngBlob(
  text: string,
  options: AsciiPngOptions = {},
): Promise<Blob> {
  const fontSize = options.fontSize ?? 10
  const padding = options.padding ?? 16
  const background = options.background ?? '#070a12'
  const foreground = options.foreground ?? '#d8e0ff'

  const canvas = document.createElement('canvas')
  paintAsciiToCanvas(canvas, text, {
    fontSize,
    padding,
    background,
    foreground,
    fontFamily: options.fontFamily ?? EXPORT_MONO_FONT,
    charAspect: options.charAspect,
    lineHeight: options.lineHeight,
    metricGlyph: options.metricGlyph,
    colors: options.colors,
    devicePixelRatio: 1,
  })

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png'),
  )
  if (!blob) throw new Error('PNG 导出失败')
  return blob
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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

/**
 * Pick a zoom % so the ASCII block fits inside the preview frame at `fontSize`.
 */
export function suggestFitZoom(options: FitZoomOptions): number {
  const fontSize = Math.max(2, options.fontSize)
  const padding = options.padding ?? 24
  const margin = options.margin ?? 0.92
  const minZoom = options.minZoom ?? 10
  const maxZoom = options.maxZoom ?? 300
  const step = options.step ?? 5

  const metrics = measureMonoCellMetrics(
    fontSize,
    options.fontFamily ?? PREVIEW_MONO_FONT,
    options.metricGlyph ?? 'M',
  )
  const charWidth = metrics.advance
  const aspect = options.charAspect
  const charHeight =
    aspect && aspect > 0 ? charWidth / aspect : metrics.lineHeight

  const artW = options.columns * charWidth + padding * 2
  const artH = options.rows * charHeight + padding * 2
  if (artW <= 0 || artH <= 0) return 100

  const availW = Math.max(80, options.frameWidth)
  const availH = Math.max(80, options.frameHeight)
  const fit = Math.min(availW / artW, availH / artH) * margin

  // displayFontSize = fontSize * zoom/100 → linear scale with zoom
  const raw = fit * 100
  const snapped = Math.round(raw / step) * step
  return clamp(snapped, minZoom, maxZoom)
}
