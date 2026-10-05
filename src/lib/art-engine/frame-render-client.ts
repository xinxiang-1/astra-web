import type { ArtFrame, ArtRenderOptions } from './types'
import type { FrameRenderRequest, FrameRenderResponse } from './frame-render-protocol'

export function createFrameRenderWorker(
  onResult: (
    result: Extract<FrameRenderResponse, { bitmap: ImageBitmap }>,
    frame: ArtFrame,
    options: ArtRenderOptions,
  ) => void,
  onError: () => void,
  onProgress?: (progress: number, frame: ArtFrame, options: ArtRenderOptions) => void,
) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null
  let worker: Worker
  try {
    worker = new Worker(new URL('./frame-render.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return null
  }
  let stopped = false,
    busy = false,
    id = 0
  let atlas: ArtFrame['glyphs'] | null = null
  let queued: { frame: ArtFrame; options: ArtRenderOptions } | null = null
  let sentFrame: ArtFrame | null = null
  let sentOptions: ArtRenderOptions | null = null
  let renderMs = 0,
    interactionActive = false,
    completedCells = 0
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const dispose = () => {
    stopped = true
    queued = null
    sentFrame = null
    sentOptions = null
    atlas = null
    worker.terminate()
    clearTimeout(watchdog)
  }
  const fail = () => {
    if (stopped) return
    dispose()
    onError()
  }
  const send = () => {
    if (stopped || busy || !queued) return
    const next = queued
    queued = null
    const { glyphs, ...frame } = next.frame
    try {
      const request: FrameRenderRequest = { id: ++id, frame, options: next.options }
      if (atlas !== glyphs) {
        request.glyphs = glyphs.map((g) => ({
          char: g.char,
          coverage: g.coverage,
          pixels: g.tile
            .getContext('2d', { willReadFrequently: true })!
            .getImageData(0, 0, g.tile.width, g.tile.height),
        }))
        atlas = glyphs
      }
      sentFrame = next.frame
      sentOptions = next.options
      completedCells = 0
      busy = true
      worker.postMessage(request)
      watchdog = setTimeout(fail, 12000)
    } catch {
      fail()
    }
  }
  worker.onerror = (event) => {
    event.preventDefault()
    fail()
  }
  worker.onmessage = (event: MessageEvent<FrameRenderResponse>) => {
    const result = event.data
    if ('error' in result) {
      fail()
      return
    }
    if ('completedCells' in result) {
      // A slow frame that is making progress is alive. Keep the last completed
      // bitmap visible rather than abandoning it for a blocking main-thread draw.
      if (
        !stopped &&
        busy &&
        result.id === id &&
        sentFrame &&
        sentOptions &&
        result.totalCells === sentFrame.columns * sentFrame.rows &&
        Number.isInteger(result.completedCells) &&
        result.completedCells > completedCells &&
        result.completedCells <= result.totalCells
      ) {
        completedCells = result.completedCells
        clearTimeout(watchdog)
        watchdog = setTimeout(fail, 12000)
        try {
          onProgress?.(completedCells / result.totalCells, sentFrame, sentOptions)
        } catch {
          fail()
        }
      }
      return
    }
    if (stopped || result.id !== id || !sentFrame || !sentOptions) {
      result.bitmap.close()
      return
    }
    busy = false
    clearTimeout(watchdog)
    renderMs = result.renderMs
    interactionActive = result.interactionActive
    const renderedFrame = sentFrame
    const renderedOptions = sentOptions
    sentFrame = null
    sentOptions = null
    try {
      onResult(result, renderedFrame, renderedOptions)
    } catch {
      fail()
    } finally {
      result.bitmap.close()
    }
    send()
  }
  return {
    get pending() {
      return busy || queued !== null
    },
    get renderMs() {
      return renderMs
    },
    get interactionActive() {
      return interactionActive
    },
    render(frame: ArtFrame, options: ArtRenderOptions) {
      if (stopped) return
      const samples = [
        ...(queued?.options.pointerSamples ?? []),
        ...(options.pointerSamples ?? []),
      ].slice(-128)
      queued = { frame, options: { ...options, pointerSamples: samples } }
      send()
    },
    dispose,
  }
}
export type FrameRenderWorker = NonNullable<ReturnType<typeof createFrameRenderWorker>>
