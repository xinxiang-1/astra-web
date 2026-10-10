/// <reference lib="webworker" />
import { createCanvasArtRenderer } from './canvas'
import { createAreaGlyphGpu } from './area-gpu'
import type { ArtFrame, ArtGlyph } from './types'
import type { FrameRenderRequest, FrameRenderResponse } from './frame-render-protocol'

const surface = new OffscreenCanvas(1, 1)
surface.getContext('2d', { willReadFrequently: false })
let areaGpu: ReturnType<typeof createAreaGlyphGpu> = null
let gpuAttempted = false
// The shared renderer uses Canvas geometry/context APIs only, including on its glyph tiles.
const renderer = createCanvasArtRenderer(surface as unknown as HTMLCanvasElement, {
  createSurface: () => new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement,
  maxTileEntries: 64,
  canRasterBatch: (frame, width, height) => Boolean(areaGpu?.canRaster(frame, width, height)),
  rasterBatch: (...args) => {
    if (args[1].glow !== false) return false
    try {
      return Boolean(areaGpu?.rasterBatch(...args))
    } catch {
      areaGpu?.destroy()
      areaGpu = null
      return false
    }
  },
})
let glyphs: ArtGlyph[] = []
let sourceFrame: ArtFrame | null = null
let frameRevision = 0
self.onmessage = async (event: MessageEvent<FrameRenderRequest>) => {
  const request = event.data
  try {
    if (request.glyphs) {
      glyphs = request.glyphs.map((g) => {
        const tile = new OffscreenCanvas(g.pixels.width, g.pixels.height)
        tile.getContext('2d', { willReadFrequently: true })!.putImageData(g.pixels, 0, 0)
        return { char: g.char, coverage: g.coverage, tile: tile as unknown as HTMLCanvasElement }
      })
    }
    if (request.frame) {
      if (request.frameRevision !== frameRevision + 1) throw new Error('字符画帧版本不连续')
      sourceFrame = { ...request.frame, glyphs } as ArtFrame
      frameRevision = request.frameRevision
    }
    if (!sourceFrame || request.frameRevision !== frameRevision)
      throw new Error('字符画源帧不可用，请重新解析')
    if (!gpuAttempted && sourceFrame.settings.softwareRaster && request.options.glow === false) {
      gpuAttempted = true
      try {
        areaGpu = createAreaGlyphGpu(surface as unknown as HTMLCanvasElement, false)
      } catch {
        /* Preserve the full-quality CPU fallback. */
      }
    }
    const start = performance.now()
    areaGpu?.reset()
    await renderer.renderResponsive(
      sourceFrame,
      request.options,
      (completedCells, totalCells) => {
        const progress: FrameRenderResponse = { id: request.id, completedCells, totalCells }
        self.postMessage(progress)
      },
      undefined,
      (progress) => {
        const response: FrameRenderResponse = { id: request.id, phase: 'interaction', ...progress }
        self.postMessage(response)
      },
    )
    // Transfer GPU pixels directly; keep the 2D readback barrier for the CPU fallback.
    // renderMs measures worker completion, not the browser's presented frame interval.
    const accelerated = areaGpu?.bitmap()
    if (!accelerated) surface.getContext('2d')!.getImageData(0, 0, 1, 1)
    const bitmap = accelerated ?? surface.transferToImageBitmap()
    const renderMs = performance.now() - start
    const response: FrameRenderResponse = {
      id: request.id,
      bitmap,
      renderMs,
      interactionActive: renderer.interactionActive,
      cacheStats: { ...renderer.cacheStats, rasterGpu: areaGpu?.cacheStats },
    }
    self.postMessage(response, [bitmap])
  } catch (e) {
    const response: FrameRenderResponse = {
      id: request.id,
      error: e instanceof Error ? e.message : '视频绘制失败',
    }
    self.postMessage(response)
  }
}
