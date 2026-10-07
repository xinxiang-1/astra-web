/// <reference lib="webworker" />
import { renderPrint, type Sample } from './engine'
import { styles, validateRecipe, type PrintAtlas, type PrintRecipe } from './model'

const scope = self as unknown as DedicatedWorkerGlobalScope
let cancelled = false
const tasks = new MessageChannel()
let resume: (() => void) | null = null
tasks.port1.onmessage = () => { const next = resume; resume = null; next?.() }
async function checkpoint() {
  // A worker already frees the UI thread. Queue a task for cancellation without nested timer delays.
  await new Promise<void>(resolve => { resume = resolve; tasks.port2.postMessage(0) })
  if (cancelled) throw new DOMException('已取消', 'AbortError')
}
scope.onmessage = async (event: MessageEvent<{ type: 'run' | 'cancel'; id: number; source: Blob; recipe: PrintRecipe; atlas: PrintAtlas }>) => {
  if (event.data.type === 'cancel') { cancelled = true; return }
  const { id, source, atlas } = event.data
  let image: ImageBitmap | null = null, surface: OffscreenCanvas | null = null
  try {
    const recipe = validateRecipe(event.data.recipe)
    if (source.size > 20 * 1024 * 1024) throw new Error('请使用小于20MB的图片')
    image = await createImageBitmap(source, { imageOrientation: 'from-image' })
    if (image.width * image.height > 48_000_000 || Math.max(image.width, image.height) > 12000 || Math.max(image.width / image.height, image.height / image.width) > 4) throw new Error('请先裁剪图片，最长边不超过12000px，比例不超过4:1')
    const fit = Math.min(1, 800 / Math.max(image.width, image.height))
    surface = new OffscreenCanvas(Math.max(1, Math.round(image.width * fit)), Math.max(1, Math.round(image.height * fit)))
    const ctx = surface.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(image, 0, 0, surface.width, surface.height)
    const sample: Sample = { width: surface.width, height: surface.height, sourceWidth: image.width, sourceHeight: image.height, pixels: ctx.getImageData(0, 0, surface.width, surface.height).data }
    image.close(); image = null
    for (let at = 0; at < styles.length; at++) {
      let lastProgress = 0
      const result = await renderPrint(sample, atlas, recipe, styles[at]!.id, {
        progress(fraction, label) {
          const now = performance.now()
          if (now - lastProgress < 80) return
          lastProgress = now
          scope.postMessage({ type: 'progress', id, fraction: (at + fraction) / styles.length, label: `${styles[at]!.title} · ${label}` })
        },
        checkpoint,
      })
      scope.postMessage({ type: 'result', id, ...result }, [result.bitmap])
    }
    scope.postMessage({ type: 'done', id })
  } catch (error) { scope.postMessage({ type: 'error', id, message: error instanceof Error ? error.message : '生成失败' }) }
  finally { image?.close(); if (surface) surface.width = surface.height = 1; tasks.port1.close(); tasks.port2.close(); scope.close() }
}
