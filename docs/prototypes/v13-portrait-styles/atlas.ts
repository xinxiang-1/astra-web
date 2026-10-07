import type { GlyphMask, PrintAtlas, PrintRecipe } from './model'

/** Actual forward glyph alpha; all styles share the same screen geometry. */
export async function makeAtlas(recipe: PrintRecipe): Promise<PrintAtlas> {
  await document.fonts.ready
  const phrase = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(recipe.phrase)].map(v => v.segment)
  const chars = recipe.screen === 'ramp' ? [...' .:-=+*#@▓█'] : [...new Set(phrase)]
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const font = recipe.screen === 'ramp' ? '32px Consolas, "Cascadia Mono", monospace' : '600 32px "Microsoft YaHei", sans-serif'
  ctx.font = font
  // Full-block bounds define compact cells; no artificial gutters or glyph stretching.
  const block = ctx.measureText('█')
  const width = Math.ceil(Math.max(...chars.map(c => {
    const m = ctx.measureText(c)
    return Math.max(m.width, m.actualBoundingBoxLeft + m.actualBoundingBoxRight)
  }))) + (recipe.screen === 'phrase' ? 2 : 0)
  const ascent = recipe.screen === 'ramp' ? Math.ceil(block.actualBoundingBoxAscent) : 34
  const descent = recipe.screen === 'ramp' ? Math.ceil(block.actualBoundingBoxDescent) : 10
  const height = ascent + descent
  canvas.width = width; canvas.height = height
  const glyphs: GlyphMask[] = []
  for (const char of chars) {
    ctx.clearRect(0, 0, width, height)
    ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#fff'
    ctx.fillText(char, width / 2, ascent)
    const pixels = ctx.getImageData(0, 0, width, height).data
    const alpha = new Uint8ClampedArray(width * height)
    let sum = 0
    for (let i = 0; i < alpha.length; i++) { alpha[i] = pixels[i * 4 + 3]!; sum += alpha[i]! }
    glyphs.push({ char, alpha, coverage: sum / (255 * alpha.length) })
  }
  canvas.width = canvas.height = 1
  return { width, height, glyphs }
}
