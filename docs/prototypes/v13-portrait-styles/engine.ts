import { palettes, type PrintAtlas, type PrintRecipe, type PrintStats, type PrintStyle } from './model'

const clamp = (v: number) => Math.max(0, Math.min(1, v))
const smooth = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t) }
const rgb = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
const light = (r: number, g: number, b: number) => (r * .2126 + g * .7152 + b * .0722) / 255
const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
function noise(x: number, y: number, seed: number) {
  let v = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ seed
  v = Math.imul(v ^ (v >>> 13), 1274126177)
  return ((v ^ (v >>> 16)) >>> 0) / 0xffffffff
}
export type PrintHooks = { progress: (fraction: number, label: string) => void; checkpoint: () => Promise<void> }
export type Sample = { width: number; height: number; sourceWidth: number; sourceHeight: number; pixels: Uint8ClampedArray }

export function curves(luma: number, contrast: number) {
  const y = clamp((luma - .5) * (1 + contrast) + .5)
  return [clamp((.93 - y) / .83) ** 1.1, .72 * smooth(.08, .4, y) * (1 - smooth(.68, .97, y))]
}

/** A single spot-color screen. Ink exists only where a forward glyph has alpha. */
export async function renderPrint(sample: Sample, atlas: PrintAtlas, recipe: PrintRecipe, style: PrintStyle, hooks: PrintHooks) {
  const started = performance.now(), p = palettes[recipe.palette]
  const cols = recipe.columns, rows = Math.max(1, Math.round(sample.sourceHeight / sample.sourceWidth * cols * atlas.width / atlas.height))
  if (cols * rows > 80000) throw new Error('图片比例过长，请裁剪后再试')
  const scale = recipe.longEdge / Math.max(sample.sourceWidth, sample.sourceHeight)
  const width = Math.max(1, Math.round(sample.sourceWidth * scale)), height = Math.max(1, Math.round(sample.sourceHeight * scale))
  const paper = style === 'pop' ? p.popPaper : p.paper
  const inks = style === 'pop' ? [p.popAccent, p.popCool, p.key] : [p.shadow, p.accent]
  const colors = new Float32Array(cols * rows * 4)
  // Area sampled grid from the bounded source, preserving source transparency as paper.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const a = (row * cols + col) * 4
      let opacity = 0, r = 0, g = 0, b = 0, count = 0
      for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 2; sx++) {
        const x = Math.min(sample.width - 1, Math.floor((col + (sx + .5) / 2) / cols * sample.width))
        const y = Math.min(sample.height - 1, Math.floor((row + (sy + .5) / 3) / rows * sample.height))
        const i = (y * sample.width + x) * 4, alpha = sample.pixels[i + 3]! / 255
        opacity += alpha; r += sample.pixels[i]! * alpha; g += sample.pixels[i + 1]! * alpha; b += sample.pixels[i + 2]! * alpha; count++
      }
      colors[a] = opacity ? r / opacity : 255; colors[a + 1] = opacity ? g / opacity : 255; colors[a + 2] = opacity ? b / opacity : 255; colors[a + 3] = opacity / count
    }
    if (row % 12 === 0) { hooks.progress(.1 * row / rows, '采样光影'); await hooks.checkpoint() }
  }
  const sampledAt = performance.now()
  if (style === 'pop') {
    // Bounded bilateral smoothing in sample space; range term preserves major facial edges.
    const filtered = colors.slice()
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const at = (row * cols + col) * 4, origin = light(colors[at]!, colors[at + 1]!, colors[at + 2]!)
        let weight = 0, r = 0, g = 0, b = 0
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const y = Math.max(0, Math.min(rows - 1, row + dy)), x = Math.max(0, Math.min(cols - 1, col + dx)), i = (y * cols + x) * 4
          const delta = light(colors[i]!, colors[i + 1]!, colors[i + 2]!) - origin
          const w = Math.exp(-(dx * dx + dy * dy) / 5 - delta * delta / .012) * colors[i + 3]!
          weight += w; r += colors[i]! * w; g += colors[i + 1]! * w; b += colors[i + 2]! * w
        }
        if (weight) { filtered[at] = r / weight; filtered[at + 1] = g / weight; filtered[at + 2] = b / weight }
      }
      if (row % 8 === 0) { hooks.progress(.1 + .1 * row / rows, '保留轮廓、平滑色面'); await hooks.checkpoint() }
    }
    colors.set(filtered)
  }
  const fields = inks.map(() => new Float32Array(cols * rows))
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cell = row * cols + col, at = cell * 4
      const r = colors[at]!, g = colors[at + 1]!, b = colors[at + 2]!, a = colors[at + 3]!
      const luma = light(r, g, b), y = clamp((luma - .5) * (1 + recipe.contrast) + .5)
      let tones: number[]
      if (style === 'duotone') tones = curves(luma, recipe.contrast)
      else if (style === 'riso') {
        const warm = clamp((r - b) / 120)
        tones = [clamp((.84 - y) / .72) ** 1.05, clamp(.14 + warm * .46 + .2 * smooth(.2, .6, y)) * (1 - smooth(.78, 1, y))]
      } else {
        const left = Math.max(0, col - 1), right = Math.min(cols - 1, col + 1), up = Math.max(0, row - 1), down = Math.min(rows - 1, row + 1)
        const lumAt = (x: number, yy: number) => { const i = (yy * cols + x) * 4; return light(colors[i]!, colors[i + 1]!, colors[i + 2]!) }
        const edge = Math.hypot(lumAt(left, row) - lumAt(right, row), lumAt(col, up) - lumAt(col, down))
        const level = y < .18 ? 0 : y < .36 ? 1 : y < .56 ? 2 : y < .77 ? 3 : 4
        const warm = (r - b) / 255 > .07
        const levels = [[.3, .35, .98], [.7, .8, .18], [warm ? .85 : .12, warm ? .12 : .9, 0], [.35, 0, 0], [0, 0, 0]]
        tones = levels[level]!.slice(); tones[2] = Math.max(tones[2]!, .95 * smooth(.09, .25, edge))
      }
      tones.forEach((t, ink) => { fields[ink]![cell] = clamp(t * a) })
    }
    if (row % 12 === 0) { hooks.progress(.2 + .08 * row / rows, '生成独立墨层'); await hooks.checkpoint() }
  }
  const separatedAt = performance.now()
  const output = new OffscreenCanvas(width, height), ctx = output.getContext('2d', { willReadFrequently: true })!
  const maxCoverage = Math.max(...atlas.glyphs.map(g => g.coverage))
  const ramp = atlas.glyphs.map((g, i) => ({ coverage: g.coverage, i })).sort((a, b) => a.coverage - b.coverage)
  const sequence = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(recipe.phrase)].map(v => atlas.glyphs.findIndex(g => g.char === v.segment))
  ctx.fillStyle = paper; ctx.fillRect(0, 0, width, height); ctx.globalCompositeOperation = 'multiply'
  let glyphCount = 0, capacityClipped = 0, glyphRasterMs = 0, printingMs = 0
  try {
    for (let ink = 0; ink < inks.length; ink++) {
      const glyphStarted = performance.now()
      const tint = rgb(inks[ink]!), variants: OffscreenCanvas[][] = []
      // Fixed seed variants avoid time noise and bound total atlas memory.
      for (let variant = 0; variant < 3; variant++) {
        const tiles: OffscreenCanvas[] = []
        for (const g of atlas.glyphs) {
          const tile = new OffscreenCanvas(atlas.width, atlas.height), tc = tile.getContext('2d', { willReadFrequently: true })!, pixels = new ImageData(atlas.width, atlas.height)
          for (let i = 0; i < g.alpha.length; i++) {
            pixels.data[i * 4] = tint[0]!; pixels.data[i * 4 + 1] = tint[1]!; pixels.data[i * 4 + 2] = tint[2]!
            const grain = style === 'riso' ? 1 - recipe.grain * .15 * noise(i % atlas.width, Math.floor(i / atlas.width), recipe.seed + variant * 631) : 1
            pixels.data[i * 4 + 3] = g.alpha[i]! * grain
          }
          tc.putImageData(pixels, 0, 0); tiles.push(tile)
        }
        variants.push(tiles)
      }
      glyphRasterMs += performance.now() - glyphStarted
      const printStarted = performance.now()
      const shift = style === 'riso' && ink === 1 ? recipe.registration * recipe.longEdge / 1024 : 0
      const margin = style === 'riso' ? Math.ceil(recipe.registration * recipe.longEdge / 1024) + 1 : 0
      const cellWidth = (width - margin * 2) / cols, cellHeight = (height - margin * 2) / rows
      try {
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const cell = row * cols + col, target = fields[ink]![cell]!
            if (target <= .002) continue
            let index = recipe.screen === 'phrase' ? sequence[cell % sequence.length]! : (ramp.find(g => g.coverage >= target)?.i ?? ramp[ramp.length - 1]!.i)
            if (style === 'riso' && recipe.screen === 'ramp') {
              // Ordered area screening chooses whole forward glyphs instead of soft RGB tinting.
              const hi = ramp.find(g => g.coverage >= target) ?? ramp[ramp.length - 1]!
              const lo = ramp[Math.max(0, ramp.indexOf(hi) - 1)]!
              const mix = hi.coverage > lo.coverage ? clamp((target - lo.coverage) / (hi.coverage - lo.coverage)) : 1
              index = mix > (bayer[(row % 4) * 4 + col % 4]! + .5) / 16 ? hi.i : lo.i
            }
            const g = atlas.glyphs[index]!, variant = Math.min(2, Math.floor(noise(col, row, recipe.seed) * 3))
            if (target > (recipe.screen === 'phrase' ? g.coverage : maxCoverage) + .01) capacityClipped++
            if (!g.coverage) continue
            ctx.globalAlpha = style === 'riso' && recipe.screen === 'ramp' ? 1 : clamp(target / g.coverage)
            if (style === 'riso') ctx.globalAlpha *= 1 - recipe.grain * .07 * noise(col, row, recipe.seed + ink * 743)
            const x = Math.round(col * cellWidth), y = Math.round(row * cellHeight)
            ctx.drawImage(variants[variant]![index]!, margin + x + shift, margin + y - shift * .55, Math.round((col + 1) * cellWidth) - x, Math.round((row + 1) * cellHeight) - y)
            glyphCount++
          }
          if (row % 6 === 0) { hooks.progress(.28 + .7 * (ink + row / rows) / inks.length, `印制第${ink + 1}层字符`); await hooks.checkpoint() }
        }
      } finally { variants.flat().forEach(tile => { tile.width = tile.height = 1 }) }
      printingMs += performance.now() - printStarted
    }
    await hooks.checkpoint()
    const bitmap = output.transferToImageBitmap()
    const stats: PrintStats = { style, width, height, columns: cols, rows, glyphs: glyphCount, capacityClipped,
      maxCoverage, elapsedMs: performance.now() - started, inks, paper,
      timings: { samplingMs: sampledAt - started, separationMs: separatedAt - sampledAt, glyphRasterMs, printingMs } }
    return { bitmap, stats }
  } finally { output.width = output.height = 1 }
}
