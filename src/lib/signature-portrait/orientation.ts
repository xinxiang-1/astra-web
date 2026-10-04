/** Smoothed structure tensor: follow contours while keeping complete names upright. */
export function createSignatureDirectionField(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) {
  const stride = width + 1
  const light = new Float32Array(width * height)
  for (let i = 0; i < light.length; i++) {
    const p = i * 4,
      a = pixels[p + 3]! / 255
    light[i] =
      ((pixels[p]! * 0.2126 + pixels[p + 1]! * 0.7152 + pixels[p + 2]! * 0.0722) / 255) * a + 1 - a
  }
  const sums = Array.from({ length: 3 }, () => new Float64Array(stride * (height + 1)))
  const at = (x: number, y: number) =>
    light[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]!
  for (let y = 0; y < height; y++) {
    const row = [0, 0, 0]
    for (let x = 0; x < width; x++) {
      const gx =
        (at(x + 1, y - 1) +
          2 * at(x + 1, y) +
          at(x + 1, y + 1) -
          at(x - 1, y - 1) -
          2 * at(x - 1, y) -
          at(x - 1, y + 1)) /
        8
      const gy =
        (at(x - 1, y + 1) +
          2 * at(x, y + 1) +
          at(x + 1, y + 1) -
          at(x - 1, y - 1) -
          2 * at(x, y - 1) -
          at(x + 1, y - 1)) /
        8
      const terms = [gx * gx, gx * gy, gy * gy]
      for (let c = 0; c < 3; c++) {
        row[c]! += terms[c]!
        sums[c]![(y + 1) * stride + x + 1] = sums[c]![y * stride + x + 1]! + row[c]!
      }
    }
  }
  return (x: number, y: number, radiusX: number, radiusY: number, base: number) => {
    const x0 = Math.max(0, Math.floor(x - radiusX)),
      x1 = Math.min(width, Math.ceil(x + radiusX))
    const y0 = Math.max(0, Math.floor(y - radiusY)),
      y1 = Math.min(height, Math.ceil(y + radiusY))
    const area = Math.max(1, (x1 - x0) * (y1 - y0))
    const [xx = 0, xy = 0, yy = 0] = sums.map(
      (s) =>
        (s[y1 * stride + x1]! -
          s[y0 * stride + x1]! -
          s[y1 * stride + x0]! +
          s[y0 * stride + x0]!) /
        area,
    )
    // Integral sums can lose a few ulps when a nearly flat region is subtracted.
    const trace = Math.max(0, xx + yy)
    const coherence = trace > 1e-10 ? Math.min(1, Math.hypot(xx - yy, 2 * xy) / trace) : 0
    const tangent = 0.5 * Math.atan2(2 * xy, xx - yy) + Math.PI / 2
    // An axis has two directions. Choose the equivalent one nearest the writing baseline.
    const offset = ((((tangent - base + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2
    return { offset, confidence: coherence * Math.min(1, Math.sqrt(trace) * 12) }
  }
}
