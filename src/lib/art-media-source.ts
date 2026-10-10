import { isImageFile, isVideoFile, type AsciiFrameSource } from './ascii'

export const ART_SOURCE_MAX_BYTES = 64 * 1024 * 1024
export const ART_SOURCE_MAX_PIXELS = 32000000
export const ART_SOURCE_MAX_SIDE = 16384

export interface PreparedArtSource {
  kind: 'image' | 'video'
  frame: AsciiFrameSource
  url: string
  bitmap?: ImageBitmap
  /** Derived playback bytes; the caller keeps the user's original GIF for projects. */
  playbackFile?: File
  animated?: boolean
  dispose: () => void
}

function checkDimensions(width: number, height: number) {
  if (width < 2 || height < 2) throw new Error('素材尺寸太小，宽高至少需要 2 像素')
  if (width * height > ART_SOURCE_MAX_PIXELS || Math.max(width, height) > ART_SOURCE_MAX_SIDE)
    throw new Error('素材尺寸过大，请缩小到 3200 万像素以内、最长边不超过 16384 像素')
}

/** Decode into a candidate; the caller commits it or disposes it, leaving the active source intact. */
export async function prepareArtSource(
  file: File,
  video: HTMLVideoElement | null,
  signal: AbortSignal,
): Promise<PreparedArtSource> {
  signal.throwIfAborted()
  if (!file.size) throw new Error('文件为空，请重新选择素材')
  if (file.size > ART_SOURCE_MAX_BYTES) throw new Error('素材超过 64 MiB，请压缩或裁剪后重试')
  let playbackFile = file
  let animated = false
  if (file.type === 'image/gif' || /\.gif$/i.test(file.name)) {
    const { gifPlaybackFile } = await import('./gif-playback')
    const playback = await gifPlaybackFile(file, signal, checkDimensions)
    if (playback) {
      playbackFile = playback
      animated = true
    }
  }
  signal.throwIfAborted()
  if (isVideoFile(playbackFile)) {
    if (!video) throw new Error('视频预览组件未就绪')
    const url = URL.createObjectURL(playbackFile)
    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      if (video.getAttribute('src') === url) {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
      URL.revokeObjectURL(url)
    }
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer)
          video.removeEventListener('loadeddata', ready)
          video.removeEventListener('error', failed)
          signal.removeEventListener('abort', aborted)
        }
        const finish = (cause?: Error | DOMException) => {
          cleanup()
          if (cause) reject(cause)
          else resolve()
        }
        const ready = () => finish()
        const failed = () => finish(new Error('视频解码失败，请换 MP4 / WebM 再试'))
        const aborted = () => finish(new DOMException('素材读取已取消', 'AbortError'))
        const timer = setTimeout(() => finish(new Error('视频读取超时，请换文件后重试')), 20000)
        video.addEventListener('loadeddata', ready, { once: true })
        video.addEventListener('error', failed, { once: true })
        signal.addEventListener('abort', aborted, { once: true })
        video.muted = true
        video.playsInline = true
        video.preload = 'auto'
        video.src = url
        video.load()
      })
      signal.throwIfAborted()
      checkDimensions(video.videoWidth, video.videoHeight)
      if (!Number.isFinite(video.duration) || video.duration <= 0)
        throw new Error('视频时长无法读取，请重新编码后重试')
      return {
        kind: 'video',
        playbackFile,
        animated,
        frame: { source: video, width: video.videoWidth, height: video.videoHeight },
        url,
        dispose,
      }
    } catch (cause) {
      dispose()
      throw cause
    }
  }
  if (!isImageFile(file)) throw new Error('请选择图片或视频（MP4 / WebM）')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    signal.throwIfAborted()
    throw new Error('图片解码失败，请换一张有效图片重试')
  }
  try {
    signal.throwIfAborted()
    checkDimensions(bitmap.width, bitmap.height)
  } catch (cause) {
    bitmap.close()
    throw cause
  }
  const url = URL.createObjectURL(file)
  let disposed = false
  return {
    kind: 'image',
    frame: { source: bitmap, width: bitmap.width, height: bitmap.height },
    bitmap,
    url,
    dispose: () => {
      if (disposed) return
      disposed = true
      bitmap.close()
      URL.revokeObjectURL(url)
    },
  }
}
