/** Versioned mixed-media background profiles. They do not alter signature geometry or ink. */
export type SignatureWashStyle = 'duotone-v1' | 'pop-v1'
export type SignatureWashPalette = 'blue-coral' | 'forest-rose' | 'violet-gold'
export type SignatureWashRecipe = { washStyle?: SignatureWashStyle; washPalette?: SignatureWashPalette }
export const SIGNATURE_WASH_PALETTES = [
  { id: 'blue-coral', name: '深蓝＋珊瑚红' },
  { id: 'forest-rose', name: '森林绿＋玫瑰粉' },
  { id: 'violet-gold', name: '紫罗兰＋金黄' },
] as const
const palettes = {
  'blue-coral': { paper: '#fff5e6', shadow: '#163b63', accent: '#f15060', popPaper: '#fff098', popAccent: '#ed388a', popCool: '#16b9ce', key: '#182337' },
  'forest-rose': { paper: '#faf2e4', shadow: '#195444', accent: '#eb718e', popPaper: '#fff3ac', popAccent: '#f0578b', popCool: '#39ac87', key: '#18382e' },
  'violet-gold': { paper: '#faf1e5', shadow: '#503d80', accent: '#eca82b', popPaper: '#ffed8a', popAccent: '#b861b4', popCool: '#5cc6cf', key: '#372448' },
} as const
const clamp = (v: number) => Math.max(0, Math.min(1, v))
const light = (r: number, g: number, b: number) => (r * .2126 + g * .7152 + b * .0722) / 255
const rgb = (hex: string) => [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16))
const smooth = (a: number, b: number, value: number) => { const t = clamp((value - a) / (b - a)); return t * t * (3 - 2 * t) }
export function washRecipe(recipe: SignatureWashRecipe) {
  if (!recipe.washStyle) {
    if (recipe.washPalette) throw new Error('风格配色需要指定彩绘风格')
    return null
  }
  if (!['duotone-v1', 'pop-v1'].includes(recipe.washStyle)) throw new Error('彩绘风格暂不支持')
  const palette = recipe.washPalette ?? 'blue-coral'
  if (!Object.hasOwn(palettes, palette)) throw new Error('彩绘配色暂不支持')
  return { style: recipe.washStyle, palette, key: `${recipe.washStyle}:${palette}` }
}
export function createWashTaskQueue() {
  const channel = new MessageChannel()
  let resume: (() => void) | null = null
  channel.port1.onmessage = () => { const next = resume; resume = null; next?.() }
  return {
    yield: () => new Promise<void>(resolve => { resume = resolve; channel.port2.postMessage(0) }),
    close: () => { channel.port1.close(); channel.port2.close() },
  }
}

/** Pure bounded RGBA processing, shared by the worker and responsive compatibility path. */
export async function processSignatureWash(
  image: ImageData,
  recipe: SignatureWashRecipe,
  hooks: { checkpoint: () => Promise<void>; progress?: (ratio: number) => void },
) {
  const profile = washRecipe(recipe)
  if (!profile) return image
  const { width, height, data } = image
  if (Math.max(width, height) > 384 || width < 1 || height < 1) throw new Error('彩绘底色超出尺寸预算')
  const p = palettes[profile.palette]
  const filtered = new Float32Array(width * height * 3)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, dst = (y * width + x) * 3
      let r = data[at]!, g = data[at + 1]!, b = data[at + 2]!
      if (profile.style === 'pop-v1' && data[at + 3]) {
        const origin = light(r, g, b)
        let weight = 0, rr = 0, gg = 0, bb = 0
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const yy = Math.max(0, Math.min(height - 1, y + dy)), xx = Math.max(0, Math.min(width - 1, x + dx)), i = (yy * width + xx) * 4
          const delta = light(data[i]!, data[i + 1]!, data[i + 2]!) - origin
          const w = Math.exp(-(dx * dx + dy * dy) / 5 - delta * delta / .012) * data[i + 3]! / 255
          weight += w; rr += data[i]! * w; gg += data[i + 1]! * w; bb += data[i + 2]! * w
        }
        if (weight) { r = rr / weight; g = gg / weight; b = bb / weight }
      }
      filtered[dst] = r; filtered[dst + 1] = g; filtered[dst + 2] = b
    }
    if (y % 8 === 0) { hooks.progress?.(.6 * y / height); await hooks.checkpoint() }
  }
  const paper = rgb(profile.style === 'pop-v1' ? p.popPaper : p.paper)
  const inks = (profile.style === 'pop-v1' ? [p.popAccent, p.popCool, p.key] : [p.shadow, p.accent]).map(rgb)
  const out = new ImageData(width, height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, i = (y * width + x) * 3
      const r = filtered[i]!, g = filtered[i + 1]!, b = filtered[i + 2]!, value = clamp((light(r, g, b) - .5) * 1.15 + .5)
      let tones: number[]
      if (profile.style === 'duotone-v1') tones = [clamp((.93 - value) / .83) ** 1.1, .72 * smooth(.08, .4, value) * (1 - smooth(.68, .97, value))]
      else {
        const lumAt = (xx: number, yy: number) => { const j = (yy * width + xx) * 3; return light(filtered[j]!, filtered[j + 1]!, filtered[j + 2]!) }
        const edge = Math.hypot(lumAt(Math.max(0, x - 1), y) - lumAt(Math.min(width - 1, x + 1), y), lumAt(x, Math.max(0, y - 1)) - lumAt(x, Math.min(height - 1, y + 1)))
        const level = value < .18 ? 0 : value < .36 ? 1 : value < .56 ? 2 : value < .77 ? 3 : 4, warm = (r - b) / 255 > .07
        tones = [[.3, .35, .98], [.7, .8, .18], [warm ? .85 : .12, warm ? .12 : .9, 0], [.35, 0, 0], [0, 0, 0]][level]!.slice()
        tones[2] = Math.max(tones[2]!, .95 * smooth(.09, .25, edge))
      }
      for (let c = 0; c < 3; c++) {
        let value = paper[c]!
        for (let ink = 0; ink < tones.length; ink++) value *= 1 - tones[ink]! + tones[ink]! * inks[ink]![c]! / 255
        out.data[at + c] = Math.round(value)
      }
      out.data[at + 3] = data[at + 3]!
    }
    if (y % 8 === 0) { hooks.progress?.(.6 + .4 * y / height); await hooks.checkpoint() }
  }
  hooks.progress?.(1)
  return out
}
