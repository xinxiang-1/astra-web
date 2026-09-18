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

/** Seek a video element and wait until `seeked` (or resolve if already there). */
export function seekVideoTo(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Math.min(
    Math.max(0, time),
    Number.isFinite(video.duration) ? video.duration : time,
  )
  if (Math.abs(video.currentTime - target) < 0.001) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('视频定位失败'))
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    video.currentTime = target
  })
}
