import type { CanvasArtPrototypeOptions } from '../../../src/lib/art-engine/canvas'

/** Presentation only. Samples one native solver; no secondary flow simulation. */
export function createRiftPresentation() {
  let data = new Float32Array(0),
    columns = 0,
    rows = 0,
    peakOffset = 0
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
    peakOffset = 0
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
        peakOffset = Math.max(peakOffset, Math.hypot(data[i + 5]! * sx, data[i + 6]! * sy))
      }
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
      return { columns, rows, bytes: data.byteLength, peakOffset, limit: 256 * 1024 }
    },
  }
}
