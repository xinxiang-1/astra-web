/**
 * 纯计算排版（无 DOM），可在 Web Worker 中运行。
 */

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
  onEdge?: boolean
  tintLiteral?: boolean
}

export type StampMetricInput = {
  inkRatio: number
  width: number
  height: number
  aspect: number
}

export type LayoutComputeOptions = {
  density?: number
  angleRange?: number
  allowVertical?: boolean
  minSizeRatio?: number
  maxSizeRatio?: number
  fillHighlights?: boolean
  invertDensity?: boolean | null
  seed?: number
  gamma?: number
  lloydIters?: number
  edgeOutline?: boolean
  edgeBoost?: number
  edgeThreshold?: number
  edgeColorMode?: 'auto' | 'custom' | 'ink'
  edgeColor?: { r: number; g: number; b: number }
  stampCount?: number
}

export type LayoutComputeInput = {
  fullPixels: Uint8ClampedArray
  outW: number
  outH: number
  aPixels: Uint8ClampedArray
  aW: number
  aH: number
  aScale: number
  sizeMin: number
  sizeMax: number
  longSide: number
  stampMetrics: StampMetricInput[]
  options: LayoutComputeOptions
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
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

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
  return sorted[i]!
}

function lumAt(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
) {
  const xi = Math.max(0, Math.min(w - 1, x | 0))
  const yi = Math.max(0, Math.min(h - 1, y | 0))
  const i = (yi * w + xi) * 4
  const a = pixels[i + 3] ?? 0
  if (a < 8) return -1
  return (
    (0.299 * (pixels[i] ?? 0) +
      0.587 * (pixels[i + 1] ?? 0) +
      0.114 * (pixels[i + 2] ?? 0)) /
    255
  )
}

export function autoInvertDensity(
  pixels: Uint8ClampedArray,
  outW: number,
  outH: number,
): boolean {
  const cx0 = Math.floor(outW * 0.28)
  const cx1 = Math.floor(outW * 0.72)
  const cy0 = Math.floor(outH * 0.18)
  const cy1 = Math.floor(outH * 0.8)
  let center = 0
  let cn = 0
  let border = 0
  let bn = 0
  const step = 3
  for (let y = 0; y < outH; y += step) {
    for (let x = 0; x < outW; x += step) {
      const i = (y * outW + x) * 4
      if ((pixels[i + 3] ?? 0) < 10) continue
      const lum =
        (0.299 * (pixels[i] ?? 0) +
          0.587 * (pixels[i + 1] ?? 0) +
          0.114 * (pixels[i + 2] ?? 0)) /
        255
      if (x >= cx0 && x < cx1 && y >= cy0 && y < cy1) {
        center += lum
        cn++
      } else {
        border += lum
        bn++
      }
    }
  }
  if (cn < 20 || bn < 20) return false
  return center / cn - border / bn > 0.08
}

function buildDensityField(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  invert: boolean,
  gamma: number,
  fillHighlights: boolean,
  edgeBoost = 0,
) {
  const tone = new Float32Array(w * h)
  const vals: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const L = lumAt(pixels, w, h, x, y)
      // invert=true：亮处密（浅色主体）；false：暗处密
      const t = L < 0 ? 0 : invert ? L : 1 - L
      tone[y * w + x] = t
      if (t > 0.02) vals.push(t)
    }
  }
  vals.sort((a, b) => a - b)
  const lo = percentile(vals, 0.05)
  const hi = percentile(vals, 0.96)
  const span = Math.max(0.12, hi - lo)
  for (let i = 0; i < tone.length; i++) {
    let t = clamp01(((tone[i] ?? 0) - lo) / span)
    t = Math.pow(t, gamma)
    if (!fillHighlights && t < 0.03) t = 0
    tone[i] = t
  }

  const edge = new Float32Array(w * h)
  const angle = new Float32Array(w * h)
  let maxE = 1e-6
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx =
        -tone[i - w - 1]! +
        tone[i - w + 1]! -
        2 * tone[i - 1]! +
        2 * tone[i + 1]! -
        tone[i + w - 1]! +
        tone[i + w + 1]!
      const gy =
        -tone[i - w - 1]! -
        2 * tone[i - w]! -
        tone[i - w + 1]! +
        tone[i + w - 1]! +
        2 * tone[i + w]! +
        tone[i + w + 1]!
      const e = Math.hypot(gx, gy)
      edge[i] = e
      angle[i] = Math.atan2(gy, gx) + Math.PI / 2
      if (e > maxE) maxE = e
    }
  }
  for (let i = 0; i < edge.length; i++) edge[i] = (edge[i] ?? 0) / maxE

  const boost = Math.max(0, edgeBoost)
  const density = new Float32Array(w * h)
  const cdf = new Float32Array(w * h)
  let total = 0
  let maxD = 1e-6
  for (let i = 0; i < density.length; i++) {
    const d = (tone[i] ?? 0) + boost * (edge[i] ?? 0)
    density[i] = d
    if (d > maxD) maxD = d
  }
  for (let i = 0; i < density.length; i++) {
    density[i] = (density[i] ?? 0) / maxD
    total += density[i]!
    cdf[i] = total
  }
  return { density, tone, edge, angle, cdf, total }
}

function sampleFromCdf(
  cdf: Float32Array,
  total: number,
  w: number,
  h: number,
  rand: () => number,
) {
  if (total <= 0) return null
  const target = rand() * total
  let lo = 0
  let hi = cdf.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((cdf[mid] ?? 0) < target) lo = mid + 1
    else hi = mid
  }
  const y = Math.floor(lo / w)
  const x = lo - y * w
  if (y < 0 || y >= h || x < 0 || x >= w) return null
  return { x: x + rand(), y: y + rand() }
}

function lloydRelax(
  points: { x: number; y: number }[],
  density: Float32Array,
  w: number,
  h: number,
  iters: number,
  rand: () => number,
  onStep?: (i: number, n: number) => void,
) {
  const n = points.length
  if (n === 0) return
  const area = w * h
  const baseR = Math.max(2.5, Math.sqrt(area / n) * 1.55)

  for (let iter = 0; iter < iters; iter++) {
    onStep?.(iter, iters)
    const cell = Math.max(4, Math.round(baseR * 0.9))
    const gw = Math.ceil(w / cell)
    const gh = Math.ceil(h / cell)
    const buckets: number[][] = Array.from({ length: gw * gh }, () => [])
    for (let i = 0; i < n; i++) {
      const p = points[i]!
      const bx = Math.min(gw - 1, Math.max(0, Math.floor(p.x / cell)))
      const by = Math.min(gh - 1, Math.max(0, Math.floor(p.y / cell)))
      buckets[by * gw + bx]!.push(i)
    }

    const next = points.map((p) => ({ x: p.x, y: p.y }))
    for (let i = 0; i < n; i++) {
      const p = points[i]!
      const ix = Math.max(0, Math.min(w - 1, p.x | 0))
      const iy = Math.max(0, Math.min(h - 1, p.y | 0))
      const localD = density[iy * w + ix] ?? 0.1
      const R = baseR * (0.55 + (1 - localD) * 0.9)
      let sx = 0
      let sy = 0
      let sw = 0
      const step = Math.max(1, Math.floor(R / 7))
      const x0 = Math.max(0, Math.floor(p.x - R))
      const x1 = Math.min(w - 1, Math.ceil(p.x + R))
      const y0 = Math.max(0, Math.floor(p.y - R))
      const y1 = Math.min(h - 1, Math.ceil(p.y + R))
      const R2 = R * R
      for (let y = y0; y <= y1; y += step) {
        for (let x = x0; x <= x1; x += step) {
          const dx = x + 0.5 - p.x
          const dy = y + 0.5 - p.y
          if (dx * dx + dy * dy > R2) continue
          const bx = Math.min(gw - 1, Math.max(0, Math.floor(x / cell)))
          const by = Math.min(gh - 1, Math.max(0, Math.floor(y / cell)))
          let nearest = i
          let best = dx * dx + dy * dy
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const nx = bx + ox
              const ny = by + oy
              if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
              const bucket = buckets[ny * gw + nx]!
              for (const j of bucket) {
                if (j === i) continue
                const q = points[j]!
                const ddx = x + 0.5 - q.x
                const ddy = y + 0.5 - q.y
                const dd = ddx * ddx + ddy * ddy
                if (dd < best) {
                  best = dd
                  nearest = j
                }
              }
            }
          }
          if (nearest !== i) continue
          const rho = density[y * w + x] ?? 0
          if (rho <= 0) continue
          sx += (x + 0.5) * rho
          sy += (y + 0.5) * rho
          sw += rho
        }
      }
      if (sw > 1e-6) {
        const cx = sx / sw
        const cy = sy / sw
        next[i] = { x: p.x * 0.25 + cx * 0.75, y: p.y * 0.25 + cy * 0.75 }
      } else {
        next[i] = {
          x: p.x + (rand() - 0.5) * 2,
          y: p.y + (rand() - 0.5) * 2,
        }
      }
    }
    for (let i = 0; i < n; i++) {
      points[i]!.x = Math.max(1, Math.min(w - 2, next[i]!.x))
      points[i]!.y = Math.max(1, Math.min(h - 2, next[i]!.y))
    }
  }
}

function nearestDistances(
  points: { x: number; y: number }[],
  cellHint: number,
): Float32Array {
  const n = points.length
  const dist = new Float32Array(n)
  dist.fill(1e9)
  if (n === 0) return dist
  const cell = Math.max(4, Math.round(cellHint))
  let maxX = 0
  let maxY = 0
  for (const p of points) {
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  const gw = Math.ceil(maxX / cell) + 2
  const gh = Math.ceil(maxY / cell) + 2
  const buckets: number[][] = Array.from({ length: gw * gh }, () => [])
  for (let i = 0; i < n; i++) {
    const p = points[i]!
    const bx = Math.min(gw - 1, Math.max(0, Math.floor(p.x / cell)))
    const by = Math.min(gh - 1, Math.max(0, Math.floor(p.y / cell)))
    buckets[by * gw + bx]!.push(i)
  }
  for (let i = 0; i < n; i++) {
    const p = points[i]!
    const bx = Math.min(gw - 1, Math.max(0, Math.floor(p.x / cell)))
    const by = Math.min(gh - 1, Math.max(0, Math.floor(p.y / cell)))
    let best = 1e9
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        const nx = bx + ox
        const ny = by + oy
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
        for (const j of buckets[ny * gw + nx]!) {
          if (j === i) continue
          const q = points[j]!
          const d = Math.hypot(p.x - q.x, p.y - q.y)
          if (d < best) best = d
        }
      }
    }
    dist[i] = best
  }
  return dist
}

function sampleRegion(
  pixels: Uint8ClampedArray,
  w: number,
  h: number,
  cx: number,
  cy: number,
  radius: number,
) {
  const r = Math.max(2, radius)
  let sr = 0
  let sg = 0
  let sb = 0
  let n = 0
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(w - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(h - 1, Math.ceil(cy + r))
  const step = Math.max(1, Math.floor(r / 4))
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const i = (y * w + x) * 4
      if ((pixels[i + 3] ?? 0) < 12) continue
      sr += pixels[i] ?? 0
      sg += pixels[i + 1] ?? 0
      sb += pixels[i + 2] ?? 0
      n++
    }
  }
  if (n < 1) return null
  return { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) }
}

function pickStamp(metrics: StampMetricInput[], rand: () => number): number {
  if (metrics.length <= 1) return 0
  let best = 0
  let bestScore = -Infinity
  const probes = Math.min(metrics.length, 20)
  for (let k = 0; k < probes; k++) {
    const i = Math.floor(rand() * metrics.length)
    const m = metrics[i]!
    const score = 1 - m.inkRatio * 2.2 + rand() * 0.4
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

/**
 * 在已有像素缓冲上完成采样 → Lloyd → placements。
 * onProgress 为同步回调（Worker 里直接 postMessage）。
 */
export function computePlacementsFromPixels(
  input: LayoutComputeInput,
  onProgress?: (stage: string, ratio: number) => void,
  isCancelled?: () => boolean,
): Placement[] {
  const {
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
    options,
  } = input

  const report = (stage: string, ratio: number) => {
    if (isCancelled?.()) throw new Error('已取消')
    onProgress?.(stage, clamp01(ratio))
  }

  const densityMul = Math.min(50, Math.max(0.7, options.density ?? 30))
  const angleRange = options.angleRange ?? 12
  const allowVertical = options.allowVertical ?? false
  const fillHighlights = options.fillHighlights ?? false
  const gamma = options.gamma ?? 1.15
  const rand = mulberry32(options.seed ?? 42)
  const edgeOutline = options.edgeOutline ?? false
  const edgeBoost = edgeOutline
    ? Math.min(2.2, Math.max(0, options.edgeBoost ?? 0.95))
    : 0
  const edgeThreshold = Math.min(
    0.95,
    Math.max(0.08, options.edgeThreshold ?? 0.32),
  )
  const edgeColorMode = options.edgeColorMode ?? 'auto'
  const edgeColor = options.edgeColor ?? { r: 28, g: 72, b: 96 }
  const refSide = 2048
  const lloydIters =
    options.lloydIters ?? (longSide >= 6000 ? 9 : longSide >= 3500 ? 11 : 14)

  const invertDensity =
    options.invertDensity ?? autoInvertDensity(fullPixels, outW, outH)

  report('构建密度场', 0.08)
  const { density, tone, edge, angle, cdf, total } = buildDensityField(
    aPixels,
    aW,
    aH,
    invertDensity,
    gamma,
    fillHighlights,
    edgeBoost,
  )

  const meanD = total / Math.max(1, aW * aH)
  const areaBoost = Math.pow(longSide / refSide, 1.55)
  const edgePointBoost = edgeOutline ? 1.12 : 1
  const stampCount = options.stampCount ?? stampMetrics.length
  const targetN = Math.min(
    220000,
    Math.max(
      2000,
      Math.round(
        aW *
          aH *
          meanD *
          0.1 *
          densityMul *
          areaBoost *
          edgePointBoost *
          (0.7 + stampCount * 0.001),
      ),
    ),
  )

  report('密度采样', 0.15)
  const points: { x: number; y: number }[] = []
  const maxTries = targetN * 40
  let tries = 0
  while (points.length < targetN && tries < maxTries) {
    tries++
    if (tries % 4000 === 0) {
      report('密度采样', 0.15 + (0.12 * points.length) / targetN)
    }
    if (rand() < 0.72) {
      const s = sampleFromCdf(cdf, total, aW, aH, rand)
      if (!s) continue
      const ix = Math.max(0, Math.min(aW - 1, s.x | 0))
      const iy = Math.max(0, Math.min(aH - 1, s.y | 0))
      if ((density[iy * aW + ix] ?? 0) < 0.05) continue
      points.push(s)
    } else {
      const x = rand() * aW
      const y = rand() * aH
      const ix = Math.max(0, Math.min(aW - 1, x | 0))
      const iy = Math.max(0, Math.min(aH - 1, y | 0))
      const d = density[iy * aW + ix] ?? 0
      if (rand() > d) continue
      points.push({ x, y })
    }
  }

  report('Lloyd 松弛', 0.28)
  lloydRelax(points, density, aW, aH, lloydIters, rand, (i, n) => {
    report('Lloyd 松弛', 0.28 + (0.35 * i) / Math.max(1, n))
  })

  report('测量近邻', 0.66)
  const spacing = Math.sqrt((aW * aH) / Math.max(1, points.length))
  const nn = nearestDistances(points, spacing)

  report('生成排版', 0.7)
  const scaleBack = 1 / aScale
  const placements: Placement[] = []

  for (let i = 0; i < points.length; i++) {
    if (i % 2000 === 0) {
      report('生成排版', 0.7 + (0.2 * i) / Math.max(1, points.length))
    }
    const p = points[i]!
    const ax = Math.max(0, Math.min(aW - 1, p.x | 0))
    const ay = Math.max(0, Math.min(aH - 1, p.y | 0))
    const t = tone[ay * aW + ax] ?? 0
    const e = edge[ay * aW + ax] ?? 0
    const onEdge = edgeOutline && e >= edgeThreshold
    if (!onEdge && t < 0.02) continue
    if (onEdge && t < 0.02 && e < edgeThreshold) continue

    const ox = p.x * scaleBack
    const oy = p.y * scaleBack
    const nnOut = (nn[i] ?? spacing) * scaleBack
    let targetSize = nnOut * (1.05 + t * 0.25)
    if (onEdge) targetSize *= 0.62 + (1 - Math.min(1, e)) * 0.12
    targetSize = Math.max(
      sizeMin * (onEdge ? 0.85 : 1),
      Math.min(sizeMax, targetSize),
    )

    let ang = angle[ay * aW + ax] ?? 0
    if (onEdge) {
      ang += (((rand() * 2 - 1) * angleRange * Math.PI) / 180) * 0.28
    } else {
      ang += ((rand() * 2 - 1) * angleRange * Math.PI) / 180
      if (allowVertical && e < 0.2 && rand() > 0.75) {
        ang += (rand() > 0.5 ? 1 : -1) * (Math.PI / 2)
      }
    }

    const col = sampleRegion(fullPixels, outW, outH, ox, oy, targetSize * 0.45)
    let tint = col ?? { r: 40, g: 36, b: 44 }
    if (onEdge) {
      if (edgeColorMode === 'custom') tint = { ...edgeColor }
      else if (edgeColorMode === 'ink') tint = { r: 22, g: 20, b: 26 }
      else {
        tint = {
          r: Math.round(tint.r * 0.28 + 12),
          g: Math.round(tint.g * 0.28 + 14),
          b: Math.round(tint.b * 0.32 + 22),
        }
      }
    }

    placements.push({
      x: ox,
      y: oy,
      angle: ang,
      targetSize,
      stampIndex: pickStamp(stampMetrics, rand),
      strength: clamp01(onEdge ? 0.72 + e * 0.28 : 0.38 + t * 0.45),
      tint,
      blend: onEdge || t > 0.35 ? 'ink' : 'soft',
      depth: clamp01(onEdge ? 0.75 + e * 0.2 : 0.3 + t * 0.5),
      onEdge,
      tintLiteral:
        onEdge && (edgeColorMode === 'custom' || edgeColorMode === 'ink'),
    })
  }

  report('排版完成', 0.92)
  return placements
}
