import { paintSignatureCover } from './cover-ink'
/// <reference lib="webworker" />
import { createTintedStampCache } from './raster-cache'
import type { RasterRequest, RasterResponse, RasterScene } from './raster-worker-protocol'
import type { Placement } from './layout'
import { RASTER_PLACEMENT_STRIDE, readRasterPlacement } from './raster-placement-wire'
import { traceStampPixels } from './trace'
import { paintSignatureStripePng } from './raster-stripes'
import {
  paintVectorInkTemplate,
  prepareVectorInkTemplate,
  type VectorInkTemplate,
} from './vector-ink-geometry'

const createSurface = (width = 1, height = 1) => {
  const surface = new OffscreenCanvas(width, height)
  surface.getContext('2d', { willReadFrequently: false })
  return surface
}
function context(canvas: OffscreenCanvas) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建后台绘图画布')
  return ctx
}
function send(message: RasterResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer)
}
let active: { id: number; cancelled: boolean } | null = null
let queued: RasterRequest | null = null
let loadedScene: RasterScene | null = null
function check(signal: { cancelled: boolean }) {
  if (signal.cancelled) throw new Error('已取消')
}
async function paint(request: RasterRequest, signal: { cancelled: boolean }) {
  const { width, height } = request
  const scene = loadedScene
  if (!scene) throw new Error('后台作品尚未准备好')
  if (request.type === 'png-stripes') {
    await paintSignatureStripePng(scene, request, signal, send)
    return
  }
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 67108864 ||
    !scene.templates.length
  )
    throw new Error('后台绘图参数无效')
  const sources: OffscreenCanvas[] = []
  const vectorTemplates: VectorInkTemplate[] = []
  let templateBytes = 0
  let pathBytes = 0
  try {
    for (const template of scene.templates) {
      check(signal)
      templateBytes += template.width * template.height * 4
      if (templateBytes > 96 * 1024 * 1024) throw new Error('签名模板超过后台绘图预算')
      let pixels = template.pixels
      if (scene.options.inkStyle === 'cutout') {
        const vector =
          template.vector ??
          traceStampPixels(new ImageData(pixels.data.slice(), pixels.width, pixels.height))
        pathBytes += vector.paths.reduce((sum, d) => sum + d.length * 2, 0)
        if (pathBytes > 16 * 1024 * 1024) throw new Error('签名路径超过后台绘图预算')
        vectorTemplates.push(prepareVectorInkTemplate(vector))
        pixels = new ImageData(pixels.data.slice(), pixels.width, pixels.height)
        let ink = 0
        for (let i = 3; i < pixels.data.length; i += 4) ink += pixels.data[i]!
        if (!ink) throw new Error('签名模板没有有效笔迹')
        for (let i = 0; i < pixels.data.length; i += 4) {
          pixels.data[i] = 20
          pixels.data[i + 1] = 24
          pixels.data[i + 2] = 32
          pixels.data[i + 3] = 255 - pixels.data[i + 3]!
        }
      }
      const raw = createSurface(template.width, template.height)
      context(raw).putImageData(pixels, 0, 0)
      const scale = Math.min(1, request.stampMaxLong / Math.max(template.width, template.height))
      if (scale < 1) {
        const surface = createSurface(
          Math.max(1, Math.round(template.width * scale)),
          Math.max(1, Math.round(template.height * scale)),
        )
        const ctx = context(surface)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(raw, 0, 0, surface.width, surface.height)
        raw.width = 1
        raw.height = 1
        sources.push(surface)
      } else sources.push(raw)
    }
    const sx = request.region
      ? width / Math.max(1e-3, request.region.w)
      : width / Math.max(1, scene.layoutW)
    const sy = request.region
      ? height / Math.max(1e-3, request.region.h)
      : height / Math.max(1, scene.layoutH)
    const mapped: Placement[] = []
    for (let at = 0; at < scene.placements.length; at += RASTER_PLACEMENT_STRIDE) {
      const p = readRasterPlacement(scene.placements, at)
      if (request.region) {
        const r = request.region,
          rad = p.targetSize * 0.7,
          pad = 80
        if (
          p.x + rad < r.x - pad ||
          p.x - rad > r.x + r.w + pad ||
          p.y + rad < r.y - pad ||
          p.y - rad > r.y + r.h + pad
        )
          continue
      }
      mapped.push({
        ...p,
        x: (p.x - (request.region?.x ?? 0)) * sx,
        y: (p.y - (request.region?.y ?? 0)) * sy,
        targetSize: (p.targetSize * (sx + sy)) / 2,
      })
    }
    mapped.sort((a, b) => b.targetSize - a.targetSize || a.depth - b.depth)
    const output = createSurface(width, height),
      ctx = context(output)
    ctx.fillStyle = scene.options.background ?? '#f5f0e8'
    ctx.fillRect(0, 0, width, height)
    if ((scene.options.underlay ?? 0) > 0) {
      const wash = scene.colorWash
      if (!wash || Math.max(wash.width, wash.height) > 384) throw new Error('彩绘底色超出后台预算')
      const base = createSurface(wash.width, wash.height)
      const cropped = request.region ? createSurface(width, height) : null
      try {
        context(base).putImageData(wash, 0, 0)
        if (cropped && request.region) {
          const r = request.region
          context(cropped).drawImage(
            base,
            (r.x / scene.layoutW) * wash.width,
            (r.y / scene.layoutH) * wash.height,
            (r.w / scene.layoutW) * wash.width,
            (r.h / scene.layoutH) * wash.height,
            0,
            0,
            width,
            height,
          )
        }
        ctx.globalAlpha = Math.min(0.85, Math.max(0, scene.options.underlay ?? 0))
        // Region follows the existing synchronous painter's crop/resample steps.
        ctx.imageSmoothingQuality = request.region ? 'low' : 'high'
        ctx.drawImage(cropped ?? base, 0, 0, width, height)
        ctx.globalAlpha = 1
      } finally {
        base.width = base.height = 1
        if (cropped) cropped.width = cropped.height = 1
      }
    }
    const tiled = !request.region,
      size = tiled ? Math.max(128, request.tileSize ?? 320) : Math.max(width, height)
    const nx = Math.ceil(width / size),
      ny = Math.ceil(height / size),
      total = nx * ny
    const cache = createTintedStampCache(
      sources,
      scene.options.colorize ?? true,
      16 * 1024 * 1024,
      64,
      createSurface,
    )
    let done = 0,
      start = performance.now()
    try {
      for (let ty = 0; ty < ny; ty++)
        for (let tx = 0; tx < nx; tx++) {
          check(signal)
          const x0 = tx * size,
            y0 = ty * size,
            w = Math.min(size, width - x0),
            h = Math.min(size, height - y0)
          const tile = tiled ? createSurface(w, h) : output,
            target = tiled ? context(tile) : ctx
          for (let i = 0; i < mapped.length; i++) {
            if (i % 8 === 0 && performance.now() - start >= 8) {
              // Drain this worker's raster commands before yielding. Otherwise a final
              // full readback can leave a long shared GPU queue that stalls UI frames.
              // Explicit false at creation retains the established raster backend.
              target.getImageData(0, 0, 1, 1)
              await new Promise((resolve) => setTimeout(resolve, 0))
              start = performance.now()
              check(signal)
            }
            const p = mapped[i]!,
              rad = p.targetSize * 0.75 + 3
            if (
              tiled &&
              (p.x + rad < x0 || p.x - rad > x0 + w || p.y + rad < y0 || p.y - rad > y0 + h)
            )
              continue
            const glyph =
              scene.options.inkStyle === 'cutout'
                ? sources[p.stampIndex]!
                : cache.get(
                    p.stampIndex,
                    p.tint.r,
                    p.tint.g,
                    p.tint.b,
                    p.depth,
                    Boolean(p.tintLiteral),
                  )
            const scale = p.targetSize / Math.max(glyph.width, glyph.height)
            if (scene.options.coverFill) {
              paintSignatureCover(
                target,
                { ...p, x: p.x - x0, y: p.y - y0 },
                glyph.width,
                glyph.height,
                scale,
              )
            }
            if (scene.options.inkStyle === 'cutout') {
              paintVectorInkTemplate(
                target,
                { ...p, x: p.x - x0, y: p.y - y0 },
                vectorTemplates[p.stampIndex]!,
                scene.options.colorize ?? true,
              )
              continue
            }
            target.save()
            target.translate(p.x - x0, p.y - y0)
            target.rotate(p.angle)
            target.scale(scale, scale)
            target.imageSmoothingEnabled = true
            target.imageSmoothingQuality = 'high'
            target.globalAlpha = Math.min(1, Math.max(0, p.strength))
            target.globalCompositeOperation = p.blend === 'soft' ? 'source-over' : 'multiply'
            target.drawImage(glyph, -glyph.width / 2, -glyph.height / 2)
            target.restore()
          }
          if (tiled) {
            ctx.drawImage(tile, x0, y0)
            tile.width = 1
            tile.height = 1
          }
          send({ type: 'progress', id: request.id, done: ++done, total })
        }
      check(signal)
      if (request.type === 'png') {
        send({ type: 'progress', id: request.id, done: 0, total: 1, stage: 'encode' })
        const blob = await output.convertToBlob({ type: 'image/png' })
        check(signal)
        send({ type: 'encoded', id: request.id, blob })
      } else {
        const pixels = ctx.getImageData(0, 0, width, height)
        send({ type: 'complete', id: request.id, pixels }, [pixels.data.buffer])
      }
    } finally {
      cache.clear()
      output.width = 1
      output.height = 1
    }
  } finally {
    for (const surface of sources) {
      surface.width = 1
      surface.height = 1
    }
  }
}
async function drain() {
  if (active || !queued) return
  const request = queued
  queued = null
  const signal = { id: request.id, cancelled: false }
  active = signal
  try {
    await paint(request, signal)
  } catch (error) {
    if (!signal.cancelled)
      send({
        type: 'error',
        id: request.id,
        error: error instanceof Error ? error.message : '后台绘图失败',
      })
  } finally {
    active = null
    void drain()
  }
}
self.onmessage = (
  event: MessageEvent<
    RasterRequest | { type: 'cancel'; id: number } | { type: 'scene'; scene: RasterScene }
  >,
) => {
  const message = event.data
  if (message.type === 'scene') {
    loadedScene = message.scene
    return
  }
  if (message.type === 'cancel') {
    if (active?.id === message.id) active.cancelled = true
    if (queued?.id === message.id) queued = null
    return
  }
  if (active) active.cancelled = true
  queued = message
  void drain()
}
