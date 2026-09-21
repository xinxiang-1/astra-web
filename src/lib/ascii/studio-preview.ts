import {
  mountStudio,
  normalizeStudioSettings,
  type StudioInput,
  type StudioSettings,
} from 'asciify-engine/studio'

export type AsciiStudioHoverEffect =
  | 'none'
  | 'trail'
  | 'water'
  | 'silk'
  | 'vortex'
  | 'contour'
  | 'dissolve'

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
}

export type CharsetStudioHandle = Awaited<ReturnType<typeof mountStudio>>

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
export function studioCellSizeFromColumns(
  stageCssWidth: number,
  columns: number,
): number {
  const w = Math.max(40, stageCssWidth)
  const cols = clamp(Math.round(columns), 20, 520)
  return clamp(Math.round(w / cols), 2, 14)
}

/** Map art-page exposure/contrast into Studio color fields. */
export function mapToneToStudio(exposure = 0, contrast = 0) {
  const brightness = clamp(0.05 + exposure * 0.08, -0.4, 0.55)
  const studioContrast = clamp(1 + contrast * 0.9, 0.55, 1.85)
  return { brightness, contrast: studioContrast }
}

export function buildAsciiStudioSettings(
  input: AsciiStudioPreviewInput,
): StudioSettings {
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
    charset: charsetForStudio(input.charset, input.invert ?? true),
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
      algorithm: 'none' as const,
      palette: 'mono',
      colors: ['#080808', ink],
      amount: 1,
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
) {
  const rect = stage.getBoundingClientRect()
  const cssW = Math.max(2, rect.width)
  const cssH = Math.max(2, rect.height)
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
  return mountStudio(canvas, source, {
    settings,
    adaptive: false,
    maxDimension: options?.maxDimension ?? 1920,
    maxCells: options?.maxCells ?? 180_000,
    signal: options?.signal,
  })
}

export function asciiStudioEffectsActive(
  hover: AsciiStudioHoverEffect,
  motion: AsciiStudioMotion,
) {
  return hover !== 'none' || motion !== 'none'
}
