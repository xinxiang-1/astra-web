import { loadImageElement, type SignatureStamp } from './extract'
import type { SignatureCutoutResult, SignatureCutoutSettings } from './signature-cutout'

export async function prepareSignaturePhoto(file: File, signal: AbortSignal) {
  if (file.size > 32 * 1024 * 1024) throw new Error('签名图片超过32MB，请先缩小图片')
  const { image, objectUrl } = await loadImageElement(file)
  try {
    signal.throwIfAborted()
    const scale = Math.min(1, 2032 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('无法读取签名图片')
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
      return ctx.getImageData(0, 0, canvas.width, canvas.height)
    } finally { canvas.width = canvas.height = 1 }
  } finally { URL.revokeObjectURL(objectUrl) }
}

export function cutoutSignature(pixels: ImageData, settings: SignatureCutoutSettings, signal: AbortSignal) {
  signal.throwIfAborted()
  if (typeof Worker === 'undefined') throw new Error('当前浏览器不支持后台签名抠图，请更新浏览器后重试')
  return new Promise<SignatureCutoutResult>((resolve, reject) => {
    const worker = new Worker(new URL('./cutout.worker.ts', import.meta.url), { type: 'module' })
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate() }
    const abort = () => { finish(); reject(new DOMException('已取消', 'AbortError')) }
    const timer = setTimeout(() => { finish(); reject(new Error('抠图等待超时，请裁切签名区域后重试')) }, 30000)
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ result?: SignatureCutoutResult; error?: string }>) => {
      finish()
      if (event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error ?? '签名抠图失败'))
    }
    worker.onerror = (event) => { event.preventDefault(); finish(); reject(new Error('后台抠图失败，请重试')) }
    try {
      const copy = new ImageData(pixels.data.slice(), pixels.width, pixels.height)
      worker.postMessage({ pixels: copy, settings }, [copy.data.buffer])
    } catch (error) { finish(); reject(error) }
  })
}

export function cutoutToStamp(result: SignatureCutoutResult, file: File): SignatureStamp {
  const canvas = document.createElement('canvas')
  canvas.width = result.pixels.width; canvas.height = result.pixels.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法保存透明签名')
  ctx.putImageData(result.pixels, 0, 0)
  return { id: `cutout:${file.name}:${file.lastModified}:${crypto.randomUUID()}`, label: file.name,
    canvas, width: canvas.width, height: canvas.height, previewUrl: canvas.toDataURL('image/png') }
}
