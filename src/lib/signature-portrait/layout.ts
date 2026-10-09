/**
 * 签名画像：默认按实测笔迹区域错行织排，控制重叠并表达局部明暗。
 * 旧 WVS / Lloyd 算法通过 layoutMethod='stipple' 保留作对照。
 */

import type { SignatureStamp } from './extract'
import { measureStampTraits } from './extract'
import { autoInvertDensity } from './layout-compute'
import { createTintedStampCache } from './raster-cache'
import { prepareSignatureInk, type SignatureInkStyle } from './ink-style'
import { createVectorInkPainterSteps } from './vector-ink'
import { paintSignatureCover } from './cover-ink'
import type { SignatureWashRecipe } from './wash-style'

export type SignatureLayoutOptions = SignatureWashRecipe & {
  inkStyle?: SignatureInkStyle
  layoutMethod?: 'woven' | 'stipple'
  ink?: { r: number; g: number; b: number }
  maxSide?: number
  density?: number
  angleRange?: number
  orientationMode?: 'classic' | 'flow'
  orientationStrength?: number
  allowVertical?: boolean
  minSizeRatio?: number
  maxSizeRatio?: number
  fillHighlights?: boolean
  invertDensity?: boolean
  colorize?: boolean
  /** 原墨色保持兼容；source 把采样RGB直接用作彩墨，不再额外压暗。 */
  colorMode?: 'ink' | 'source'
  /** UI choice retained in project files; auto keeps historical colour settings. */
  inkColorMode?: 'auto' | 'custom' | 'source'
  /** 1保持旧作品；0.2–3平滑调整笔迹墨量，不改变几何。 */
  toneGain?: number
  /** 印章下垫软色椭圆（Canvas / Path SVG；GPU 候选另行验证） */
  coverFill?: boolean
  background?: string
  /** Explicit mixed-media colour wash (0–.85); zero keeps pure signature artwork. */
  underlay?: number
  seed?: number
  overlap?: number
  gamma?: number
  lloydIters?: number
  /** 边缘勾勒：密度叠边缘，边缘章更细更实 */
  edgeOutline?: boolean
  /** 边缘写入密度的强度，默认 0.9 */
  edgeBoost?: number
  /** 视为边缘的阈值下限 0–1，默认 0.32 */
  edgeThreshold?: number
  /** 边缘章颜色：auto 跟画像加深 / custom 自定义 / ink 纯墨 */
  edgeColorMode?: 'auto' | 'custom' | 'ink'
  edgeColor?: { r: number; g: number; b: number }
  /** 只算排版坐标（矢量数据），不栅格化整图 */
  skipPaint?: boolean
  onProgress?: (stage: string, ratio: number) => void
}

export type Placement = {
  x: number
  y: number
  angle: number
  targetSize: number
  stampIndex: number
  strength: number
  tint: { r: number; g: number; b: number }
  blend: 'soft' | 'ink'
  depth: number
  /** 落在强边缘上（勾勒用） */
  onEdge?: boolean
  /** 为 true 时 tint 直接当墨色，不再做 colorize 加深变换 */
  tintLiteral?: boolean
}

type StampMetrics = {
  canvas: HTMLCanvasElement
  width: number
  height: number
  inkRatio: number
  aspect: number
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  return canvas
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function prepareStamp(
  stamp: SignatureStamp,
  maxLong = 512,
  inkStyle: SignatureInkStyle = 'ink',
  stableRaster = false,
): StampMetrics {
  const src = prepareSignatureInk(stamp.canvas, inkStyle)
  const long = Math.max(src.width, src.height)
  let canvas = src
  if (long > maxLong) {
    const s = maxLong / long
    const w = Math.max(1, Math.round(src.width * s))
    const h = Math.max(1, Math.round(src.height * s))
    canvas = makeCanvas(w, h)
    const ctx = canvas.getContext('2d', { willReadFrequently: stableRaster })
    if (ctx) {
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(src, 0, 0, w, h)
    }
  }
  const traits = measureStampTraits(canvas)
  if (src !== stamp.canvas && src !== canvas) src.width = src.height = 1
  return {
    canvas,
    width: canvas.width,
    height: canvas.height,
    inkRatio: Math.max(0.04, Math.min(0.4, traits.inkRatio)),
    aspect: traits.aspect,
  }
}

export async function renderSignaturePortrait(
  portrait: CanvasImageSource,
  portraitWidth: number,
  portraitHeight: number,
  stamps: SignatureStamp[],
  options: SignatureLayoutOptions = {},
  signal?: { cancelled?: boolean },
): Promise<{
  canvas: HTMLCanvasElement
  placements: Placement[]
  width: number
  height: number
}> {
  if (stamps.length === 0) throw new Error('请先添加至少一枚签名印章')

  let lastReport = 0
  const report = (stage: string, ratio: number) => {
    const t = performance.now()
    if (ratio < 1 && t - lastReport < 40) return
    lastReport = t
    options.onProgress?.(stage, clamp01(ratio))
  }

  if (
    ![portraitWidth, portraitHeight, options.maxSide ?? 4096].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    throw new Error('布局尺寸无效')
  const maxSide = Math.min(8192, Math.max(128, options.maxSide ?? 4096))
  const layoutMethod = options.layoutMethod ?? 'woven'
  const densityMul = Math.min(50, Math.max(0.7, options.density ?? 30))
  const angleRange = options.angleRange ?? 12
  const allowVertical = options.allowVertical ?? false
  const minSizeRatio = options.minSizeRatio ?? 0.022
  const maxSizeRatio = options.maxSizeRatio ?? 0.065
  const fillHighlights = options.fillHighlights ?? false
  const colorize = options.colorize ?? true
  const background = options.background ?? '#f5f0e8'
  const gamma = options.gamma ?? 1.15
  const edgeOutline = options.edgeOutline ?? false
  const edgeBoost = edgeOutline ? Math.min(2.2, Math.max(0, options.edgeBoost ?? 0.95)) : 0
  const edgeThreshold = Math.min(0.95, Math.max(0.08, options.edgeThreshold ?? 0.32))
  const edgeColorMode = options.edgeColorMode ?? 'auto'
  const edgeColor = options.edgeColor ?? { r: 28, g: 72, b: 96 }

  report('缩放画像', 0.02)
  const scaleFit = maxSide / Math.max(1, portraitWidth, portraitHeight)
  const outW = Math.max(1, Math.round(portraitWidth * scaleFit))
  const outH = Math.max(1, Math.round(portraitHeight * scaleFit))
  const shortSide = Math.min(outW, outH)
  const longSide = Math.max(outW, outH)
  const lloydIters = options.lloydIters ?? (longSide >= 6000 ? 9 : longSide >= 3500 ? 11 : 14)

  /**
   * 关键：若字号只按 shortSide 百分比，2K/8K 在相同窗口里纹理会几乎一样。
   * 高分辨率把相对字号压小，并靠更多点数填满 → 放大时才能看出更细。
   * ref=2048 时与原先一致；8192 时相对字号约 ×0.4。
   */
  const refSide = 2048
  const fineScale = Math.pow(refSide / Math.max(refSide, shortSide), 0.7)
  const sizeMin = Math.max(12, shortSide * Math.min(minSizeRatio, maxSizeRatio) * fineScale)
  const sizeMax = Math.max(
    sizeMin + 6,
    shortSide * Math.max(minSizeRatio, maxSizeRatio) * fineScale,
  )

  // Woven sampling does not allocate an 8K photograph for a vector preview.
  const samplingScale = layoutMethod === 'woven' ? Math.min(1, 1024 / longSide) : 1
  const full = makeCanvas(outW * samplingScale, outH * samplingScale)
  const fctx = full.getContext('2d', { willReadFrequently: true })
  if (!fctx) throw new Error('无法创建采样画布')
  fctx.imageSmoothingEnabled = true
  fctx.imageSmoothingQuality = 'high'
  fctx.drawImage(portrait, 0, 0, full.width, full.height)
  const fullPixels = fctx.getImageData(0, 0, full.width, full.height).data

  const invertDensity =
    options.invertDensity ??
    (layoutMethod === 'woven' ? false : autoInvertDensity(fullPixels, full.width, full.height))

  // 分析分辨率随成图走
  const analysisMax =
    layoutMethod === 'woven'
      ? Math.min(1024, longSide)
      : Math.min(2800, Math.max(800, Math.round(longSide * 0.36)))
  const aScale = Math.min(1, analysisMax / longSide)
  const aW = Math.max(1, Math.round(outW * aScale))
  const aH = Math.max(1, Math.round(outH * aScale))
  const analysis = layoutMethod === 'woven' ? full : makeCanvas(aW, aH)
  const actx = analysis.getContext('2d', { willReadFrequently: true })
  if (!actx) throw new Error('无法创建分析画布')
  if (layoutMethod !== 'woven') actx.drawImage(portrait, 0, 0, aW, aH)
  const aPixels = layoutMethod === 'woven' ? fullPixels : actx.getImageData(0, 0, aW, aH).data

  report('构建密度场', 0.08)
  await yieldFrame()

  const stampSrcLong = Math.min(1200, Math.max(480, Math.round(sizeMax * 4)))
  const metrics: StampMetrics[] = []
  let prepareSliceStart = performance.now()
  for (const stamp of stamps) {
    if (signal?.cancelled) throw new Error('已取消')
    metrics.push(prepareStamp(stamp, stampSrcLong, options.inkStyle))
    if (performance.now() - prepareSliceStart >= 8) {
      await yieldFrame()
      prepareSliceStart = performance.now()
    }
  }
  const stampMetrics = metrics.map((m) => ({
    inkRatio: m.inkRatio,
    width: m.width,
    height: m.height,
    aspect: m.aspect,
  }))

  const computeOpts = {
    layoutMethod,
    inkColor: options.ink,
    sourceColor: colorize && options.colorMode === 'source',
    toneGain: options.toneGain,
    density: densityMul,
    angleRange,
    orientationMode: options.orientationMode,
    orientationStrength: options.orientationStrength,
    allowVertical,
    minSizeRatio,
    maxSizeRatio,
    fillHighlights,
    invertDensity,
    seed: options.seed ?? 42,
    gamma,
    lloydIters,
    edgeOutline,
    edgeBoost,
    edgeThreshold,
    edgeColorMode,
    edgeColor,
    stampCount: stamps.length,
  }

  let placements: Placement[]
  try {
    report('后台排版', 0.1)
    const { runLayoutInWorker } = await import('./layout-worker-client')
    placements = await runLayoutInWorker({
      fullPixels,
      outW,
      outH,
      aPixels,
      aW,
      aH,
      aScale,
      sizeMin,
      sizeMax,
      longSide,
      stampMetrics,
      options: computeOpts,
      onProgress: (stage, ratio) => report(stage, ratio),
      signal,
    })
  } catch (e) {
    if (e instanceof Error && e.message === '已取消') throw e
    // Worker 不可用时回退主线程（仍会卡，但保证功能）
    report('本地排版', 0.1)
    const { computePlacementsFromPixels } = await import('./layout-compute')
    placements = computePlacementsFromPixels(
      {
        fullPixels,
        outW,
        outH,
        aPixels,
        aW,
        aH,
        aScale,
        sizeMin,
        sizeMax,
        longSide,
        stampMetrics,
        options: computeOpts,
      },
      (stage, ratio) => report(stage, ratio),
      () => Boolean(signal?.cancelled),
    )
  }

  report('排版完成', 0.92)
  await yieldFrame()

  if (options.skipPaint) {
    const stub = makeCanvas(8, 8)
    const sctx = stub.getContext('2d')
    if (sctx) {
      sctx.fillStyle = background
      sctx.fillRect(0, 0, 8, 8)
    }
    report('完成', 1)
    return { canvas: stub, placements, width: outW, height: outH }
  }

  report('渲染', 0.93)
  const canvas = paintPlacements(placements, stamps, outW, outH, {
    inkStyle: options.inkStyle,
    background,
    colorize,
    coverFill: options.coverFill ?? false,
    portrait,
    underlay: Math.max(0, Math.min(1, options.underlay ?? 0)),
    onProgress: (r) => report('渲染', 0.93 + 0.06 * r),
    signal,
  })

  report('完成', 1)
  return { canvas, placements, width: outW, height: outH }
}

/**
 * 按排版用印章「源图」重绘到指定分辨率。
 * 放大预览时调用，避免把已栅格化的小字再拉伸变糊。
 */
function* paintPlacementSteps(
  placements: Placement[],
  stamps: SignatureStamp[],
  outW: number,
  outH: number,
  options: {
    inkStyle?: SignatureInkStyle
    background?: string
    colorize?: boolean
    /** 印章下垫软色块，补稀疏笔迹空洞 */
    coverFill?: boolean
    portrait?: CanvasImageSource | null
    underlay?: number
    /** 印章源最长边，放大预览用更大以保证清晰 */
    stampMaxLong?: number
    onProgress?: (ratio: number) => void
    signal?: { cancelled?: boolean }
  } = {},
): Generator<void, HTMLCanvasElement> {
  const background = options.background ?? '#f5f0e8'
  const colorize = options.colorize ?? true
  const coverFill = options.coverFill ?? false
  const underlay = options.underlay ?? 0
  const vectorPainter =
    options.inkStyle === 'cutout' ? yield* createVectorInkPainterSteps(stamps) : null
  const metrics: StampMetrics[] = []
  for (const stamp of stamps) {
    if (options.signal?.cancelled) throw new Error('已取消')
    metrics.push(
      prepareStamp(
        stamp,
        options.stampMaxLong ?? Math.max(640, Math.round(Math.max(outW, outH) * 0.35)),
        options.inkStyle,
      ),
    )
    yield
  }

  const canvas = makeCanvas(outW, outH)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建输出画布')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, outW, outH)

  if (options.portrait && underlay > 0) {
    ctx.globalAlpha = underlay
    ctx.drawImage(options.portrait, 0, 0, outW, outH)
    ctx.globalAlpha = 1
  }

  const tintCache = createTintedStampCache(
    metrics.map((metric) => metric.canvas),
    colorize,
  )

  const drawOrder = [...placements].sort((a, b) => b.targetSize - a.targetSize || a.depth - b.depth)

  try {
    for (let i = 0; i < drawOrder.length; i++) {
      if (options.signal?.cancelled) throw new Error('已取消')
      if (i > 0 && i % 400 === 0) options.onProgress?.(i / Math.max(1, drawOrder.length))
      const p = drawOrder[i]!
      if (vectorPainter) {
        const metric = metrics[p.stampIndex]!
        if (coverFill)
          paintSignatureCover(
            ctx,
            p,
            metric.width,
            metric.height,
            p.targetSize / Math.max(metric.width, metric.height),
          )
        vectorPainter(ctx, p, colorize)
        yield
        continue
      }
      const glyph = tintCache.get(
        p.stampIndex,
        p.tint.r,
        p.tint.g,
        p.tint.b,
        p.depth,
        Boolean(p.tintLiteral),
      )
      const stampLong = Math.max(glyph.width, glyph.height)
      const scale = p.targetSize / stampLong

      if (coverFill) paintSignatureCover(ctx, p, glyph.width, glyph.height, scale)

      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.rotate(p.angle)
      ctx.scale(scale, scale)
      // 高质量平滑，保持小笔迹与放大预览。
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.globalAlpha = clamp01(p.strength)
      ctx.globalCompositeOperation = p.blend === 'soft' ? 'source-over' : 'multiply'
      ctx.drawImage(glyph, -glyph.width / 2, -glyph.height / 2)
      ctx.restore()
      yield
    }
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    options.onProgress?.(1)
    return canvas
  } finally {
    tintCache.clear()
  }
}

export function paintPlacements(
  placements: Placement[],
  stamps: SignatureStamp[],
  outW: number,
  outH: number,
  options: {
    inkStyle?: SignatureInkStyle
    background?: string
    colorize?: boolean
    /** 印章下垫软色块，补稀疏笔迹空洞 */
    coverFill?: boolean
    portrait?: CanvasImageSource | null
    underlay?: number
    /** 印章源最长边，放大预览用更大以保证清晰 */
    stampMaxLong?: number
    onProgress?: (ratio: number) => void
    signal?: { cancelled?: boolean }
  } = {},
): HTMLCanvasElement {
  const steps = paintPlacementSteps(placements, stamps, outW, outH, options)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}

/** Same drawing order and pixels as the synchronous painter; yields during preparation and ink drawing. */
export function paintPlacementsResponsive(
  placements: Placement[],
  stamps: SignatureStamp[],
  outW: number,
  outH: number,
  options: NonNullable<Parameters<typeof paintPlacements>[4]> = {},
) {
  return runResponsiveSteps(
    paintPlacementSteps(placements, stamps, outW, outH, options),
    options.signal,
  )
}

async function runResponsiveSteps<T>(
  steps: Generator<void, T>,
  signal?: { cancelled?: boolean },
): Promise<T> {
  let sliceStart = performance.now()
  try {
    while (true) {
      if (signal?.cancelled) throw new Error('已取消')
      const next = steps.next()
      if (next.done) return next.value
      if (performance.now() - sliceStart >= 8) {
        await yieldFrame()
        sliceStart = performance.now()
      }
    }
  } finally {
    steps.return(undefined as never)
  }
}

/**
 * 分块渐进绘制：完成一块就回调一块，避免一次栅格化卡死页面。
 * placements 坐标基于 layoutW×layoutH，输出缩放到 outW×outH。
 */
export async function paintPlacementsTiled(
  placements: Placement[],
  stamps: SignatureStamp[],
  layoutW: number,
  layoutH: number,
  outW: number,
  outH: number,
  options: {
    inkStyle?: SignatureInkStyle
    background?: string
    colorize?: boolean
    coverFill?: boolean
    portrait?: CanvasImageSource | null
    underlay?: number
    tileSize?: number
    /** Deterministic software overview for transactional project recovery. */
    stableRaster?: boolean
    stampMaxLong?: number
    onTile?: (info: { canvas: HTMLCanvasElement; done: number; total: number }) => void
    signal?: { cancelled?: boolean }
  } = {},
): Promise<HTMLCanvasElement> {
  const sx = outW / Math.max(1, layoutW)
  const sy = outH / Math.max(1, layoutH)
  const sAvg = (sx + sy) * 0.5
  const mapped = placements
    .map((p) => ({
      ...p,
      x: p.x * sx,
      y: p.y * sy,
      targetSize: p.targetSize * sAvg,
    }))
    .sort((a, b) => b.targetSize - a.targetSize || a.depth - b.depth)

  const background = options.background ?? '#f5f0e8'
  const colorize = options.colorize ?? true
  const coverFill = options.coverFill ?? false
  const underlay = options.underlay ?? 0
  const tileSize = Math.max(128, options.tileSize ?? 384)
  const metrics: StampMetrics[] = []
  let sliceStart = performance.now()
  let canvas: HTMLCanvasElement | null = null
  let completed = false
  let tintCache: ReturnType<typeof createTintedStampCache> | null = null
  try {
    for (const stamp of stamps) {
      if (options.signal?.cancelled) throw new Error('已取消')
      metrics.push(
        prepareStamp(
          stamp,
          options.stampMaxLong ??
            Math.min(1000, Math.max(480, Math.round(Math.max(outW, outH) * 0.4))),
          options.inkStyle,
          options.stableRaster,
        ),
      )
      if (performance.now() - sliceStart >= 8) {
        await yieldFrame()
        sliceStart = performance.now()
      }
    }

    canvas = makeCanvas(outW, outH)
    const ctx = canvas.getContext('2d', { willReadFrequently: options.stableRaster ?? false })
    if (!ctx) {
      canvas.width = canvas.height = 1
      throw new Error('无法创建输出画布')
    }
    ctx.fillStyle = background
    ctx.fillRect(0, 0, outW, outH)
    if (options.portrait && underlay > 0) {
      ctx.globalAlpha = underlay
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(options.portrait, 0, 0, outW, outH)
      ctx.globalAlpha = 1
    }
    // 先亮底图，立刻可看
    options.onTile?.({ canvas, done: 0, total: 1 })
    await yieldFrame()

    tintCache = createTintedStampCache(
      metrics.map((metric) => metric.canvas),
      colorize,
      undefined,
      undefined,
      undefined,
      options.stableRaster,
    )

    const tilesX = Math.ceil(outW / tileSize)
    const tilesY = Math.ceil(outH / tileSize)
    const total = tilesX * tilesY
    let done = 0
    const vectorPainter =
      options.inkStyle === 'cutout'
        ? await runResponsiveSteps(createVectorInkPainterSteps(stamps), options.signal)
        : null

    for (let ty = 0; ty < tilesY; ty++) {
      for (let tx = 0; tx < tilesX; tx++) {
        if (options.signal?.cancelled) throw new Error('已取消')
        const x0 = tx * tileSize
        const y0 = ty * tileSize
        const tw = Math.min(tileSize, outW - x0)
        const th = Math.min(tileSize, outH - y0)

        const tile = makeCanvas(tw, th)
        const tctx = tile.getContext('2d', { willReadFrequently: options.stableRaster ?? false })
        if (!tctx) {
          tile.width = tile.height = 1
          throw new Error('无法创建绘图分块')
        }
        try {
          // 透明底，叠到主画布
          tctx.clearRect(0, 0, tw, th)

          for (let i = 0; i < mapped.length; i++) {
            if (i % 32 === 0) {
              if (options.signal?.cancelled) throw new Error('已取消')
              if (performance.now() - sliceStart >= 8) {
                await yieldFrame()
                sliceStart = performance.now()
              }
            }
            const p = mapped[i]!
            // A rotated rectangle fits within sqrt(2)/2 of its longest side.
            // Three pixels also cover the optional minimum-radius ellipse and antialiasing.
            const rad = p.targetSize * 0.75 + 3
            if (p.x + rad < x0 || p.x - rad > x0 + tw || p.y + rad < y0 || p.y - rad > y0 + th) {
              continue
            }
            if (vectorPainter) {
              const metric = metrics[p.stampIndex]!
              const local = { ...p, x: p.x - x0, y: p.y - y0 }
              if (coverFill)
                paintSignatureCover(
                  tctx,
                  local,
                  metric.width,
                  metric.height,
                  p.targetSize / Math.max(metric.width, metric.height),
                )
              vectorPainter(tctx, local, colorize)
              continue
            }
            const glyph = tintCache.get(
              p.stampIndex,
              p.tint.r,
              p.tint.g,
              p.tint.b,
              p.depth,
              Boolean(p.tintLiteral),
            )
            const stampLong = Math.max(glyph.width, glyph.height)
            const scale = p.targetSize / stampLong
            const local = {
              ...p,
              x: p.x - x0,
              y: p.y - y0,
            }
            if (coverFill) paintSignatureCover(tctx, local, glyph.width, glyph.height, scale)
            tctx.save()
            tctx.translate(p.x - x0, p.y - y0)
            tctx.rotate(p.angle)
            tctx.scale(scale, scale)
            tctx.imageSmoothingEnabled = true
            tctx.imageSmoothingQuality = 'high'
            tctx.globalAlpha = clamp01(p.strength)
            tctx.globalCompositeOperation = p.blend === 'soft' ? 'source-over' : 'multiply'
            tctx.drawImage(glyph, -glyph.width / 2, -glyph.height / 2)
            tctx.restore()
          }

          ctx.save()
          ctx.globalCompositeOperation = 'source-over'
          ctx.drawImage(tile, x0, y0)
          ctx.restore()
        } finally {
          tile.width = tile.height = 1
        }

        done++
        options.onTile?.({ canvas, done, total })
        if (done % 2 === 0) await yieldFrame()
      }
    }

    completed = true
    return canvas
  } finally {
    tintCache?.clear()
    if (!completed && canvas) canvas.width = canvas.height = 1
    for (let i = 0; i < metrics.length; i++) {
      const source = metrics[i]!.canvas
      if (source !== stamps[i]!.canvas) source.width = source.height = 1
    }
  }
}

/** 把布局坐标映射到新画布尺寸后重绘（高清导出用） */
export function paintPlacementsScaled(
  placements: Placement[],
  stamps: SignatureStamp[],
  layoutW: number,
  layoutH: number,
  outW: number,
  outH: number,
  options: {
    inkStyle?: SignatureInkStyle
    background?: string
    colorize?: boolean
    coverFill?: boolean
    portrait?: CanvasImageSource | null
    underlay?: number
    stampMaxLong?: number
  } = {},
): HTMLCanvasElement {
  const sx = outW / Math.max(1, layoutW)
  const sy = outH / Math.max(1, layoutH)
  const s = (sx + sy) * 0.5
  const mapped = placements.map((p) => ({
    ...p,
    x: p.x * sx,
    y: p.y * sy,
    targetSize: p.targetSize * s,
  }))
  return paintPlacements(mapped, stamps, outW, outH, {
    ...options,
    stampMaxLong:
      options.stampMaxLong ?? Math.min(1200, Math.max(640, Math.round(Math.max(outW, outH) * 0.4))),
  })
}

/**
 * 只绘制布局坐标系中某一矩形区域 → 输出像素画布。
 * 用于超大预览：只重绘可视窗口，不扛整张超大图。
 */
function preparePlacementRegion(
  placements: Placement[],
  stamps: SignatureStamp[],
  region: { x: number; y: number; w: number; h: number },
  outW: number,
  outH: number,
  options: {
    inkStyle?: SignatureInkStyle
    background?: string
    colorize?: boolean
    coverFill?: boolean
    portrait?: CanvasImageSource | null
    layoutW?: number
    layoutH?: number
    underlay?: number
    stampMaxLong?: number
  } = {},
) {
  const rw = Math.max(1e-3, region.w)
  const rh = Math.max(1e-3, region.h)
  const sx = outW / rw
  const sy = outH / rh
  const sAvg = (sx + sy) * 0.5
  const pad = 80

  const mapped: Placement[] = []
  for (const p of placements) {
    const rad = p.targetSize * 0.7
    if (
      p.x + rad < region.x - pad ||
      p.x - rad > region.x + region.w + pad ||
      p.y + rad < region.y - pad ||
      p.y - rad > region.y + region.h + pad
    ) {
      continue
    }
    mapped.push({
      ...p,
      x: (p.x - region.x) * sx,
      y: (p.y - region.y) * sy,
      targetSize: p.targetSize * sAvg,
    })
  }

  let portraitCrop: CanvasImageSource | null | undefined = options.portrait
  // 底图裁切到 region
  if (options.portrait && (options.underlay ?? 0) > 0) {
    const lw = Math.max(1, options.layoutW ?? region.x + region.w)
    const lh = Math.max(1, options.layoutH ?? region.y + region.h)
    const src = options.portrait
    const sw =
      'naturalWidth' in src && (src as HTMLImageElement).naturalWidth
        ? (src as HTMLImageElement).naturalWidth
        : (src as HTMLCanvasElement).width || lw
    const sh =
      'naturalHeight' in src && (src as HTMLImageElement).naturalHeight
        ? (src as HTMLImageElement).naturalHeight
        : (src as HTMLCanvasElement).height || lh
    const tmp = makeCanvas(outW, outH)
    const tctx = tmp.getContext('2d')
    if (tctx) {
      tctx.drawImage(
        src,
        (region.x / lw) * sw,
        (region.y / lh) * sh,
        (region.w / lw) * sw,
        (region.h / lh) * sh,
        0,
        0,
        outW,
        outH,
      )
      portraitCrop = tmp
    }
  }

  return {
    mapped,
    options: {
      ...options,
      inkStyle: options.inkStyle,
      background: options.background,
      colorize: options.colorize,
      coverFill: options.coverFill,
      portrait: portraitCrop,
      underlay: options.underlay,
      stampMaxLong:
        options.stampMaxLong ??
        Math.min(1400, Math.max(720, Math.round(Math.max(outW, outH) * 0.55))),
    },
  }
}

export function paintPlacementsRegion(
  placements: Placement[],
  stamps: SignatureStamp[],
  region: { x: number; y: number; w: number; h: number },
  outW: number,
  outH: number,
  options: {
    inkStyle?: SignatureInkStyle
    background?: string
    colorize?: boolean
    coverFill?: boolean
    portrait?: CanvasImageSource | null
    layoutW?: number
    layoutH?: number
    underlay?: number
    stampMaxLong?: number
  } = {},
): HTMLCanvasElement {
  const prepared = preparePlacementRegion(placements, stamps, region, outW, outH, options)
  return paintPlacements(prepared.mapped, stamps, outW, outH, prepared.options)
}

export function paintPlacementsRegionResponsive(
  placements: Placement[],
  stamps: SignatureStamp[],
  region: { x: number; y: number; w: number; h: number },
  outW: number,
  outH: number,
  options: NonNullable<Parameters<typeof paintPlacementsRegion>[5]> & {
    signal?: { cancelled?: boolean }
    onProgress?: (ratio: number) => void
  } = {},
) {
  const prepared = preparePlacementRegion(placements, stamps, region, outW, outH, options)
  return paintPlacementsResponsive(prepared.mapped, stamps, outW, outH, {
    ...prepared.options,
    signal: options.signal,
    onProgress: options.onProgress,
  })
}

export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('导出 PNG 失败'))),
      'image/png',
    )
  })
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
