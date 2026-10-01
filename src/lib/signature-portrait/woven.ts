import type { LayoutComputeInput, Placement } from './layout-compute'

/** Measured signature footprints in staggered rows; opacity carries the image. */
export function computeWovenPlacements(input: LayoutComputeInput, report: (stage: string, ratio: number) => void): Placement[] {
  const { aPixels, aW: width, aH: height, aScale, stampMetrics, options } = input
  if (!stampMetrics.length) return []
  const clamp = (value: number) => Math.max(0, Math.min(1, value))
  let state = options.seed ?? 42
  const random = () => { state |= 0; state = state + 0x6d2b79f5 | 0; let t = Math.imul(state ^ state >>> 15, 1 | state); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296 }
  const stride = width + 1
  const sums = Array.from({ length: 6 }, () => new Float64Array((width + 1) * (height + 1)))
  const invert = options.invertDensity ?? false
  report('分析签名织排', .1)
  for (let y = 0; y < height; y++) {
    const row = [0, 0, 0, 0, 0, 0]
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4, opacity = aPixels[index + 3]! / 255
      const r = aPixels[index]!, g = aPixels[index + 1]!, b = aPixels[index + 2]!
      const light = (r * .2126 + g * .7152 + b * .0722) / 255
      const tone = Math.pow(invert ? light : 1 - light, options.gamma ?? 1.15) * opacity
      const values = [tone, tone * tone, opacity, r * opacity, g * opacity, b * opacity]
      for (let channel = 0; channel < sums.length; channel++) {
        row[channel]! += values[channel]!
        sums[channel]![(y + 1) * stride + x + 1] = sums[channel]![y * stride + x + 1]! + row[channel]!
      }
    }
  }
  function sample(x: number, y: number, w: number, h: number) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y))
    const x1 = Math.min(width, Math.ceil(x + w)), y1 = Math.min(height, Math.ceil(y + h))
    const area = Math.max(1, (x1 - x0) * (y1 - y0))
    return sums.map(sum => (sum[y1 * stride + x1]! - sum[y0 * stride + x1]! - sum[y1 * stride + x0]! + sum[y0 * stride + x0]!) / area)
  }
  const averageAspect = stampMetrics.reduce((sum, metric) => sum + metric.width / Math.max(1, metric.height), 0) / stampMetrics.length
  const aspect = Math.max(.5, Math.min(10, averageAspect))
  const density = Math.max(.7, Math.min(50, options.density ?? 30))
  const vertical = Boolean(options.allowVertical)
  const cellAspect = vertical ? 1 / aspect : aspect
  const cellWidth = Math.max(input.sizeMin, 5 * Math.max(1, aspect)) * Math.min(1, cellAspect) * aScale * Math.sqrt(30 / density) * 1.1
  const cellHeight = cellWidth / cellAspect
  const angleLimit = Math.min(80, Math.max(0, options.angleRange ?? 12)) * Math.PI / 180 * .35
  function footprint(metric: typeof stampMetrics[number], w: number, h: number, angle: number) {
    const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle))
    const scale = Math.min(w / (metric.width * c + metric.height * s), h / (metric.width * s + metric.height * c), input.sizeMax * aScale / Math.max(metric.width, metric.height)) * .94
    return { scale, coverage: metric.inkRatio * metric.width * metric.height * scale * scale / (w * h) }
  }
  const orientation = vertical ? Math.PI / 2 : 0
  // A single unusually sparse writing must not wash out the whole portrait.
  // Most variants can carry this lower-quartile tone; sparse ones cap opacity.
  const coverages = stampMetrics.map(metric => footprint(metric, cellWidth, cellHeight, orientation + angleLimit).coverage).sort((a, b) => a - b)
  const reference = coverages[Math.floor((coverages.length - 1) * .25)]! * .95
  const placements: Placement[] = []
  const rows = Math.ceil(height / cellHeight)
  for (let row = 0; row < rows; row++) {
    if (row % 12 === 0) report('织排完整签名', .25 + .6 * row / rows)
    const y = row * cellHeight, h = Math.min(cellHeight, height - y)
    const startX = row % 2 ? -cellWidth / 2 : 0
    for (let cellX = startX; cellX < width; cellX += cellWidth) {
    if (placements.length >= 220_000) break
    const x = Math.max(0, cellX), w = Math.min(width, cellX + cellWidth) - x
    if (w < cellWidth * .65 || h < cellHeight * .65) continue
    const data = sample(x, y, w, h), tone = data[0]!, opacity = data[2]!
    if (opacity < .01 || tone < .005 && !options.fillHighlights) continue
    const stampIndex = Math.floor(random() * stampMetrics.length), metric = stampMetrics[stampIndex]!
    // Rotation is fitted into the tile instead of increasing the occupied area.
    const angle = orientation + (random() * 2 - 1) * angleLimit
    const fit = footprint(metric, w, h, angle)
    const denominator = Math.max(.01, opacity)
    const variance = Math.sqrt(Math.max(0, data[1]! - tone * tone))
    const onEdge = Boolean(options.edgeOutline && variance > (options.edgeThreshold ?? .32) * .3)
    let tint = { r: Math.round(data[3]! / denominator), g: Math.round(data[4]! / denominator), b: Math.round(data[5]! / denominator) }
    const tintLiteral = Boolean(options.inkColor || onEdge && (options.edgeColorMode === 'custom' || options.edgeColorMode === 'ink'))
    if (onEdge && options.edgeColorMode === 'custom') tint = options.edgeColor ?? { r: 28, g: 72, b: 96 }
    else if (options.inkColor) tint = options.inkColor
    else if (tintLiteral) tint = { r: 22, g: 20, b: 26 }
    placements.push({ x: (x + w / 2) / aScale, y: (y + h / 2) / aScale, angle, targetSize: Math.max(metric.width, metric.height) * fit.scale / aScale, stampIndex, strength: clamp((tone + (onEdge ? variance * .08 : 0)) * reference / Math.max(.001, fit.coverage)), tint, depth: clamp(tone), blend: 'soft', onEdge, tintLiteral })
    }
  }
  report('签名织排完成', .92)
  return placements
}
