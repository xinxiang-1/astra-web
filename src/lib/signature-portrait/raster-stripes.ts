/// <reference lib="webworker" />
import { createPngRowEncoder } from './png-stream'
import { createTintedStampCache } from './raster-cache'
import { RASTER_PLACEMENT_STRIDE, readRasterPlacement } from './raster-placement-wire'
import { traceStampPixels, type StampVector } from './trace'
import { paintVectorInkTemplate, prepareVectorInkTemplate } from './vector-ink-geometry'
import { paintSignatureCover } from './cover-ink'
import { signatureTint } from './render-style'
import type { Placement } from './layout'
import type { RasterRequest, RasterResponse, RasterScene } from './raster-worker-protocol'

function context(canvas: OffscreenCanvas) {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建分块绘图画布')
  return ctx
}

/** Render original placements at export scale. No full-size canvas, image or RGBA readback. */
export async function paintSignatureStripePng(
  scene: RasterScene,
  request: RasterRequest,
  signal: { cancelled: boolean },
  send: (message: RasterResponse) => void,
) {
  const { width, height } = request
  if (
    request.region ||
    ![width, height].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 16384)
  )
    throw new Error('超清PNG导出尺寸无效')
  const check = () => {
    if (signal.cancelled) throw new Error('已取消')
  }
  // Outline export uses the worker's software raster backend: long GPU command
  // queues from 16K painting can otherwise compete with the page compositor.
  // Original mode retains the established backend and exact PNG pixel contract.
  const surface = (w = 1, h = 1) => {
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d', { willReadFrequently: request.inkMode === 'outline' })
    return canvas
  }
  const sources: OffscreenCanvas[] = []
  const vectors: {
    vector: StampVector
    paths: Path2D[]
    negative: ReturnType<typeof prepareVectorInkTemplate>
  }[] = []
  const outline = request.inkMode === 'outline' || scene.options.inkStyle === 'cutout'
  let wash: OffscreenCanvas | null = null
  let stripe: OffscreenCanvas | null = null
  let tile: OffscreenCanvas | null = null
  let encoder: ReturnType<typeof createPngRowEncoder> | null = null
  let cache: ReturnType<typeof createTintedStampCache> | null = null
  try {
    let bytes = 0,
      pathBytes = 0
    for (const template of scene.templates) {
      check()
      bytes += template.width * template.height * 4
      if (bytes > 96 * 1024 * 1024) throw new Error('签名模板超过后台绘图预算')
      if (outline) {
        const vector =
          template.vector ??
          traceStampPixels(
            new ImageData(template.pixels.data.slice(), template.width, template.height),
          )
        pathBytes += vector.paths.reduce((sum, d) => sum + d.length * 2, 0)
        if (pathBytes > 16 * 1024 * 1024) throw new Error('签名轮廓超过后台绘图预算')
        vectors.push({
          vector,
          paths: vector.paths.map((d) => new Path2D(d)),
          negative: prepareVectorInkTemplate(vector),
        })
      }
      let pixels = template.pixels
      if (scene.options.inkStyle === 'cutout') {
        let ink = 0
        for (let at = 3; at < pixels.data.length; at += 4) ink += pixels.data[at]!
        if (!ink) throw new Error('签名模板没有有效笔迹')
        pixels = new ImageData(pixels.data.slice(), pixels.width, pixels.height)
        for (let at = 0; at < pixels.data.length; at += 4) {
          pixels.data[at] = 20
          pixels.data[at + 1] = 24
          pixels.data[at + 2] = 32
          pixels.data[at + 3] = 255 - pixels.data[at + 3]!
        }
      }
      const raw = surface(template.width, template.height)
      sources.push(raw)
      context(raw).putImageData(pixels, 0, 0)
      const scale = Math.min(1, request.stampMaxLong / Math.max(template.width, template.height))
      if (scale < 1) {
        const resized = surface(
          Math.max(1, Math.round(template.width * scale)),
          Math.max(1, Math.round(template.height * scale)),
        )
        const ctx = context(resized)
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(raw, 0, 0, resized.width, resized.height)
        raw.width = raw.height = 1
        sources[sources.length - 1] = resized
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (!sources.length) throw new Error('没有可导出的签名')
    if ((scene.options.underlay ?? 0) > 0) {
      const pixels = scene.colorWash
      if (!pixels || Math.max(pixels.width, pixels.height) > 384)
        throw new Error('彩绘底色超出后台预算')
      wash = surface(pixels.width, pixels.height)
      context(wash).putImageData(pixels, 0, 0)
    }
    const sx = width / Math.max(1, scene.layoutW),
      sy = height / Math.max(1, scene.layoutH)
    const mapped: Placement[] = []
    for (let at = 0; at < scene.placements.length; at += RASTER_PLACEMENT_STRIDE) {
      const p = readRasterPlacement(scene.placements, at)
      mapped.push({ ...p, x: p.x * sx, y: p.y * sy, targetSize: (p.targetSize * (sx + sy)) / 2 })
      if (at % (RASTER_PLACEMENT_STRIDE * 1024) === 0) {
        check()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    mapped.sort((a, b) => b.targetSize - a.targetSize || a.depth - b.depth)
    // Buckets preserve the global paint order and avoid scanning every signature for every tile.
    const size = 384,
      nx = Math.ceil(width / size),
      ny = Math.ceil(height / size),
      total = nx * ny
    const buckets: number[][] = Array.from({ length: total }, () => [])
    let references = 0
    for (let i = 0; i < mapped.length; i++) {
      const p = mapped[i]!,
        rad = p.targetSize * 0.75 + 3
      const x0 = Math.max(0, Math.ceil((p.x - rad) / size) - 1),
        x1 = Math.min(nx - 1, Math.floor((p.x + rad) / size))
      const y0 = Math.max(0, Math.ceil((p.y - rad) / size) - 1),
        y1 = Math.min(ny - 1, Math.floor((p.y + rad) / size))
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          if (++references > 20_000_000) throw new Error('超清签名覆盖量过大，请降低导出清晰度')
          buckets[y * nx + x]!.push(i)
        }
      if (i % 1024 === 0) {
        check()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    cache = createTintedStampCache(
      sources,
      scene.options.colorize ?? true,
      16 * 1024 * 1024,
      64,
      surface,
    )
    encoder = createPngRowEncoder(width, height, { signal })
    stripe = surface(width, Math.min(size, height))
    tile = surface(size, size)
    let done = 0,
      start = performance.now()
    for (let ty = 0; ty < ny; ty++) {
      check()
      const y0 = ty * size,
        h = Math.min(size, height - y0)
      let halo = 0,
        bottomHalo = 0
      if (request.inkMode === 'outline') {
        halo = bottomHalo = 32
        // Keep each intersecting signature's whole contour inside the working
        // surface. Clipping distant parts of a curve can alter Skia's raster
        // approximation even well away from a 32px band overlap.
        for (let i = 0; i < mapped.length; i++) {
          const p = mapped[i]!,
            rad = p.targetSize * 0.75 + 3
          if (p.y + rad < y0 || p.y - rad > y0 + h) continue
          halo = Math.max(halo, Math.ceil(y0 - (p.y - rad)))
          bottomHalo = Math.max(bottomHalo, Math.ceil(p.y + rad - (y0 + h)))
          if (i % 1024 === 0 && performance.now() - start >= 8) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            check()
            start = performance.now()
          }
        }
      }
      if (h + halo + bottomHalo > 16384 || width * (h + halo + bottomHalo) * 4 > 128 * 1024 * 1024)
        throw new Error('超清笔迹绘制超出内存预算，请选择8K或减小名字尺寸')
      stripe.height = h + halo + bottomHalo
      const ctx = context(stripe)
      ctx.fillStyle = scene.options.background ?? '#f5f0e8'
      ctx.fillRect(0, 0, width, stripe.height)
      if (wash) {
        ctx.imageSmoothingQuality = 'high'
        ctx.globalAlpha = Math.min(0.85, Math.max(0, scene.options.underlay ?? 0))
        ctx.drawImage(wash, 0, halo - y0, width, height)
        ctx.globalAlpha = 1
      }
      if (request.inkMode === 'outline') {
        // Paint into the final paper/wash surface with full-width coordinates.
        // The halo keeps curve clipping outside the encoded rows at band joins.
        for (let index = 0; index < mapped.length; index++) {
          if (index % 8 === 0 && performance.now() - start >= 8) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            check()
            start = performance.now()
          }
          const p = mapped[index]!,
            rad = p.targetSize * 0.75 + 3
          if (p.y + rad < y0 || p.y - rad > y0 + h) continue
          const template = vectors[p.stampIndex]
          if (!template) throw new Error('签名轮廓引用无效')
          const local = { ...p, y: p.y - y0 + halo }
          const shape = template.vector,
            scale = p.targetSize / Math.max(shape.width, shape.height)
          if (scene.options.coverFill)
            paintSignatureCover(ctx, local, shape.width, shape.height, scale)
          if (scene.options.inkStyle === 'cutout') {
            paintVectorInkTemplate(ctx, local, template.negative, scene.options.colorize ?? true)
          } else {
            ctx.save()
            ctx.translate(local.x, local.y)
            ctx.rotate(p.angle)
            ctx.scale(scale, scale)
            ctx.translate(-shape.width / 2, -shape.height / 2)
            ctx.globalAlpha = Math.min(1, Math.max(0, p.strength))
            ctx.globalCompositeOperation = p.blend === 'soft' ? 'source-over' : 'multiply'
            ctx.fillStyle = `rgb(${signatureTint(scene.options.colorize ?? true, p.tint.r, p.tint.g, p.tint.b, p.depth, Boolean(p.tintLiteral)).join(',')})`
            for (const path of template.paths) ctx.fill(path)
            ctx.restore()
          }
        }
        send({ type: 'progress', id: request.id, done: (ty + 1) * nx, total })
      } else
        for (let tx = 0; tx < nx; tx++) {
          const x0 = tx * size,
            w = Math.min(size, width - x0)
          tile.width = w
          tile.height = h
          const target = context(tile)
          for (const index of buckets[ty * nx + tx]!) {
            if (performance.now() - start >= 8) {
              target.getImageData(0, 0, 1, 1)
              await new Promise((resolve) => setTimeout(resolve, 0))
              check()
              start = performance.now()
            }
            const p = mapped[index]!,
              rad = p.targetSize * 0.75 + 3
            if (p.x + rad < x0 || p.x - rad > x0 + w || p.y + rad < y0 || p.y - rad > y0 + h)
              continue
            const local = { ...p, x: p.x - x0, y: p.y - y0 }
            const vector = vectors[p.stampIndex]
            const glyph = sources[p.stampIndex]
            if (!glyph) throw new Error('签名写法引用无效')
            const shape = outline && scene.options.inkStyle !== 'cutout' ? vector!.vector : glyph
            const scale = p.targetSize / Math.max(shape.width, shape.height)
            if (scene.options.coverFill)
              paintSignatureCover(target, local, shape.width, shape.height, scale)
            if (scene.options.inkStyle === 'cutout') {
              paintVectorInkTemplate(
                target,
                local,
                vector!.negative,
                scene.options.colorize ?? true,
              )
            } else {
              target.save()
              target.translate(local.x, local.y)
              target.rotate(p.angle)
              target.scale(scale, scale)
              target.globalAlpha = Math.min(1, Math.max(0, p.strength))
              target.globalCompositeOperation = p.blend === 'soft' ? 'source-over' : 'multiply'
              if (outline) {
                target.translate(-shape.width / 2, -shape.height / 2)
                target.fillStyle = `rgb(${signatureTint(scene.options.colorize ?? true, p.tint.r, p.tint.g, p.tint.b, p.depth, Boolean(p.tintLiteral)).join(',')})`
                for (const path of vector!.paths) target.fill(path)
              } else {
                target.imageSmoothingEnabled = true
                target.imageSmoothingQuality = 'high'
                const tinted = cache.get(
                  p.stampIndex,
                  p.tint.r,
                  p.tint.g,
                  p.tint.b,
                  p.depth,
                  Boolean(p.tintLiteral),
                )
                target.drawImage(tinted, -glyph.width / 2, -glyph.height / 2)
              }
              target.restore()
            }
          }
          ctx.drawImage(tile, x0, 0)
          send({ type: 'progress', id: request.id, done: ++done, total })
        }
      await encoder.writeRows(ctx.getImageData(0, halo, width, h))
      check()
    }
    send({ type: 'progress', id: request.id, done: 0, total: 1, stage: 'encode' })
    const blob = await encoder.finish()
    check()
    send({ type: 'encoded', id: request.id, blob })
  } finally {
    await encoder?.abort()
    cache?.clear()
    for (const canvas of [...sources, wash, stripe, tile])
      if (canvas) canvas.width = canvas.height = 1
  }
}
