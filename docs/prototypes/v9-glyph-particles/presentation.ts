import type { ArtFrame } from '../../../src/lib/art-engine/types'
import type { CanvasArtPrototypeOptions } from '../../../src/lib/art-engine/canvas'

/** Native fluid drives each existing glyph; no new cursor or particle emitter. */
export function createGlyphParticlePresentation() {
  let frame: ArtFrame | null = null
  let data = new Float32Array(0)
  let clock = 0
  let previous = -1
  let peak = 0
  let moving = 0
  const limit = 4 * 1024 * 1024
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
  const hash = (i: number, salt: number) => {
    let n = Math.imul(i + salt, 0x45d9f3b)
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b)
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296
  }
  const prepare: NonNullable<CanvasArtPrototypeOptions['experimentalTrail']> = (
    sample,
    next,
    strength,
    width,
    height,
  ) => {
    const count = next.columns * next.rows
    if (count * 8 * 4 > limit) throw new Error('粒子候选超过 4 MiB 状态预算')
    if (frame !== next) {
      frame = next
      data = new Float32Array(count * 8)
      previous = -1
    }
    const delta = previous < 0 ? 0 : clamp(clock - previous, 0, 0.25)
    previous = clock
    peak = moving = 0
    if (strength <= 0) {
      data.fill(0)
      return null
    }
    const short = Math.min(width, height),
      sx = width / short,
      sy = height / short
    for (let row = 0; row < next.rows; row++) {
      for (let col = 0; col < next.columns; col++) {
        const cell = row * next.columns + col,
          index = cell * 8
        const x = (col + 0.5) / next.columns,
          y = (row + 0.5) / next.rows
        const f = sample(x, y)
        const vx = f.velocityX * sx,
          vy = f.velocityY * sy
        const speed = Math.hypot(vx, vy)
        const energy = clamp(speed * 3.4 + Math.max(0, f.density) * 0.18, 0, 1)
        const angle = (hash(cell, 31) - 0.5) * 2.8
        const ca = Math.cos(angle),
          sa = Math.sin(angle)
        const directionX = speed > 0.00001 ? vx / speed : Math.cos(hash(cell, 19) * Math.PI * 2)
        const directionY = speed > 0.00001 ? vy / speed : Math.sin(hash(cell, 19) * Math.PI * 2)
        const scatter = energy * strength * (0.035 + hash(cell, 71) * 0.12)
        // Stable identity-specific dispersion. No time noise while the mouse rests.
        const tx = clamp(
          (ca * directionX - sa * directionY) * scatter + f.offsetX * sx * strength * 0.55,
          -0.18,
          0.18,
        )
        const ty = clamp(
          (sa * directionX + ca * directionY) * scatter + f.offsetY * sy * strength * 0.55,
          -0.18,
          0.18,
        )
        const omega = 8 + hash(cell, 101) * 4,
          zeta = 0.76
        const damping = zeta * omega,
          wd = omega * Math.sqrt(1 - zeta * zeta)
        const e = Math.exp(-damping * delta),
          cs = Math.cos(wd * delta),
          sn = Math.sin(wd * delta)
        // Exact damped spring step for a held force; both position and velocity survive frames.
        for (let axis = 0; axis < 2; axis++) {
          const target = axis ? ty : tx
          const q = data[index + axis]! - target,
            v = data[index + 2 + axis]!
          data[index + axis] = target + e * (q * cs + ((v + damping * q) / wd) * sn)
          data[index + 2 + axis] = e * (v * cs - ((damping * v + omega * omega * q) / wd) * sn)
        }
        let distance = Math.hypot(data[index]!, data[index + 1]!)
        const velocity = Math.hypot(data[index + 2]!, data[index + 3]!)
        // Snap only after the native force and actual spring energy both become negligible.
        if (!f.active && distance < 0.00008 && velocity < 0.0005) {
          data.fill(0, index, index + 4)
          distance = 0
        }
        peak = Math.max(peak, distance)
        if (distance > 0.00008 || velocity > 0.0005) moving++
        data[index + 4] = energy
        // Add glyph inertia to the shared refraction, in UV units; never treat offsets as velocity.
        data[index + 5] = data[index]! / sx
        data[index + 6] = data[index + 1]! / sy
        data[index + 7] = clamp(distance * 5 + energy * 0.4, 0, 1)
      }
    }
    return (x, y) => {
      const col = Math.min(next.columns - 1, Math.max(0, Math.floor(x * next.columns)))
      const row = Math.min(next.rows - 1, Math.max(0, Math.floor(y * next.rows)))
      const index = (row * next.columns + col) * 8
      const detail = data[index + 7]!
      return {
        offsetX: data[index + 5]!,
        offsetY: data[index + 6]!,
        light: 1 + detail * 0.22,
        opacity: 1 - detail * 0.22,
        // Keep light on the actual glyph; no filtered halo on transparent area output.
        glow: 0,
      }
    }
  }
  return {
    prepare,
    setTime(value: number) {
      if (!Number.isFinite(value) || value < 0) throw new Error('无效粒子时间')
      if (value < clock) {
        data.fill(0)
        previous = -1
      }
      clock = value
    },
    reset() {
      data.fill(0)
      previous = -1
      peak = moving = 0
    },
    destroy() {
      data = new Float32Array(0)
      frame = null
      previous = -1
      peak = moving = 0
    },
    get stats() {
      return { bytes: data.byteLength, limit, peak, moving, clock }
    },
  }
}
