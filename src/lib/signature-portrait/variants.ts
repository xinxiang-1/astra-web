/** Licensed font variations are typography, not a substitute for someone's handwriting. */
import type { SignatureStamp } from './extract'
import { loadSignatureFont, type SignatureFontId } from './fonts'

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(w))
  canvas.height = Math.max(1, Math.ceil(h))
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

export type VariantGenOptions = {
  count?: number
  seed?: number
  maxSide?: number
  font?: SignatureFontId
  signal?: AbortSignal
  onProgress?: (ratio: number) => void
}

export type SignatureVariantStyle = {
  fontSize: number
  skewX: number
  skewY: number
  scaleX: number
  scaleY: number
  rotation: number
  tracking: number
  stroke: number
}

function buildStyle(rand: () => number): SignatureVariantStyle {
  return {
    fontSize: 58 + Math.floor(rand() * 18),
    skewX: (rand() - 0.5) * 0.13,
    skewY: (rand() - 0.5) * 0.035,
    scaleX: 0.92 + rand() * 0.22,
    scaleY: 0.94 + rand() * 0.12,
    rotation: ((rand() - 0.5) * 10 * Math.PI) / 180,
    tracking: (rand() - 0.4) * 1.3,
    stroke: 0.2 + rand() * 0.6,
  }
}

/** Allocate transformed ink bounds before drawing: long rotated names cannot be cropped. */
export function renderSignatureVariant(
  text: string,
  family: string,
  style: SignatureVariantStyle,
  maxSide: number,
): HTMLCanvasElement {
  const measure = makeCanvas(1, 1)
  const mctx = measure.getContext('2d')
  if (!mctx) throw new Error('无法创建画布')
  const configure = (ctx: CanvasRenderingContext2D) => {
    ctx.font = `400 ${style.fontSize}px "${family}"`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.letterSpacing = `${style.tracking}px`
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.lineWidth = style.stroke
    ctx.fillStyle = '#121018'
    ctx.strokeStyle = '#121018'
  }
  configure(mctx)
  const metrics = mctx.measureText(text)
  const margin = style.stroke / 2 + 2
  const left = -metrics.actualBoundingBoxLeft - margin
  const right = metrics.actualBoundingBoxRight + margin
  const top = -metrics.actualBoundingBoxAscent - margin
  const bottom = metrics.actualBoundingBoxDescent + margin
  // R · K · S, identical to rotate → skew → scale in Canvas2D.
  const cos = Math.cos(style.rotation),
    sin = Math.sin(style.rotation)
  const a = (cos - sin * style.skewY) * style.scaleX
  const b = (sin + cos * style.skewY) * style.scaleX
  const c = (cos * style.skewX - sin) * style.scaleY
  const d = (sin * style.skewX + cos) * style.scaleY
  const corners = [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ].map(([x, y]) => ({ x: a * x! + c * y!, y: b * x! + d * y! }))
  const minX = Math.floor(Math.min(...corners.map((p) => p.x)))
  const minY = Math.floor(Math.min(...corners.map((p) => p.y)))
  const rawW = Math.ceil(Math.max(...corners.map((p) => p.x))) - minX + 8
  const rawH = Math.ceil(Math.max(...corners.map((p) => p.y))) - minY + 8
  if (!Number.isFinite(rawW * rawH) || rawW * rawH > 8_000_000 || rawW < 1 || rawH < 1) {
    throw new Error('名字过长，请缩短或使用手写签名')
  }
  const raw = makeCanvas(rawW, rawH)
  const ctx = raw.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建画布')
  configure(ctx)
  ctx.setTransform(a, b, c, d, 4 - minX, 4 - minY)
  ctx.strokeText(text, 0, 0)
  ctx.fillText(text, 0, 0)
  const pixels = ctx.getImageData(0, 0, raw.width, raw.height).data
  let x0 = raw.width,
    y0 = raw.height,
    x1 = -1,
    y1 = -1
  for (let y = 0; y < raw.height; y++) {
    for (let x = 0; x < raw.width; x++) {
      if (!pixels[(y * raw.width + x) * 4 + 3]) continue
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  }
  if (x1 < x0) throw new Error('没有可用的名字笔画，请换字体或手写名字')
  if (x0 < 1 || y0 < 1 || x1 >= raw.width - 1 || y1 >= raw.height - 1) {
    throw new Error('名字笔画超出边界，请换字体或手写名字')
  }
  const width = x1 - x0 + 1,
    height = y1 - y0 + 1
  const scale = Math.min(1, (maxSide - 8) / Math.max(width, height))
  const targetW = Math.max(1, Math.floor(width * scale))
  const targetH = Math.max(1, Math.floor(height * scale))
  const out = makeCanvas(targetW + 8, targetH + 8)
  const octx = out.getContext('2d')
  if (!octx) throw new Error('无法创建画布')
  octx.imageSmoothingEnabled = true
  octx.imageSmoothingQuality = 'high'
  octx.drawImage(raw, x0, y0, width, height, 4, 4, targetW, targetH)
  return out
}

export async function generateHandwritingVariants(
  text: string,
  options: VariantGenOptions = {},
): Promise<SignatureStamp[]> {
  const raw = text.trim() || '名字'
  if (Array.from(raw).length > 32) throw new Error('名字最多支持 32 个字符')
  const requestedCount = options.count ?? 100
  const maxSide = options.maxSide ?? 420
  const seed = options.seed ?? 20260322
  if (!Number.isFinite(requestedCount) || !Number.isInteger(requestedCount))
    throw new Error('写法数量须为整数')
  if (!Number.isFinite(maxSide) || maxSide < 64 || maxSide > 1024)
    throw new Error('印章尺寸须在 64–1024 之间')
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('生成种子须为 32 位正整数或零')
  const count = Math.max(8, Math.min(200, requestedCount))
  const font = options.font ?? 'mashanzheng'
  options.signal?.throwIfAborted()
  options.onProgress?.(0)
  const family = await loadSignatureFont(font, raw, options.signal)
  const rand = mulberry32(seed)
  const out: SignatureStamp[] = []
  for (let i = 0; i < count; i++) {
    options.signal?.throwIfAborted()
    const canvas = renderSignatureVariant(raw, family, buildStyle(rand), maxSide)
    out.push({
      id: `font-v2:${font}:${seed}:${raw}:${i}`,
      label: `字体写法 #${i + 1}`,
      canvas,
      width: canvas.width,
      height: canvas.height,
      previewUrl: canvas.toDataURL('image/png'),
      source: { kind: 'font', version: 2, font, text: raw, seed, variant: i },
    })
    if (i % 8 === 7) {
      options.onProgress?.((i + 1) / count)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }
  options.signal?.throwIfAborted()
  options.onProgress?.(1)
  return out
}
