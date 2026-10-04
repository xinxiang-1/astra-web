import type { ArtFrame, ArtGlyph, ArtSettings } from './types'

/** Self-contained sampling factory, also embedded in exported HTML. */
export function createArtCore(defaults: ArtSettings, version: string) {
  const atlasCache = new Map<
    string,
    { glyphs: ArtGlyph[]; cellWidth: number; cellHeight: number }
  >()
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
  function glyphsOf(text: string): string[] {
    return [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(text)].map(
      (part) => part.segment,
    )
  }
  function canvas(width: number, height: number) {
    const result = document.createElement('canvas')
    result.width = width
    result.height = height
    return result
  }
  function* atlas(
    charset: string,
    fontFamily?: string,
    fontWeight = 400,
  ): Generator<void, { glyphs: ArtGlyph[]; cellWidth: number; cellHeight: number }> {
    const chars = [...new Set([' ', ...glyphsOf(charset)])]
    if (chars.length > 512) throw new Error('字符库过长，请保留最多 511 个不同字符')
    const key = `${fontFamily || ''}${fontWeight === 400 ? '' : `:${fontWeight}`}\u0001${chars.join('\u0000')}`
    const cached = atlasCache.get(key)
    if (cached) return cached
    const baseFont = fontFamily
      ? `22px ${fontFamily}`
      : /[\u3400-\u9fff]|\p{Extended_Pictographic}/u.test(charset)
        ? '22px "Microsoft YaHei", "PingFang SC", sans-serif'
        : '22px Consolas, "Cascadia Mono", monospace'
    const font = fontWeight === 400 ? baseFont : `${fontWeight} ${baseFont}`
    const measure = canvas(40, 40).getContext('2d')!
    measure.font = font
    const cellWidth = Math.max(
      14,
      Math.ceil(Math.max(...chars.map((char) => measure.measureText(char).width))),
    )
    const cellHeight = 28
    const glyphs: ArtGlyph[] = []
    for (const char of chars) {
      const tile = canvas(cellWidth, cellHeight)
      const ctx = tile.getContext('2d', { willReadFrequently: true })!
      ctx.font = font
      ctx.fillStyle = '#fff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(char, cellWidth / 2, cellHeight / 2)
      const pixels = ctx.getImageData(0, 0, cellWidth, cellHeight).data
      let ink = 0
      for (let i = 3; i < pixels.length; i += 4) ink += pixels[i]!
      glyphs.push({ char, tile, coverage: ink / (255 * cellWidth * cellHeight) })
      yield
    }
    const value = { glyphs, cellWidth, cellHeight }
    // Bound cached user phrases and their raster assets.
    if (atlasCache.size >= 12) atlasCache.delete(atlasCache.keys().next().value!)
    atlasCache.set(key, value)
    return value
  }
  function percentile(histogram: Uint32Array, total: number, fraction: number) {
    let accumulated = 0
    for (let i = 0; i < 256; i++) {
      accumulated += histogram[i]!
      if (accumulated >= total * fraction) return i
    }
    return 255
  }
  function faithfulColor(settings: ArtSettings) {
    return (
      settings.softwareRaster &&
      settings.colorFidelity &&
      settings.mode === 'color' &&
      settings.invert
    )
  }
  function* toneMapping(
    pixels: Uint8ClampedArray,
    settings: ArtSettings,
  ): Generator<void, (luminance: number) => number> {
    const histogram = new Uint32Array(256)
    let total = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (i % 32768 === 0) yield
      if (pixels[i + 3]! < 16) continue
      histogram[
        Math.round(
          faithfulColor(settings)
            ? Math.max(pixels[i]!, pixels[i + 1]!, pixels[i + 2]!)
            : pixels[i]! * 0.2126 + pixels[i + 1]! * 0.7152 + pixels[i + 2]! * 0.0722,
        )
      ]!++
      total++
    }
    const min = settings.normalize && total ? percentile(histogram, total, 0.01) : 0
    const max = settings.normalize && total ? percentile(histogram, total, 0.99) : 255
    const stretch = max - min > 12 ? 255 / (max - min) : 1
    const offset = stretch === 1 ? 0 : min
    return (luminance: number) => {
      const t = clamp(
        (((luminance - offset) * stretch) / 255 - 0.5) * (1 + settings.contrast) +
          0.5 +
          settings.exposure * 0.18,
        0,
        1,
      )
      return settings.invert ? t : 1 - t
    }
  }

  /** All modes share source sampling, geometry, frame data and output rendering. */
  function* prepareArtFrameSteps(
    source: CanvasImageSource,
    width: number,
    height: number,
    input: Partial<ArtSettings> = {},
  ): Generator<void, ArtFrame> {
    if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0))
      throw new Error('素材尺寸无效')
    const start = performance.now()
    const settings = { ...defaults, ...input }
    const columns = clamp(
      Math.round(Number.isFinite(settings.columns) ? settings.columns : 180),
      24,
      400,
    )
    const phrase = glyphsOf(settings.phrase.trim() || '光与影').slice(0, 64)
    let charset = settings.mode === 'phrase' ? phrase.join('') : settings.charset
    if (settings.mode === 'contour') charset = ' .─│╱╲'
    if (settings.mode === 'halftone') charset = ' ·•●'
    if (settings.mode === 'braille')
      charset = Array.from({ length: 256 }, (_, i) => String.fromCodePoint(0x2800 + i)).join('')
    const weight =
      ((settings.mode === 'density' && !settings.colored) ||
        (settings.mode === 'color' && settings.softwareRaster)) &&
      settings.fontWeight === 600
        ? 600
        : 400
    const { glyphs, cellWidth, cellHeight } = yield* atlas(charset, settings.fontFamily, weight)
    const aspect = Number.isFinite(settings.charAspect)
      ? clamp(settings.charAspect!, 0.35, 1.2)
      : cellWidth / cellHeight
    const rows = Math.max(1, Math.round((height / width) * columns * aspect))
    if (columns * rows > 180_000) throw new Error('素材比例过长，请先裁剪或降低细节')
    const sampler = canvas(columns * 2, rows * 4)
    const ctx = sampler.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, sampler.width, sampler.height)
    const pixels = ctx.getImageData(0, 0, sampler.width, sampler.height).data
    yield
    const tone = yield* toneMapping(pixels, settings)
    const count = columns * rows
    const indices = new Uint16Array(count),
      alpha = new Float32Array(count)
    const colors = new Uint8ClampedArray(count * 3),
      luminosity = new Float32Array(count),
      coverage = new Float32Array(count)
    const maxCoverage = Math.max(0.01, ...glyphs.map((glyph) => glyph.coverage))
    const ramp = glyphs
      .map((glyph, index) => ({ index, density: glyph.coverage / maxCoverage }))
      .sort((a, b) => a.density - b.density)
    const lookup = new Map(glyphs.map((glyph, index) => [glyph.char, index]))
    const bits = [1, 8, 2, 16, 4, 32, 64, 128]
    const lines: string[] = []
    let nonEmpty = 0
    for (let y = 0; y < rows; y++) {
      yield
      for (let x = 0; x < columns; x++) {
        const cell = y * columns + x
        let r = 0,
          g = 0,
          b = 0,
          a = 0,
          braille = 0
        for (let dy = 0; dy < 4; dy++)
          for (let dx = 0; dx < 2; dx++) {
            const i = ((y * 4 + dy) * sampler.width + x * 2 + dx) * 4
            const opacity = pixels[i + 3]! / 255
            r += pixels[i]! * opacity
            g += pixels[i + 1]! * opacity
            b += pixels[i + 2]! * opacity
            a += opacity
            if (
              settings.mode === 'braille' &&
              opacity > 0.1 &&
              tone(pixels[i]! * 0.2126 + pixels[i + 1]! * 0.7152 + pixels[i + 2]! * 0.0722) > 0.44
            )
              braille |= bits[dy * 2 + dx]!
          }
        const denominator = Math.max(0.001, a)
        r /= denominator
        g /= denominator
        b /= denominator
        if (faithfulColor(settings)) {
          const peak = Math.max(r, g, b)
          colors.set(
            peak > 0 ? [(r * 255) / peak, (g * 255) / peak, (b * 255) / peak] : [0, 0, 0],
            cell * 3,
          )
          luminosity[cell] = tone(peak)
        } else {
          colors.set([r, g, b], cell * 3)
          luminosity[cell] = tone(r * 0.2126 + g * 0.7152 + b * 0.0722)
        }
        coverage[cell] = a / 8
        if (settings.mode === 'braille')
          indices[cell] = lookup.get(String.fromCodePoint(0x2800 + braille)) ?? 0
      }
    }
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
    for (let y = 0; y < rows; y++) {
      yield
      let line = ''
      for (let x = 0; x < columns; x++) {
        const cell = y * columns + x
        const dither =
          settings.mode === 'phrase' || settings.mode === 'contour'
            ? 0
            : (bayer[(y % 4) * 4 + (x % 4)]! / 15 - 0.5) *
              0.065 *
              clamp(settings.ditherStrength ?? 0, 0, 1)
        const t = clamp(luminosity[cell]! + dither, 0, 1)
        if (coverage[cell]! < 0.02) {
          line += ' '
          continue
        }
        let index = 0,
          opacity = 1
        if (settings.mode === 'phrase') {
          // Spatial order is stable across frames; brightness never shuffles the user's words.
          index = lookup.get(phrase[cell % phrase.length]!) ?? 0
          opacity = clamp((t * maxCoverage) / Math.max(0.015, glyphs[index]!.coverage), 0, 1)
          if (!settings.fillAll && t < settings.threshold) opacity = 0
        } else if (settings.mode === 'braille') {
          index = indices[cell]!
          opacity = t < 0.02 ? 0 : 1
        } else if (settings.mode === 'contour') {
          const left = luminosity[y * columns + Math.max(0, x - 1)]!,
            right = luminosity[y * columns + Math.min(columns - 1, x + 1)]!
          const top = luminosity[Math.max(0, y - 1) * columns + x]!,
            bottom = luminosity[Math.min(rows - 1, y + 1) * columns + x]!
          const gx = right - left,
            gy = bottom - top,
            magnitude = Math.hypot(gx, gy)
          const direction = Math.atan2(gy, gx) + Math.PI / 2
          const bin = ((Math.round(direction / (Math.PI / 4)) % 4) + 4) % 4
          index = lookup.get(['─', '╲', '│', '╱'][bin]!) ?? 0
          opacity = clamp(magnitude * 3, 0, 1)
        } else {
          // Select the first glyph with enough ink, then compensate alpha within that interval.
          const candidate =
            ramp.find((glyph) => glyph.density >= t && glyph.density > 0.001) ?? ramp.at(-1)!
          index = candidate.index
          opacity = t / Math.max(0.001, candidate.density)
          if (t < 0.008) {
            index = 0
            opacity = 0
          }
        }
        indices[cell] = index
        alpha[cell] = clamp(opacity * coverage[cell]!, 0, 1)
        if (alpha[cell]! > 0.01 && glyphs[index]!.coverage > 0) nonEmpty++
        line += alpha[cell]! > 0.01 ? glyphs[index]!.char : ' '
      }
      lines.push(line)
    }
    return {
      version: version,
      columns,
      rows,
      width,
      height,
      glyphs,
      indices,
      alpha,
      colors,
      settings,
      cellWidth,
      cellHeight,
      text: lines.join('\n'),
      statistics: { nonEmpty, maxCoverage, preparationMs: performance.now() - start },
    }
  }

  function prepareArtFrame(
    source: CanvasImageSource,
    width: number,
    height: number,
    input: Partial<ArtSettings> = {},
  ): ArtFrame {
    const steps = prepareArtFrameSteps(source, width, height, input)
    let next = steps.next()
    while (!next.done) next = steps.next()
    return next.value
  }

  /** Same sampling and font atlas; bounded compute slices keep controls responsive. */
  async function prepareArtFrameResponsive(
    source: CanvasImageSource,
    width: number,
    height: number,
    input: Partial<ArtSettings> = {},
    options: { shouldAbort?: () => boolean } = {},
  ): Promise<ArtFrame> {
    const steps = prepareArtFrameSteps(source, width, height, input)
    let sliceStart = performance.now()
    try {
      while (true) {
        if (options.shouldAbort?.()) throw new DOMException('已取消转换', 'AbortError')
        const next = steps.next()
        if (next.done) return next.value
        if (performance.now() - sliceStart >= 8) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
          sliceStart = performance.now()
        }
      }
    } finally {
      steps.return(undefined as never)
    }
  }

  /** Freeze the rendered font atlas in an HTML file; no font installation is required. */
  function primeAtlas(frame: ArtFrame) {
    const weight =
      ((frame.settings.mode === 'density' && !frame.settings.colored) ||
        (frame.settings.mode === 'color' && frame.settings.softwareRaster)) &&
      frame.settings.fontWeight === 600
        ? 600
        : 400
    const key = `${frame.settings.fontFamily || ''}${weight === 400 ? '' : `:${weight}`}\u0001${frame.glyphs.map((glyph) => glyph.char).join('\u0000')}`
    atlasCache.set(key, {
      glyphs: frame.glyphs,
      cellWidth: frame.cellWidth,
      cellHeight: frame.cellHeight,
    })
  }
  return { prepareArtFrame, prepareArtFrameResponsive, primeAtlas }
}
