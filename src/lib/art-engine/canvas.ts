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
  let glowCanvas: HTMLCanvasElement | null = null
  const trail: { x: number; y: number; time: number }[] = []
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

  // Shared by ordinary Canvas, the area raster and the offline HTML runtime.
  // Positions change; glyph orientation, indices and phrase order never change.
  function effects(options: ArtRenderOptions, w: number, h: number) {
    const motion = options.motion ?? 'none',
      hover = options.hover ?? 'displace'
    const expressive =
      options.effectProfile === 'expressive' ||
      ['current', 'reform', 'caustics'].includes(motion) ||
      ['trail', 'water', 'silk', 'vortex', 'contour', 'dissolve'].includes(hover)
    const time = (options.time ?? 0) * clamp(options.motionSpeed ?? 1, 0.2, 2)
    const interactionTime = options.hoverTime ?? options.time ?? 0
    const amount = clamp(options.motionStrength ?? 0.65, 0, 1)
    const pointer = options.pointer
    const radius = clamp(options.hoverRadius ?? 0.38, 0.05, 1) * Math.min(w, h) * 0.68
    while (
      trail.length &&
      (interactionTime - trail[0]!.time > 0.7 || interactionTime < trail[0]!.time)
    )
      trail.shift()
    if (hover === 'trail' && pointer && pointer.strength > 0.01) {
      const previous = trail.at(-1)
      if (!previous || Math.hypot(pointer.x - previous.x, pointer.y - previous.y) > 0.015) {
        trail.push({ x: pointer.x, y: pointer.y, time: interactionTime })
        if (trail.length > 10) trail.shift()
      }
    } else trail.length = 0
    function cell(x: number, y: number, cw: number, ch: number, alpha: number) {
      const index = y * frame.columns + x
      let dx = 0,
        dy = 0,
        intensity = 1,
        opacity = alpha,
        glow = 0
      if (motion === 'breathe')
        intensity = 1 - amount * (0.5 - 0.5 * Math.sin(time * 0.9 + x * 0.03 + y * 0.025)) * 0.28
      if (motion === 'wave') {
        dx = Math.sin(y * 0.075 + time * 0.85) * cw * 0.65 * amount
        dy = Math.cos(x * 0.055 + time * 0.65) * ch * 0.38 * amount
      }
      if (motion === 'assemble') {
        const fade = Math.exp(-Math.max(0, time) * 1.4) * amount
        dx = Math.sin(index * 12.9898) * cw * 12 * fade
        dy = Math.cos(index * 7.13) * ch * 10 * fade
      }
      if (motion === 'current') {
        dx =
          (Math.sin(y * 0.04 + time * 0.32) + Math.cos(x * 0.035 - time * 0.23)) *
          cw *
          0.65 *
          amount
        dy = Math.sin(x * 0.045 + y * 0.03 + time * 0.28) * ch * 0.5 * amount
      }
      if (motion === 'reform') {
        const pulse = Math.pow(Math.max(0, Math.sin(time * 0.85)), 6) * amount
        dx = Math.sin(index * 12.9898) * cw * 2.1 * pulse
        dy = Math.cos(index * 7.13) * ch * 1.6 * pulse
        intensity = 1 - pulse * 0.26
      }
      if (motion === 'caustics') {
        const bands =
          Math.sin(x * 0.075 + y * 0.04 - time * 0.8) * Math.cos(y * 0.085 - x * 0.025 + time * 0.5)
        glow = Math.pow(Math.max(0, bands), 3) * amount * 0.55
        intensity = 1 - amount * 0.12 + glow * 0.16
      }
      if (pointer?.strength) {
        const px = ((x + 0.5) / frame.columns - pointer.x) * w
        const py = ((y + 0.5) / frame.rows - pointer.y) * h
        const distance = Math.hypot(px, py),
          q = distance / radius
        const falloff = Math.exp(-q * q * 2) * clamp(pointer.strength, 0, 1)
        const ux = px / Math.max(1, distance),
          uy = py / Math.max(1, distance)
        const phase = q * 15 - interactionTime * 3.2
        if (hover === 'light') {
          opacity += (1 - alpha) * falloff * 0.6
          glow += falloff * 0.95
        } else if (hover === 'ripple') {
          const ripple = Math.sin(phase) * falloff
          dx += ux * cw * ripple * 0.8
          dy += uy * ch * ripple * 0.55
          glow += Math.max(0, ripple) * 0.28
        } else if (hover === 'displace') {
          dx += ux * cw * falloff * 1.15
          dy += uy * ch * falloff * 0.85
        } else if (hover === 'water') {
          dx += (ux * Math.sin(phase) + Math.cos(phase * 0.6)) * cw * falloff * 0.7
          dy += (uy * Math.sin(phase) + Math.sin(phase * 0.8)) * ch * falloff * 0.5
          glow += (0.25 + Math.max(0, Math.cos(phase)) * 0.35) * falloff
        } else if (hover === 'silk') {
          const fold = Math.sin((py / radius) * 7 + interactionTime * 1.6)
          dx += cw * falloff * (fold * 1.1 - uy * 0.45)
          dy += ch * falloff * Math.cos((px / radius) * 4 - interactionTime) * 0.4
          glow += (fold * 0.15 + 0.2) * falloff
        } else if (hover === 'vortex') {
          dx -= uy * cw * falloff * 1.8
          dy += ux * ch * falloff * 1.3
          glow += falloff * 0.22
        } else if (hover === 'contour') {
          const band = Math.pow(Math.max(0, Math.cos(q * 22 - interactionTime * 0.7)), 7)
          glow += band * falloff * 0.85
          intensity *= 1 - (1 - band) * falloff * 0.2
        } else if (hover === 'dissolve') {
          const noise =
            Math.sin(index * 12.9898 + interactionTime * 1.4) *
            Math.cos(index * 3.17 - interactionTime)
          const dissolve = Math.max(0, noise) * falloff
          opacity *= 1 - dissolve * 0.85
          dx += Math.sin(index * 9.1) * cw * dissolve * 1.6
          dy -= ch * dissolve * 1.2
          glow += Math.max(0, -noise) * falloff * 0.4
        } else if (hover === 'trail') {
          let wake = falloff
          for (const point of trail) {
            const tx = (((x + 0.5) / frame.columns - point.x) * w) / radius
            const ty = (((y + 0.5) / frame.rows - point.y) * h) / radius
            wake = Math.max(
              wake,
              Math.exp(-(tx * tx + ty * ty) * 3) *
                Math.max(0, 1 - (interactionTime - point.time) / 0.7) *
                pointer.strength,
            )
          }
          dx += Math.sin(y * 0.12 + interactionTime * 2) * cw * wake * 0.3
          glow += wake * 0.8
        }
      }
      return { dx, dy, intensity, opacity, glow }
    }
    const needsGlow =
      (motion === 'caustics' && amount > 0) || (!!pointer?.strength && hover !== 'displace')
    return { expressive, needsGlow, cell }
  }

  function renderGlow(effect: ReturnType<typeof effects>, w: number, h: number) {
    if (!effect.expressive || !effect.needsGlow) return
    // One bounded glyph-mask surface; no photographic layer or per-glyph blur.
    const scale = Math.min(1, 1536 / Math.max(w, h))
    const gw = Math.max(1, Math.round(w * scale)),
      gh = Math.max(1, Math.round(h * scale))
    let gc: CanvasRenderingContext2D | null = null
    const cw = gw / frame.columns,
      ch = gh / frame.rows
    for (let y = 0; y < frame.rows; y++)
      for (let x = 0; x < frame.columns; x++) {
        const i = y * frame.columns + x,
          alpha = frame.alpha[i]!
        if (alpha < 0.005 || frame.glyphs[frame.indices[i]!]!.coverage < 0.001) continue
        const e = effect.cell(x, y, cw, ch, alpha)
        if (e.glow < 0.003) continue
        if (!gc) {
          glowCanvas ??= canvas(gw, gh)
          if (glowCanvas.width !== gw || glowCanvas.height !== gh) {
            glowCanvas.width = gw
            glowCanvas.height = gh
          }
          gc = glowCanvas.getContext('2d')!
          gc.clearRect(0, 0, gw, gh)
        }
        gc.globalAlpha = clamp(e.glow * Math.max(0.35, e.opacity) * e.intensity, 0, 1)
        gc.drawImage(tile(frame.indices[i]!, '#86fff2'), x * cw + e.dx, y * ch + e.dy, cw, ch)
      }
    if (!gc) return
    const spread = Math.max(2, Math.min(w, h) * 0.018)
    outputCtx.save()
    outputCtx.globalCompositeOperation = 'screen'
    outputCtx.globalAlpha = 0.75
    outputCtx.filter = `blur(${spread}px)`
    outputCtx.drawImage(glowCanvas!, 0, 0, w, h)
    outputCtx.globalAlpha = 0.9
    outputCtx.filter = `blur(${Math.max(1, spread * 0.25)}px)`
    outputCtx.drawImage(glowCanvas!, 0, 0, w, h)
    outputCtx.filter = 'none'
    // Screen alone disappears into fully opaque pale ink. Tint the actual strokes
    // as well, so faithful/full-alpha characters still give visible feedback.
    outputCtx.globalCompositeOperation = 'source-over'
    outputCtx.globalAlpha = 0.85
    outputCtx.drawImage(glowCanvas!, 0, 0, w, h)
    outputCtx.restore()
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

  function renderSoftware(
    options: ArtRenderOptions,
    w: number,
    h: number,
    effect: ReturnType<typeof effects>,
  ) {
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
          if (effect.expressive) {
            const e = effect.cell(x, y, cw, ch, alpha)
            dx = e.dx
            dy = e.dy
            intensity = e.intensity
            opacity = e.opacity
          } else {
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
      const effect = effects(options, w, h)
      if (
        frame.settings.softwareRaster &&
        (frame.settings.mode === 'color' ||
          (frame.settings.mode === 'density' && !frame.settings.colored)) &&
        renderSoftware(options, w, h, effect)
      ) {
        renderGlow(effect, w, h)
        return { width: w, height: h, renderMs: performance.now() - start }
      }
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
          let hoveredAlpha = alpha
          if (effect.expressive) {
            const e = effect.cell(x, y, cw, ch, alpha)
            dx = e.dx
            dy = e.dy
            intensity = e.intensity
            hoveredAlpha = e.opacity
          } else {
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
          }
          ctx.globalAlpha = effect.expressive
            ? clamp(hoveredAlpha * intensity, 0, 1)
            : hoveredAlpha * intensity
          ctx.drawImage(tile(frame.indices[cell]!, color), x * cw + dx, y * ch + dy, cw, ch)
        }

      ctx.globalAlpha = 1
      if (ctx !== outputCtx) {
        outputCtx.globalAlpha = 1
        outputCtx.imageSmoothingQuality = 'high'
        if (options.transparent) outputCtx.clearRect(0, 0, w, h)
        outputCtx.drawImage(supersample!, 0, 0, w, h)
      }
      renderGlow(effect, w, h)
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
      trail.length = 0
      if (glowCanvas) {
        glowCanvas.width = glowCanvas.height = 1
        glowCanvas = null
      }
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
        glowBytes: glowCanvas ? glowCanvas.width * glowCanvas.height * 4 : 0,
        trailPoints: trail.length,
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
