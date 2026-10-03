import type { CanvasArtPrototypeOptions } from '../../../src/lib/art-engine/canvas'

/** Presentation only. Samples one native solver; no secondary flow simulation. */
export function createRiftPresentation() {
  let data = new Float32Array(0),
    columns = 0,
    rows = 0,
    peakOffset = 0,
    rawPeakOffset = 0,
    maxStrain = 0,
    minJacobian = 1
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
  const prepare: NonNullable<CanvasArtPrototypeOptions['experimentalTrail']> = (
    sample,
    _frame,
    strength,
    width,
    height,
  ) => {
    if (strength <= 0 || !sample(0.5, 0.5).active) {
      data.fill(0)
      peakOffset = 0
      rawPeakOffset = maxStrain = 0
      minJacobian = 1
      return null
    }
    const ratio = width / height
    const nextColumns = Math.min(80, Math.max(24, Math.round(56 * Math.max(1, ratio))))
    const nextRows = Math.min(80, Math.max(24, Math.round(56 * Math.max(1, 1 / ratio))))
    if (columns !== nextColumns || rows !== nextRows) {
      columns = nextColumns
      rows = nextRows
      data = new Float32Array(columns * rows * 10)
    }
    const shortEdge = Math.min(width, height),
      sx = width / shortEdge,
      sy = height / shortEdge
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const field = sample(x / (columns - 1), y / (rows - 1)),
          i = (y * columns + x) * 10
        data[i] = field.velocityX * sx
        data[i + 1] = field.velocityY * sy
        data[i + 2] = field.offsetX * sx
        data[i + 3] = field.offsetY * sy
        data[i + 4] = Math.max(0, field.density)
      }
    peakOffset = rawPeakOffset = 0
    const density = (x: number, y: number) =>
      data[(clamp(y, 0, rows - 1) * columns + clamp(x, 0, columns - 1)) * 10 + 4]!
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const i = (y * columns + x) * 10,
          vx = data[i]!,
          vy = data[i + 1]!
        const speed = Math.hypot(vx, vy),
          nx = -vy / (speed + 1e-7),
          ny = vx / (speed + 1e-7)
        // Density gradient in short-edge coordinates; normal opens either side of the wake.
        const gx = ((density(x + 1, y) - density(x - 1, y)) * (columns - 1)) / (2 * sx)
        const gy = ((density(x, y + 1) - density(x, y - 1)) * (rows - 1)) / (2 * sy)
        const wake = 1 - Math.exp(-data[i + 4]! * 2.6),
          energy = Math.tanh(speed * 4)
        const split = -Math.tanh((gx * nx + gy * ny) * 0.23)
        const edge = Math.min(1, x / 3, (columns - 1 - x) / 3, y / 3, (rows - 1 - y) / 3)
        const opening = strength * 0.06 * wake * energy * split * edge
        const dx = (data[i + 2]! * strength * 2.7 + nx * opening) / sx
        const dy = (data[i + 3]! * strength * 2.7 + ny * opening) / sy
        const reflection =
          Math.tanh(Math.hypot(gx, gy) * 0.12) * wake * (0.3 + 0.7 * energy) * strength
        data[i + 5] = clamp(dx, -0.08 / sx, 0.08 / sx)
        data[i + 6] = clamp(dy, -0.08 / sy, 0.08 / sy)
        data[i + 7] = 1 + reflection * 0.8
        data[i + 8] = 1 - wake * energy * (1 - Math.abs(split)) * strength * 0.38
        data[i + 9] = reflection * 0.48
        rawPeakOffset = Math.max(rawPeakOffset, Math.hypot(data[i + 5]! * sx, data[i + 6]! * sy))
      }
    // Project only excessive neighbouring strain. Broad strokes keep their
    // displacement while narrow folds spread into a readable, elastic opening.
    const hx = sx / (columns - 1),
      hy = sy / (rows - 1)
    const project = (a: number, b: number, step: number) => {
      const dx = (data[b + 5]! - data[a + 5]!) * sx,
        dy = (data[b + 6]! - data[a + 6]!) * sy,
        length = Math.hypot(dx, dy),
        allowed = step * 0.5
      if (length <= allowed) return
      const amount = (1 - allowed / length) * 0.5
      data[a + 5] = data[a + 5]! + (dx * amount) / sx
      data[b + 5] = data[b + 5]! - (dx * amount) / sx
      data[a + 6] = data[a + 6]! + (dy * amount) / sy
      data[b + 6] = data[b + 6]! - (dy * amount) / sy
    }
    for (let pass = 0; pass < 8; pass++) {
      const reverse = pass % 2 === 1
      for (let iy = 0; iy < rows; iy++)
        for (let ix = 0; ix < columns; ix++) {
          const x = reverse ? columns - 1 - ix : ix,
            y = reverse ? rows - 1 - iy : iy,
            a = (y * columns + x) * 10
          if (x < columns - 1) project(a, a + 10, hx)
          if (y < rows - 1) project(a, a + columns * 10, hy)
        }
    }
    // Bound the Frobenius norm at all four bilinear corners. The largest
    // singular value is no larger, so I + D cannot reverse or fully compress.
    const strain = (a: number, b: number, c: number, d: number) => {
      const ux = ((data[b + 5]! - data[a + 5]!) * sx) / hx,
        vx = ((data[b + 6]! - data[a + 6]!) * sy) / hx,
        uy = ((data[d + 5]! - data[c + 5]!) * sx) / hy,
        vy = ((data[d + 6]! - data[c + 6]!) * sy) / hy
      return { norm: Math.hypot(ux, vx, uy, vy), determinant: (1 + ux) * (1 + vy) - uy * vx }
    }
    const visitCorners = (visit: (value: ReturnType<typeof strain>) => void) => {
      for (let y = 0; y < rows - 1; y++)
        for (let x = 0; x < columns - 1; x++) {
          const a = (y * columns + x) * 10,
            b = a + 10,
            c = a + columns * 10,
            d = c + 10
          visit(strain(a, b, a, c))
          visit(strain(a, b, b, d))
          visit(strain(c, d, a, c))
          visit(strain(c, d, b, d))
        }
    }
    maxStrain = 0
    visitCorners((value) => {
      maxStrain = Math.max(maxStrain, value.norm)
    })
    const correction = Math.min(1, 0.72 / Math.max(1e-7, maxStrain))
    for (let i = 0; i < data.length; i += 10) {
      data[i + 5] = data[i + 5]! * correction
      data[i + 6] = data[i + 6]! * correction
      peakOffset = Math.max(peakOffset, Math.hypot(data[i + 5]! * sx, data[i + 6]! * sy))
    }
    maxStrain = 0
    minJacobian = 1
    visitCorners((value) => {
      maxStrain = Math.max(maxStrain, value.norm)
      minJacobian = Math.min(minJacobian, value.determinant)
    })
    return (x, y) => {
      const fx = clamp(x, 0, 1) * (columns - 1),
        fy = clamp(y, 0, 1) * (rows - 1)
      const ix = Math.min(columns - 2, Math.floor(fx)),
        iy = Math.min(rows - 2, Math.floor(fy))
      const tx = fx - ix,
        ty = fy - iy,
        a = (iy * columns + ix) * 10
      const read = (channel: number) =>
        (data[a + channel]! * (1 - tx) + data[a + 10 + channel]! * tx) * (1 - ty) +
        (data[a + columns * 10 + channel]! * (1 - tx) +
          data[a + columns * 10 + 10 + channel]! * tx) *
          ty
      return { offsetX: read(5), offsetY: read(6), light: read(7), opacity: read(8), glow: read(9) }
    }
  }
  return {
    prepare,
    get stats() {
      return {
        columns,
        rows,
        bytes: data.byteLength,
        peakOffset,
        rawPeakOffset,
        maxStrain,
        minJacobian,
        limit: 256 * 1024,
      }
    },
  }
}
