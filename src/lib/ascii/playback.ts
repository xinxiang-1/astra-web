export type FrameLoopHandle = {
  /** Cancel the pending rAF and reset timing. */
  stop: () => void
}

function clampFps(fps: number): number {
  return Math.max(8, Math.min(24, fps))
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
  onFrame: (currentTime: number) => void
  /** Fired when the video reports paused mid-loop. */
  onPaused?: () => void
  /**
   * When set, playback wraps inside this window instead of the whole file.
   * `end` is exclusive.
   */
  getRange?: () => { start: number; end: number } | null
}): FrameLoopHandle {
  let rafId = 0
  let lastFrameMs = 0
  let wrapping = false
  const frameMs = 1000 / clampFps(options.fps)

  const tick = (now: number) => {
    rafId = requestAnimationFrame(tick)
    const video = options.getVideo()
    if (!video || (options.isActive && !options.isActive())) return

    const range = options.getRange?.() ?? null
    const pastEnd =
      range != null &&
      (video.ended || video.currentTime >= range.end - 0.04)
    const beforeStart =
      range != null && !video.ended && video.currentTime < range.start - 0.02

    if (range && video.currentTime >= range.start && !pastEnd && !beforeStart) {
      wrapping = false
    }

    if (range && (pastEnd || beforeStart)) {
      if (!wrapping) {
        wrapping = true
        video.addEventListener(
          'seeked',
          () => {
            wrapping = false
          },
          { once: true },
        )
        video.currentTime = range.start
        if (video.paused || video.ended) void video.play()
      }
      return
    }

    if (video.paused) {
      options.onPaused?.()
      return
    }
    if (now - lastFrameMs < frameMs) return
    lastFrameMs = now
    options.onFrame(video.currentTime)
  }

  rafId = requestAnimationFrame(tick)

  return {
    stop() {
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
      lastFrameMs = 0
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
}): FrameLoopHandle {
  let rafId = 0
  let lastFrameMs = 0
  const frameMs = 1000 / clampFps(options.fps)
  const count = Math.max(0, options.frameCount)

  if (count === 0) {
    return {
      stop() {
        lastFrameMs = 0
      },
    }
  }

  const tick = (now: number) => {
    rafId = requestAnimationFrame(tick)
    if (!options.shouldTick()) return
    if (now - lastFrameMs < frameMs) return
    lastFrameMs = now
    const index = options.getIndex()
    options.onFrame(index)
    options.setIndex((index + 1) % count)
  }

  rafId = requestAnimationFrame(tick)

  return {
    stop() {
      if (rafId) {
        cancelAnimationFrame(rafId)
        rafId = 0
      }
      lastFrameMs = 0
    },
  }
}
