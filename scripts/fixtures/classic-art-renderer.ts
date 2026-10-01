import type { ArtFrame, ArtRenderOptions } from './types'

/** Self-contained Canvas implementation shared with the standalone HTML runtime. */
export function createCanvasArtRenderer(target: HTMLCanvasElement) {
  let current: ArtFrame | null = null
  let frame: ArtFrame
  const tinted = new Map<string, HTMLCanvasElement | ImageBitmap>()
  const maxBackingBytes = 16 * 1024 * 1024
  const maxEntries = typeof OffscreenCanvas === 'undefined' ? 4096 : 12000
  let backingBytes = 0,
    hits = 0,
    misses = 0
  let scratch: OffscreenCanvas | HTMLCanvasElement | null = null
  const outputCtx = target.getContext('2d')!
  let ctx = outputCtx
  let supersample: HTMLCanvasElement | null = null
  const softwareLimit = 4 * 1024 * 1024
  const softwareWorkingLimit = 16 * 1024 * 1024
  const prefixes = new Map<number, Float32Array>()
  const softwareMasks = new Map<string, { width: number; height: number; alpha: Float32Array }>()
  let softwareGlyphs: ArtFrame['glyphs'] | null = null
  let softwareGeometry = ''
  let prefixBytes = 0,
    maskBytes = 0
  let softwarePixels: Float32Array | null = null
  let softwareImage: ImageData | null = null
  let colorProbe: HTMLCanvasElement | null = null
  const styleColors = new Map<string, number[]>()
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
  const canvas = (width: number, height: number) => {
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    return c
  }
  function tile(glyphIndex: number, color: string) {
    const key = `${glyphIndex}:${color}`
    const existing = tinted.get(key)
    if (existing) {
      hits++
      return existing
    }
    misses++
    scratch ??=
      typeof OffscreenCanvas === 'undefined'
        ? canvas(frame.cellWidth, frame.cellHeight)
        : new OffscreenCanvas(frame.cellWidth, frame.cellHeight)
    const context = scratch.getContext('2d')! as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    context.globalCompositeOperation = 'source-over'
    context.clearRect(0, 0, frame.cellWidth, frame.cellHeight)
    context.drawImage(frame.glyphs[glyphIndex]!.tile, 0, 0)
    context.globalCompositeOperation = 'source-in'
    context.fillStyle = color
    context.fillRect(0, 0, frame.cellWidth, frame.cellHeight)
    const bytes = frame.cellWidth * frame.cellHeight * 4
    // Saturation uses one reusable scratch, rather than evicting early cells and
    // rebuilding every color on the next frame. No color quantization or filtering.
    if (tinted.size >= maxEntries || backingBytes + bytes > maxBackingBytes) return scratch
    let result: HTMLCanvasElement | ImageBitmap
    if (typeof OffscreenCanvas !== 'undefined' && scratch instanceof OffscreenCanvas)
      result = scratch.transferToImageBitmap()
    else {
      result = canvas(frame.cellWidth, frame.cellHeight)
      result.getContext('2d')!.drawImage(scratch, 0, 0)
    }
    tinted.set(key, result)
    backingBytes += bytes
    return result
  }

  function clearTiles() {
    for (const value of tinted.values()) if ('close' in value) value.close()
    tinted.clear()
    backingBytes = 0
  }

  function styleColor(value: string) {
    const cached = styleColors.get(value)
    if (cached) return cached
    colorProbe ??= canvas(1, 1)
    const probe = colorProbe.getContext('2d', { willReadFrequently: true })!
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = '#000'
    probe.fillStyle = value
    probe.fillRect(0, 0, 1, 1)
    const color = [...probe.getImageData(0, 0, 1, 1).data].map((n) => n / 255)
    if (styleColors.size < 64) styleColors.set(value, color)
    return color
  }

  function prefixOf(index: number) {
    const cached = prefixes.get(index)
    if (cached) return cached
    const width = frame.cellWidth,
      height = frame.cellHeight,
      stride = width + 1
    const bytes = stride * (height + 1) * 4
    if (prefixBytes + maskBytes + bytes > softwareLimit) return null
    const pixels = frame.glyphs[index]!.tile.getContext('2d', {
      willReadFrequently: true,
    })!.getImageData(0, 0, width, height).data
    const prefix = new Float32Array(stride * (height + 1))
    for (let y = 0; y < height; y++) {
      let row = 0
      for (let x = 0; x < width; x++) {
        row += pixels[(y * width + x) * 4 + 3]! / 255
        prefix[(y + 1) * stride + x + 1] = prefix[y * stride + x + 1]! + row
      }
    }
    prefixes.set(index, prefix)
    prefixBytes += bytes
    return prefix
  }

  function softwareMask(index: number, cw: number, ch: number, fx: number, fy: number) {
    // Round position to 1/32px (maximum error 1/64px), preserving RGB and glyph order.
    fx = Math.round(fx * 32) / 32
    fy = Math.round(fy * 32) / 32
    const key = `${index}:${fx}:${fy}`
    const cached = softwareMasks.get(key)
    if (cached) return cached
    const prefix = prefixes.get(index)!,
      nativeWidth = frame.cellWidth,
      nativeHeight = frame.cellHeight
    const stride = nativeWidth + 1
    const width = Math.ceil(cw + fx),
      height = Math.ceil(ch + fy)
    const alpha = new Float32Array(width * height)
    function integral(x: number, y: number) {
      x = clamp(x, 0, nativeWidth)
      y = clamp(y, 0, nativeHeight)
      const ix = Math.min(nativeWidth - 1, Math.floor(x)),
        iy = Math.min(nativeHeight - 1, Math.floor(y))
      const dx = x - ix,
        dy = y - iy,
        i = iy * stride + ix
      const top = prefix[i]! * (1 - dx) + prefix[i + 1]! * dx
      const bottom = prefix[i + stride]! * (1 - dx) + prefix[i + stride + 1]! * dx
      return top * (1 - dy) + bottom * dy
    }
    const sx = nativeWidth / cw,
      sy = nativeHeight / ch,
      area = 1 / (sx * sy)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const left = (x - fx) * sx,
          right = (x + 1 - fx) * sx
        const top = (y - fy) * sy,
          bottom = (y + 1 - fy) * sy
        alpha[y * width + x] = clamp(
          (integral(right, bottom) -
            integral(left, bottom) -
            integral(right, top) +
            integral(left, top)) *
            area,
          0,
          1,
        )
      }
    const result = { width, height, alpha }
    if (prefixBytes + maskBytes + alpha.byteLength <= softwareLimit && softwareMasks.size < 16384) {
      softwareMasks.set(key, result)
      maskBytes += alpha.byteLength
    }
    return result
  }

  function renderSoftware(options: ArtRenderOptions, w: number, h: number) {
    if (softwareGlyphs !== frame.glyphs) {
      prefixes.clear()
      softwareMasks.clear()
      prefixBytes = maskBytes = 0
      softwareGlyphs = frame.glyphs
    }
    const cw = w / frame.columns,
      ch = h / frame.rows,
      geometry = `${cw}:${ch}`
    if (softwareGeometry !== geometry) {
      softwareMasks.clear()
      maskBytes = 0
      softwareGeometry = geometry
    }
    for (const index of new Set(frame.indices))
      if (frame.glyphs[index]!.coverage > 0.001 && !prefixOf(index)) return false
    const stripRows = Math.min(h, Math.max(1, Math.floor(softwareWorkingLimit / (w * 20))))
    if (!softwareImage || softwareImage.width !== w || softwareImage.height !== stripRows) {
      softwareImage = outputCtx.createImageData(w, stripRows)
      softwarePixels = new Float32Array(w * stripRows * 4)
    }
    const pixels = softwarePixels!,
      image = softwareImage!
    const background = options.transparent ? [0, 0, 0, 0] : styleColor(frame.settings.background)
    const ink = styleColor(frame.settings.ink)
    const colored = frame.settings.colored || frame.settings.mode === 'color'
    const time = options.time ?? 0,
      motion = options.motion ?? 'none'
    for (let strip = 0; strip < h; strip += stripRows) {
      const activeRows = Math.min(stripRows, h - strip),
        count = w * activeRows * 4
      for (let i = 0; i < count; i += 4) {
        pixels[i] = background[0]! * background[3]!
        pixels[i + 1] = background[1]! * background[3]!
        pixels[i + 2] = background[2]! * background[3]!
        pixels[i + 3] = background[3]!
      }
      for (let y = 0; y < frame.rows; y++)
        for (let x = 0; x < frame.columns; x++) {
          const cell = y * frame.columns + x,
            index = frame.indices[cell]!,
            alpha = frame.alpha[cell]!
          if (alpha < 0.005 || frame.glyphs[index]!.coverage < 0.001) continue
          let dx = 0,
            dy = 0,
            intensity = 1,
            opacity = alpha
          if (motion === 'breathe')
            intensity = 0.92 + Math.sin(time * 0.9 + x * 0.02 + y * 0.02) * 0.08
          if (motion === 'wave') {
            dx = Math.sin(y * 0.075 + time * 0.75) * cw * 0.18
            dy = Math.cos(x * 0.055 + time * 0.6) * ch * 0.1
          }
          if (motion === 'assemble') {
            const amount = Math.exp(-Math.max(0, time) * 1.4)
            dx = Math.sin(cell * 12.9898) * cw * 12 * amount
            dy = Math.cos(cell * 7.13) * ch * 10 * amount
          }
          if (options.pointer?.strength) {
            const px = (x + 0.5) / frame.columns - options.pointer.x
            const py = (y + 0.5) / frame.rows - options.pointer.y
            const falloff = Math.exp(-(px * px + py * py) / 0.018) * options.pointer.strength
            if (options.hover === 'light') opacity += (1 - alpha) * falloff * 0.28
            else if (options.hover === 'ripple') {
              const distance = Math.hypot(px, py),
                ripple = Math.sin(distance * 48 - time * 2.4) * falloff
              dx += (px / Math.max(0.01, distance)) * cw * ripple * 0.14
              dy += (py / Math.max(0.01, distance)) * ch * ripple * 0.14
              opacity += (1 - alpha) * falloff * 0.18
            } else {
              dx += px * cw * 14 * falloff
              dy += py * ch * 10 * falloff
            }
          }
          const px = x * cw + dx,
            py = y * ch + dy,
            left = Math.floor(px),
            top = Math.floor(py)
          if (
            top + Math.ceil(ch + 1) <= strip ||
            top >= strip + activeRows ||
            left >= w ||
            left + Math.ceil(cw + 1) <= 0
          )
            continue
          const mask = softwareMask(index, cw, ch, px - left, py - top)
          const x0 = Math.max(0, -left),
            x1 = Math.min(mask.width, w - left)
          const y0 = Math.max(0, strip - top),
            y1 = Math.min(mask.height, strip + activeRows - top)
          const red = colored ? frame.colors[cell * 3]! / 255 : ink[0]!
          const green = colored ? frame.colors[cell * 3 + 1]! / 255 : ink[1]!
          const blue = colored ? frame.colors[cell * 3 + 2]! / 255 : ink[2]!
          const multiplier = clamp(opacity * intensity * (colored ? 1 : ink[3]!), 0, 1)
          for (let my = y0; my < y1; my++)
            for (let mx = x0; mx < x1; mx++) {
              const a = mask.alpha[my * mask.width + mx]! * multiplier
              if (a < 0.00001) continue
              const i = ((my + top - strip) * w + mx + left) * 4,
                remaining = 1 - a
              pixels[i] = red * a + pixels[i]! * remaining
              pixels[i + 1] = green * a + pixels[i + 1]! * remaining
              pixels[i + 2] = blue * a + pixels[i + 2]! * remaining
              pixels[i + 3] = a + pixels[i + 3]! * remaining
            }
        }
      for (let i = 0; i < count; i += 4) {
        const a = pixels[i + 3]!,
          inverse = a > 0 ? 255 / a : 0
        image.data[i] = pixels[i]! * inverse
        image.data[i + 1] = pixels[i + 1]! * inverse
        image.data[i + 2] = pixels[i + 2]! * inverse
        image.data[i + 3] = a * 255
      }
      outputCtx.putImageData(image, 0, strip, 0, 0, w, activeRows)
    }
    return true
  }

  return {
    render(next: ArtFrame, options: ArtRenderOptions = {}) {
      const start = performance.now()
      frame = next
      if (current !== frame) {
        current = frame
        clearTiles()
        if (scratch) {
          scratch.width = frame.cellWidth
          scratch.height = frame.cellHeight
        }
      }
      const ratio = frame.width / frame.height,
        edge = clamp(Math.round(options.longEdge ?? 1200), 32, 8192)
      const w = ratio >= 1 ? edge : Math.max(1, Math.round(edge * ratio)),
        h = ratio >= 1 ? Math.max(1, Math.round(edge / ratio)) : edge
      if (target.width !== w || target.height !== h) {
        target.width = w
        target.height = h
      }
      if (
        frame.settings.softwareRaster &&
        (frame.settings.mode === 'color' ||
          (frame.settings.mode === 'density' && !frame.settings.colored)) &&
        renderSoftware(options, w, h)
      )
        return { width: w, height: h, renderMs: performance.now() - start }
      const quality =
        frame.settings.mode === 'density' && !frame.settings.colored
          ? frame.settings.rasterQuality
          : 'legacy'
      const scale =
        quality === 'supersampled' && Math.max(w, h) * 2 <= 4096 && w * h * 16 <= 32 * 1024 * 1024
          ? 2
          : 1
      if (scale > 1) {
        supersample ??= canvas(w * scale, h * scale)
        if (supersample.width !== w * scale || supersample.height !== h * scale) {
          supersample.width = w * scale
          supersample.height = h * scale
        }
        ctx = supersample.getContext('2d')!
      } else ctx = outputCtx
      ctx.imageSmoothingQuality = quality && quality !== 'legacy' ? 'high' : 'low'
      ctx.globalAlpha = 1
      if (options.transparent) ctx.clearRect(0, 0, w * scale, h * scale)
      else {
        ctx.fillStyle = frame.settings.background
        ctx.fillRect(0, 0, w * scale, h * scale)
      }
      const cw = (w * scale) / frame.columns,
        ch = (h * scale) / frame.rows
      const time = options.time ?? 0,
        motion = options.motion ?? 'none'
      for (let y = 0; y < frame.rows; y++)
        for (let x = 0; x < frame.columns; x++) {
          const cell = y * frame.columns + x,
            alpha = frame.alpha[cell]!
          if (alpha < 0.005 || frame.glyphs[frame.indices[cell]!]!.coverage < 0.001) continue
          let color = frame.settings.ink
          if (frame.settings.colored || frame.settings.mode === 'color') {
            // Preserve the same sampled RGB as GPU; bound the raster cache separately.
            color = `rgb(${frame.colors[cell * 3]!},${frame.colors[cell * 3 + 1]!},${frame.colors[cell * 3 + 2]!})`
          }
          let dx = 0,
            dy = 0,
            intensity = 1
          if (motion === 'breathe')
            intensity = 0.92 + Math.sin(time * 0.9 + x * 0.02 + y * 0.02) * 0.08
          if (motion === 'wave') {
            dx = Math.sin(y * 0.075 + time * 0.75) * cw * 0.18
            dy = Math.cos(x * 0.055 + time * 0.6) * ch * 0.1
          }
          if (motion === 'assemble') {
            const amount = Math.exp(-Math.max(0, time) * 1.4)
            dx = Math.sin(cell * 12.9898) * cw * 12 * amount
            dy = Math.cos(cell * 7.13) * ch * 10 * amount
          }
          let hoveredAlpha = alpha
          if (options.pointer?.strength) {
            const px = (x + 0.5) / frame.columns - options.pointer.x,
              py = (y + 0.5) / frame.rows - options.pointer.y
            const falloff = Math.exp(-(px * px + py * py) / 0.018) * options.pointer.strength
            if (options.hover === 'light') {
              // Change only the ink alpha. Glyphs, word order and tone polarity stay fixed.
              hoveredAlpha += (1 - alpha) * falloff * 0.28
            } else if (options.hover === 'ripple') {
              const distance = Math.hypot(px, py)
              const ripple = Math.sin(distance * 48 - time * 2.4) * falloff
              // Below a quarter cell: no glyph can jump over its neighbouring word.
              dx += (px / Math.max(0.01, distance)) * cw * ripple * 0.14
              dy += (py / Math.max(0.01, distance)) * ch * ripple * 0.14
              hoveredAlpha += (1 - alpha) * falloff * 0.18
            } else {
              dx += px * cw * 14 * falloff
              dy += py * ch * 10 * falloff
            }
          }
          ctx.globalAlpha = hoveredAlpha * intensity
          ctx.drawImage(tile(frame.indices[cell]!, color), x * cw + dx, y * ch + dy, cw, ch)
        }

      ctx.globalAlpha = 1
      if (ctx !== outputCtx) {
        outputCtx.globalAlpha = 1
        outputCtx.imageSmoothingQuality = 'high'
        if (options.transparent) outputCtx.clearRect(0, 0, w, h)
        outputCtx.drawImage(supersample!, 0, 0, w, h)
      }
      return { width: w, height: h, renderMs: performance.now() - start }
    },
    destroy() {
      current = null
      clearTiles()
      prefixes.clear()
      softwareMasks.clear()
      styleColors.clear()
      prefixBytes = maskBytes = 0
      softwareGlyphs = null
      softwarePixels = null
      softwareImage = null
      if (colorProbe) {
        colorProbe.width = colorProbe.height = 1
        colorProbe = null
      }
      if (supersample) {
        supersample.width = 1
        supersample.height = 1
        supersample = null
      }
      if (scratch) {
        scratch.width = 1
        scratch.height = 1
        scratch = null
      }
    },
    get cacheStats() {
      return {
        entries: tinted.size,
        backingBytes,
        maxBackingBytes,
        scratchBytes: scratch ? scratch.width * scratch.height * 4 : 0,
        supersampleBytes: supersample ? supersample.width * supersample.height * 4 : 0,
        softwareMaskBytes: prefixBytes + maskBytes,
        softwareMaskEntries: softwareMasks.size,
        softwareWorkingBytes:
          (softwarePixels?.byteLength ?? 0) + (softwareImage?.data.byteLength ?? 0),
        hits,
        misses,
      }
    },
  }
}
