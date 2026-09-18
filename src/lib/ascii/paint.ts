import {
  DEFAULT_CHAR_ASPECT,
  EXPORT_MONO_FONT,
  PREVIEW_MONO_FONT,
} from './constants'
import { hasCjkText } from './convert'
import type {
  AsciiPaintOptions,
  AsciiPaintSize,
  AsciiPngOptions,
  FitZoomOptions,
  MonoCellMetrics,
} from './types'

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
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
