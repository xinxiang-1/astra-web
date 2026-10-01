import {
  mountStudio,
  createStudioRenderer,
  loadStudioMedia,
  mountStudioMedia,
  studioSourceSize,
  type StudioSource,
  normalizeStudioSettings,
  type StudioInput,
  type StudioSettings,
} from 'asciify-engine/studio'
import type { AsciiFrameSource } from './types'

export type AsciiStudioHoverEffect =
  'none' | 'trail' | 'water' | 'silk' | 'vortex' | 'contour' | 'dissolve'

export type AsciiStudioMotion = 'none' | 'current' | 'reform' | 'caustics'

export type AsciiStudioPreviewInput = {
  charset: string
  /** Preview color: source pixels vs single ink. */
  colored: boolean
  ink?: string
  /**
   * Match AsciiArt `previewInvert`: when true, bright pixels get dense glyphs
   * (dark-theme default). When false, dark pixels get dense glyphs.
   */
  invert?: boolean
  /** EV-ish exposure from the art UI (−2…+2). */
  exposure?: number
  /** Art UI contrast (−1…+1). Mapped to Studio midtone boost. */
  contrast?: number
  cellSize?: number
  hoverEffect?: AsciiStudioHoverEffect
  hoverStrength?: number
  hoverRadius?: number
  motion?: AsciiStudioMotion
  motionSpeed?: number
  backdrop?: string
  /** Custom phrase characters are rendered by the same native glyph pipeline. */
  phrase?: string
  phraseFillAll?: boolean
  ditherStrength?: number
  normalize?: boolean
  phraseThreshold?: number
}

export type AsciiStudioGridSpec = {
  columns: number
  rows: number
  /** CSS box shared by static and animated previews. */
  cssWidth: number
  cssHeight: number
}

export type AsciiStudioRasterSpec = {
  width: number
  height: number
  pixelRatio: number
  cellSize: number
  columns: number
  rows: number
}

/** Minimum readable cell for the native-size character preview. */
export const STUDIO_NATIVE_CELL_SIZE = 6

export type CharsetStudioHandle = Awaited<ReturnType<typeof mountStudio>> & {
  setSourceOptions(input: AsciiStudioPreviewInput): void
}

const preparedSources = new WeakMap<StudioSource, { key: string; canvas: HTMLCanvasElement }>()
export function prepareStudioSource(
  source: StudioSource,
  input: AsciiStudioPreviewInput,
): StudioSource {
  const maskPhrase = Boolean(input.phrase && !input.phraseFillAll)
  if (!input.normalize && !maskPhrase) return source
  const [width, height] = studioSourceSize(source)
  const key = JSON.stringify([
    width,
    height,
    input.normalize,
    maskPhrase,
    input.phraseThreshold,
    input.invert,
  ])
  const cached = preparedSources.get(source)
  const moving = source instanceof HTMLVideoElement || source instanceof HTMLCanvasElement
  if (cached?.key === key && !moving) return cached.canvas
  const canvas = cached?.canvas ?? document.createElement('canvas')
  const scale = Math.min(1, 1040 / Math.max(width, height))
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Canvas 2D unavailable')
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = image.data
  let min = 255
  let max = 0
  if (input.normalize) {
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 16) continue
      const lum = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114
      min = Math.min(min, lum)
      max = Math.max(max, lum)
    }
  }
  const stretch = input.normalize && max > min ? 255 / (max - min) : 1
  const offset = stretch === 1 ? 0 : min
  for (let i = 0; i < data.length; i += 4) {
    const lum = data[i]! * 0.299 + data[i + 1]! * 0.587 + data[i + 2]! * 0.114
    const normalized = Math.max(0, Math.min(255, (lum - offset) * stretch))
    if (
      maskPhrase &&
      (input.invert ? 1 - normalized / 255 : normalized / 255) > (input.phraseThreshold ?? 0.55)
    ) {
      data[i + 3] = 0
    }
    // Shift luminance while retaining source hue for colored character art.
    const delta = normalized - lum
    data[i] = data[i]! + delta
    data[i + 1] = data[i + 1]! + delta
    data[i + 2] = data[i + 2]! + delta
  }
  ctx.putImageData(image, 0, 0)
  preparedSources.set(source, { key, canvas })
  return canvas
}

const ASCII_FALLBACK = '@%#*+=-:. '

/** Art charsets are dark→light; Studio ramps index high luminance → last char. */
export function toStudioCharset(charset: string): string {
  const chars = Array.from(charset.length > 0 ? charset : ASCII_FALLBACK)
  return chars.reverse().join('')
}

/**
 * Pick Studio charset order so polarity matches the static converter.
 * - invert true  → bright→dense (same as dark-theme preview default)
 * - invert false → dark→dense (same as light-theme / 反相 off on light)
 */
export function charsetForStudio(charset: string, invert: boolean): string {
  const raw = charset.length > 0 ? charset : ASCII_FALLBACK
  return invert ? toStudioCharset(raw) : raw
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/**
 * Map art-page column count → Studio cellSize so 低清/高清 still changes
 * glyph density while hover/motion is on.
 * target: ≈ `columns` cells across the CSS stage width.
 */
export function studioCellSizeFromColumns(stageCssWidth: number, columns: number): number {
  const w = Math.max(40, stageCssWidth)
  const cols = clamp(Math.round(columns), 20, 520)
  return clamp(Math.round(w / cols), 2, 14)
}

/**
 * Studio 4.1 has a fixed ASCII row-height multiplier (1.65) and clamps
 * cellSize to >= 3. Driving it from CSS width therefore collapses the high,
 * ultra and max presets into nearly the same grid. Instead, render a raster
 * whose physical dimensions encode the already-generated static grid, then
 * let CSS fit that raster into the exact same stage box.
 */
export function studioRasterForGrid(grid: AsciiStudioGridSpec): AsciiStudioRasterSpec {
  const columns = clamp(Math.round(grid.columns), 20, 520)
  const cellSize = STUDIO_NATIVE_CELL_SIZE
  const rowHeight = cellSize * 1.65
  const cssRatio = Math.max(0.05, grid.cssWidth / Math.max(1, grid.cssHeight))
  const width = Math.max(2, Math.round((columns - 0.01) * cellSize))
  // Preserve Studio's native stage aspect. Encoding the static row count here
  // squeezes Studio's 1.65 row grid and visibly degrades its effects.
  const height = Math.max(2, Math.round(width / cssRatio))
  const rows = Math.max(1, Math.ceil(height / rowHeight))
  return {
    width,
    height,
    pixelRatio: 1,
    cellSize,
    columns,
    rows,
  }
}

/** Map art-page exposure/contrast into Studio color fields. */
export function mapToneToStudio(exposure = 0, contrast = 0) {
  const brightness = clamp(0.05 + exposure * 0.08, -0.4, 0.55)
  const studioContrast = clamp(1 + contrast * 0.9, 0.55, 1.85)
  return { brightness, contrast: studioContrast }
}

export function buildAsciiStudioSettings(input: AsciiStudioPreviewInput): StudioSettings {
  const ink = input.ink?.trim() || '#e8e6e1'
  const tone = mapToneToStudio(input.exposure ?? 0, input.contrast ?? 0)
  const cellSize = clamp(Math.round(input.cellSize ?? 4), 2, 14)
  const hoverEffect = input.hoverEffect ?? 'trail'
  const motion = input.motion ?? 'none'

  return normalizeStudioSettings({
    version: 1,
    aspectRatio: 'original',
    style: 'ascii',
    cellSize,
    charset: input.phrase
      ? `${input.phraseFillAll ? '' : ' '}${input.phrase.replace(/\s/g, '') || '光与影'}`
      : charsetForStudio(input.charset, input.invert ?? true),
    colorMode: input.colored ? 'source' : 'accent',
    ink,
    crop: { x: 0.5, y: 0.35, zoom: 1, rotation: 0 },
    backdrop: {
      mode: 'solid',
      color: input.backdrop?.trim() || '#0a0a0a',
      opacity: 1,
    },
    color: {
      brightness: tone.brightness,
      contrast: tone.contrast,
      saturation: input.colored ? 1 : 0,
      grayscale: input.colored ? 0 : 1,
      tint: ink,
      amount: 0,
      blend: 'source-over',
    },
    dither: {
      algorithm: (input.ditherStrength ?? 0) > 0 ? ('bayer4' as const) : ('none' as const),
      palette: 'mono',
      colors: ['#080808', ink],
      amount: input.ditherStrength ?? 1,
      scale: 2,
      threshold: 0.5,
      motion: 'none' as const,
      speed: 1,
    },
    motion: { type: motion, speed: input.motionSpeed ?? 0.45 },
    hover: {
      effect: hoverEffect,
      strength: input.hoverStrength ?? 0.65,
      radius: input.hoverRadius ?? 0.38,
      edgeSafe: false,
    },
    effects: {
      bloom: 0,
      characterBloom: 0,
      grain: 0,
      dust: 0,
      scanlines: 0,
      crt: 0,
      prism: 0,
      vignette: 0,
      glitch: 0,
      pixelate: 0,
      blur: 0,
      blurType: 'gaussian',
      angle: 0,
      focus: 0.5,
      halftone: 0,
    },
  })
}

/** One native renderer for still previews, thumbnails and exported frames.
 * Reuse renderers per canvas; switching hover/motion never swaps glyph engines.
 */
const stillRenderers = new WeakMap<HTMLCanvasElement, ReturnType<typeof createStudioRenderer>>()
export function paintStudioFrame(
  canvas: HTMLCanvasElement,
  frame: AsciiFrameSource,
  input: AsciiStudioPreviewInput,
  columns: number,
  options: { longEdge?: number; transparent?: boolean; time?: number } = {},
) {
  const settings = buildAsciiStudioSettings({ ...input, cellSize: STUDIO_NATIVE_CELL_SIZE })
  settings.hover.effect = 'none'
  if (options.transparent) settings.backdrop.mode = 'transparent'
  const raster = studioRasterForGrid({
    columns,
    rows: 1,
    cssWidth: frame.width,
    cssHeight: frame.height,
  })
  const scale = options.longEdge ? options.longEdge / Math.max(raster.width, raster.height) : 1
  let renderer = stillRenderers.get(canvas)
  if (!renderer) {
    renderer = createStudioRenderer(canvas, settings, { maxDimension: 8192, maxCells: 180_000 })
    stillRenderers.set(canvas, renderer)
  }
  renderer.configure(settings)
  renderer.setPixelRatio(scale)
  renderer.render(
    prepareStudioSource(frame.source as StudioSource, input),
    options.time ?? 0,
    Math.round(raster.width * scale),
    Math.round(raster.height * scale),
    options.time ?? 0,
  )
  return canvas
}

export function disposeStudioFrame(canvas: HTMLCanvasElement) {
  stillRenderers.get(canvas)?.destroy()
  stillRenderers.delete(canvas)
}

export function studioPatchFromInput(input: AsciiStudioPreviewInput): StudioInput {
  const settings = buildAsciiStudioSettings(input)
  return {
    aspectRatio: settings.aspectRatio,
    cellSize: settings.cellSize,
    charset: settings.charset,
    colorMode: settings.colorMode,
    ink: settings.ink,
    color: settings.color,
    motion: settings.motion,
    hover: settings.hover,
    effects: settings.effects,
    dither: settings.dither,
    backdrop: settings.backdrop,
    crop: settings.crop,
  }
}

export function resizeCharsetStudio(
  studio: CharsetStudioHandle,
  stage: HTMLElement,
  grid?: { columns: number; rows: number },
) {
  const rect = stage.getBoundingClientRect()
  const cssW = Math.max(2, rect.width)
  const cssH = Math.max(2, rect.height)
  if (grid && grid.columns > 0 && grid.rows > 0) {
    const raster = studioRasterForGrid({
      columns: grid.columns,
      rows: grid.rows,
      cssWidth: cssW,
      cssHeight: cssH,
    })
    studio.resize(raster.width, raster.height, raster.pixelRatio)
    return raster
  }
  const dpr = Math.min(
    typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    2,
    1920 / Math.max(cssW, cssH),
  )
  studio.resize(Math.round(cssW * dpr), Math.round(cssH * dpr), dpr)
}

export async function mountCharsetStudio(
  canvas: HTMLCanvasElement,
  /** mountStudio only accepts File or URL string — not ImageBitmap / video elements. */
  source: File | string,
  input: AsciiStudioPreviewInput,
  options?: {
    signal?: AbortSignal
    maxDimension?: number
    maxCells?: number
  },
): Promise<CharsetStudioHandle> {
  const settings = buildAsciiStudioSettings(input)
  const media = await loadStudioMedia(source, options?.signal)
  let sourceOptions = input
  const nativeFrame = media.frame.bind(media)
  media.frame = (time) => prepareStudioSource(nativeFrame(time), sourceOptions)
  let mounted: Awaited<ReturnType<typeof mountStudio>>
  try {
    mounted = mountStudioMedia(canvas, media, {
      settings,
      adaptive: false,
      maxDimension: options?.maxDimension ?? 4096,
      maxCells: options?.maxCells ?? 180_000,
      signal: options?.signal,
    })
  } catch (error) {
    media.destroy()
    throw error
  }
  return Object.assign(mounted, {
    setSourceOptions(next: AsciiStudioPreviewInput) {
      sourceOptions = next
      mounted.redraw()
    },
  })
}

export function asciiStudioEffectsActive(hover: AsciiStudioHoverEffect, motion: AsciiStudioMotion) {
  return hover !== 'none' || motion !== 'none'
}
