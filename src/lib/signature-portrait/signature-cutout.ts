/** Local paper estimation for photographed handwriting. Runs in the cutout Worker. */
export type SignatureCutoutSettings = { polarity: 'auto' | 'dark' | 'light'; sensitivity: number }
export type SignatureCutoutResult = {
  pixels: ImageData
  polarity: 'dark' | 'light'
  coverage: number
  bounds: { x: number; y: number; width: number; height: number }
}

function extremum(input: Uint8Array, width: number, height: number, radius: number, maximum: boolean, horizontal: boolean) {
  const output = new Uint8Array(input.length)
  const length = horizontal ? width : height
  const lines = horizontal ? height : width
  const queue = new Int32Array(length + radius * 2)
  const valueAt = (line: number, at: number) => {
    const index = Math.max(0, Math.min(length - 1, at))
    return input[horizontal ? line * width + index : index * width + line]!
  }
  for (let line = 0; line < lines; line++) {
    let head = 0, tail = 0
    for (let at = -radius; at < length + radius; at++) {
      while (head < tail && queue[head]! < at - radius * 2) head++
      const value = valueAt(line, at)
      while (head < tail && (maximum ? valueAt(line, queue[tail - 1]!) <= value : valueAt(line, queue[tail - 1]!) >= value)) tail--
      queue[tail++] = at
      if (at >= radius) {
        const index = at - radius
        output[horizontal ? line * width + index : index * width + line] = valueAt(line, queue[head]!)
      }
    }
  }
  return output
}

export function isolateSignaturePixels(input: ImageData, settings: SignatureCutoutSettings): SignatureCutoutResult {
  const { width, height, data } = input
  if (width < 1 || height < 1 || width > 2032 || height > 2032 || !Number.isFinite(settings.sensitivity))
    throw new Error('签名抠图参数无效')
  const border: number[] = []
  const luminance = (at: number) => 0.299 * data[at]! + 0.587 * data[at + 1]! + 0.114 * data[at + 2]!
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if ((x < 4 || y < 4 || x >= width - 4 || y >= height - 4) && data[(y * width + x) * 4 + 3]! > 200)
      border.push(luminance((y * width + x) * 4))
  }
  border.sort((a, b) => a - b)
  // A transparent PNG has no paper colour; estimate polarity from visible ink instead.
  let visible = 0, lightness = 0
  if (!border.length) for (let at = 0; at < data.length; at += 4) {
    const alpha = data[at + 3]! / 255
    visible += alpha
    lightness += luminance(at) * alpha
  }
  const polarity = settings.polarity === 'auto'
    ? (border.length ? border[Math.floor(border.length / 2)]! >= 128 : lightness / Math.max(1, visible) < 128) ? 'dark' : 'light'
    : settings.polarity
  const grey = new Uint8Array(width * height)
  for (let at = 0; at < grey.length; at++) {
    const lum = luminance(at * 4)
    grey[at] = data[at * 4 + 3]! < 8 ? 255 : Math.round(polarity === 'dark' ? lum : 255 - lum)
  }
  // Closing removes thin dark strokes from the paper estimate while retaining smooth lighting.
  const radius = Math.max(8, Math.min(96, Math.round(Math.min(width, height) / 12)))
  let paper = extremum(grey, width, height, radius, true, true)
  paper = extremum(paper, width, height, radius, true, false)
  paper = extremum(paper, width, height, radius, false, true)
  paper = extremum(paper, width, height, radius, false, false)
  const floor = 38 - Math.max(0, Math.min(100, settings.sensitivity)) * 0.3
  const mask = new Uint8Array(grey.length)
  for (let at = 0; at < mask.length; at++) {
    const contrast = paper[at]! - grey[at]!
    mask[at] = Math.round(Math.max(0, Math.min(1, (contrast - floor) / 48)) * data[at * 4 + 3]!)
  }
  let x0 = width, y0 = height, x1 = -1, y1 = -1, ink = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = y * width + x
    const alpha = mask[at]!
    if (!alpha) continue
    ink += alpha / 255
    x0 = Math.min(x0, x); y0 = Math.min(y0, y)
    x1 = Math.max(x1, x); y1 = Math.max(y1, y)
  }
  if (x1 < x0 || ink < 4) throw new Error('没有提取到清晰笔迹，请调整提取力度或切换深色／浅色笔迹')
  const padding = 8
  const pixels = new ImageData(x1 - x0 + 1 + padding * 2, y1 - y0 + 1 + padding * 2)
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const at = ((y - y0 + padding) * pixels.width + x - x0 + padding) * 4
    pixels.data[at] = 20; pixels.data[at + 1] = 24; pixels.data[at + 2] = 32
    pixels.data[at + 3] = mask[y * width + x]!
  }
  return { pixels, polarity, coverage: ink / ((x1 - x0 + 1) * (y1 - y0 + 1)),
    bounds: { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } }
}
