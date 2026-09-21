import { convertSourceToAscii } from '../convert'
import { seekVideoTo } from '../media'
import type { AsciiFrameSource, PrerenderFrame } from '../types'
import {
  LOOP_MAX_COLUMNS,
  LOOP_MAX_DURATION_SEC,
  LOOP_MAX_FRAMES,
  type LoopFlowPattern,
} from './constants'
import { sampleDominantColor, type DominantColor } from './color'
import { applyFlowToFrame, matteSourceMask } from './matte'

export type CaptureLoopBaseOptions = {
  columns: number
  fps: number
  invert?: boolean
  charAspect?: number
  withColors?: boolean
  exposure?: number
  charset: string
  /** Flow pattern stamped onto matted background cells. */
  flowPattern?: LoopFlowPattern
  /** Distance from backdrop brightness to treat as background. */
  matteThreshold?: number
  maxDurationSec?: number
  maxFrames?: number
  shouldAbort?: () => boolean
  onProgress?: (info: { done: number; total: number }) => void
}

export type CaptureLoopOptions = CaptureLoopBaseOptions & {
  video: HTMLVideoElement
}

export type CaptureLoopResult = {
  frames: PrerenderFrame[]
  color: DominantColor
  fps: number
}

function clampColumns(columns: number) {
  return Math.max(40, Math.min(LOOP_MAX_COLUMNS, Math.round(columns)))
}

function clampFps(fps: number) {
  return Math.max(6, Math.min(12, Math.round(fps)))
}

function flowColorFromDominant(
  color: DominantColor,
): readonly [number, number, number] {
  const [r, g, b] = color.rgb
  return [
    Math.min(255, Math.round(r * 0.55 + 80)),
    Math.min(255, Math.round(g * 0.55 + 90)),
    Math.min(255, Math.round(b * 0.55 + 110)),
  ]
}

function convertAndMatte(
  source: AsciiFrameSource,
  options: CaptureLoopBaseOptions,
  columns: number,
  frameIndex: number,
  color: DominantColor,
): PrerenderFrame {
  const result = convertSourceToAscii(source, {
    columns,
    charset: options.charset,
    invert: options.invert ?? false,
    charAspect: options.charAspect,
    exposure: options.exposure ?? 0,
    withColors: options.withColors ?? true,
  })
  const frame: PrerenderFrame = {
    text: result.text,
    colors: result.colors ?? null,
    columns: result.columns,
    rows: result.rows,
    time: frameIndex,
  }
  const pattern = options.flowPattern ?? 'rain'
  const mask = matteSourceMask(source, result.columns, {
    invert: options.invert,
    exposure: options.exposure,
    threshold: options.matteThreshold ?? 0.14,
    charAspect: options.charAspect,
  })
  return applyFlowToFrame(
    frame,
    mask,
    frameIndex,
    pattern,
    flowColorFromDominant(color),
  )
}

/** Decode animated GIF / WebP when ImageDecoder is available. */
export async function decodeAnimatedImageBitmaps(file: File): Promise<{
  bitmaps: ImageBitmap[]
  delaysMs: number[]
}> {
  if (typeof ImageDecoder === 'undefined') {
    throw new Error('当前浏览器无法逐帧读取 GIF，请改用短 MP4 / WebM')
  }
  const data = await file.arrayBuffer()
  const decoder = new ImageDecoder({ data, type: file.type || 'image/gif' })
  await decoder.tracks.ready
  const track = decoder.tracks.selectedTrack
  if (!track) throw new Error('无法读取动画轨道')
  const count = track.frameCount
  if (count <= 0) throw new Error('动画没有帧')

  const bitmaps: ImageBitmap[] = []
  const delaysMs: number[] = []
  const limit = Math.min(count, LOOP_MAX_FRAMES)
  for (let i = 0; i < limit; i++) {
    const { image, duration } = await decoder.decode({ frameIndex: i })
    const bitmap = await createImageBitmap(image)
    image.close()
    bitmaps.push(bitmap)
    delaysMs.push(Math.max(40, duration / 1000))
  }
  decoder.close()
  return { bitmaps, delaysMs }
}

export async function captureLoopAsciiFromBitmaps(
  bitmaps: readonly ImageBitmap[],
  options: CaptureLoopBaseOptions,
): Promise<CaptureLoopResult> {
  if (bitmaps.length === 0) throw new Error('没有可解析的帧')
  const columns = clampColumns(options.columns)
  const fps = clampFps(options.fps)
  const maxFrames = options.maxFrames ?? LOOP_MAX_FRAMES
  const total = Math.min(maxFrames, bitmaps.length)
  const frames: PrerenderFrame[] = []
  const first = bitmaps[0]
  if (!first) throw new Error('没有可解析的帧')
  const color = sampleDominantColor(first, first.width, first.height)

  for (let i = 0; i < total; i++) {
    if (options.shouldAbort?.()) throw new Error('已取消解析')
    const bitmap = bitmaps[i]
    if (!bitmap) continue
    frames.push(
      convertAndMatte(
        { source: bitmap, width: bitmap.width, height: bitmap.height },
        options,
        columns,
        i,
        color,
      ),
    )
    options.onProgress?.({ done: i + 1, total })
    await new Promise<void>((r) => setTimeout(r, 0))
  }

  if (frames.length === 0) throw new Error('解析未得到有效帧')
  return { frames, color, fps }
}

export async function captureLoopAsciiFrames(
  options: CaptureLoopOptions,
): Promise<CaptureLoopResult> {
  const video = options.video
  const duration = video.duration
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('无法读取时长，请换一段循环视频或 GIF')
  }

  const maxDuration = options.maxDurationSec ?? LOOP_MAX_DURATION_SEC
  const maxFrames = options.maxFrames ?? LOOP_MAX_FRAMES
  const fps = clampFps(options.fps)
  const span = Math.min(duration, maxDuration)
  const step = 1 / fps
  const total = Math.min(maxFrames, Math.floor(span * fps) + 1)
  if (total <= 0) throw new Error('没有可解析的帧')

  const columns = clampColumns(options.columns)
  const frames: PrerenderFrame[] = []
  let color: DominantColor | null = null
  const resume = video.currentTime

  try {
    for (let i = 0; i < total; i++) {
      if (options.shouldAbort?.()) throw new Error('已取消解析')
      const t = Math.min(span, i * step)
      await seekVideoTo(video, t)
      if (
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
        video.videoWidth < 2
      ) {
        continue
      }

      if (!color) {
        color = sampleDominantColor(video, video.videoWidth, video.videoHeight)
      }

      const source: AsciiFrameSource = {
        source: video,
        width: video.videoWidth,
        height: video.videoHeight,
      }
      const frame = convertAndMatte(source, options, columns, i, color)
      frames.push({ ...frame, time: t })
      options.onProgress?.({ done: i + 1, total })
      await new Promise<void>((r) => setTimeout(r, 0))
    }
  } finally {
    try {
      await seekVideoTo(video, resume)
    } catch {
      // ignore
    }
  }

  if (frames.length === 0) throw new Error('解析未得到有效帧')
  return {
    frames,
    color: color ?? {
      hex: '#1a2238',
      rgb: [26, 34, 56],
      hsl: [0.62, 0.36, 0.16],
    },
    fps,
  }
}
