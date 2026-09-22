/** Signature → transparent ink stamp (整段签名当一枚印章). */

export type SignatureStamp = {
  id: string
  label: string
  canvas: HTMLCanvasElement
  width: number
  height: number
  /** 缩略图 data URL，方便列表预览 */
  previewUrl: string
  /** 第三档：模板 path（trace 后写入） */
  vector?: {
    width: number
    height: number
    paths: string[]
  } | null
}

export type ExtractStampOptions = {
  /** 0–255；越低越容易把浅灰当墨迹 */
  threshold?: number
  /** 浅色纸深色墨 = false；深底浅字 = true */
  invert?: boolean
  /** 输出印章长边上限 */
  maxSide?: number
  padding?: number
}

function clampByte(n: number) {
  return Math.max(0, Math.min(255, n | 0))
}

function luminance(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  return canvas
}

/**
 * 从签名照片抠出透明底印章：深色笔画保留，纸底变透明。
 */
export function extractStampFromImage(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  options: ExtractStampOptions = {},
  meta: { id: string; label: string },
): SignatureStamp {
  const threshold = options.threshold ?? 168
  const invert = options.invert ?? false
  const maxSide = options.maxSide ?? 360
  const padding = options.padding ?? 6

  const src = makeCanvas(sourceWidth, sourceHeight)
  const sctx = src.getContext('2d', { willReadFrequently: true })
  if (!sctx) throw new Error('无法创建画布')
  sctx.drawImage(source, 0, 0, sourceWidth, sourceHeight)
  const { data, width, height } = sctx.getImageData(0, 0, src.width, src.height)

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  const ink = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const a = data[i + 3] ?? 0
      if (a < 8) {
        ink[y * width + x] = 0
        continue
      }
      const lum = luminance(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)
      const darkness = invert ? lum / 255 : 1 - lum / 255
      const pass = invert ? lum >= threshold : lum <= threshold
      const strength = pass ? Math.min(1, darkness * 1.35) : 0
      ink[y * width + x] = strength
      if (strength > 0.08) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    throw new Error('没识别到笔迹，试试调阈值或开关「浅色字」')
  }

  const cropW = maxX - minX + 1
  const cropH = maxY - minY + 1
  const scale = Math.min(1, maxSide / Math.max(cropW, cropH))
  const outW = Math.max(1, Math.round(cropW * scale + padding * 2))
  const outH = Math.max(1, Math.round(cropH * scale + padding * 2))
  const out = makeCanvas(outW, outH)
  const octx = out.getContext('2d')
  if (!octx) throw new Error('无法创建印章画布')

  const image = octx.createImageData(outW, outH)
  for (let y = 0; y < cropH; y++) {
    for (let x = 0; x < cropW; x++) {
      const strength = ink[(minY + y) * width + (minX + x)] ?? 0
      if (strength <= 0) continue
      const dx = Math.round(x * scale + padding)
      const dy = Math.round(y * scale + padding)
      if (dx < 0 || dy < 0 || dx >= outW || dy >= outH) continue
      const oi = (dy * outW + dx) * 4
      const alpha = clampByte(strength * 255)
      image.data[oi] = 20
      image.data[oi + 1] = 24
      image.data[oi + 2] = 32
      image.data[oi + 3] = alpha
    }
  }
  octx.putImageData(image, 0, 0)

  // 略加粗：小尺寸铺贴时仍有墨量
  thickenInk(out, 1)

  return {
    id: meta.id,
    label: meta.label,
    canvas: out,
    width: outW,
    height: outH,
    previewUrl: out.toDataURL('image/png'),
  }
}

/** 膨胀墨迹一圈，避免细线铺成灰雾 */
export function thickenInk(canvas: HTMLCanvasElement, radius = 1) {
  if (radius < 1) return canvas
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return canvas
  const { width, height } = canvas
  const src = ctx.getImageData(0, 0, width, height)
  const out = ctx.createImageData(width, height)
  const s = src.data
  const d = out.data
  const r = Math.max(1, Math.round(radius))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let maxA = 0
      let br = 20
      let bg = 24
      let bb = 32
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy > r * r) continue
          const nx = x + ox
          const ny = y + oy
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
          const i = (ny * width + nx) * 4
          const a = s[i + 3] ?? 0
          if (a > maxA) {
            maxA = a
            br = s[i] ?? 20
            bg = s[i + 1] ?? 24
            bb = s[i + 2] ?? 32
          }
        }
      }
      const oi = (y * width + x) * 4
      if (maxA > 0) {
        d[oi] = br
        d[oi + 1] = bg
        d[oi + 2] = bb
        d[oi + 3] = maxA
      }
    }
  }
  ctx.putImageData(out, 0, 0)
  return canvas
}

/** 粗测墨量与长宽比，供多写法选章 */
export function measureStampTraits(canvas: HTMLCanvasElement): {
  inkRatio: number
  aspect: number
} {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return {
      inkRatio: 0.2,
      aspect: canvas.width / Math.max(1, canvas.height),
    }
  }
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let ink = 0
  const total = width * height
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i] ?? 0
    if (a > 24) ink += a / 255
  }
  return {
    inkRatio: total > 0 ? Math.min(0.8, ink / total) : 0.2,
    aspect: width / Math.max(1, height),
  }
}

export async function loadImageElement(file: File): Promise<{
  image: HTMLImageElement
  objectUrl: string
}> {
  const objectUrl = URL.createObjectURL(file)
  const image = new Image()
  image.decoding = 'async'
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error(`无法读取图片：${file.name}`))
    }
    image.src = objectUrl
  })
  // 不在这里 revoke：画像还要用 drawImage 渲染预览
  return { image, objectUrl }
}

export async function stampFromFile(
  file: File,
  options: ExtractStampOptions = {},
): Promise<SignatureStamp> {
  const { image, objectUrl } = await loadImageElement(file)
  try {
    return extractStampFromImage(
      image,
      image.naturalWidth,
      image.naturalHeight,
      options,
      {
        id: `${file.name}-${file.size}-${file.lastModified}`,
        label: file.name,
      },
    )
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/** 用打字名生成示意印章，方便先看布局效果 */
export function createTextStamp(
  text: string,
  options: { id?: string; maxSide?: number } = {},
): SignatureStamp {
  const raw = text.trim() || '名字'
  const fontSize = 72
  const measure = makeCanvas(8, 8)
  const mctx = measure.getContext('2d')
  if (!mctx) throw new Error('无法创建画布')
  mctx.font = `italic 700 ${fontSize}px "Segoe Script", "KaiTi", "STKaiti", cursive`
  const metrics = mctx.measureText(raw)
  const tw = Math.min(480, Math.ceil(metrics.width) + 8)
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.25
  const th = Math.ceil(ascent + descent + 8)
  const pad = 8
  const outW = tw + pad * 2
  const outH = th + pad * 2
  const out = makeCanvas(outW, outH)
  const octx = out.getContext('2d')
  if (!octx) throw new Error('无法创建画布')
  octx.clearRect(0, 0, outW, outH)
  octx.fillStyle = '#141820'
  octx.font = mctx.font
  octx.textBaseline = 'alphabetic'
  // 略描边加粗，小尺寸铺贴时仍有墨量
  octx.lineWidth = Math.max(1.2, fontSize * 0.045)
  octx.strokeStyle = '#141820'
  octx.lineJoin = 'round'
  octx.strokeText(raw, pad, pad + ascent)
  octx.fillText(raw, pad, pad + ascent)

  const maxSide = options.maxSide ?? 160
  const scale = Math.min(1, maxSide / Math.max(outW, outH))
  if (scale < 0.999) {
    const sw = Math.max(1, Math.round(outW * scale))
    const sh = Math.max(1, Math.round(outH * scale))
    const scaled = makeCanvas(sw, sh)
    const sctx = scaled.getContext('2d')
    if (!sctx) throw new Error('无法缩放印章')
    sctx.drawImage(out, 0, 0, sw, sh)
    return {
      id: options.id ?? `text:${raw}`,
      label: raw,
      canvas: scaled,
      width: sw,
      height: sh,
      previewUrl: scaled.toDataURL('image/png'),
    }
  }

  return {
    id: options.id ?? `text:${raw}`,
    label: raw,
    canvas: out,
    width: outW,
    height: outH,
    previewUrl: out.toDataURL('image/png'),
  }
}

/** 从手写板画布抠印章（白底深色笔迹） */
export function stampFromDrawnCanvas(
  canvas: HTMLCanvasElement,
  options: ExtractStampOptions & { label?: string } = {},
): SignatureStamp {
  return extractStampFromImage(
    canvas,
    canvas.width,
    canvas.height,
    {
      threshold: options.threshold ?? 200,
      invert: options.invert ?? false,
      maxSide: options.maxSide ?? 360,
      padding: options.padding,
    },
    {
      id: `draw:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label: options.label ?? '手写签名',
    },
  )
}
