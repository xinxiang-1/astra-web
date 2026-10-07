import { signatureColorWash } from './color-wash'
import { createWashTaskQueue, processSignatureWash, washRecipe, type SignatureWashRecipe } from './wash-style'

const ready = new WeakMap<HTMLImageElement, Map<string, HTMLCanvasElement>>()
type Options = { signal?: { cancelled?: boolean }; onProgress?: (ratio: number) => void }
function check(options: Options) { if (options.signal?.cancelled) throw new Error('已取消') }
export function preparedSignatureWash(portrait: HTMLImageElement, recipe: SignatureWashRecipe = {}) {
  const profile = washRecipe(recipe)
  if (!profile) return signatureColorWash(portrait)
  const canvas = ready.get(portrait)?.get(profile.key)
  if (!canvas) throw new Error('风格底色尚未准备，请重新生成')
  return canvas
}
/** Six versioned variants maximum per immutable source; raw wash retains its existing cache. */
export async function prepareSignatureWash(portrait: HTMLImageElement, recipe: SignatureWashRecipe = {}, options: Options = {}) {
  check(options)
  const profile = washRecipe(recipe)
  if (!profile) return signatureColorWash(portrait)
  const existing = ready.get(portrait)?.get(profile.key)
  if (existing) return existing
  const source = signatureColorWash(portrait), ctx = source.getContext('2d')!
  let pixels: ImageData
  try {
    if (typeof Worker === 'undefined') throw new Error('后台配色不可用')
    const worker = new Worker(new URL('./wash-style.worker.ts', import.meta.url), { type: 'module' })
    try {
      pixels = await new Promise<ImageData>((resolve, reject) => {
        let activity = performance.now()
        const timer = setInterval(() => {
          if (options.signal?.cancelled || performance.now() - activity > 15000) {
            clearInterval(timer)
            reject(new Error(options.signal?.cancelled ? '已取消' : '后台配色等待超时'))
          }
        }, 16)
        const settle = () => clearInterval(timer)
        worker.onmessage = (event: MessageEvent<{ type: string; pixels: ImageData; ratio: number; error: string }>) => {
          activity = performance.now()
          if (event.data.type === 'progress') { options.onProgress?.(event.data.ratio); return }
          settle()
          if (event.data.type === 'done') resolve(event.data.pixels)
          else reject(new Error(event.data.error || '后台配色失败'))
        }
        worker.onerror = event => { event.preventDefault(); settle(); reject(new Error('后台配色失败')) }
        try { const input = ctx.getImageData(0, 0, source.width, source.height); worker.postMessage({ pixels: input, recipe }, [input.data.buffer]) }
        catch (error) { settle(); reject(error) }
      })
    } finally { worker.terminate() }
  } catch {
    check(options)
    const tasks = createWashTaskQueue()
    try {
      pixels = await processSignatureWash(ctx.getImageData(0, 0, source.width, source.height), recipe, {
        checkpoint: async () => { await tasks.yield(); check(options) }, progress: options.onProgress,
      })
    } finally { tasks.close() }
  }
  check(options)
  const canvas = document.createElement('canvas'); canvas.width = pixels.width; canvas.height = pixels.height
  canvas.getContext('2d', { willReadFrequently: true })!.putImageData(pixels, 0, 0)
  let cache = ready.get(portrait)
  if (!cache) { cache = new Map(); ready.set(portrait, cache) }
  cache.set(profile.key, canvas)
  return canvas
}
