import { ASCII_CHARSETS, DEFAULT_CHAR_ASPECT } from './constants'
import type {
  AsciiConvertOptions,
  AsciiConvertResult,
  AsciiFrameSource,
  AsciiPhraseOptions,
  AsciiToneOptions,
} from './types'

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function hasCjkText(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text)
}

/** Draw `source` into an offscreen canvas at the sampling size. */
export function sampleImageData(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  columns: number,
  charAspect: number = DEFAULT_CHAR_ASPECT,
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

  // Browser downscale already box-filters — same role as asciify cell averaging.
  ctx.drawImage(source, 0, 0, cols, rows)
  return ctx.getImageData(0, 0, cols, rows)
}

/**
 * Asciify-style brightness/contrast on 0–255 luminance.
 * contrast ≈ 0 leaves the value unchanged; positive boosts midtones.
 */
function toneMap255(lum: number, brightness: number, contrast: number): number {
  let v = lum + 255 * brightness
  const c = clamp(contrast, -1, 1)
  const factor = (259 * (c * 255 + 255)) / (255 * (259 - c * 255))
  v = factor * (v - 128) + 128
  return clamp(v, 0, 255)
}

/** Ordered Bayer 4×4 dither on 0–255 luminance (asciify core). */
const BAYER_4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const

function bayerDither255(
  lum: number,
  x: number,
  y: number,
  strength: number,
): number {
  if (strength <= 0) return lum
  const threshold = BAYER_4[y & 3]![x & 3]! / 16 - 0.5
  return clamp(lum + threshold * strength * 128, 0, 255)
}

/** Exposure stops → linear brightness bias roughly like asciify's brightness. */
function exposureToBrightness(exposure: number): number {
  if (!exposure) return 0
  // Map ≈±2 EV into a gentle −0.45…0.45 shift before contrast.
  return clamp(exposure * 0.22, -0.5, 0.5)
}

function splitCharset(charset: string): string[] {
  const raw = charset.length > 0 ? charset : ASCII_CHARSETS.dense
  // Prefer grapheme clusters when available (emoji / ZWJ sequences).
  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter?: new (
        locale?: string,
        options?: { granularity: 'grapheme' },
      ) => { segment: (input: string) => Iterable<{ segment: string }> }
    }
  ).Segmenter
  if (typeof Segmenter === 'function') {
    return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(raw)].map(
      (part) => part.segment,
    )
  }
  return Array.from(raw)
}

/** charset index: dark→light ramp, luminance 0–255. */
function pickCharsetChar(
  lum255: number,
  chars: string[],
  invert: boolean,
): string {
  const n = Math.max(1, chars.length)
  let t = lum255 / 255
  if (invert) t = 1 - t
  const idx = clamp(Math.floor(t * (n - 1)), 0, n - 1)
  return chars[idx] ?? ' '
}

function findLuminanceRange(
  data: Uint8ClampedArray,
  columns: number,
  rows: number,
): { min: number; range: number } {
  let min = 255
  let max = 0
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      const i = (y * columns + x) * 4
      const a = data[i + 3] ?? 255
      if (a < 16) continue
      const lum =
        0.299 * (data[i] ?? 0) +
        0.587 * (data[i + 1] ?? 0) +
        0.114 * (data[i + 2] ?? 0)
      if (lum < min) min = lum
      if (lum > max) max = lum
    }
  }
  const range = max > min ? max - min : 255
  return { min, range }
}

export function imageDataToAscii(
  image: ImageData,
  charset: string,
  options: AsciiToneOptions & { withColors?: boolean } = {},
): AsciiConvertResult {
  const invert = options.invert ?? false
  const exposure = options.exposure ?? 0
  const contrast = options.contrast ?? 0
  const normalize = options.normalize ?? false
  const ditherStrength = clamp(options.ditherStrength ?? 0, 0, 1)
  const withColors = options.withColors ?? false

  const chars = splitCharset(charset)
  const { width: columns, height: rows, data } = image
  const lines: string[] = []
  const colors = withColors
    ? new Uint8ClampedArray(columns * rows * 3)
    : undefined

  const { min: lumMin, range: lumRange } = normalize
    ? findLuminanceRange(data, columns, rows)
    : { min: 0, range: 255 }
  const brightnessBias = exposureToBrightness(exposure)

  for (let y = 0; y < rows; y++) {
    let line = ''
    for (let x = 0; x < columns; x++) {
      const i = (y * columns + x) * 4
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      const a = data[i + 3] ?? 255

      let lum =
        a < 16 ? 0 : 0.299 * r + 0.587 * g + 0.114 * b
      if (normalize) lum = ((lum - lumMin) / lumRange) * 255
      lum = toneMap255(lum, brightnessBias, contrast)
      lum = bayerDither255(lum, x, y, ditherStrength)

      const ch = pickCharsetChar(lum, chars, invert)
      line += ch
      if (colors && ch !== ' ' && ch !== '　') {
        const ci = (y * columns + x) * 3
        colors[ci] = r
        colors[ci + 1] = g
        colors[ci + 2] = b
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
    contrast?: number
    normalize?: boolean
  },
): AsciiConvertResult {
  const raw = Array.from(options.phrase).filter((ch) => !/\s/.test(ch))
  const phrase = raw.length > 0 ? raw : Array.from('我爱你中国')
  const threshold = clamp(options.threshold ?? 0.55, 0, 1)
  const invert = options.invert ?? false
  const fillAll = options.fillAll ?? false
  const withColors = options.withColors ?? false
  const exposure = options.exposure ?? 0
  const contrast = options.contrast ?? 0
  const normalize = options.normalize ?? false

  const { width: columns, height: rows, data } = image
  const lines: string[] = []
  const colors = withColors
    ? new Uint8ClampedArray(columns * rows * 3)
    : undefined
  let cursor = 0

  const { min: lumMin, range: lumRange } = normalize
    ? findLuminanceRange(data, columns, rows)
    : { min: 0, range: 255 }
  const brightnessBias = exposureToBrightness(exposure)

  for (let y = 0; y < rows; y++) {
    let line = ''
    for (let x = 0; x < columns; x++) {
      const i = (y * columns + x) * 4
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      const a = data[i + 3] ?? 255

      let lum = a < 16 ? 0 : 0.299 * r + 0.587 * g + 0.114 * b
      if (normalize) lum = ((lum - lumMin) / lumRange) * 255
      lum = toneMap255(lum, brightnessBias, contrast)
      let brightness = lum / 255
      if (invert) brightness = 1 - brightness

      const ink = fillAll || brightness <= threshold
      if (ink) {
        const ch = phrase[cursor % phrase.length] ?? '·'
        cursor += 1
        line += ch
        if (colors) {
          const ci = (y * columns + x) * 3
          colors[ci] = r
          colors[ci + 1] = g
          colors[ci + 2] = b
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

export function convertSourceToAscii(
  frame: AsciiFrameSource,
  options: AsciiConvertOptions,
): AsciiConvertResult {
  const sampled = sampleImageData(
    frame.source,
    frame.width,
    frame.height,
    options.columns,
    options.charAspect ?? DEFAULT_CHAR_ASPECT,
  )
  return imageDataToAscii(sampled, options.charset, {
    invert: options.invert ?? false,
    exposure: options.exposure ?? 0,
    contrast: options.contrast ?? 0,
    normalize: options.normalize ?? false,
    ditherStrength: options.ditherStrength ?? 0,
    withColors: options.withColors ?? false,
  })
}

export function convertSourceToPhraseAscii(
  frame: AsciiFrameSource,
  options: AsciiPhraseOptions,
): AsciiConvertResult {
  const sampled = sampleImageData(
    frame.source,
    frame.width,
    frame.height,
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
    contrast: options.contrast,
    normalize: options.normalize,
  })
}

export function convertBitmapToAscii(
  bitmap: ImageBitmap,
  options: AsciiConvertOptions,
): AsciiConvertResult {
  return convertSourceToAscii(
    { source: bitmap, width: bitmap.width, height: bitmap.height },
    options,
  )
}

export function convertBitmapToPhraseAscii(
  bitmap: ImageBitmap,
  options: AsciiPhraseOptions,
): AsciiConvertResult {
  return convertSourceToPhraseAscii(
    { source: bitmap, width: bitmap.width, height: bitmap.height },
    options,
  )
}
