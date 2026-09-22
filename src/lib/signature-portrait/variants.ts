/**
 * 细线伪手写多写法：尽量细但可见，方便多层叠色而不糊成黑块。
 */

import type { SignatureStamp } from './extract'

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  return canvas
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** 偏细的字体栈（避免黑体/粗笔） */
const FONT_STACKS = [
  '"FangSong", "STFangsong", "仿宋", serif',
  '"KaiTi", "STKaiti", "楷体", serif',
  '"STXingkai", "华文行楷", "KaiTi", cursive',
  '"Segoe Script", "Lucida Handwriting", cursive',
  '"SimSun", "宋体", serif',
  '"Microsoft YaHei Light", "Microsoft YaHei", sans-serif',
  'cursive',
  '"Brush Script MT", "Segoe Script", cursive',
  '"Times New Roman", "SimSun", serif',
  '"Palatino Linotype", "KaiTi", serif',
]

export type VariantGenOptions = {
  count?: number
  seed?: number
  maxSide?: number
  onProgress?: (ratio: number) => void
}

function buildStyle(i: number, rand: () => number) {
  const font = FONT_STACKS[i % FONT_STACKS.length]!
  // 细：200–450，绝大多数偏轻
  const weightRoll = rand()
  const weight =
    weightRoll < 0.45 ? 200 : weightRoll < 0.75 ? 300 : weightRoll < 0.92 ? 400 : 450
  const italic = rand() > 0.35
  const fontSize = 48 + Math.floor(rand() * 28)
  const skewX = (rand() - 0.5) * 0.28
  const skewY = (rand() - 0.5) * 0.08
  const scaleX = 0.78 + rand() * 0.55
  const scaleY = 0.82 + rand() * 0.4
  const rot = ((rand() - 0.5) * 14 * Math.PI) / 180
  const tracking = Math.floor((rand() - 0.35) * 6)
  // 极细描边增强可见度，不加粗填充
  const hairline = 0.35 + rand() * 0.55
  const fillAlpha = 0.55 + rand() * 0.4
  return {
    font,
    weight,
    italic,
    fontSize,
    skewX,
    skewY,
    scaleX,
    scaleY,
    rot,
    tracking,
    hairline,
    fillAlpha,
  }
}

function drawOneVariant(
  text: string,
  style: ReturnType<typeof buildStyle>,
  id: string,
  maxSide: number,
): SignatureStamp {
  const fontCss = `${style.italic ? 'italic' : 'normal'} ${style.weight} ${style.fontSize}px ${style.font}`
  const measure = makeCanvas(8, 8)
  const mctx = measure.getContext('2d')
  if (!mctx) throw new Error('无法创建画布')
  mctx.font = fontCss
  if (style.tracking) {
    ;(mctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      `${style.tracking}px`
  }
  const metrics = mctx.measureText(text)
  const tw = Math.ceil(metrics.width) + 24
  const ascent = metrics.actualBoundingBoxAscent || style.fontSize * 0.8
  const descent = metrics.actualBoundingBoxDescent || style.fontSize * 0.28
  const th = Math.ceil(ascent + descent + 20)

  const pad = 18
  const raw = makeCanvas(tw + pad * 2, th + pad * 2)
  const rctx = raw.getContext('2d')
  if (!rctx) throw new Error('无法创建画布')
  rctx.clearRect(0, 0, raw.width, raw.height)
  rctx.save()
  rctx.translate(raw.width / 2, raw.height / 2)
  rctx.rotate(style.rot)
  rctx.transform(1, style.skewY, style.skewX, 1, 0, 0)
  rctx.scale(style.scaleX, style.scaleY)
  rctx.font = fontCss
  if (style.tracking) {
    ;(rctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing =
      `${style.tracking}px`
  }
  rctx.textAlign = 'center'
  rctx.textBaseline = 'middle'
  rctx.lineJoin = 'round'
  rctx.lineCap = 'round'
  // 先细描边再半透明填充 → 细但可见
  rctx.strokeStyle = `rgba(20,20,28,${0.75 + style.fillAlpha * 0.2})`
  rctx.lineWidth = style.hairline
  rctx.strokeText(text, 0, 0)
  rctx.fillStyle = `rgba(18,16,24,${style.fillAlpha})`
  rctx.fillText(text, 0, 0)
  rctx.restore()

  const { data, width, height } = rctx.getImageData(0, 0, raw.width, raw.height)
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = data[(y * width + x) * 4 + 3] ?? 0
      if (a < 12) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }
  if (maxX < minX) {
    minX = 0
    minY = 0
    maxX = width - 1
    maxY = height - 1
  }
  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  const cropPad = 3
  let outW = bw + cropPad * 2
  let outH = bh + cropPad * 2
  let out = makeCanvas(outW, outH)
  const octx = out.getContext('2d')
  if (!octx) throw new Error('无法创建画布')
  octx.drawImage(raw, minX, minY, bw, bh, cropPad, cropPad, bw, bh)

  const scale = Math.min(1, maxSide / Math.max(outW, outH))
  if (scale < 0.999) {
    const sw = Math.max(1, Math.round(outW * scale))
    const sh = Math.max(1, Math.round(outH * scale))
    const scaled = makeCanvas(sw, sh)
    const sctx = scaled.getContext('2d')
    if (sctx) {
      sctx.imageSmoothingEnabled = true
      sctx.imageSmoothingQuality = 'high'
      sctx.drawImage(out, 0, 0, sw, sh)
      out = scaled
      outW = sw
      outH = sh
    }
  }

  return {
    id,
    label: `#${id.split(':').pop() ?? ''}`,
    canvas: out,
    width: outW,
    height: outH,
    previewUrl: out.toDataURL('image/png'),
  }
}

export async function generateHandwritingVariants(
  text: string,
  options: VariantGenOptions = {},
): Promise<SignatureStamp[]> {
  const raw = text.trim() || '名字'
  const count = Math.max(8, Math.min(200, options.count ?? 100))
  const maxSide = options.maxSide ?? 280
  const rand = mulberry32(options.seed ?? 20260322)
  const out: SignatureStamp[] = []

  for (let i = 0; i < count; i++) {
    out.push(
      drawOneVariant(raw, buildStyle(i, rand), `var:${raw}:${i}`, maxSide),
    )
    if (i % 8 === 0) {
      options.onProgress?.(i / count)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  options.onProgress?.(1)
  return out
}
