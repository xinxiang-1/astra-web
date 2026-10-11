import { VIDEO_LIVE_MAX_COLUMNS } from './constants'
import type { AsciiMediaKind, AsciiMode } from './types'

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name)
}

export function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true
  return /\.(mp4|webm|mov|ogg|ogv|m4v)$/i.test(file.name)
}

export function videoLiveColumnCap(mode: AsciiMode): number {
  return mode === 'phrase'
    ? VIDEO_LIVE_MAX_COLUMNS.phrase
    : VIDEO_LIVE_MAX_COLUMNS.charset
}

/**
 * Ultra / max (and any columns above the live cap) should prerender
 * then play, instead of realtime capped preview.
 */
export function needsVideoPrerender(
  columns: number,
  mode: AsciiMode,
): boolean {
  return columns > videoLiveColumnCap(mode)
}

/**
 * Resolve sampling columns.
 * - Image / paused video / export → full selected columns
 * - Playing video → capped so realtime ASCII stays responsive
 */
export function resolveAsciiColumns(options: {
  columns: number
  kind: AsciiMediaKind | null
  mode: AsciiMode
  /** True while video is actively playing a realtime preview. */
  livePreview?: boolean
  forExport?: boolean
}): number {
  const cols = clamp(Math.round(options.columns), 20, 520)
  if (
    options.forExport ||
    options.kind !== 'video' ||
    !options.livePreview
  ) {
    return cols
  }
  return Math.min(cols, videoLiveColumnCap(options.mode))
}

/** @deprecated Prefer resolveAsciiColumns. */
export function clampColumnsForMedia(
  columns: number,
  kind: AsciiMediaKind | null,
): number {
  return resolveAsciiColumns({
    columns,
    kind,
    mode: 'charset',
    livePreview: kind === 'video',
  })
}

export async function fileToImageBitmap(file: File): Promise<ImageBitmap> {
  if (!isImageFile(file)) {
    throw new Error('请选择图片文件')
  }
  return createImageBitmap(file)
}

/**
 * Load a local video into an element (muted / inline / loop by default).
 * Caller owns the object URL and must revoke it.
 */
export function loadVideoElement(
  file: File,
  video: HTMLVideoElement,
): Promise<string> {
  if (!isVideoFile(file)) {
    return Promise.reject(new Error('请选择视频文件'))
  }
  const url = URL.createObjectURL(file)
  video.pause()
  video.muted = true
  video.playsInline = true
  video.loop = true
  video.preload = 'auto'
  video.src = url

  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup()
      if (video.videoWidth < 2 || video.videoHeight < 2) {
        URL.revokeObjectURL(url)
        reject(new Error('无法读取视频画面'))
        return
      }
      resolve(url)
    }
    const onError = () => {
      cleanup()
      URL.revokeObjectURL(url)
      reject(new Error('视频解码失败，请换 MP4 / WebM 再试'))
    }
    const cleanup = () => {
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('loadeddata', onReady, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.load()
  })
}

export type VideoSeekOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  /** Legacy callers can cancel while the decoder is still seeking. */
  shouldAbort?: () => boolean
}

/** Wait for decoded positioning, with cancellation and a bounded decoder wait. */
export function seekVideoTo(
  video: HTMLVideoElement,
  time: number,
  options: VideoSeekOptions = {},
): Promise<void> {
  const aborted = () => options.signal?.aborted || options.shouldAbort?.()
  const abortError = () => new DOMException('已取消视频定位', 'AbortError')
  if (aborted()) return Promise.reject(abortError())
  if (!Number.isFinite(time)) return Promise.reject(new Error('视频定位时间无效'))
  const target = Math.min(
    Math.max(0, time),
    Number.isFinite(video.duration) ? Math.max(0, video.duration) : Math.max(0, time),
  )
  if (!video.seeking && Math.abs(video.currentTime - target) < 0.001) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) reject(error)
      else resolve()
    }
    const onAbort = () => finish(abortError())
    const onSeeked = () => {
      if (aborted()) onAbort()
      else if (!video.seeking) finish()
    }
    const onError = () => finish(new Error('视频定位失败，请换 MP4 / WebM 再试'))
    const cleanup = () => {
      clearTimeout(timeout)
      clearInterval(poll)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      video.removeEventListener('emptied', onAbort)
      video.removeEventListener('abort', onAbort)
      options.signal?.removeEventListener('abort', onAbort)
    }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.addEventListener('emptied', onAbort)
    video.addEventListener('abort', onAbort)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const requestedTimeout = options.timeoutMs ?? 10_000
    const timeoutMs = Number.isFinite(requestedTimeout)
      ? Math.max(1, requestedTimeout)
      : 10_000
    const timeout = setTimeout(() => finish(new Error('视频定位超时，请重试或换 MP4 / WebM 文件')), timeoutMs)
    const poll = options.shouldAbort
      ? setInterval(() => { if (aborted()) onAbort() }, 25)
      : undefined
    try {
      if (aborted()) onAbort()
      else video.currentTime = target
    } catch (error) {
      finish(error)
    }
  })
}
