import { loadImageElement, type SignatureStamp } from './extract'
import type { SignatureCutoutResult, SignatureCutoutSettings } from './signature-cutout'
import { FULL_IMAGE_REGION, imageRegionBounds, type ImageRegion } from '../image-region'

export async function openSignaturePhoto(file: File, signal: AbortSignal) {
  signal.throwIfAborted()
  const loaded = await loadImageElement(file, {
    signal, maxBytes: 32 * 1024 * 1024, maxPixels: 48_000_000, maxSide: 12000,
  })
  try {
    signal.throwIfAborted()
    return {
      ...loaded,
      dispose: () => {
        loaded.image.removeAttribute('src')
        URL.revokeObjectURL(loaded.objectUrl)
      },
    }
  } catch (error) {
    loaded.image.removeAttribute('src')
    URL.revokeObjectURL(loaded.objectUrl)
    throw error
  }
}

/** Crop the original source first; only the selected region is bounded for extraction. */
export function signatureRegionPixels(
  image: HTMLImageElement,
  region: ImageRegion = FULL_IMAGE_REGION,
) {
  const bounds = imageRegionBounds(image.naturalWidth, image.naturalHeight, region)
  const scale = Math.min(1, 2032 / Math.max(bounds.width, bounds.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bounds.width * scale))
  canvas.height = Math.max(1, Math.round(bounds.height * scale))
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('无法读取签名图片')
    ctx.drawImage(
      image,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    return ctx.getImageData(0, 0, canvas.width, canvas.height)
  } finally {
    canvas.width = canvas.height = 1
  }
}

export async function prepareSignaturePhoto(
  file: File,
  signal: AbortSignal,
  region: ImageRegion = FULL_IMAGE_REGION,
) {
  const photo = await openSignaturePhoto(file, signal)
  try {
    signal.throwIfAborted()
    return signatureRegionPixels(photo.image, region)
  } finally {
    photo.dispose()
  }
}

export function cutoutSignature(
  pixels: ImageData,
  settings: SignatureCutoutSettings,
  signal: AbortSignal,
) {
  signal.throwIfAborted()
  if (typeof Worker === 'undefined')
    throw new Error('当前浏览器不支持后台签名抠图，请更新浏览器后重试')
  return new Promise<SignatureCutoutResult>((resolve, reject) => {
    const worker = new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'module' })
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = () => {
      finish()
      reject(new DOMException('已取消', 'AbortError'))
    }
    const timer = setTimeout(() => {
      finish()
      reject(new Error('抠图等待超时，请裁切签名区域后重试'))
    }, 30000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (
      event: MessageEvent<{ result?: SignatureCutoutResult; error?: string }>,
    ) => {
      finish()
      if (event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error ?? '签名抠图失败'))
    }
    worker.onerror = (event) => {
      event.preventDefault()
      finish()
      reject(new Error('后台抠图失败，请重试'))
    }
    try {
      const copy = new ImageData(pixels.data.slice(), pixels.width, pixels.height)
      worker.postMessage({ pixels: copy, settings }, [copy.data.buffer])
    } catch (error) {
      finish()
      reject(error)
    }
  })
}

export function cutoutToStamp(result: SignatureCutoutResult, file: File): SignatureStamp {
  const canvas = document.createElement('canvas')
  canvas.width = result.pixels.width
  canvas.height = result.pixels.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法保存透明签名')
  ctx.putImageData(result.pixels, 0, 0)
  return {
    id: `cutout:${file.name}:${file.lastModified}:${crypto.randomUUID()}`,
    label: file.name,
    canvas,
    width: canvas.width,
    height: canvas.height,
    previewUrl: canvas.toDataURL('image/png'),
  }
}
