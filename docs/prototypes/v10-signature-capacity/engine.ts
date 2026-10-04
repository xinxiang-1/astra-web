import type { SignatureStamp } from '../../../src/lib/signature-portrait/extract'

export type Palette = 'paper' | 'night'
export type Cell = { x: number; y: number; w: number; h: number; index: number; scale: number; dx: number; dy: number; polarity: 'ink' | 'cutout'; alpha: number; target: number; coverage: number; shortSide: number }
export type Scene = { engine: 'signed-partition-1'; width: number; height: number; palette: Palette; cells: Cell[]; integralBytes: number; clippedToneCells: number; seed: number }
export const palettes = {
  paper: { background: '#f5f3ef', rgb: [245, 243, 239], ink: [18, 16, 24] },
  night: { background: '#111615', rgb: [17, 22, 21], ink: [238, 234, 226] },
} as const
function canvas(width: number, height: number) {
  const surface = document.createElement('canvas')
  surface.width = width; surface.height = height
  return surface
}
function context(surface: HTMLCanvasElement) {
  const value = surface.getContext('2d', { willReadFrequently: true })
  if (!value) throw new Error('无法创建签名研究画布')
  return value
}
export function measure(stamp: SignatureStamp) {
  const data = context(stamp.canvas).getImageData(0, 0, stamp.width, stamp.height).data
  let alpha = 0, x0 = stamp.width, y0 = stamp.height, x1 = -1, y1 = -1
  for (let y = 0; y < stamp.height; y++) for (let x = 0; x < stamp.width; x++) {
    const a = data[(y * stamp.width + x) * 4 + 3]!
    alpha += a / 255
    if (a) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
  }
  if (x1 < x0) throw new Error('签名没有有效笔迹')
  return { alpha, coverage: alpha / (stamp.width * stamp.height), inkWidth: x1 - x0 + 1, inkHeight: y1 - y0 + 1 }
}
export async function historicalStamp(): Promise<SignatureStamp[]> {
  const image = new Image()
  image.src = '/docs/research/2026-10-04-signature-capacity/beethoven-signature.svg'
  await image.decode()
  const raw = canvas(1560, 240)
  context(raw).drawImage(image, 0, 0, raw.width, raw.height)
  const probe = measure({ id: 'probe', label: 'source probe', width: raw.width, height: raw.height, canvas: raw, previewUrl: '' })
  // The unmodified historical SVG has transparent margins; retain all of its pixels.
  const stamp = { id: 'beethoven-historical-vector-reproduction', label: '贝多芬历史签名矢量重绘', width: raw.width, height: raw.height, canvas: raw, previewUrl: raw.toDataURL('image/png') }
  if (!probe.alpha) throw new Error('历史签名为空')
  return [stamp]
}
function generator(seed: number) {
  let state = seed
  return () => { state |= 0; state = state + 0x6d2b79f5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
}
function stencils(stamps: SignatureStamp[], palette: Palette) {
  let bytes = 0
  const ink = palettes[palette].ink
  const result = stamps.map(stamp => {
    bytes += stamp.width * stamp.height * 4
    if (bytes > 16 * 1024 * 1024) throw new Error('研究模板超过16MiB预算')
    const source = context(stamp.canvas).getImageData(0, 0, stamp.width, stamp.height)
    for (let p = 0; p < source.data.length; p += 4) { source.data[p] = ink[0]; source.data[p + 1] = ink[1]; source.data[p + 2] = ink[2] }
    const tinted = canvas(stamp.width, stamp.height)
    context(tinted).putImageData(source, 0, 0)
    return tinted
  })
  return { result, bytes, dispose() { for (const c of result) { c.width = 1; c.height = 1 } } }
}
export function partition(image: HTMLImageElement, stamps: SignatureStamp[], palette: Palette, seed = 42): Scene {
  const longest = 1024
  const ratio = longest / Math.max(image.naturalWidth, image.naturalHeight)
  const width = Math.round(image.naturalWidth * ratio), height = Math.round(image.naturalHeight * ratio)
  if (!width || !height || width * height > 1048576) throw new Error('研究尺寸超出范围')
  const source = canvas(width, height), ctx = context(source)
  ctx.drawImage(image, 0, 0, width, height)
  const pixels = ctx.getImageData(0, 0, width, height).data
  const stride = width + 1, size = stride * (height + 1)
  const sum = new Float64Array(size), squared = new Float64Array(size)
  if (sum.byteLength + squared.byteLength > 24 * 1024 * 1024) throw new Error('研究积分数组超过预算')
  for (let y = 0; y < height; y++) {
    let total = 0, totalSquared = 0
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4
      const light = (pixels[p]! * .2126 + pixels[p + 1]! * .7152 + pixels[p + 2]! * .0722) / 255
      const tone = (palette === 'paper' ? 1 - light : light) * pixels[p + 3]! / 255
      total += tone; totalSquared += tone * tone
      sum[(y + 1) * stride + x + 1] = sum[y * stride + x + 1]! + total
      squared[(y + 1) * stride + x + 1] = squared[y * stride + x + 1]! + totalSquared
    }
  }
  source.width = 1; source.height = 1
  const traits = stamps.map(measure)
  const minH = Math.ceil(Math.max(...stamps.map((s, i) => 8 * s.height / traits[i]!.inkHeight)))
  const minW = Math.ceil(Math.max(...stamps.map((s, i) => 8 * s.width / traits[i]!.inkHeight)))
  if (width < minW || height < minH) throw new Error('完整签名无法达到此研究的原生8px笔迹短边')
  const averageAspect = stamps.reduce((a, s) => a + s.width / s.height, 0) / stamps.length
  const random = generator(seed)
  const rectSum = (array: Float64Array, x: number, y: number, w: number, h: number) => array[(y + h) * stride + x + w]! - array[y * stride + x + w]! - array[(y + h) * stride + x]! + array[y * stride + x]!
  const leaves: { x: number; y: number; w: number; h: number; target: number }[] = []
  const stack = [{ x: 0, y: 0, w: width, h: height }]
  while (stack.length) {
    const rect = stack.pop()!, area = rect.w * rect.h
    const target = rectSum(sum, rect.x, rect.y, rect.w, rect.h) / area
    const variance = Math.sqrt(Math.max(0, rectSum(squared, rect.x, rect.y, rect.w, rect.h) / area - target * target))
    const mustSplit = area > minW * minH * (variance > .035 ? 1.8 : 6)
    let vertical = rect.w / rect.h > averageAspect
    const canX = rect.w >= 2 * minW, canY = rect.h >= 2 * minH
    if (vertical && !canX) vertical = false
    else if (!vertical && !canY) vertical = true
    if (mustSplit && (vertical ? canX : canY)) {
      const extent = vertical ? rect.w : rect.h, minimum = vertical ? minW : minH
      const split = Math.min(extent - minimum, Math.max(minimum, Math.round(extent * (.42 + random() * .16))))
      if (vertical) stack.push({ ...rect, x: rect.x + split, w: rect.w - split }, { ...rect, w: split })
      else stack.push({ ...rect, y: rect.y + split, h: rect.h - split }, { ...rect, h: split })
    } else leaves.push({ ...rect, target })
    if (leaves.length + stack.length > 16000) throw new Error('研究分区超过16000枚预算')
  }
  const tinted = stencils(stamps, palette), scratch = canvas(1, 1), sctx = context(scratch)
  const cells: Cell[] = []
  let clippedToneCells = 0
  try {
    for (const leaf of leaves) {
      const index = Math.floor(random() * stamps.length), stamp = stamps[index]!
      const scale = Math.min(leaf.w / stamp.width, leaf.h / stamp.height)
      const dx = (leaf.w - stamp.width * scale) / 2, dy = (leaf.h - stamp.height * scale) / 2
      scratch.width = leaf.w; scratch.height = leaf.h
      sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high'
      sctx.drawImage(tinted.result[index]!, dx, dy, stamp.width * scale, stamp.height * scale)
      const data = sctx.getImageData(0, 0, leaf.w, leaf.h).data
      let alpha = 0
      for (let p = 3; p < data.length; p += 4) alpha += data[p]! / 255
      const coverage = alpha / (leaf.w * leaf.h)
      const polarity = leaf.target <= coverage || coverage >= .5 ? 'ink' : 'cutout'
      const available = polarity === 'ink' ? coverage : 1 - coverage
      if (leaf.target > available) clippedToneCells++
      cells.push({ ...leaf, index, scale, dx, dy, polarity, alpha: Math.min(1, leaf.target / Math.max(1e-8, available)), coverage, shortSide: traits[index]!.inkHeight * scale })
    }
  } finally { scratch.width = 1; scratch.height = 1; tinted.dispose() }
  return { engine: 'signed-partition-1', width, height, palette, cells, integralBytes: sum.byteLength + squared.byteLength, clippedToneCells, seed }
}
/** Replays only the layout and original templates: the source image is not an input. */
export function paint(scene: Scene, stamps: SignatureStamp[]) {
  const output = canvas(scene.width, scene.height), ctx = context(output)
  ctx.fillStyle = palettes[scene.palette].background; ctx.fillRect(0, 0, output.width, output.height)
  const tinted = stencils(stamps, scene.palette), scratch = canvas(1, 1), sctx = context(scratch)
  try {
    for (const cell of scene.cells) {
      const stamp = stamps[cell.index]!
      scratch.width = cell.w; scratch.height = cell.h
      sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = 'high'
      sctx.drawImage(tinted.result[cell.index]!, cell.dx, cell.dy, stamp.width * cell.scale, stamp.height * cell.scale)
      if (cell.polarity === 'cutout') {
        const data = sctx.getImageData(0, 0, cell.w, cell.h)
        const ink = palettes[scene.palette].ink
        for (let p = 0; p < data.data.length; p += 4) { data.data[p] = ink[0]; data.data[p + 1] = ink[1]; data.data[p + 2] = ink[2]; data.data[p + 3] = 255 - data.data[p + 3]! }
        sctx.putImageData(data, 0, 0)
      }
      ctx.globalAlpha = cell.alpha; ctx.drawImage(scratch, cell.x, cell.y)
    }
    ctx.globalAlpha = 1
    return output
  } finally { scratch.width = 1; scratch.height = 1; tinted.dispose() }
}
