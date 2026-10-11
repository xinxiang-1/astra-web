import { VIDEO_PRERENDER_MAX_DURATION_SEC, VIDEO_PRERENDER_MAX_FRAMES } from './constants'
import { seekVideoTo } from './media'
import type { AsciiConvertResult, AsciiFrameSource, AsciiMode, PrerenderFrame } from './types'

export type { PrerenderFrame }

/** Inputs that invalidate a prerender cache when any value changes. */
export type PrerenderCacheKeyInputs = {
  videoObjectUrl: string
  columns: number
  mode: AsciiMode
  phrase: string
  charset: string
  previewInvert: boolean
  exposure: number
  contrast: number
  normalize: boolean
  ditherStrength: number
  previewAspect: number
  phraseColor: boolean
  phraseThreshold: number
  phraseFillAll: boolean
  videoFps: number
  clipStart: number
  clipEnd: number
}

export function buildPrerenderCacheKey(inputs: PrerenderCacheKeyInputs): string {
  return [
    inputs.videoObjectUrl,
    inputs.columns,
    inputs.mode,
    inputs.phrase,
    inputs.charset,
    String(inputs.previewInvert),
    String(inputs.exposure),
    String(inputs.contrast),
    String(inputs.normalize),
    String(inputs.ditherStrength),
    String(inputs.previewAspect),
    String(inputs.phraseColor),
    String(inputs.phraseThreshold),
    String(inputs.phraseFillAll),
    String(inputs.videoFps),
    inputs.clipStart.toFixed(2),
    inputs.clipEnd.toFixed(2),
  ].join('|')
}

/** Index of the cached frame whose `time` is closest to `time`. */
export function nearestPrerenderIndex(frames: readonly PrerenderFrame[], time: number): number {
  if (frames.length === 0) return 0
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < frames.length; i++) {
    const dist = Math.abs((frames[i]?.time ?? 0) - time)
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  }
  return best
}

export type PrerenderVideoOptions = {
  /** Budget text, backing buffers, glyph tiles and optional rasters; not total browser heap. */
  maxCacheBytes?: number
  video: HTMLVideoElement
  fps: number
  /** Inclusive range start in seconds. Defaults to 0. */
  startTime?: number
  /** Exclusive range end in seconds. Defaults to the full duration. */
  endTime?: number
  maxDurationSec?: number
  maxFrames?: number
  signal?: AbortSignal
  /** Decoder wait limit per seek, including successful source restoration. */
  seekTimeoutMs?: number
  /** A newer task may own the same element even when its URL has not changed. */
  canRestoreSource?: () => boolean
  /** Return true to abort, including while waiting for a seek. */
  shouldAbort: () => boolean
  getFrameSource: () => AsciiFrameSource | null
  convertFrame: (source: AsciiFrameSource) => AsciiConvertResult | Promise<AsciiConvertResult>
  renderRaster?: (source: AsciiFrameSource, time: number) => Promise<Blob>
  /** Called once limits pass and the frame count is known. */
  onPlan?: (info: { total: number; fps: number; duration: number }) => void
  /**
   * Called after each successful frame (done is 1-based).
   * Use for progress UI and optional first-frame preview.
   */
  onProgress?: (info: { done: number; total: number; frame: PrerenderFrame; index: number }) => void
}

export type PrerenderVideoSuccess = {
  ok: true
  frames: PrerenderFrame[]
  resumeTime: number
}

export type PrerenderVideoFailure = {
  ok: false
  error: string
  aborted?: boolean
}

export type PrerenderVideoResult = PrerenderVideoSuccess | PrerenderVideoFailure

/**
 * Seek through a short video, convert each sample to ASCII, return cached frames.
 * Vue/UI state stays in the caller — pass callbacks for progress / abort / convert.
 */
export async function prerenderVideoFrames(
  options: PrerenderVideoOptions,
): Promise<PrerenderVideoResult> {
  const { video, getFrameSource, convertFrame, shouldAbort, onProgress } = options
  const cancelled = (): PrerenderVideoFailure => ({ ok: false, error: '已取消预渲染', aborted: true })
  if (options.signal?.aborted || shouldAbort()) return cancelled()
  const maxDurationSec = options.maxDurationSec ?? VIDEO_PRERENDER_MAX_DURATION_SEC
  const maxFrames = options.maxFrames ?? VIDEO_PRERENDER_MAX_FRAMES

  const fileDuration = video.duration
  if (!Number.isFinite(fileDuration) || fileDuration <= 0) {
    return { ok: false, error: '无法读取视频时长，请换一个文件' }
  }

  const start = Math.min(Math.max(0, options.startTime ?? 0), fileDuration)
  const end = Math.min(Math.max(start, options.endTime ?? fileDuration), fileDuration)
  const span = end - start
  if (span < 0.05) {
    return { ok: false, error: '选段太短，请拉开入点和出点' }
  }
  if (span > maxDurationSec) {
    return {
      ok: false,
      error: `选段 ${span.toFixed(1)} 秒超过 ${maxDurationSec} 秒。请缩短入点/出点后再解析。`,
    }
  }

  const fps = Math.max(8, Math.min(60, options.fps))
  const step = 1 / fps
  const planned = Math.floor(span * fps) + 1
  if (planned > maxFrames) {
    return {
      ok: false,
      error: `按 ${fps} fps 帧数过多。请缩短选段或降低帧率后再预渲染。`,
    }
  }
  const total = Math.min(maxFrames, planned)

  const frames: PrerenderFrame[] = []
  let cacheBytes = 0
  const retained = new WeakSet<object>()
  const maxCacheBytes = options.maxCacheBytes ?? 96 * 1024 * 1024
  const bufferBytes = (view: ArrayBufferView | undefined) => {
    if (!view || retained.has(view.buffer)) return 0
    retained.add(view.buffer)
    return view.buffer.byteLength
  }
  const resumeTime = video.currentTime
  const sourceUrl = () => video.getAttribute?.('src') ?? video.currentSrc ?? ''
  const originalSource = sourceUrl()
  let sourceInvalidated = false
  const onSourceRemoved = () => { sourceInvalidated = true }
  const sameSource = () => !sourceInvalidated && sourceUrl() === originalSource
  const aborted = () => options.signal?.aborted || shouldAbort() || !sameSource()
  const checkAbort = () => {
    if (aborted()) throw new DOMException('已取消预渲染', 'AbortError')
  }
  const seekOptions = { signal: options.signal, shouldAbort: aborted, timeoutMs: options.seekTimeoutMs }
  const failure = (error: unknown): PrerenderVideoFailure =>
    aborted() || (error instanceof Error && error.name === 'AbortError')
      ? cancelled()
      : { ok: false, error: error instanceof Error ? error.message : '预渲染失败' }
  video.addEventListener('emptied', onSourceRemoved)
  video.addEventListener('abort', onSourceRemoved)

  const collectFrames = async (): Promise<PrerenderVideoResult> => {
    checkAbort()
    options.onPlan?.({ total, fps, duration: span })
    for (let i = 0; i < total; i++) {
      checkAbort()
      const t = Math.min(end, start + i * step)
      await seekVideoTo(video, t, seekOptions)
      checkAbort()
      const source = getFrameSource()
      if (!source) continue

      const result = await convertFrame(source)
      checkAbort()
      const frameBytes = result.text.length * 2 + 1024 + bufferBytes(result.colors) +
        bufferBytes(result.art?.indices) + bufferBytes(result.art?.alpha) + bufferBytes(result.art?.colors)
      let atlasBytes = 0
      for (const glyph of result.art?.glyphs ?? []) {
        if (!retained.has(glyph.tile)) {
          retained.add(glyph.tile)
          atlasBytes += glyph.tile.width * glyph.tile.height * 4 + 128
        }
      }
      // Reject the complete typed-frame plan after one sample, before spending time on all frames.
      if (i === 0 && frameBytes * total + atlasBytes > maxCacheBytes) {
        const mib = Math.ceil((frameBytes * total + atlasBytes) / 1024 / 1024)
        return { ok: false, error: `预计缓存 ${mib} MiB，超过内存上限。请选择低消耗预览或缩短选段；视频导出会逐帧处理。` }
      }
      const raster = await options.renderRaster?.(source, t)
      checkAbort()
      if (i === 0 && (frameBytes + (raster?.size ?? 0)) * total + atlasBytes > maxCacheBytes)
        return { ok: false, error: '预计栅格缓存超过内存上限，请选择低消耗预览或缩短选段。' }
      cacheBytes += frameBytes + atlasBytes + (raster?.size ?? 0)
      if (cacheBytes > maxCacheBytes)
        return { ok: false, error: '选段缓存已达到内存上限，请选择低消耗预览或缩短选段。视频导出会逐帧处理。' }
      const frame: PrerenderFrame = {
        art: result.art,
        raster,
        text: result.text,
        colors: result.colors ?? null,
        columns: result.columns,
        rows: result.rows,
        time: t,
      }
      frames.push(frame)
      onProgress?.({ done: i + 1, total, frame, index: i })

      await new Promise<void>((r) => setTimeout(r, 0))
    }

    if (frames.length === 0) {
      return { ok: false, error: '预渲染未得到有效帧' }
    }

    return { ok: true, frames, resumeTime }
  }

  try {
    let result: PrerenderVideoResult
    try {
      result = await collectFrames()
      checkAbort()
    } catch (error) {
      result = failure(error)
    }
    if (sameSource() && (options.canRestoreSource?.() ?? true) && video.readyState >= 1) {
      if (result.ok) {
        try {
          await seekVideoTo(video, resumeTime, seekOptions)
          checkAbort()
        } catch (error) {
          result = failure(error)
        }
      } else {
        // Release cancelled/failed work immediately; another decoder wait can stall again.
        try {
          if (Math.abs(video.currentTime - resumeTime) >= 0.001) video.currentTime = resumeTime
        } catch {
          // Keep the original failure if the same source is no longer seekable.
        }
      }
    }
    return aborted() ? cancelled() : result
  } finally {
    video.removeEventListener('emptied', onSourceRemoved)
    video.removeEventListener('abort', onSourceRemoved)
  }
}
