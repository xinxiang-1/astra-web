import { IMAGE_HEADER_BYTES, readImageHeader } from './image-header'

export type ImageReadOptions = {
  signal?: AbortSignal
  maxBytes?: number
  maxPixels?: number
  maxSide?: number
  timeoutMs?: number
}

function checkDimensions(width: number, height: number, options: ImageReadOptions) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error('图片尺寸无效，请换一张有效图片重试')
  if (options.maxPixels && width * height > options.maxPixels)
    throw new Error(`图片最多支持${options.maxPixels / 10_000}万像素，请裁切或缩小后重试`)
  if (options.maxSide && Math.max(width, height) > options.maxSide)
    throw new Error(`图片最长边不能超过${options.maxSide}像素，请缩小后重试`)
}

/** Caller owns a successful URL. Failures, timeout and abort release every candidate resource. */
export async function loadImageElement(file: File, options: ImageReadOptions = {}): Promise<{
  image: HTMLImageElement
  objectUrl: string
}> {
  const { signal } = options
  signal?.throwIfAborted()
  for (const limit of [options.maxBytes, options.maxPixels, options.maxSide, options.timeoutMs])
    if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error('图片读取参数无效')
  if (!file.size) throw new Error('图片文件为空，请重新选择')
  if (options.maxBytes && file.size > options.maxBytes)
    throw new Error(`图片超过${options.maxBytes / 1024 / 1024}MiB，请压缩或裁切后重试`)
  return new Promise((resolve, reject) => {
    let image: HTMLImageElement | null = null, objectUrl = '', settled = false
    const finish = (cause?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      if (image) { image.onload = null; image.onerror = null }
      if (cause !== undefined) {
        image?.removeAttribute('src')
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        reject(cause)
      } else resolve({ image: image!, objectUrl })
    }
    const aborted = () => finish(signal?.reason ?? new DOMException('图片读取已取消', 'AbortError'))
    const timer = setTimeout(() => finish(new Error('图片读取超时，请换文件或缩小图片后重试')), options.timeoutMs ?? 30000)
    signal?.addEventListener('abort', aborted, { once: true })
    void (async () => {
      const header = readImageHeader(await file.slice(0, IMAGE_HEADER_BYTES).arrayBuffer())
      if (settled) return
      signal?.throwIfAborted()
      if (header) checkDimensions(header.width, header.height, options)
      image = new Image()
      image.decoding = 'async'
      image.onload = () => {
        try { checkDimensions(image!.naturalWidth, image!.naturalHeight, options); finish() }
        catch (cause) { finish(cause) }
      }
      image.onerror = () => finish(new Error(`无法读取图片：${file.name}，请换一张有效图片重试`))
      objectUrl = URL.createObjectURL(file)
      image.src = objectUrl
    })().catch(finish)
  })
}
