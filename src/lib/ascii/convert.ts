import { ASCII_CHARSETS, DEFAULT_CHAR_ASPECT } from './constants'
import type {
  AsciiConvertOptions,
  AsciiConvertResult,
  AsciiFrameSource,
  AsciiPhraseOptions,
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
  return imageDataToAscii(
    sampled,
    options.charset,
    options.invert ?? false,
    options.exposure ?? 0,
    options.withColors ?? false,
  )
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
