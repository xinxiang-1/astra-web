import { createCanvasArtRenderer, type ArtRendererCacheStats } from './canvas'
import { createFrameRenderWorker, type FrameRenderWorker } from './frame-render-client'
import type { ArtFrame, ArtRenderOptions } from './types'

/** Animation time and real pointer input may advance while a complete frame is being drawn. */
export function artPreviewConfigKey(frame: ArtFrame, options: ArtRenderOptions) {
  const {
    time: _time,
    hoverTime: _hoverTime,
    pointer: _pointer,
    pointerSamples: _samples,
    ...config
  } = options
  return JSON.stringify([
    frame.settings,
    frame.width,
    frame.height,
    frame.columns,
    frame.rows,
    config,
    Boolean(options.pointer),
  ])
}

type Request = { frame: ArtFrame; options: ArtRenderOptions; key: string }
type PreviewCallbacks = {
  isCurrent: (frame: ArtFrame, options: ArtRenderOptions) => boolean
  onResult: (
    frame: ArtFrame,
    options: ArtRenderOptions,
    active: boolean,
    backend: 'worker' | 'responsive',
    stats: ArtRendererCacheStats,
  ) => void
  onProgress: (progress: number, phase?: 'drawing' | 'interaction') => void
  onFallback: () => void
  onError: (error: unknown) => void
  onSettled?: () => void
  compatibilityOnly?: boolean
}

/** One complete frame in flight, one latest candidate; visible pixels never contain a partial draw. */
export function createPreviewRenderClient(target: HTMLCanvasElement, callbacks: PreviewCallbacks) {
  let stopped = false,
    compatibility = Boolean(callbacks.compatibilityOnly)
  let worker: FrameRenderWorker | null = null
  let running: Request | null = null,
    queued: Request | null = null,
    latest: Request | null = null
  let generation = 0,
    renderMs = 0,
    interactionActive = false
  let cacheStats: ArtRendererCacheStats | null = null
  let staging: HTMLCanvasElement | null = null
  let renderer: ReturnType<typeof createCanvasArtRenderer> | null = null
  let drawingCompatibility = false

  const current = (request: Request) =>
    !stopped &&
    latest?.frame === request.frame &&
    latest.key === request.key &&
    callbacks.isCurrent(request.frame, request.options)
  const releaseStaging = () => {
    renderer?.destroy()
    renderer = null
    if (staging) staging.width = staging.height = 1
    staging = null
  }
  const present = (
    surface: CanvasImageSource & { width: number; height: number },
    request: Request,
    elapsed: number,
    active: boolean,
    stats: ArtRendererCacheStats,
    backend: 'worker' | 'responsive',
  ) => {
    if (!current(request)) return
    const ctx = target.getContext('2d', { willReadFrequently: false })
    if (!ctx) throw new Error('无法显示字符画，请重试或更换浏览器')
    if (target.width !== surface.width) target.width = surface.width
    if (target.height !== surface.height) target.height = surface.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'copy'
    ctx.drawImage(surface, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    renderMs = elapsed
    interactionActive = active
    cacheStats = stats
    callbacks.onResult(request.frame, request.options, active, backend, stats)
  }

  const drawCompatibility = async (request: Request) => {
    const token = generation
    drawingCompatibility = true
    const abort = () => stopped || token !== generation
    try {
      if (!staging) {
        staging = document.createElement('canvas')
        staging.getContext('2d', { willReadFrequently: false })
        renderer = createCanvasArtRenderer(staging, { maxTileEntries: 64 })
      }
      const start = performance.now()
      await renderer!.renderResponsive(
        request.frame,
        request.options,
        (completed, total) => {
          if (current(request)) callbacks.onProgress(completed / total)
        },
        abort,
        (progress) => {
          if (current(request))
            callbacks.onProgress(progress.completedSeconds / progress.totalSeconds, 'interaction')
        },
      )
      if (abort()) return
      staging.getContext('2d')!.getImageData(0, 0, 1, 1)
      present(
        staging,
        request,
        performance.now() - start,
        renderer!.interactionActive,
        renderer!.cacheStats,
        'responsive',
      )
    } catch (error) {
      if (!abort()) {
        queued = null
        callbacks.onError(error)
      }
      releaseStaging()
    } finally {
      drawingCompatibility = false
      running = null
      if (stopped || abort()) releaseStaging()
      pump()
      if (!stopped) callbacks.onSettled?.()
    }
  }

  function pump() {
    if (stopped || running || drawingCompatibility || !queued) return
    const request = queued
    queued = null
    running = request
    callbacks.onProgress(0)
    if (!compatibility && !worker) {
      worker = createFrameRenderWorker(
        (result) => {
          const completed = running
          running = null
          try {
            if (completed)
              present(
                result.bitmap,
                completed,
                result.renderMs,
                result.interactionActive,
                result.cacheStats,
                'worker',
              )
          } catch (error) {
            queued = null
            callbacks.onError(error)
          }
          pump()
          if (!stopped) callbacks.onSettled?.()
        },
        () => {
          worker = null
          compatibility = true
          // Retry the latest request, including input not consumed by the failed worker.
          const samples = [
            ...(running?.options.pointerSamples ?? []),
            ...(queued?.options.pointerSamples ?? []),
          ].slice(-128)
          if (latest)
            queued = { ...latest, options: { ...latest.options, pointerSamples: samples } }
          running = null
          callbacks.onFallback()
          pump()
        },
        (progress, _frame, _options, phase) => {
          if (running && current(running)) callbacks.onProgress(progress, phase)
        },
      )
      if (!worker) {
        compatibility = true
        callbacks.onFallback()
      }
    }
    if (worker) worker.render(request.frame, request.options)
    else void drawCompatibility(request)
  }

  return {
    get pending() {
      return Boolean(running || queued || drawingCompatibility)
    },
    get renderMs() {
      return renderMs
    },
    get interactionActive() {
      return interactionActive
    },
    get cacheStats() {
      return cacheStats
    },
    render(frame: ArtFrame, options: ArtRenderOptions) {
      if (stopped) return
      const key = artPreviewConfigKey(frame, options)
      const incompatible = latest && (latest.frame !== frame || latest.key !== key)
      const samples = [
        ...(!incompatible ? (queued?.options.pointerSamples ?? []) : []),
        ...(options.pointerSamples ?? []),
      ]
        .slice(-128)
        .map((sample) => ({ ...sample }))
      latest = queued = {
        frame,
        key,
        options: {
          ...options,
          pointer: options.pointer ? { ...options.pointer } : undefined,
          pointerSamples: samples,
        },
      }
      if (incompatible) {
        generation++
        worker?.dispose()
        worker = null
        if (!drawingCompatibility) running = null
      }
      pump()
    },
    destroy() {
      stopped = true
      generation++
      worker?.dispose()
      worker = null
      queued = latest = null
      cacheStats = null
      interactionActive = false
      if (!drawingCompatibility) {
        running = null
        releaseStaging()
      }
    },
  }
}
export type PreviewRenderClient = ReturnType<typeof createPreviewRenderClient>
