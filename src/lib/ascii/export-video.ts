import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
} from 'mediabunny'

import {
  EXPORT_MONO_FONT,
  VIDEO_EXPORT_BUFFER_FRAMES,
  VIDEO_EXPORT_MAX_FRAMES,
} from './constants'
import { paintAsciiToCanvas } from './paint'
import type { AsciiPngOptions } from './types'

export type AsciiVideoFrameInput = {
  text: string
  colors?: Uint8ClampedArray | null
}

export type AsciiVideoExportOptions = {
  frameCount: number
  fps: number
  /** Load / convert one export frame (0-based). Return null to skip. */
  getFrame: (index: number) => Promise<AsciiVideoFrameInput | null>
  fontSize?: number
  background?: string
  foreground?: string
  fontFamily?: string
  charAspect?: number
  metricGlyph?: string
  padding?: number
  /** Cap long edge of the recorded canvas (keeps encode cost sane). */
  maxEdge?: number
  videoBitsPerSecond?: number
  shouldAbort?: () => boolean
  onProgress?: (info: { done: number; total: number }) => void
  /**
   * Above this many frames, encode one and drop it before reading the next.
   * Defaults to `VIDEO_EXPORT_BUFFER_FRAMES`.
   */
  bufferFrames?: number
}

export type AsciiVideoExportResult = {
  blob: Blob
  mimeType: string
  extension: 'mp4' | 'webm'
}

type RecorderPick = {
  mimeType: string
  extension: 'mp4' | 'webm'
}

const MIME_CANDIDATES: RecorderPick[] = [
  { mimeType: 'video/mp4;codecs=avc1.4D401F', extension: 'mp4' },
  { mimeType: 'video/mp4;codecs=avc1.42E01E', extension: 'mp4' },
  { mimeType: 'video/mp4', extension: 'mp4' },
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm' },
  { mimeType: 'video/webm', extension: 'webm' },
]

const CANCELLED = '已取消视频导出'

function even(n: number) {
  const v = Math.max(2, Math.round(n))
  return v + (v % 2)
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function isCancelled(error: unknown) {
  return error instanceof Error && error.message === CANCELLED
}

/** Prefer MP4 when the browser can record it; otherwise WebM. */
export function pickRecorderMimeType(): RecorderPick | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const candidate of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(candidate.mimeType)) return candidate
  }
  return { mimeType: '', extension: 'webm' }
}

function scaleToMaxEdge(width: number, height: number, maxEdge: number) {
  const edge = Math.max(width, height)
  if (edge <= maxEdge) {
    return { width: even(width), height: even(height) }
  }
  const scale = maxEdge / edge
  return { width: even(width * scale), height: even(height * scale) }
}

async function collectFrames(options: AsciiVideoExportOptions) {
  const frameCount = Math.max(0, Math.floor(options.frameCount))
  if (frameCount <= 0) throw new Error('没有可导出的视频帧')

  const frames: AsciiVideoFrameInput[] = []
  for (let i = 0; i < frameCount; i++) {
    if (options.shouldAbort?.()) throw new Error(CANCELLED)
    const frame = await options.getFrame(i)
    options.onProgress?.({ done: i + 1, total: frameCount })
    if (frame?.text) frames.push(frame)
  }
  if (frames.length === 0) throw new Error('视频导出未得到有效帧')
  return frames
}

function createPaintSession(
  sample: AsciiVideoFrameInput,
  options: AsciiVideoExportOptions,
) {
  const fontSize = Math.max(6, options.fontSize ?? 10)
  const padding = options.padding ?? 16
  const background = options.background ?? '#ffffff'
  const foreground = options.foreground ?? '#111111'
  const fontFamily = options.fontFamily ?? EXPORT_MONO_FONT
  const maxEdge = options.maxEdge ?? 1280

  const paintCanvas = document.createElement('canvas')
  const recordCanvas = document.createElement('canvas')
  const recordCtx = recordCanvas.getContext('2d')
  if (!recordCtx) throw new Error('Canvas 2D unavailable')

  const paintOptions: AsciiPngOptions = {
    fontSize,
    padding,
    background,
    foreground,
    fontFamily,
    charAspect: options.charAspect,
    metricGlyph: options.metricGlyph,
  }

  const paint = (frame: AsciiVideoFrameInput) => {
    paintAsciiToCanvas(paintCanvas, frame.text, {
      ...paintOptions,
      fontSize,
      background,
      foreground,
      colors: frame.colors ?? undefined,
      devicePixelRatio: 1,
    })
    recordCtx.fillStyle = background
    recordCtx.fillRect(0, 0, recordCanvas.width, recordCanvas.height)
    recordCtx.imageSmoothingEnabled = false
    recordCtx.drawImage(
      paintCanvas,
      0,
      0,
      paintCanvas.width,
      paintCanvas.height,
      0,
      0,
      recordCanvas.width,
      recordCanvas.height,
    )
  }

  const size = paintAsciiToCanvas(paintCanvas, sample.text, {
    ...paintOptions,
    fontSize,
    background,
    foreground,
    colors: sample.colors ?? undefined,
    devicePixelRatio: 1,
  })
  const fitted = scaleToMaxEdge(size.cssWidth, size.cssHeight, maxEdge)
  recordCanvas.width = fitted.width
  recordCanvas.height = fitted.height
  paint(sample)

  return { recordCanvas, paint, background }
}

async function encodeMp4(
  recordCanvas: HTMLCanvasElement,
  frames: AsyncIterable<AsciiVideoFrameInput>,
  paint: (frame: AsciiVideoFrameInput) => void,
  options: AsciiVideoExportOptions,
) {
  if (typeof VideoEncoder === 'undefined') {
    throw new Error('当前浏览器不支持 MP4 编码')
  }

  const fps = Math.max(8, Math.min(24, Math.round(options.fps)))
  const target = new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  })
  const source = new CanvasSource(recordCanvas, {
    codec: 'avc',
    bitrate: options.videoBitsPerSecond ?? 4_000_000,
    keyFrameInterval: 2,
  })
  output.addVideoTrack(source, { frameRate: fps })
  await output.start()

  const duration = 1 / fps
  let written = 0
  try {
    for await (const frame of frames) {
      if (options.shouldAbort?.()) throw new Error(CANCELLED)
      if (!frame?.text) continue
      paint(frame)
      await source.add(written / fps, duration, {
        keyFrame: written % fps === 0,
      })
      written += 1
    }
    if (written === 0) throw new Error('视频导出未得到有效帧')
    await output.finalize()
  } catch (error) {
    if (output.state === 'started' || output.state === 'pending') {
      await output.cancel().catch(() => undefined)
    }
    throw error
  }

  if (!target.buffer || target.buffer.byteLength === 0) {
    throw new Error('视频导出失败：文件为空')
  }
  return new Blob([target.buffer], { type: 'video/mp4' })
}

async function encodeWithRecorder(
  recordCanvas: HTMLCanvasElement,
  frames: AsyncIterable<AsciiVideoFrameInput>,
  paint: (frame: AsciiVideoFrameInput) => void,
  options: AsciiVideoExportOptions,
): Promise<AsciiVideoExportResult> {
  const fps = Math.max(8, Math.min(24, Math.round(options.fps)))
  const pick = pickRecorderMimeType()
  if (!pick) throw new Error('当前浏览器不支持视频录制导出')

  const stream = recordCanvas.captureStream(fps)
  const recorderOptions: MediaRecorderOptions = {
    videoBitsPerSecond: options.videoBitsPerSecond ?? 4_000_000,
  }
  if (pick.mimeType) recorderOptions.mimeType = pick.mimeType

  let recorder: MediaRecorder
  try {
    recorder = new MediaRecorder(stream, recorderOptions)
  } catch {
    recorder = new MediaRecorder(stream)
  }

  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  const stopped = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve()
    recorder.onerror = () => reject(new Error('视频录制失败'))
  })

  const frameDelay = Math.max(16, Math.round(1000 / fps))
  recorder.start(200)
  await sleep(40)

  try {
    for await (const frame of frames) {
      if (options.shouldAbort?.()) throw new Error(CANCELLED)
      if (!frame?.text) continue
      paint(frame)
      await sleep(frameDelay)
    }
    await sleep(frameDelay)
  } catch (error) {
    if (recorder.state !== 'inactive') recorder.stop()
    stream.getTracks().forEach((track) => track.stop())
    throw error
  }

  recorder.stop()
  stream.getTracks().forEach((track) => track.stop())
  await stopped

  const mimeType =
    recorder.mimeType || pick.mimeType || chunks[0]?.type || 'video/webm'
  const extension: 'mp4' | 'webm' = /mp4/i.test(mimeType) ? 'mp4' : 'webm'
  const blob = new Blob(chunks, { type: mimeType || `video/${extension}` })
  if (blob.size <= 0) throw new Error('视频导出失败：文件为空')
  return { blob, mimeType: blob.type || mimeType, extension }
}

async function* listFrames(
  frames: AsciiVideoFrameInput[],
): AsyncGenerator<AsciiVideoFrameInput> {
  for (const frame of frames) yield frame
}

async function locateFirstFrame(
  options: AsciiVideoExportOptions,
  frameCount: number,
) {
  for (let i = 0; i < frameCount; i++) {
    if (options.shouldAbort?.()) throw new Error(CANCELLED)
    const frame = await options.getFrame(i)
    options.onProgress?.({ done: i + 1, total: frameCount })
    if (frame?.text) return { index: i, frame }
  }
  throw new Error('视频导出未得到有效帧')
}

/** Read one frame, encode it, then drop it. Nothing but the current frame is kept. */
async function* streamFrames(
  options: AsciiVideoExportOptions,
  frameCount: number,
  first: { index: number; frame: AsciiVideoFrameInput },
): AsyncGenerator<AsciiVideoFrameInput> {
  yield first.frame
  for (let i = first.index + 1; i < frameCount; i++) {
    if (options.shouldAbort?.()) throw new Error(CANCELLED)
    const frame = await options.getFrame(i)
    options.onProgress?.({ done: i + 1, total: frameCount })
    if (frame?.text) yield frame
  }
}

/**
 * Paint ASCII frames and encode an MP4 (H.264).
 * Short clips are buffered. Past `bufferFrames`, each frame is encoded and dropped.
 * Falls back to MediaRecorder (often WebM) when WebCodecs is unavailable.
 */
export async function exportAsciiVideo(
  options: AsciiVideoExportOptions,
): Promise<AsciiVideoExportResult> {
  const frameCount = Math.max(0, Math.floor(options.frameCount))
  if (frameCount <= 0) throw new Error('没有可导出的视频帧')

  const bufferFrames = options.bufferFrames ?? VIDEO_EXPORT_BUFFER_FRAMES
  const discard = frameCount > bufferFrames

  if (!discard) {
    const buffered = await collectFrames({ ...options, frameCount })
    const first = buffered[0]
    if (!first) throw new Error('视频导出未得到有效帧')
    const session = createPaintSession(first, options)
    try {
      const blob = await encodeMp4(
        session.recordCanvas,
        listFrames(buffered),
        session.paint,
        options,
      )
      return { blob, mimeType: 'video/mp4', extension: 'mp4' }
    } catch (error) {
      if (isCancelled(error)) throw error
      return encodeWithRecorder(
        session.recordCanvas,
        listFrames(buffered),
        session.paint,
        options,
      )
    }
  }

  const located = await locateFirstFrame(options, frameCount)
  const session = createPaintSession(located.frame, options)
  const frames = streamFrames(options, frameCount, {
    index: located.index,
    frame: located.frame,
  })
  if (typeof VideoEncoder === 'undefined') {
    return encodeWithRecorder(
      session.recordCanvas,
      frames,
      session.paint,
      options,
    )
  }
  const blob = await encodeMp4(
    session.recordCanvas,
    frames,
    session.paint,
    options,
  )
  return { blob, mimeType: 'video/mp4', extension: 'mp4' }
}

export function planVideoExportFrames(
  durationSec: number,
  fps: number,
  maxFrames = VIDEO_EXPORT_MAX_FRAMES,
):
  | { ok: true; total: number; fps: number; step: number; discard: boolean }
  | { ok: false; error: string } {
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { ok: false, error: '无法读取视频时长，请换一个文件' }
  }
  const clampedFps = Math.max(8, Math.min(24, Math.round(fps)))
  const step = 1 / clampedFps
  const total = Math.floor(durationSec * clampedFps) + 1
  if (total <= 0) return { ok: false, error: '没有可导出的视频帧' }
  if (total > maxFrames) {
    const maxSec = Math.floor(maxFrames / clampedFps)
    return {
      ok: false,
      error: `这段有 ${total} 帧，超过单次 ${maxFrames} 帧（约 ${maxSec} 秒）。请缩短选段或降低帧率。`,
    }
  }
  return {
    ok: true,
    total,
    fps: clampedFps,
    step,
    discard: total > VIDEO_EXPORT_BUFFER_FRAMES,
  }
}
