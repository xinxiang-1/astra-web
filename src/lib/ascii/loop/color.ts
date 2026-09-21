export type DominantColor = {
  hex: string
  rgb: readonly [number, number, number]
  hsl: readonly [number, number, number]
}

function clampByte(n: number) {
  return Math.min(255, Math.max(0, Math.round(n)))
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6
  else if (max === gg) h = ((bb - rr) / d + 2) / 6
  else h = ((rr - gg) / d + 4) / 6
  return [h, s, l]
}

function toHex(r: number, g: number, b: number) {
  return `#${[r, g, b]
    .map((v) => clampByte(v).toString(16).padStart(2, '0'))
    .join('')}`
}

/**
 * Average a downscaled frame, biased toward mid-saturation pixels.
 */
export function sampleDominantColor(
  source: CanvasImageSource,
  width: number,
  height: number,
): DominantColor {
  const w = Math.max(1, Math.min(64, Math.round(width)))
  const h = Math.max(1, Math.min(64, Math.round(height)))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return { hex: '#1a2238', rgb: [26, 34, 56], hsl: [0.62, 0.36, 0.16] }
  }
  ctx.drawImage(source, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)

  let rSum = 0
  let gSum = 0
  let bSum = 0
  let weight = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    const a = data[i + 3] ?? 0
    if (a < 16) continue
    const [, s, l] = rgbToHsl(r, g, b)
    const wgt = 0.35 + s * 1.4 + (l > 0.15 && l < 0.85 ? 0.4 : 0)
    rSum += r * wgt
    gSum += g * wgt
    bSum += b * wgt
    weight += wgt
  }

  if (weight <= 0) {
    return { hex: '#1a2238', rgb: [26, 34, 56], hsl: [0.62, 0.36, 0.16] }
  }
  const r = clampByte(rSum / weight)
  const g = clampByte(gSum / weight)
  const b = clampByte(bSum / weight)
  return { hex: toHex(r, g, b), rgb: [r, g, b], hsl: rgbToHsl(r, g, b) }
}
