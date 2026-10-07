export type PrintStyle = 'duotone' | 'riso' | 'pop'
export type Screen = 'ramp' | 'phrase'
export type PrintRecipe = {
  version: 1
  palette: 'blue-coral' | 'forest-rose' | 'violet-gold'
  screen: Screen
  phrase: string
  columns: number
  longEdge: 1024 | 2048
  contrast: number
  grain: number
  registration: number
  seed: number
}
export type GlyphMask = { char: string; alpha: Uint8ClampedArray; coverage: number }
export type PrintAtlas = { width: number; height: number; glyphs: GlyphMask[] }
export type PrintStats = {
  style: PrintStyle
  width: number
  height: number
  columns: number
  rows: number
  glyphs: number
  capacityClipped: number
  maxCoverage: number
  elapsedMs: number
  timings: { samplingMs: number; separationMs: number; glyphRasterMs: number; printingMs: number }
  inks: string[]
  paper: string
}
export const styles: { id: PrintStyle; title: string; description: string }[] = [
  { id: 'duotone', title: '双色 · 校园海报', description: '阴影墨＋中间调墨，各自曲线控制，保留柔和光影。' },
  { id: 'riso', title: 'Riso · 文艺印刷', description: '双墨分色、字符网屏、固定纹理与轻微套色偏移。' },
  { id: 'pop', title: '波普 · 鲜明色面', description: '保边平滑、分级色面与深色轮廓，形成更强对比。' },
]
export const defaultRecipe: PrintRecipe = {
  version: 1, palette: 'blue-coral', screen: 'ramp', phrase: '林晓晚，把名字写进光影。',
  columns: 160, longEdge: 2048, contrast: .15, grain: .4, registration: .8, seed: 20261007,
}
const finite = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi
/** Strict prototype recipe; source media is deliberately not embedded. */
export function validateRecipe(value: unknown): PrintRecipe {
  if (!value || typeof value !== 'object') throw new Error('风格参数格式无效')
  const r = value as PrintRecipe
  const phrase = typeof r.phrase === 'string' ? r.phrase.normalize('NFC').trim() : ''
  const count = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(phrase)].length
  if (r.version !== 1 || !['blue-coral', 'forest-rose', 'violet-gold'].includes(r.palette)
    || !['ramp', 'phrase'].includes(r.screen) || !count || count > 64 || /[\p{C}\p{Zl}\p{Zp}]/u.test(phrase)
    || !finite(r.columns, 64, 240) || !Number.isInteger(r.columns)
    || ![1024, 2048].includes(r.longEdge) || !finite(r.contrast, 0, .5)
    || !finite(r.grain, 0, 1) || !finite(r.registration, 0, 2)
    || !finite(r.seed, 0, 0xffffffff) || !Number.isInteger(r.seed)) throw new Error('风格参数超出范围；短句最多64个字符')
  return { version: 1, palette: r.palette, screen: r.screen, phrase, columns: r.columns,
    longEdge: r.longEdge, contrast: r.contrast, grain: r.grain, registration: r.registration, seed: r.seed }
}
export const palettes = {
  'blue-coral': { paper: '#fff5e6', shadow: '#163b63', accent: '#f15060', popPaper: '#fff098', popAccent: '#ed388a', popCool: '#16b9ce', key: '#182337' },
  'forest-rose': { paper: '#faf2e4', shadow: '#195444', accent: '#eb718e', popPaper: '#fff3ac', popAccent: '#f0578b', popCool: '#39ac87', key: '#18382e' },
  'violet-gold': { paper: '#faf1e5', shadow: '#503d80', accent: '#eca82b', popPaper: '#ffed8a', popAccent: '#b861b4', popCool: '#5cc6cf', key: '#372448' },
} as const
