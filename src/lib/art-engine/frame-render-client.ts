import type { ArtFrame, ArtRenderOptions } from './types'
import type { FrameRenderRequest, FrameRenderResponse } from './frame-render-protocol'

const hasInteractionClock = (frame: ArtFrame, options: ArtRenderOptions) =>
  Boolean(options.pointer) &&
  (options.hoverStrength ?? options.pointer?.strength ?? 0) > 0 &&
  !(options.hover === 'particles' && frame.columns * frame.rows > 131072) &&
  (options.effectProfile === 'expressive' ||
    options.motionStyle === 'cinematic' ||
    ['current', 'reform', 'caustics'].includes(options.motion ?? '') ||
    ['trail', 'rift', 'particles', 'water', 'silk', 'vortex', 'contour', 'dissolve'].includes(
      options.hover ?? '',
    ))

export function createFrameRenderWorker(
  onResult: (
    result: Extract<FrameRenderResponse, { bitmap: ImageBitmap }>,
    frame: ArtFrame,
    options: ArtRenderOptions,
  ) => void,
  onError: () => void,
  onProgress?: (
    progress: number,
    frame: ArtFrame,
    options: ArtRenderOptions,
    phase: 'drawing' | 'interaction',
  ) => void,
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
  let uploadedFrame: ArtFrame | null = null
  let frameRevision = 0
  let queued: { frame: ArtFrame; options: ArtRenderOptions } | null = null
  let sentFrame: ArtFrame | null = null
  let sentOptions: ArtRenderOptions | null = null
  let renderMs = 0,
    interactionActive = false,
    completedCells = 0
  let previousClock: number | null = null,
    expectedInteractionSeconds: number | null = null
  let interactionSteps = 0,
    interactionSeconds = 0
  let watchdog: ReturnType<typeof setTimeout> | undefined
  const dispose = () => {
    stopped = true
    queued = null
    sentFrame = null
    sentOptions = null
    atlas = null
    uploadedFrame = null
    previousClock = expectedInteractionSeconds = null
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
      const changed = uploadedFrame !== next.frame
      const request: FrameRenderRequest = {
        id: ++id,
        frameRevision: changed ? ++frameRevision : frameRevision,
        frame: changed ? frame : undefined,
        options: next.options,
      }
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
      interactionSteps = interactionSeconds = 0
      const clock = next.options.hoverTime ?? next.options.time ?? 0
      expectedInteractionSeconds =
        (next.options.hover === 'particles' || next.options.hover === 'light') &&
        hasInteractionClock(next.frame, next.options) &&
        previousClock !== null &&
        previousClock >= 0 &&
        Number.isFinite(clock) &&
        clock <= 1e9 &&
        clock - previousClock > 0.25
          ? clock - previousClock
          : null
      busy = true
      worker.postMessage(request)
      uploadedFrame = next.frame
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
    if ('completedSteps' in result) {
      if (
        !stopped &&
        busy &&
        result.id === id &&
        sentFrame &&
        sentOptions &&
        expectedInteractionSeconds !== null &&
        completedCells === 0 &&
        result.totalSeconds === expectedInteractionSeconds &&
        Number.isInteger(result.completedSteps) &&
        result.completedSteps > interactionSteps &&
        result.completedSteps <= Math.ceil(expectedInteractionSeconds / 0.05) + 256 &&
        Number.isFinite(result.completedSeconds) &&
        result.completedSeconds > interactionSeconds &&
        result.completedSeconds <= result.totalSeconds
      ) {
        interactionSteps = result.completedSteps
        interactionSeconds = result.completedSeconds
        clearTimeout(watchdog)
        watchdog = setTimeout(fail, 12000)
        try {
          onProgress?.(
            interactionSeconds / result.totalSeconds,
            sentFrame,
            sentOptions,
            'interaction',
          )
        } catch {
          fail()
        }
      }
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
          onProgress?.(completedCells / result.totalCells, sentFrame, sentOptions, 'drawing')
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
    previousClock = hasInteractionClock(renderedFrame, renderedOptions)
      ? (renderedOptions.hoverTime ?? renderedOptions.time ?? 0)
      : null
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
