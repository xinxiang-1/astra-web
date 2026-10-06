import type { SignatureStamp } from './extract'
import type { Placement, SignatureLayoutOptions } from './layout'
import type { RasterRequest, RasterResponse, RasterScene } from './raster-worker-protocol'
import { SIGNATURE_COLOR_WASH_LONG } from './color-wash'

/** Private worker renderer for ordinary ink. Negative plates retain the verified responsive Canvas path. */
export async function createSignatureRasterWorker(
  placements: Placement[],
  stamps: SignatureStamp[],
  layoutW: number,
  layoutH: number,
  options: SignatureLayoutOptions,
  signal?: { cancelled?: boolean },
  colorWash?: HTMLCanvasElement,
) {
  if (
    options.inkStyle === 'cutout' ||
    typeof Worker === 'undefined' ||
    typeof OffscreenCanvas === 'undefined'
  )
    return null
  const templates = []
  let bytes = 0
  for (const stamp of stamps) {
    if (signal?.cancelled) throw new Error('已取消')
    bytes += stamp.canvas.width * stamp.canvas.height * 4
    if (bytes > 96 * 1024 * 1024) throw new Error('签名模板超过后台绘图预算')
    const ctx = stamp.canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('无法读取签名模板')
    templates.push({
      width: stamp.canvas.width,
      height: stamp.canvas.height,
      pixels: ctx.getImageData(0, 0, stamp.canvas.width, stamp.canvas.height),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const scene: RasterScene = {
    placements,
    templates,
    layoutW,
    layoutH,
    options: {
      background: options.background,
      colorize: options.colorize,
      coverFill: options.coverFill,
      underlay: options.underlay,
    },
  }
  if ((options.underlay ?? 0) > 0) {
    if (!colorWash || Math.max(colorWash.width, colorWash.height) > SIGNATURE_COLOR_WASH_LONG)
      throw new Error('浓彩融合需要有界的彩绘底色')
    const ctx = colorWash.getContext('2d')
    if (!ctx) throw new Error('无法读取彩绘底色')
    scene.colorWash = ctx.getImageData(0, 0, colorWash.width, colorWash.height)
  }
  if (signal?.cancelled) throw new Error('已取消')
  const worker = new Worker(new URL('./raster.worker.ts', import.meta.url), { type: 'module' })
  worker.postMessage({ type: 'scene', scene }, [
    ...templates.map((template) => template.pixels.data.buffer),
    ...(scene.colorWash ? [scene.colorWash.data.buffer] : []),
  ])
  let id = 0,
    disposed = false
  let pending: {
    id: number
    reject: (error: Error) => void
    resolve: (canvas: HTMLCanvasElement) => void
    progress?: (done: number, total: number) => void
    timer: ReturnType<typeof setInterval>
  } | null = null
  function cancel() {
    if (!pending) return
    worker.postMessage({ type: 'cancel', id: pending.id })
    clearInterval(pending.timer)
    pending.reject(new Error('已取消'))
    pending = null
  }
  worker.onmessage = (event: MessageEvent<RasterResponse>) => {
    const message = event.data
    if (!pending || message.id !== pending.id) return
    if (message.type === 'progress') {
      pending.progress?.(message.done, message.total)
      return
    }
    const current = pending
    pending = null
    clearInterval(current.timer)
    if (message.type === 'error') {
      current.reject(new Error(message.error))
      return
    }
    const canvas = document.createElement('canvas')
    try {
      canvas.width = message.pixels.width
      canvas.height = message.pixels.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法显示后台绘图结果')
      ctx.putImageData(message.pixels, 0, 0)
      current.resolve(canvas)
    } catch (error) {
      canvas.width = 1
      canvas.height = 1
      current.reject(error instanceof Error ? error : new Error('无法显示后台绘图结果'))
    }
  }
  worker.onerror = (event) => {
    event.preventDefault()
    disposed = true
    if (pending) {
      clearInterval(pending.timer)
      pending.reject(new Error(event.message || '后台绘图不可用'))
      pending = null
    }
    worker.terminate()
  }
  return {
    paint(
      width: number,
      height: number,
      stampMaxLong: number,
      settings: {
        region?: RasterRequest['region']
        tileSize?: number
        signal?: { cancelled?: boolean }
        onProgress?: (done: number, total: number) => void
      } = {},
    ) {
      if (disposed) return Promise.reject(new Error('后台绘图已关闭'))
      cancel()
      const request: RasterRequest = {
        type: 'paint',
        id: ++id,
        width,
        height,
        stampMaxLong,
        region: settings.region,
        tileSize: settings.tileSize,
      }
      return new Promise<HTMLCanvasElement>((resolve, reject) => {
        if (settings.signal?.cancelled) {
          reject(new Error('已取消'))
          return
        }
        const timer = setInterval(() => {
          if (settings.signal?.cancelled) cancel()
        }, 16)
        pending = { id: request.id, resolve, reject, timer, progress: settings.onProgress }
        try {
          worker.postMessage(request)
        } catch (error) {
          clearInterval(timer)
          pending = null
          reject(error instanceof Error ? error : new Error('后台绘图不可用'))
        }
      })
    },
    cancel,
    dispose() {
      if (disposed) return
      disposed = true
      cancel()
      worker.terminate()
    },
  }
}
export type SignatureRasterWorker = NonNullable<
  Awaited<ReturnType<typeof createSignatureRasterWorker>>
>
