import type { SignatureStamp } from './extract'
import type { Placement, SignatureLayoutOptions } from './layout'
import type {
  RasterRequest,
  RasterResponse,
  RasterScene,
  RasterTemplate,
} from './raster-worker-protocol'
import { SIGNATURE_COLOR_WASH_LONG } from './color-wash'
import { packRasterPlacements } from './raster-placement-wire'

type RasterSettings = {
  region?: RasterRequest['region']
  tileSize?: number
  inkMode?: RasterRequest['inkMode']
  signal?: { cancelled?: boolean }
  onProgress?: (done: number, total: number, stage?: 'render' | 'encode') => void
}

function snapshotTemplate(stamp: SignatureStamp, maxLong?: number): RasterTemplate {
  let canvas = stamp.canvas
  try {
    if (maxLong && Math.max(canvas.width, canvas.height) > maxLong) {
      // Match the established DOM painter's bounded high-quality resize before
      // pixel transfer. Resizing a raw readback later in OffscreenCanvas can
      // change coverage for large templates, especially over soft cover ink.
      const scale = maxLong / Math.max(canvas.width, canvas.height)
      canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(stamp.canvas.width * scale))
      canvas.height = Math.max(1, Math.round(stamp.canvas.height * scale))
      const ctx = canvas.getContext('2d', { willReadFrequently: false })
      if (!ctx) throw new Error('无法准备签名模板')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(stamp.canvas, 0, 0, canvas.width, canvas.height)
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('无法读取签名模板')
    return {
      width: canvas.width,
      height: canvas.height,
      pixels: ctx.getImageData(0, 0, canvas.width, canvas.height),
      vector: stamp.vector,
    }
  } finally {
    if (canvas !== stamp.canvas) canvas.width = canvas.height = 1
  }
}

/** Preview keeps its established ink gate; PNG export can request the shared negative-plate geometry. */
export async function createSignatureRasterWorker(
  placements: Placement[],
  stamps: SignatureStamp[],
  layoutW: number,
  layoutH: number,
  options: SignatureLayoutOptions,
  signal?: { cancelled?: boolean },
  colorWash?: HTMLCanvasElement,
  capabilities: { cutout?: boolean; stampMaxLong?: number; outline?: boolean } = {},
) {
  if (
    (options.inkStyle === 'cutout' && !capabilities.cutout) ||
    typeof Worker === 'undefined' ||
    typeof OffscreenCanvas === 'undefined'
  )
    return null
  const templates: RasterTemplate[] = []
  let bytes = 0
  for (const stamp of stamps) {
    if (signal?.cancelled) throw new Error('已取消')
    bytes += stamp.canvas.width * stamp.canvas.height * 4
    if (bytes > 96 * 1024 * 1024) throw new Error('签名模板超过后台绘图预算')
    templates.push(
      snapshotTemplate(
        stamp,
        options.inkStyle === 'cutout' || capabilities.outline ? undefined : capabilities.stampMaxLong,
      ),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const scene: RasterScene = {
    placements: await packRasterPlacements(placements, signal),
    templates,
    layoutW,
    layoutH,
    options: {
      background: options.background,
      colorize: options.colorize,
      coverFill: options.coverFill,
      underlay: options.underlay,
      inkStyle: options.inkStyle,
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
  try {
    worker.postMessage({ type: 'scene', scene }, [
      scene.placements.buffer,
      ...templates.map((template) => template.pixels.data.buffer),
      ...(scene.colorWash ? [scene.colorWash.data.buffer] : []),
    ])
  } catch (error) {
    worker.terminate()
    throw error
  }
  let id = 0,
    disposed = false
  let pending: {
    id: number
    reject: (error: Error) => void
    resolve: (result: HTMLCanvasElement | Blob) => void
    resultType: RasterRequest['type']
    activity: number
    progress?: (done: number, total: number, stage?: 'render' | 'encode') => void
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
    pending.activity = performance.now()
    if (message.type === 'progress') {
      pending.progress?.(message.done, message.total, message.stage)
      return
    }
    const current = pending
    pending = null
    clearInterval(current.timer)
    if (message.type === 'error') {
      current.reject(new Error(message.error))
      return
    }
    if (message.type === 'encoded') {
      if (
        current.resultType !== 'paint' &&
        message.blob.type === 'image/png' &&
        message.blob.size > 0
      )
        current.resolve(message.blob)
      else current.reject(new Error('后台PNG结果无效'))
      return
    }
    if (current.resultType !== 'paint') {
      current.reject(new Error('后台绘图消息类型不匹配'))
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
  function requestRaster<T extends HTMLCanvasElement | Blob>(
    resultType: RasterRequest['type'],
    width: number,
    height: number,
    stampMaxLong: number,
    settings: RasterSettings = {},
  ) {
    if (disposed) return Promise.reject(new Error('后台绘图已关闭'))
    cancel()
    const request: RasterRequest = {
      type: resultType,
      id: ++id,
      width,
      height,
      stampMaxLong,
      region: settings.region,
      tileSize: settings.tileSize,
      inkMode: settings.inkMode,
    }
    return new Promise<T>((resolve, reject) => {
      if (settings.signal?.cancelled) {
        reject(new Error('已取消'))
        return
      }
      const timer = setInterval(() => {
        if (settings.signal?.cancelled) cancel()
        else if (pending && resultType !== 'paint' && performance.now() - pending.activity > 60000) {
          const current = pending
          pending = null
          clearInterval(current.timer)
          disposed = true
          worker.terminate()
          current.reject(new Error('后台PNG导出等待超时，请降低清晰度后重试'))
        }
      }, 16)
      pending = {
        id: request.id,
        resolve: (result) => resolve(result as T),
        reject,
        timer,
        progress: settings.onProgress,
        resultType,
        activity: performance.now(),
      }
      try {
        worker.postMessage(request)
      } catch (error) {
        clearInterval(timer)
        pending = null
        reject(error instanceof Error ? error : new Error('后台绘图不可用'))
      }
    })
  }
  return {
    paint: (width: number, height: number, stampMaxLong: number, settings: RasterSettings = {}) =>
      requestRaster<HTMLCanvasElement>('paint', width, height, stampMaxLong, settings),
    exportPng: (
      width: number,
      height: number,
      stampMaxLong: number,
      settings: RasterSettings = {},
    ) => requestRaster<Blob>('png', width, height, stampMaxLong, settings),
    exportStripePng: (width: number, height: number, stampMaxLong: number, settings: RasterSettings = {}) =>
      requestRaster<Blob>('png-stripes', width, height, stampMaxLong, settings),
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
