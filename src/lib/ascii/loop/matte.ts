import { DEFAULT_CHAR_ASPECT } from '../constants'
import { sampleImageData } from '../convert'
import type { AsciiFrameSource, PrerenderFrame } from '../types'
import {
  LOOP_FLOW_CHARSET,
  LOOP_MATRIX_CHARSET,
  type LoopFlowPattern,
} from './constants'

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** Cheap deterministic hash → [0, 1) for noise / matrix seeds. */
function hash01(x: number, y: number, t: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + t * 74.7) * 43758.5453
  return n - Math.floor(n)
}

function pick(charset: string, idx: number): string {
  const n = Math.max(1, charset.length)
  return charset[((idx % n) + n) % n] ?? '·'
}

function densityPick(charset: string, density: number): string {
  const n = Math.max(1, charset.length)
  const band = clamp(Math.floor(density * n), 0, n - 1)
  return charset[band] ?? '·'
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
  if (exposure !== 0) brightness = clamp(brightness * 2 ** exposure, 0, 1)
  return brightness
}

/** Border-median brightness ≈ backdrop; cells near it are background. */
export function estimateBackgroundBrightness(
  image: ImageData,
  invert = false,
  exposure = 0,
): number {
  const { width, height, data } = image
  const samples: number[] = []
  const push = (x: number, y: number) => {
    const i = (y * width + x) * 4
    samples.push(pixelBrightness(data, i, invert, exposure))
  }
  for (let x = 0; x < width; x++) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 1; y < height - 1; y++) {
    push(0, y)
    push(width - 1, y)
  }
  samples.sort((a, b) => a - b)
  return samples[Math.floor(samples.length / 2)] ?? 0.5
}

/**
 * 1 = background cell, 0 = subject.
 * `threshold` is max distance from estimated backdrop brightness.
 */
export function buildBackgroundMask(
  image: ImageData,
  options?: {
    invert?: boolean
    exposure?: number
    threshold?: number
  },
): Uint8Array {
  const invert = options?.invert ?? false
  const exposure = options?.exposure ?? 0
  const threshold = options?.threshold ?? 0.14
  const bg = estimateBackgroundBrightness(image, invert, exposure)
  const { width, height, data } = image
  const mask = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const b = pixelBrightness(data, i, invert, exposure)
      mask[y * width + x] = Math.abs(b - bg) <= threshold ? 1 : 0
    }
  }
  return mask
}

function flowGlyph(
  pattern: LoopFlowPattern,
  x: number,
  y: number,
  frame: number,
  columns: number,
  rows: number,
  charset: string,
): string {
  const cx = (columns - 1) * 0.5
  const cy = (rows - 1) * 0.5
  const dx = x - cx
  const dy = y - cy
  const dist = Math.hypot(dx, dy)
  const angle = Math.atan2(dy, dx)

  switch (pattern) {
    case 'rain':
      return pick(charset, x * 3 + y + frame * 2)
    case 'wave':
      return pick(
        charset,
        Math.floor(x + Math.sin(y * 0.35 + frame * 0.45) * 5 + frame),
      )
    case 'drift':
      return pick(charset, x + y * 2 + frame * 3)
    case 'pulse': {
      const breathe = 0.5 + 0.5 * Math.sin(frame * 0.4)
      const band = Math.floor(breathe * (charset.length - 1))
      return charset[clamp(band + ((x + y + frame) % 2), 0, charset.length - 1)] ?? '·'
    }
    case 'matrix': {
      // Column cascade: bright head, fading trail (Matrix / digital rain).
      const speed = 1 + (Math.floor(hash01(x, 0, 0) * 3) % 3)
      const offset = Math.floor(hash01(x, 1, 0) * rows)
      const head = ((frame * speed + offset) % Math.max(1, rows + 8)) - 2
      const trail = head - y
      if (trail < 0 || trail > 10) return ' '
      if (trail === 0) return pick(LOOP_MATRIX_CHARSET, frame + x)
      return densityPick(LOOP_MATRIX_CHARSET, 1 - trail / 11)
    }
    case 'spiral': {
      // Spiral arms rotating around center.
      const arms = 3
      const twist = angle * arms + dist * 0.35 - frame * 0.55
      return densityPick(charset, 0.5 + 0.5 * Math.sin(twist))
    }
    case 'vortex': {
      // Inward swirl — angle advances with radius and time.
      const swirl = angle + dist * 0.22 - frame * 0.4
      const ring = Math.sin(swirl * 4) * 0.5 + 0.5
      const falloff = clamp(1 - dist / (Math.max(cx, cy) + 1), 0.15, 1)
      return densityPick(charset, ring * falloff)
    }
    case 'ripple': {
      // Expanding concentric rings.
      const ring = Math.sin(dist * 0.55 - frame * 0.7)
      return densityPick(charset, 0.5 + 0.5 * ring)
    }
    case 'plasma': {
      // Classic multi-sine plasma interference.
      const v =
        Math.sin(x * 0.18 + frame * 0.25) +
        Math.sin(y * 0.16 - frame * 0.2) +
        Math.sin((x + y) * 0.12 + frame * 0.15) +
        Math.sin(dist * 0.2 - frame * 0.3)
      return densityPick(charset, (v + 4) / 8)
    }
    case 'tunnel': {
      // Radial tunnel rush toward vanishing point.
      const depth = (1 / (dist * 0.08 + 0.35)) * 4 + frame * 0.55
      const stripe = Math.sin(angle * 6 + depth)
      return densityPick(charset, 0.45 + 0.45 * stripe)
    }
    case 'scan': {
      // Horizontal scan beam sweeping down.
      const band = ((frame * 1.4) % (rows + 6)) - 3
      const d = Math.abs(y - band)
      if (d > 3) return densityPick(charset, 0.12 + 0.08 * hash01(x, y, frame))
      return densityPick(charset, 1 - d / 4)
    }
    case 'noise': {
      // Flickering static / snow.
      const flick = hash01(x, y, Math.floor(frame / 2))
      const spark = hash01(x * 3, y * 5, frame)
      if (spark > 0.97) return charset[charset.length - 1] ?? '#'
      return densityPick(charset, flick * 0.85)
    }
    default:
      return pick(charset, x + y + frame)
  }
}

export type ApplyFlowingBackgroundOptions = {
  text: string
  columns: number
  rows: number
  mask: Uint8Array
  frameIndex: number
  pattern: LoopFlowPattern
  flowCharset?: string
  colors?: Uint8ClampedArray | null
  /** RGB used for replaced background glyphs. */
  flowColor?: readonly [number, number, number]
}

/** Replace masked background cells with flowing glyphs (subject untouched). */
export function applyFlowingBackground(
  options: ApplyFlowingBackgroundOptions,
): { text: string; colors?: Uint8ClampedArray } {
  const {
    columns,
    rows,
    mask,
    frameIndex,
    pattern,
    flowCharset = LOOP_FLOW_CHARSET,
  } = options
  const lines = options.text.split('\n')
  const out: string[] = []
  const colors = options.colors ? new Uint8ClampedArray(options.colors) : undefined
  const [fr, fg, fb] = options.flowColor ?? [120, 140, 170]

  for (let y = 0; y < rows; y++) {
    const src = lines[y] ?? ''
    let line = ''
    for (let x = 0; x < columns; x++) {
      const mi = y * columns + x
      if (mask[mi] === 1) {
        line += flowGlyph(
          pattern,
          x,
          y,
          frameIndex,
          columns,
          rows,
          flowCharset,
        )
        if (colors) {
          const ci = mi * 3
          colors[ci] = fr
          colors[ci + 1] = fg
          colors[ci + 2] = fb
        }
      } else {
        line += src[x] ?? ' '
      }
    }
    out.push(line)
  }
  return { text: out.join('\n'), colors }
}

export function matteSourceMask(
  source: AsciiFrameSource,
  columns: number,
  options?: {
    invert?: boolean
    exposure?: number
    threshold?: number
    charAspect?: number
  },
): Uint8Array {
  const image = sampleImageData(
    source.source,
    source.width,
    source.height,
    columns,
    options?.charAspect ?? DEFAULT_CHAR_ASPECT,
  )
  return buildBackgroundMask(image, options)
}

export function applyFlowToFrame(
  frame: PrerenderFrame,
  mask: Uint8Array,
  frameIndex: number,
  pattern: LoopFlowPattern,
  flowColor?: readonly [number, number, number],
): PrerenderFrame {
  const next = applyFlowingBackground({
    text: frame.text,
    columns: frame.columns,
    rows: frame.rows,
    mask,
    frameIndex,
    pattern,
    colors: frame.colors,
    flowColor,
  })
  return {
    ...frame,
    text: next.text,
    colors: next.colors ?? null,
  }
}
