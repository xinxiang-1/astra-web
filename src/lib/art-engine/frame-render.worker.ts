/// <reference lib="webworker" />
import { createCanvasArtRenderer } from './canvas'
import type { ArtFrame, ArtGlyph } from './types'
import type { FrameRenderRequest, FrameRenderResponse } from './frame-render-protocol'

const surface = new OffscreenCanvas(1, 1)
surface.getContext('2d', { willReadFrequently: false })
// The shared renderer uses Canvas geometry/context APIs only, including on its glyph tiles.
const renderer = createCanvasArtRenderer(surface as unknown as HTMLCanvasElement, {
  createSurface: () => new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement,
  maxTileEntries: 64,
})
let glyphs: ArtGlyph[] = []
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
    const start = performance.now()
    await renderer.renderResponsive(
      { ...request.frame, glyphs } as ArtFrame,
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
    // Bound pending GPU work before reporting the actual cost to the playback clock.
    surface.getContext('2d')!.getImageData(0, 0, 1, 1)
    const renderMs = performance.now() - start
    const bitmap = surface.transferToImageBitmap()
    const response: FrameRenderResponse = {
      id: request.id,
      bitmap,
      renderMs,
      interactionActive: renderer.interactionActive,
      cacheStats: renderer.cacheStats,
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
