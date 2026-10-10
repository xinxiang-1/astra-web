export type FrameLoopHandle = {
  /** Cancel the pending rAF and reset timing. */
  stop: () => void
}

function clampFps(fps: number): number {
  return Math.max(8, Math.min(60, fps))
}

/**
 * Realtime video → ASCII convert loop (no Vue).
 * Caller owns play/pause flags and conversion work via callbacks.
 */
export function createLiveFrameLoop(options: {
  fps: number
  /** Return the current video element, or null to idle. */
  getVideo: () => HTMLVideoElement | null
  /** Extra gate (e.g. mediaKind === 'video'). */
  isActive?: () => boolean
  onFrame: (currentTime: number) => void | Promise<void>
  /** Skip obsolete decoded frames while conversion/export or the stage is unavailable. */
  canProcess?: () => boolean
  /** Additional measured render budget; never reduces sampling or output quality. */
  getMinIntervalMs?: () => number
  onError?: (error: unknown) => void
  /** Fired when the video reports paused mid-loop. */
  onPaused?: () => void
  /**
   * When set, playback wraps inside this window instead of the whole file.
   * `end` is exclusive.
   */
  getRange?: () => { start: number; end: number } | null
}): FrameLoopHandle {
  let rafId = 0
  let videoFrameId = 0
  let callbackVideo: HTMLVideoElement | null = null
  let lastFrameMs = -Infinity
  let lastMediaTime = -Infinity
  let busy = false
  let stopped = false
  let conversionMs = 0
  let seekVideo: HTMLVideoElement | null = null
  let wrapping = false
  const frameMs = 1000 / clampFps(options.fps)
  const onSeeked = () => {
    wrapping = false
    seekVideo = null
  }

  const schedule = () => {
    if (stopped) return
    const video = options.getVideo()
    if (video && typeof video.requestVideoFrameCallback === 'function') {
      callbackVideo = video
      videoFrameId = video.requestVideoFrameCallback((now, metadata) => {
        videoFrameId = 0
        tick(now, metadata.mediaTime)
        schedule()
      })
    } else {
      rafId = requestAnimationFrame((now) => {
        rafId = 0
        tick(now)
        schedule()
      })
    }
  }

  const tick = (now: number, decodedTime?: number) => {
    const video = options.getVideo()
    if (stopped || document.hidden || !video || (options.isActive && !options.isActive())) return
    if (video.seeking || video.readyState < 2) return

    const range = options.getRange?.() ?? null
    const pastEnd = range != null && (video.ended || video.currentTime >= range.end - 0.04)
    const beforeStart = range != null && !video.ended && video.currentTime < range.start - 0.02

    if (range && video.currentTime >= range.start && !pastEnd && !beforeStart) {
      wrapping = false
    }

    if (range && (pastEnd || beforeStart)) {
      if (!wrapping) {
        wrapping = true
        seekVideo?.removeEventListener('seeked', onSeeked)
        seekVideo = video
        video.addEventListener('seeked', onSeeked, { once: true })
        lastMediaTime = -Infinity
        video.currentTime = range.start
        if (video.paused || video.ended) void video.play().catch(options.onError ?? (() => {}))
      }
      return
    }

    if (video.paused) {
      options.onPaused?.()
      return
    }
    if (busy || (options.canProcess && !options.canProcess())) return
    const mediaTime = decodedTime ?? video.currentTime
    if (Math.abs(mediaTime - lastMediaTime) < 0.0001) return
    const budget = Math.max(frameMs, conversionMs * 1.25, options.getMinIntervalMs?.() ?? 0)
    if (now - lastFrameMs < budget) return
    lastFrameMs = now
    lastMediaTime = mediaTime
    const start = performance.now()
    busy = true
    void Promise.resolve()
      .then(() => {
        if (!stopped) return options.onFrame(mediaTime)
      })
      .catch((error) => {
        if (!stopped) options.onError?.(error)
      })
      .finally(() => {
        conversionMs = performance.now() - start
        busy = false
      })
  }

  schedule()

  return {
    stop() {
      stopped = true
      if (videoFrameId) callbackVideo?.cancelVideoFrameCallback(videoFrameId)
      videoFrameId = 0
      seekVideo?.removeEventListener('seeked', onSeeked)
      seekVideo = null
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
      lastFrameMs = -Infinity
    },
  }
}

/**
 * Play cached prerender frames on an rAF clock (no Vue).
 * Advances index with wrap-around; caller applies the frame.
 */
export function createPrerenderFrameLoop(options: {
  fps: number
  frameCount: number
  /** Return false to skip ticks (e.g. paused / wrong mode). */
  shouldTick: () => boolean
  getIndex: () => number
  setIndex: (index: number) => void
  onFrame: (index: number) => void
  getLoop?: () => boolean
  onEnded?: () => void
}): FrameLoopHandle {
  let rafId = 0
  let lastFrameMs: number | null = null
  const frameMs = 1000 / clampFps(options.fps)
  const count = Math.max(0, options.frameCount)

  if (count === 0) {
    return {
      stop() {
        lastFrameMs = null
      },
    }
  }

  const tick = (now: number) => {
    rafId = requestAnimationFrame(tick)
    if (document.hidden || !options.shouldTick()) {
      lastFrameMs = null
      return
    }
    if (lastFrameMs === null) lastFrameMs = now - frameMs
    const elapsed = now - lastFrameMs
    // Keep the deadline phase: 16.6/16.7ms rAF jitter must not turn 60fps into 30fps.
    if (elapsed + 0.5 < frameMs) return
    const steps = Math.max(1, Math.floor((elapsed + 0.5) / frameMs))
    lastFrameMs += steps * frameMs
    const next = options.getIndex() + steps - 1
    const index = options.getLoop?.() === false ? Math.min(count - 1, next) : next % count
    options.onFrame(index)
    if (index >= count - 1 && options.getLoop?.() === false) {
      if (rafId) cancelAnimationFrame(rafId)
      rafId = 0
      options.onEnded?.()
      return
    }
    options.setIndex((index + 1) % count)
  }

  rafId = requestAnimationFrame(tick)

  return {
    stop() {
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
      lastFrameMs = null
    },
  }
}
