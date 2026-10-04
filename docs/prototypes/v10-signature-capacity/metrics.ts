import { palettes, type Palette } from './engine'

export function quality(source: HTMLImageElement, output: HTMLCanvasElement, palette: Palette) {
  const target = document.createElement('canvas')
  target.width = output.width; target.height = output.height
  const tctx = target.getContext('2d', { willReadFrequently: true })!
  tctx.drawImage(source, 0, 0, target.width, target.height)
  const input = tctx.getImageData(0, 0, target.width, target.height).data
  const pixels = output.getContext('2d')!.getImageData(0, 0, output.width, output.height).data
  const luminance = (r: number, g: number, b: number) => (r * .2126 + g * .7152 + b * .0722) / 255
  const paper = palettes[palette].rgb, ink = palettes[palette].ink
  const bg = luminance(paper[0], paper[1], paper[2]), pigment = luminance(ink[0], ink[1], ink[2])
  const expected: number[] = [], actual: number[] = []
  for (let gy = 0; gy < 32; gy++) for (let gx = 0; gx < 24; gx++) {
    const x0 = gx * output.width / 24, x1 = (gx + 1) * output.width / 24
    const y0 = gy * output.height / 32, y1 = (gy + 1) * output.height / 32
    let a = 0, b = 0, area = 0
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++) for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const weight = (Math.min(x + 1, x1) - Math.max(x, x0)) * (Math.min(y + 1, y1) - Math.max(y, y0))
      const p = (y * output.width + x) * 4
      const light = luminance(input[p]!, input[p + 1]!, input[p + 2]!)
      a += (palette === 'paper' ? 1 - light : light) * input[p + 3]! / 255 * weight
      b += (bg - luminance(pixels[p]!, pixels[p + 1]!, pixels[p + 2]!)) / (bg - pigment) * weight
      area += weight
    }
    expected.push(a / area); actual.push(b / area)
  }
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length
  const aMean = mean(expected), bMean = mean(actual)
  let cross = 0, aVariance = 0, bVariance = 0, error = 0
  for (let i = 0; i < expected.length; i++) {
    const a = expected[i]! - aMean, b = actual[i]! - bMean
    cross += a * b; aVariance += a * a; bVariance += b * b; error += Math.abs(expected[i]! - actual[i]!)
  }
  const range = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(.95 * (sorted.length - 1))]! - sorted[Math.floor(.05 * (sorted.length - 1))]! }
  const structure = cross / Math.max(1e-12, Math.sqrt(aVariance * bVariance))
  const rangeRatio = range(actual) / Math.max(1e-12, range(expected)), toneMAE = error / expected.length
  target.width = 1; target.height = 1
  return { structure, rangeRatio, toneMAE, passed: structure >= .82 && rangeRatio >= .3 && toneMAE <= .45 }
}
