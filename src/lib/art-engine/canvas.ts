import type { ArtFrame, ArtRenderOptions } from './types'

/** Drawing-environment hooks; experimentalTrail is excluded from production and portable output. */
export type CanvasArtPrototypeOptions = {
  /** Supply compatible Canvas surfaces when drawing in an OffscreenCanvas worker. */
  createSurface?: () => HTMLCanvasElement
  /** Limit temporary color tiles for changing video frames; colors/geometry stay exact. */
  maxTileEntries?: number
  experimentalTrail?: (
    sample: (x: number, y: number) => ArtFluidFieldSample,
    frame: ArtFrame,
    strength: number,
    width: number,
    height: number,
  ) =>
    | ((
        x: number,
        y: number,
      ) => {
        offsetX: number
        offsetY: number
        light: number
        opacity: number
        glow: number
      })
    | null
}

/** UV velocities per second and UV offsets; raw density, without strength applied. */
export type ArtFluidFieldSample = {
  velocityX: number
  velocityY: number
  offsetX: number
  offsetY: number
  density: number
  active: boolean
}

/** Real elapsed interaction interval processed before character drawing starts. */
export type ArtInteractionRenderProgress = {
  completedSeconds: number
  totalSeconds: number
  completedSteps: number
}

/** Portable factory keeps the matching literal inside; integration checks enforce agreement. */
export const ART_PARTICLE_MAX_CELLS = 131072

/** Self-contained Canvas implementation shared with the standalone HTML runtime. */
export function createCanvasArtRenderer(
  target: HTMLCanvasElement,
  prototype: CanvasArtPrototypeOptions = {},
) {
  let current: ArtFrame | null = null
  let frame: ArtFrame
  function createGlyphParticlePresentation() {
    let glyphs: ArtFrame['glyphs'] | null = null
    let columns = 0,
      rows = 0,
      previous = -1,
      peak = 0,
      moving = 0
    let data = new Float32Array(0),
      identity = new Float64Array(0)
    const maxCells = 131072,
      limit = maxCells * 80
    let unavailable = false
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
    const hash = (i: number, salt: number) => {
      let n = Math.imul(i + salt, 0x45d9f3b)
      n = Math.imul(n ^ (n >>> 16), 0x45d9f3b)
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296
    }
    const neutral = () => ({ offsetX: 0, offsetY: 0, light: 1, opacity: 1, glow: 0 })
    const reset = () => {
      if (moving || peak) data.fill(0)
      previous = -1
      peak = moving = 0
    }
    const destroy = () => {
      data = new Float32Array(0)
      identity = new Float64Array(0)
      glyphs = null
      columns = rows = peak = moving = 0
      previous = -1
    }
    function prepare(
      sample: (x: number, y: number) => ArtFluidFieldSample,
      next: ArtFrame,
      strength: number,
      width: number,
      height: number,
      clock: number,
    ) {
      const count = next.columns * next.rows
      unavailable = count > maxCells
      if (unavailable) {
        destroy()
        return null
      }
      if (strength <= 0) {
        reset()
        return null
      }
      // A decoded video frame changes tone/indices, not the identity of the character grid.
      if (columns !== next.columns || rows !== next.rows || glyphs !== next.glyphs) {
        destroy()
        columns = next.columns
        rows = next.rows
        glyphs = next.glyphs
      }
      if (clock < previous) reset()
      const delta = previous < 0 ? 0 : clamp(clock - previous, 0, 0.25)
      previous = clock
      if (!sample(0.5, 0.5).active && moving === 0) return neutral
      if (data.length !== count * 8) {
        data = new Float32Array(count * 8)
        identity = new Float64Array(count * 6)
        for (let cell = 0; cell < count; cell++) {
          const at = cell * 6,
            angle = (hash(cell, 31) - 0.5) * 2.8
          identity[at] = Math.cos(angle)
          identity[at + 1] = Math.sin(angle)
          identity[at + 2] = Math.cos(hash(cell, 19) * Math.PI * 2)
          identity[at + 3] = Math.sin(hash(cell, 19) * Math.PI * 2)
          identity[at + 4] = 0.035 + hash(cell, 71) * 0.12
          identity[at + 5] = 8 + hash(cell, 101) * 4
        }
      }
      peak = moving = 0
      const short = Math.min(width, height),
        sx = width / short,
        sy = height / short
      for (let row = 0; row < rows; row++)
        for (let col = 0; col < columns; col++) {
          const cell = row * columns + col,
            at = cell * 8,
            id = cell * 6
          const f = sample((col + 0.5) / columns, (row + 0.5) / rows)
          const vx = f.velocityX * sx,
            vy = f.velocityY * sy,
            speed = Math.hypot(vx, vy)
          const energy = clamp(speed * 3.4 + Math.max(0, f.density) * 0.18, 0, 1)
          const ca = identity[id]!,
            sa = identity[id + 1]!
          const directionX = speed > 0.00001 ? vx / speed : identity[id + 2]!
          const directionY = speed > 0.00001 ? vy / speed : identity[id + 3]!
          const scatter = energy * strength * identity[id + 4]!
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
          const omega = identity[id + 5]!,
            zeta = 0.76
          const damping = zeta * omega,
            wd = omega * Math.sqrt(1 - zeta * zeta)
          const e = Math.exp(-damping * delta),
            cs = Math.cos(wd * delta),
            sn = Math.sin(wd * delta)
          for (let axis = 0; axis < 2; axis++) {
            const target = axis ? ty : tx,
              q = data[at + axis]! - target,
              v = data[at + 2 + axis]!
            data[at + axis] = target + e * (q * cs + ((v + damping * q) / wd) * sn)
            data[at + 2 + axis] = e * (v * cs - ((damping * v + omega * omega * q) / wd) * sn)
          }
          let distance = Math.hypot(data[at]!, data[at + 1]!)
          const velocity = Math.hypot(data[at + 2]!, data[at + 3]!)
          if (!f.active && distance < 0.00008 && velocity < 0.0005) {
            data.fill(0, at, at + 4)
            distance = 0
          }
          peak = Math.max(peak, distance)
          if (distance > 0.00008 || velocity > 0.0005) moving++
          data[at + 4] = energy
          data[at + 5] = data[at]! / sx
          data[at + 6] = data[at + 1]! / sy
          data[at + 7] = clamp(distance * 5 + energy * 0.4, 0, 1)
        }
      return (x: number, y: number) => {
        const col = Math.min(columns - 1, Math.max(0, Math.floor(x * columns)))
        const row = Math.min(rows - 1, Math.max(0, Math.floor(y * rows)))
        const at = (row * columns + col) * 8,
          detail = data[at + 7]!
        return {
          offsetX: data[at + 5]!,
          offsetY: data[at + 6]!,
          light: 1 + detail * 0.22,
          opacity: 1 - detail * 0.22,
          glow: 0,
        }
      }
    }
    return {
      prepare,
      reset,
      destroy,
      get active() {
        return moving > 0
      },
      get stats() {
        return {
          bytes: data.byteLength + identity.byteLength,
          limit,
          maxCells,
          peak,
          moving,
          unavailable,
        }
      },
    }
  }
  const particlePresentation = createGlyphParticlePresentation()
  function createRiftPresentation() {
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
        return {
          offsetX: read(5),
          offsetY: read(6),
          light: read(7),
          opacity: read(8),
          glow: read(9),
        }
      }
    }
    return {
      prepare,
      destroy() {
        data = new Float32Array(0)
        columns = rows = peakOffset = rawPeakOffset = maxStrain = 0
        minJacobian = 1
      },
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
  const riftPresentation = createRiftPresentation()
  const tinted = new Map<string, HTMLCanvasElement | ImageBitmap>()
  const maxBackingBytes = 16 * 1024 * 1024
  const maxEntries =
    prototype.maxTileEntries ?? (typeof OffscreenCanvas === 'undefined' ? 4096 : 12000)
  let backingBytes = 0,
    hits = 0,
    misses = 0
  let scratch: OffscreenCanvas | HTMLCanvasElement | null = null
  const outputCtx = target.getContext('2d')!
  let ctx = outputCtx
  let supersample: HTMLCanvasElement | null = null
  const softwareLimit = 4 * 1024 * 1024
  const softwareWorkingLimit = 16 * 1024 * 1024
  const prefixes = new Map<number, Float32Array>()
  const softwareMasks = new Map<string, { width: number; height: number; alpha: Float32Array }>()
  let softwareGlyphs: ArtFrame['glyphs'] | null = null
  let softwareGeometry = ''
  let prefixBytes = 0,
    maskBytes = 0
  let softwarePixels: Float32Array | null = null
  let softwareImage: ImageData | null = null
  let colorProbe: HTMLCanvasElement | null = null
  const styleColors = new Map<string, number[]>()
  let glowCanvas: HTMLCanvasElement | null = null
  // Native Studio ambient sampler is adapted under the MIT notice below.
  // Offsets are reference pixels at 960px, followed by density and opacity.
  function sampleStudioAmbient(
    mode: string,
    x: number,
    y: number,
    time: number,
    out: Float32Array,
  ) {
    const smooth = (low: number, high: number, value: number) => {
      const t = Math.max(0, Math.min(1, (value - low) / (high - low)))
      return t * t * (3 - 2 * t)
    }
    out[0] = out[1] = out[2] = 0
    out[3] = 1
    if (mode === 'none') return out
    const phase = (time * Math.PI) / 6
    const edge = smooth(0, 0.12, Math.min(x, 1 - x, y, 1 - y))
    if (mode === 'caustics') {
      const bands = Math.sin(9 * x + 5 * y + phase) + Math.sin(8 * y - 3 * x - phase)
      const ridge = Math.pow(Math.max(0, 1 - 0.72 * Math.abs(bands)), 3)
      out[2] = (0.22 * ridge - 0.045) * edge
    } else if (mode === 'current') {
      out[0] = Math.sin(9 * y + phase) * Math.cos(7 * x - phase) * 10 * edge
      out[1] = Math.cos(8 * x + phase) * Math.sin(6 * y - phase) * 7 * edge
    } else if (mode === 'reform') {
      const cycle = ((time % 12) + 12) % 12
      const raw =
        ((0.06711056 * Math.floor(160 * x) + 0.00583715 * Math.floor(100 * y)) % 1) * 52.9829189
      const noise = raw - Math.floor(raw)
      const delay = 0.65 * x + 0.2 * y + 0.15 * noise + 0.08 * Math.sin(8 * x - 5 * y)
      const scatter =
        smooth(1.8 + 1.2 * delay, 3.8 + 1.2 * delay, cycle) *
        (1 - smooth(5 + 1.7 * delay, 7.2 + 1.7 * delay, cycle))
      out[0] = Math.sin(9 * y + phase) * scatter * (1 - scatter) * 24 * edge
      out[1] = -scatter * (1 - scatter) * (8 + 12 * noise) * edge
      out[2] = -0.45 * scatter
      out[3] = 1 - 0.9 * scatter
    }
    return out
  }
  // One bounded, deterministic field per frame, reused by glyph/glow/area paths.
  // Six signals: displacement x/y, intensity, opacity, glyph light and positive size.
  let motionField: Float32Array | null = null
  let motionColumns = 0,
    motionRows = 0,
    motionKey = ''
  // Exact entrance/ribbon identity cannot be interpolated on the surface grid.
  // Cache its six signals and two shutter offsets once, shared by all passes.
  const choreographyLimit = 4 * 1024 * 1024
  let choreography: Float64Array | null = null
  let choreographyKey = ''
  const motionSample = new Float32Array(6)
  const ambientNative = new Float32Array(4)
  const ambientLight = new Float32Array(4)
  // Same-frame glyph/area/glow reuse; exact doubles and bounded backing memory.
  const effectCellLimit = 4 * 1024 * 1024
  let effectCells: Float64Array | null = null,
    effectCellValid: Uint8Array | null = null
  const motionSmooth = (low: number, high: number, value: number) => {
    const t = Math.max(0, Math.min(1, (value - low) / (high - low)))
    return t * t * t * (t * (6 * t - 15) + 10)
  }
  // Choreography changes positions in space, never the faces of the glyphs.
  // Every position is analytic: seeks, pauses and standalone exports agree.
  function sampleCinematic(
    mode: string,
    x: number,
    y: number,
    time: number,
    amount: number,
    out: Float32Array,
    identity = 0,
  ) {
    const edge = motionSmooth(0, 0.16, Math.min(x, 1 - x, y, 1 - y))
    const rx = x - 0.5,
      ry = y - 0.5,
      aspect = frame.width / frame.height
    if (mode === 'wave') sampleStudioAmbient('current', x, y, time, ambientNative)
    const nativeX = ambientNative[0]! / 960,
      nativeY = ambientNative[1]! / 960
    const gaussian = (value: number, width: number) => Math.exp(-((value / width) ** 2))
    // Closed-form spring with zero initial velocity and a truly still final hold.
    const response = (elapsed: number, duration: number) => {
      const u = Math.max(0, elapsed) / duration
      if (u >= 1) return 0
      return (
        Math.exp(-3.4 * u) *
        (Math.cos(5 * u) + 0.68 * Math.sin(5 * u)) *
        (1 - motionSmooth(0.78, 1, u))
      )
    }
    let dx = 0,
      dy = 0,
      intensity = 1,
      opacity = 1,
      glow = 0,
      size = 1
    if (mode === 'breathe') {
      const cycle = ((time % 7) + 7) % 7
      const distance = Math.hypot(rx * aspect, ry)
      const envelope = motionSmooth(0, 0.22, cycle) * (1 - motionSmooth(5.8, 7, cycle))
      const phase = distance - cycle * 0.25 + 0.04
      const crest = gaussian(phase, 0.14)
      const wake = gaussian(phase + 0.23, 0.19)
      const echo = gaussian(phase + 0.46, 0.16)
      const pulse = (crest - wake * 0.68 + echo * 0.22) * envelope
      // A continuous expanding dome followed by a darker trough. The broad
      // support keeps landmarks together while the bright front crosses them.
      dx = rx * pulse * 0.11 * edge
      dy = ry * pulse * 0.11 * edge
      size = 1 + (crest * 0.24 - wake * 0.12) * envelope * edge
      intensity = 1 + (crest * 0.42 - wake * 0.38) * envelope * edge
      glow = (crest * 1.05 + echo * 0.38) * envelope * edge
    } else if (mode === 'wave') {
      // The entire curtain moves, including its edges. A shallow perspective
      // fold carries broad highlights, rather than stretching individual eyes.
      const phase = y * 5.2 - x * 1.4 - time * 1.1
      const fold = Math.sin(phase)
      const normal = Math.cos(phase)
      const perspective = 1 + fold * 0.055
      const drift = Math.sin(time * 0.42) * 0.014
      dx = rx * (perspective - 1) + (fold * 0.057 + nativeX * 0.4) * edge + drift
      dy = ry * (perspective - 1) + normal * 0.017 * edge
      const highlight = Math.max(0, normal) ** 7
      const shadow = Math.max(0, -normal) ** 2
      size = perspective
      intensity = 1 + (highlight * 0.4 - shadow * 0.34) * edge
      glow = highlight * 0.88 * edge
    } else if (mode === 'assemble') {
      const raw = Math.sin((identity + 1) * 127.1) * 43758.5453
      const noise = raw - Math.floor(raw)
      const layer = Math.floor(y * 6)
      const delay = x * 0.3 + layer * 0.065
      const elapsed = Math.max(0, time - delay)
      const arrival = 1 - motionSmooth(0.15, 3.1, elapsed)
      const landing = motionSmooth(2.1, 3.1, elapsed) * response(Math.max(0, elapsed - 2.1), 2.05)
      const remaining = arrival + Math.min(0, landing) * 0.38
      const flight = Math.max(0, remaining)
      const theta =
        Math.atan2(ry, rx * aspect) + flight * (2.8 + layer * 0.12 + Math.max(0, time) * 0.65)
      const orbit = 0.17 + noise * 0.22
      // Six elliptical orbits unwrap into the work. The initial constellation
      // fills the stage; the spring gives one restrained overshoot then a hold.
      const originX = Math.cos(theta) * orbit
      const originY = Math.sin(theta) * orbit * 0.74 + (layer - 2.5) * 0.017
      dx = (originX - rx) * remaining
      dy = (originY - ry) * remaining
      size = 1 - flight * (0.39 + noise * 0.12)
      opacity = 1 - flight * (0.48 + noise * 0.12)
      intensity = 1 - flight * 0.12
      glow = flight * (1 - flight) * 2.3 + flight * 0.32
    } else if (mode === 'current') {
      // A shallow curved sheet viewed by an orbiting camera. This is geometry,
      // not a fluid simulation or a velocity inferred from Studio displacement.
      const yaw = Math.sin(time * 0.5) * 0.34
      const pitch = Math.cos(time * 0.37) * 0.13
      const depth = Math.sin(x * Math.PI) * Math.sin(y * Math.PI) * 0.12
      const px = rx * Math.cos(yaw) + depth * Math.sin(yaw)
      const z = -rx * Math.sin(yaw) + depth * Math.cos(yaw)
      const py = ry * Math.cos(pitch) - z * Math.sin(pitch)
      const viewZ = ry * Math.sin(pitch) + z * Math.cos(pitch)
      const perspective = 0.94 / (1 - viewZ * 0.32)
      const roll = Math.sin(time * 0.31) * 0.035
      dx = (px - py * roll) * perspective - rx + Math.sin(time * 0.41) * 0.012
      dy = (py + px * roll) * perspective - ry + Math.cos(time * 0.43) * 0.008
      const light = Math.max(0, Math.cos(x * 3.8 + yaw * 2.8 - 1.8)) ** 6
      size = perspective
      intensity = 0.88 + light * 0.28
      glow = light * 0.48 * edge
    } else if (mode === 'reform') {
      const cycle = ((time % 12) + 12) % 12
      // Coherent ribbons peel into depth, instead of destroying the portrait
      // with dozens of randomly oriented rectangular fragments.
      const ribbon = Math.min(7, Math.floor(y * 8))
      const side = ribbon % 2 ? 1 : -1
      const delay = Math.abs(ribbon - 3.5) * 0.13
      const opening = motionSmooth(0.45 + delay, 1.85 + delay, cycle)
      const recovery = cycle < 3.65 + delay ? 1 : response(cycle - 3.65 - delay, 3.85)
      const separation = opening * recovery
      const anticipation = motionSmooth(0, 0.14, cycle) * (1 - motionSmooth(0.3, 0.6, cycle))
      const travel = 0.065 + Math.abs(ribbon - 3.5) * 0.009
      const separated = Math.max(0, separation)
      const local = y * 8 - ribbon
      const rim = gaussian(local - (side > 0 ? 0.12 : 0.88), 0.19)
      size = 1 - separated * (0.12 + (ribbon % 3) * 0.035) + anticipation * 0.045
      dx = side * travel * separation + rx * (size - 1) - rx * anticipation * 0.035
      dy =
        (ribbon - 3.5) * separation * 0.013 +
        ((local - 0.5) * (size - 1)) / 8 -
        ry * anticipation * 0.035
      opacity = 1 - separated * 0.1
      intensity = 1 - separated * 0.2 + rim * separated * 0.38
      glow = rim * separated * 0.9 + Math.sin(Math.min(1, Math.abs(separation)) * Math.PI) * 0.6
    } else if (mode === 'caustics') {
      const cycle = ((time % 6) + 6) % 6
      const envelope = motionSmooth(0, 0.24, cycle) * (1 - motionSmooth(5.5, 6, cycle))
      const front = y + x * 0.16 - (0.16 + (cycle / 5.2) * 1.35)
      const beam = gaussian(front, 0.036) * envelope
      const echo = gaussian(front + 0.1, 0.022) * envelope
      const occlusion = gaussian(front - 0.09, 0.1) * envelope
      const scanned = 1 - motionSmooth(-0.07, 0.14, front)
      // A readable dark-to-bright reveal, with a narrow luminous front and a
      // second echo. Both are painted from actual strokes, never a cursor blob.
      dx = beam * 0.011 * edge
      dy = -beam * 0.006 * edge
      size = 1 + beam * 0.09
      intensity = 1 + beam * 0.62 - occlusion * 0.42
      opacity = 1 - (1 - scanned) * envelope * 0.28
      glow = (beam * 1.25 + echo * 0.55) * edge
    }
    out[0] = dx * amount
    out[1] = dy * amount
    out[2] = 1 + (intensity - 1) * amount
    out[3] = 1 + (opacity - 1) * amount
    out[4] = glow * amount
    out[5] = 1 + (size - 1) * amount
    return out
  }

  function buildMotionField(mode: string, time: number, amount: number, cinematic: boolean) {
    if (mode === 'none' || amount === 0) {
      motionField = null
      motionColumns = motionRows = 0
      motionKey = ''
      return
    }
    const columns = Math.max(2, Math.min(96, frame.columns + 1))
    const rows = Math.max(2, Math.min(96, frame.rows + 1))
    const key = `${mode}:${time}:${amount}:${columns}:${rows}:${cinematic}`
    if (motionKey === key) return
    if (!motionField || motionField.length !== columns * rows * 6)
      motionField = new Float32Array(columns * rows * 6)
    motionColumns = columns
    motionRows = rows
    motionKey = key
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const x = column / (columns - 1),
          y = row / (rows - 1),
          edge = motionSmooth(0, 0.12, Math.min(x, 1 - x, y, 1 - y))
        let dx = 0,
          dy = 0,
          intensity = 1,
          opacity = 1,
          glow = 0,
          size = 1
        const nativeMode = mode === 'caustics' || mode === 'reform' ? mode : 'current'
        // Start the repeating native reform just before its dispersal, then retain
        // the complete-image hold. No random per-frame state; seeking is exact.
        if (!cinematic)
          sampleStudioAmbient(nativeMode, x, y, time + (mode === 'reform' ? 2.4 : 0), ambientNative)
        if (cinematic) {
          sampleCinematic(mode, x, y, time, amount, motionSample, row * columns + column)
          dx = motionSample[0]!
          dy = motionSample[1]!
          intensity = motionSample[2]!
          opacity = motionSample[3]!
          glow = motionSample[4]!
          size = motionSample[5]!
        } else if (mode === 'current') {
          dx = (ambientNative[0]! / 960) * 6.5 * amount
          dy = (ambientNative[1]! / 960) * 6.5 * amount
          const fold = Math.abs(ambientNative[0]! * ambientNative[1]!) / 70
          glow = fold * 0.6 * amount
          intensity = 1 - amount * 0.12 + fold * amount * 0.18
        } else if (mode === 'breathe') {
          const breath = 0.5 - 0.5 * Math.cos(time * 0.95)
          const swell = (0.005 + 0.1 * breath) * edge * amount
          dx = (x - 0.5) * swell + (ambientNative[0]! / 960) * amount
          dy = (y - 0.5) * swell + (ambientNative[1]! / 960) * amount
          sampleStudioAmbient('caustics', x, y, time * 0.55, ambientLight)
          intensity = 1 - amount * (1 - breath) * 0.24
          glow = (breath * 0.28 * edge + Math.max(0, ambientLight[2]!) * 1.1) * amount
        } else if (mode === 'wave') {
          const wave = 9 * y - time * 1.65 + Math.sin(5 * x + time * 0.35) * 0.65
          dx = ((ambientNative[0]! / 960) * 1.6 + Math.sin(wave) * 0.035 * edge) * amount
          dy = ((ambientNative[1]! / 960) * 2.1 + Math.cos(wave) * 0.048 * edge) * amount
          intensity = 1 - amount * 0.1 + Math.cos(wave) * amount * 0.12 * edge
          glow = Math.pow(Math.max(0, Math.cos(wave)), 6) * 0.5 * edge * amount
        } else if (mode === 'assemble') {
          const lane = 0.65 * x + 0.2 * y + 0.08 * Math.sin(8 * x - 5 * y)
          const remaining =
            1 - motionSmooth(0.12 + lane * 0.85, 3.15 + lane * 0.85, Math.max(0, time))
          dx = ((0.5 - x) * 0.8 + (ambientNative[0]! / 960) * 6) * remaining * amount
          dy = ((0.5 - y) * 0.72 + (ambientNative[1]! / 960) * 6) * remaining * amount
          opacity = 1 - remaining * amount * 0.85
          intensity = 1 - remaining * amount * 0.12
          glow = remaining * (1 - remaining) * amount * 1.3 * edge
        } else if (mode === 'reform') {
          const scatter = (1 - ambientNative[3]!) / 0.9
          dx = ((ambientNative[0]! / 960) * 8 + (0.5 - x) * scatter * 0.16 * edge) * amount
          dy = (ambientNative[1]! / 960) * 8 * amount
          opacity = 1 + (ambientNative[3]! - 1) * amount
          intensity = 1 + ambientNative[2]! * amount * 0.8
          glow = scatter * (1 - scatter) * 1.4 * edge * amount
        } else if (mode === 'caustics') {
          sampleStudioAmbient('caustics', 1 - x, 1 - y, time + 3, ambientLight)
          const ribbon = Math.max(0, ambientNative[2]!)
          const second = Math.max(0, ambientLight[2]!)
          intensity = 1 + (ambientNative[2]! * 3.3 + ambientLight[2]! * 0.7) * amount
          glow = (ribbon * 3.8 + second * 1.1) * amount
        }
        const offset = (row * columns + column) * 6
        motionField[offset] = dx
        motionField[offset + 1] = dy
        motionField[offset + 2] = intensity
        motionField[offset + 3] = opacity
        motionField[offset + 4] = glow
        motionField[offset + 5] = size
      }
  }
  function sampleMotionField(x: number, y: number) {
    motionSample[0] = motionSample[1] = motionSample[4] = 0
    motionSample[2] = motionSample[3] = motionSample[5] = 1
    if (!motionField) return motionSample
    const px = Math.max(0, Math.min(1, x)) * (motionColumns - 1),
      py = Math.max(0, Math.min(1, y)) * (motionRows - 1),
      ix = Math.min(motionColumns - 2, Math.floor(px)),
      iy = Math.min(motionRows - 2, Math.floor(py)),
      fx = px - ix,
      fy = py - iy,
      a = (iy * motionColumns + ix) * 6,
      b = a + motionColumns * 6
    for (let i = 0; i < 6; i++)
      motionSample[i] =
        (motionField[a + i]! * (1 - fx) + motionField[a + 6 + i]! * fx) * (1 - fy) +
        (motionField[b + i]! * (1 - fx) + motionField[b + 6 + i]! * fx) * fy
    return motionSample
  }
  function buildChoreography(mode: string, time: number, amount: number, cinematic: boolean) {
    const length = frame.columns * frame.rows * 8
    if (
      !cinematic ||
      !motionField ||
      (mode !== 'assemble' && mode !== 'reform') ||
      length * Float64Array.BYTES_PER_ELEMENT > choreographyLimit
    ) {
      choreography = null
      choreographyKey = ''
      return
    }
    if (choreographyKey === motionKey) return
    if (!choreography || choreography.length !== length) choreography = new Float64Array(length)
    for (let y = 0; y < frame.rows; y++)
      for (let x = 0; x < frame.columns; x++) {
        const index = y * frame.columns + x,
          offset = index * 8,
          nx = (x + 0.5) / frame.columns,
          ny = (y + 0.5) / frame.rows
        sampleCinematic(mode, nx, ny, time, amount, motionSample, index)
        for (let i = 0; i < 6; i++) choreography[offset + i] = motionSample[i]!
        sampleCinematic(mode, nx, ny, Math.max(0, time - 0.075), amount, motionSample, index)
        choreography[offset + 6] = motionSample[0]! - choreography[offset]!
        choreography[offset + 7] = motionSample[1]! - choreography[offset + 1]!
      }
    choreographyKey = motionKey
  }
  function makeStudioInteraction(ratio: number) {
    /*! Native interaction and ambient fields adapted from asciify-engine 4.1.0.
    MIT License

    Copyright (c) 2026 ayangabryl

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.

    */
    function studioEdge(t: number, e: number, i: number) {
      const s = Math.min(
          t * Math.max(1, i),
          (1 - t) * Math.max(1, i),
          e * Math.max(1, 1 / i),
          (1 - e) * Math.max(1, 1 / i),
        ),
        a = Math.max(0, Math.min(1, (s - 0.035) / 0.105))
      return a * a * a * (a * (6 * a - 15) + 10)
    }
    const StudioAfterimage = class {
      edgeSafe: boolean
      previous: { x: number; y: number } | null
      peak: number
      mode: string
      width: number
      height: number
      pixels: Uint8Array
      ink: Float32Array
      targetX: Float32Array
      targetY: Float32Array
      offsetX: Float32Array
      offsetY: Float32Array
      edge: Float32Array

      constructor(t: number, e: number) {
        ;((this.edgeSafe = !1),
          (this.previous = null),
          (this.peak = 0),
          (this.mode = 'dissolve'),
          (this.width = t),
          (this.height = e))
        const i = t * e
        ;((this.pixels = new Uint8Array(4 * i)),
          (this.ink = new Float32Array(i)),
          (this.targetX = new Float32Array(i)),
          (this.targetY = new Float32Array(i)),
          (this.offsetX = new Float32Array(i)),
          (this.offsetY = new Float32Array(i)),
          (this.edge = new Float32Array(i)))
        for (let i = 0; i < e; i++)
          for (let s = 0; s < t; s++)
            this.edge[i * t + s]! = studioEdge(s / (t - 1), i / (e - 1), t / e)
        this.clear()
      }
      get active() {
        return this.peak > 2e-4
      }
      setMode(t: string) {
        t !== this.mode && ((this.mode = t), this.clear())
      }
      clear() {
        for (const t of [
          this.ink,
          this.targetX,
          this.targetY,
          this.offsetX,
          this.offsetY,
          this.pixels,
        ])
          t.fill(0)
        if (((this.previous = null), (this.peak = 0), 'dissolve' !== this.mode))
          for (let t = 0; t < this.pixels.length; t += 4)
            this.pixels[t]! = this.pixels[t + 2]! = 128
      }
      leave() {
        this.previous = null
      }
      move(t: number, e: number, i: number) {
        if (!Number.isFinite(t + e + i)) return
        ;((t = Math.max(0, Math.min(1, t))), (e = Math.max(0, Math.min(1, e))))
        const s = this.previous
        this.previous = { x: t, y: e }
        const a = this.width,
          r = this.height,
          o = Math.max(1, a / r),
          n = Math.max(1, r / a),
          h = s ? (t - s.x) * o : 0,
          l = s ? (e - s.y) * n : 0,
          c = Math.hypot(h, l)
        if (!s && 'dissolve' !== this.mode) return
        if (s && c < 1e-4) return
        const m = 0.035 + 0.11 * Math.max(0.1, Math.min(1, i)),
          d = Math.min(128, Math.max(1, Math.ceil(c / (0.45 * m)))),
          f = c ? h / c : 1,
          u = c ? l / c : 0,
          g = Math.min(1, (c / (m * d)) * 2.2)
        for (let i = 0; i < d; i++) {
          const h = (i + 0.5) / d,
            l = s ? s.x + (t - s.x) * h : t,
            c = s ? s.y + (e - s.y) * h : e,
            p = Math.max(0, Math.floor((l - (2.5 * m) / o) * (a - 1))),
            M = Math.min(a - 1, Math.ceil((l + (2.5 * m) / o) * (a - 1))),
            x = Math.max(0, Math.floor((c - (2.5 * m) / n) * (r - 1))),
            v = Math.min(r - 1, Math.ceil((c + (2.5 * m) / n) * (r - 1)))
          for (let t = x; t <= v; t++)
            for (let e = p; e <= M; e++) {
              const i = ((e / (a - 1) - l) * o) / m,
                s = ((t / (r - 1) - c) * n) / m,
                h = Math.exp(1.5 * -(i * i + s * s)),
                d = t * a + e
              if ('dissolve' === this.mode) this.ink[d]! = Math.max(this.ink[d]!, h)
              else {
                const t = (-i * u + s * f) * h * 2.8,
                  e = 'silk' === this.mode ? f * t : -s * h * 2.5,
                  a = 'silk' === this.mode ? u * t : i * h * 2.5
                ;((this.targetX[d]! = Math.max(-1, Math.min(1, this.targetX[d]! + e * g))),
                  (this.targetY[d]! = Math.max(-1, Math.min(1, this.targetY[d]! + a * g))))
              }
            }
        }
        this.peak = 1
      }
      step(t: number) {
        if (!this.active || !Number.isFinite(t)) return
        const e = Math.max(0, Math.min(0.05, t)),
          i = Math.exp(-('dissolve' === this.mode ? 2.15 : 3.2) * e),
          s = 1 - Math.exp(-22 * e)
        let a = 0
        for (let t = 0; t < this.ink.length; t++)
          if ('dissolve' === this.mode) {
            ;((this.ink[t]! *= i), (a = Math.max(a, this.ink[t]!)))
            const e = Math.round(65535 * this.ink[t]!)
            ;((this.pixels[4 * t]! = e >>> 8), (this.pixels[4 * t + 1]! = 255 & e))
          } else {
            ;((this.targetX[t]! *= i),
              (this.targetY[t]! *= i),
              (this.offsetX[t]! += (this.targetX[t]! - this.offsetX[t]!) * s),
              (this.offsetY[t]! += (this.targetY[t]! - this.offsetY[t]!) * s),
              (a = Math.max(
                a,
                Math.abs(this.offsetX[t]!),
                Math.abs(this.offsetY[t]!),
                Math.abs(this.targetX[t]!),
                Math.abs(this.targetY[t]!),
              )))
            const e = Math.round(
                this.offsetX[t]! * (this.edgeSafe ? this.edge[t]! : 1) * 32767 + 32768,
              ),
              r = Math.round(this.offsetY[t]! * (this.edgeSafe ? this.edge[t]! : 1) * 32767 + 32768)
            ;((this.pixels[4 * t]! = e >>> 8),
              (this.pixels[4 * t + 1]! = 255 & e),
              (this.pixels[4 * t + 2]! = r >>> 8),
              (this.pixels[4 * t + 3]! = 255 & r))
          }
        ;((this.peak = a), this.active || this.clear())
      }
      sample(t: number, e: number, i: Float32Array) {
        const s = Math.max(0, Math.min(this.width - 1.001, t * (this.width - 1))),
          a = Math.max(0, Math.min(this.height - 1.001, e * (this.height - 1))),
          r = Math.floor(s),
          o = Math.floor(a),
          n = s - r,
          h = a - o,
          l = o * this.width + r,
          c = l + this.width,
          m = (t: Float32Array) =>
            (t[l]! * (1 - n) + t[l + 1]! * n) * (1 - h) + (t[c]! * (1 - n) + t[c + 1]! * n) * h
        ;((i[0]! =
          m(this.offsetX) *
          (this.edgeSafe ? studioEdge(t, e, this.width / this.height) : 1) *
          0.08),
          (i[1]! =
            m(this.offsetY) *
            (this.edgeSafe ? studioEdge(t, e, this.width / this.height) : 1) *
            0.08),
          (i[2]! = 'dissolve' === this.mode ? 6 * -m(this.ink) : 0))
      }
    }
    const StudioContour = class {
      rings: { x: number; y: number; age: number; radius: number }[]
      previous: { x: number; y: number } | null
      elapsed: number
      echoPeak: number
      width: number
      height: number
      pixels: Uint8Array
      echo: Float32Array

      constructor(t: number, e: number) {
        ;((this.rings = []),
          (this.previous = null),
          (this.elapsed = 1),
          (this.echoPeak = 0),
          (this.width = t),
          (this.height = e),
          (this.pixels = new Uint8Array(t * e * 4)),
          (this.echo = new Float32Array(t * e)))
      }
      get active() {
        return this.rings.length > 0 || this.echoPeak > 2e-4
      }
      clear() {
        ;((this.rings = []),
          (this.previous = null),
          (this.elapsed = 1),
          this.pixels.fill(0),
          this.echo.fill(0),
          (this.echoPeak = 0))
      }
      leave() {
        this.previous = null
      }
      move(t: number, e: number, i: number) {
        const s = Math.max(1, this.width / this.height),
          a = Math.max(1, this.height / this.width)
        ;(this.previous &&
          (Math.hypot((t - this.previous.x) * s, (e - this.previous.y) * a) < 0.065 ||
            this.elapsed < 0.3)) ||
          (4 !== this.rings.length &&
            ((this.previous = { x: t, y: e }),
            (this.elapsed = 0),
            this.rings.push({ x: t, y: e, age: 0, radius: i })))
      }
      ringSample(t: number, e: number) {
        const i = Math.max(1, this.width / this.height),
          s = Math.max(1, this.height / this.width)
        let a = 0
        for (const r of this.rings) {
          const o = 0.015 + r.age * (0.15 + 0.22 * r.radius),
            n = 0.009 + 0.014 * r.radius,
            h = (Math.hypot((t - r.x) * i, (e - r.y) * s) - o) / n,
            l =
              Math.sin((Math.min(1, r.age / 0.07) * Math.PI) / 2) *
              Math.max(0, 1 - r.age / 1.35) ** 2
          a = Math.max(a, Math.exp(-h * h) * l)
        }
        return a
      }
      sample(t: number, e: number) {
        const i = Math.max(0, Math.min(this.width - 1, Math.round(t * (this.width - 1)))),
          s = Math.max(0, Math.min(this.height - 1, Math.round(e * (this.height - 1))))
        return Math.max(this.ringSample(t, e), this.echo[s * this.width + i]!)
      }
      step(t: number) {
        if (!Number.isFinite(t)) return
        const e = Math.max(0, Math.min(0.05, t))
        this.elapsed += e
        for (const t of this.rings) t.age += e
        if (((this.rings = this.rings.filter((t) => t.age < 1.35)), !this.active))
          return void this.pixels.fill(0)
        const i = Math.exp(-5.5 * e)
        let s = 0
        for (let t = 0; t < this.height; t++)
          for (let e = 0; e < this.width; e++) {
            const a = t * this.width + e
            ;((this.echo[a]! = Math.max(
              this.ringSample(e / (this.width - 1), t / (this.height - 1)),
              this.echo[a]! * i,
            )),
              (s = Math.max(s, this.echo[a]!)))
            const r = Math.round(65535 * this.echo[a]!),
              o = 4 * a
            ;((this.pixels[o]! = r >>> 8), (this.pixels[o + 1]! = 255 & r))
          }
        ;((this.echoPeak = s), this.active || (this.echo.fill(0), this.pixels.fill(0)))
      }
    }
    const StudioFluidTrail = class {
      previous: { x: number; y: number; time: number } | null
      peak: number
      width: number
      height: number
      pixels: Uint8Array
      signal: Float32Array
      offsetX: Float32Array
      offsetY: Float32Array
      driftX: Float32Array
      driftY: Float32Array
      u: Float32Array
      v: Float32Array
      ink: Float32Array
      a: Float32Array
      b: Float32Array
      c: Float32Array
      pressure: Float32Array
      pressureNext: Float32Array
      divergence: Float32Array
      curl: Float32Array

      constructor(t: number, e: number) {
        ;((this.previous = null), (this.peak = 0), (this.width = t), (this.height = e))
        const i = t * e
        ;((this.pixels = new Uint8Array(4 * i)),
          (this.signal = new Float32Array(i)),
          (this.offsetX = new Float32Array(i)),
          (this.offsetY = new Float32Array(i)),
          (this.driftX = new Float32Array(i)),
          (this.driftY = new Float32Array(i)),
          (this.u = new Float32Array(i)),
          (this.v = new Float32Array(i)),
          (this.ink = new Float32Array(i)),
          (this.a = new Float32Array(i)),
          (this.b = new Float32Array(i)),
          (this.c = new Float32Array(i)),
          (this.pressure = new Float32Array(i)),
          (this.pressureNext = new Float32Array(i)),
          (this.divergence = new Float32Array(i)),
          (this.curl = new Float32Array(i)))
      }
      get active() {
        return this.peak > 2e-4
      }
      clear() {
        for (const t of [
          this.u,
          this.v,
          this.ink,
          this.a,
          this.b,
          this.c,
          this.pressure,
          this.pressureNext,
          this.divergence,
          this.curl,
          this.signal,
          this.pixels,
          this.offsetX,
          this.offsetY,
          this.driftX,
          this.driftY,
        ])
          t.fill(0)
        ;((this.previous = null), (this.peak = 0))
      }
      leave() {
        this.previous = null
      }
      move(t: number, e: number, i: number, s = performance.now()) {
        if (!Number.isFinite(t + e + i + s)) return
        ;((t = Math.max(0, Math.min(1, t))),
          (e = Math.max(0, Math.min(1, e))),
          (i = Math.max(0.1, Math.min(1, i))))
        const a = this.previous
        if (((this.previous = { x: t, y: e, time: s }), !a)) return
        const r = (t - a.x) * (this.width - 1),
          o = (e - a.y) * (this.height - 1),
          n = Math.hypot(r, o)
        if (n < 0.001) return
        const h = Math.min(this.width, this.height),
          l = s > a.time ? Math.max(1 / 240, (s - a.time) / 1e3) : 1 / 60,
          c = Math.min(12, n / h / l),
          m = 1 - Math.exp(-c / 2.2),
          d = h * (0.022 + 0.075 * i) * (0.65 + 0.95 * m),
          f = Math.min(128, Math.max(1, Math.ceil(n / (0.4 * d)))),
          u = ((n / d) * (0.32 + 0.22 * m)) / f,
          g = r / n,
          p = o / n,
          M = -p,
          x = g,
          v = (n * (2 + 18 * m)) / f
        for (let i = 0; i < f; i++) {
          const s = (i + 0.5) / f,
            r = (a.x + (t - a.x) * s) * (this.width - 1),
            o = (a.y + (e - a.y) * s) * (this.height - 1),
            n = Math.max(1, Math.floor(r - 3 * d)),
            h = Math.min(this.width - 2, Math.ceil(r + 3 * d)),
            l = Math.max(1, Math.floor(o - 3 * d)),
            c = Math.min(this.height - 2, Math.ceil(o + 3 * d))
          for (let t = l; t <= c; t++)
            for (let e = n; e <= h; e++) {
              const i = ((e - r) * g + (t - o) * p) / d,
                s = ((e - r) * M + (t - o) * x) / d,
                a = Math.exp(-i * i * 0.65 - s * s * 1.7),
                n = t * this.width + e
              this.ink[n]! = 1 - (1 - this.ink[n]!) * Math.exp(-a * u)
              const h = 1 - s * s * 0.55,
                l = i * s * 0.7
              ;((this.u[n]! = Math.max(-80, Math.min(80, this.u[n]! + (g * h + M * l) * a * v))),
                (this.v[n]! = Math.max(-80, Math.min(80, this.v[n]! + (p * h + x * l) * a * v))))
            }
        }
        this.peak = 1
      }
      read(t: Float32Array, e: number, i: number) {
        const s = 0 | (e = Math.max(0.5, Math.min(this.width - 1.5, e))),
          a = 0 | (i = Math.max(0.5, Math.min(this.height - 1.5, i))),
          r = e - s,
          o = i - a,
          n = a * this.width + s
        return (
          (t[n]! * (1 - r) + t[n + 1]! * r) * (1 - o) +
          (t[n + this.width]! * (1 - r) + t[n + this.width + 1]! * r) * o
        )
      }
      sample(t: number, e: number) {
        return this.read(this.signal, t * (this.width - 1), e * (this.height - 1))
      }
      displacement(t: number, e: number, i: Float32Array) {
        ;((i[0]! = this.read(this.offsetX, t * (this.width - 1), e * (this.height - 1))),
          (i[1]! = this.read(this.offsetY, t * (this.width - 1), e * (this.height - 1))))
      }
      step(t: number) {
        if (!this.active || !Number.isFinite(t)) return
        let e = Math.max(0, Math.min(0.05, t))
        const i = this.width,
          s = this.height
        for (; e > 1e-7;) {
          const t = Math.min(1 / 60, e)
          e -= t
          const a = Math.exp(-1.9 * t),
            r = Math.exp(-3.2 * t)
          for (let e = 1; e < s - 1; e++)
            for (let o = 1; o < i - 1; o++) {
              const n = e * i + o,
                h = Math.max(0.5, Math.min(i - 1.5, o - this.u[n]! * t)),
                l = Math.max(0.5, Math.min(s - 1.5, e - this.v[n]! * t)),
                c = 0 | h,
                m = 0 | l,
                d = h - c,
                f = l - m,
                u = m * i + c,
                g = (1 - d) * (1 - f),
                p = d * (1 - f),
                M = (1 - d) * f,
                x = d * f
              ;((this.a[n]! =
                (this.u[u]! * g +
                  this.u[u + 1]! * p +
                  this.u[u + i]! * M +
                  this.u[u + i + 1]! * x) *
                a),
                (this.b[n]! =
                  (this.v[u]! * g +
                    this.v[u + 1]! * p +
                    this.v[u + i]! * M +
                    this.v[u + i + 1]! * x) *
                  a),
                (this.c[n]! =
                  (this.ink[u]! * g +
                    this.ink[u + 1]! * p +
                    this.ink[u + i]! * M +
                    this.ink[u + i + 1]! * x) *
                  r))
            }
          ;(([this.u, this.a] = [this.a, this.u]),
            ([this.v, this.b] = [this.b, this.v]),
            ([this.ink, this.c] = [this.c, this.ink]))
          for (let t = 1; t < s - 1; t++)
            for (let e = 1; e < i - 1; e++) {
              const s = t * i + e
              this.curl[s]! =
                0.5 * (this.v[s + 1]! - this.v[s - 1]! - this.u[s + i]! + this.u[s - i]!)
            }
          for (let e = 1; e < s - 1; e++)
            for (let s = 1; s < i - 1; s++) {
              const a = e * i + s,
                r = Math.abs(this.curl[a + 1]!) - Math.abs(this.curl[a - 1]!),
                o = Math.abs(this.curl[a + i]!) - Math.abs(this.curl[a - i]!),
                n = Math.hypot(r, o) + 1e-4,
                h = this.curl[a]! * t * 10,
                l = Math.hypot(this.u[a]!, this.v[a]!)
              ;((this.u[a]! += (o / n) * h), (this.v[a]! -= (r / n) * h))
              const c = Math.min(1, l / (Math.hypot(this.u[a]!, this.v[a]!) + 1e-6))
              ;((this.u[a]! *= c),
                (this.v[a]! *= c),
                (this.divergence[a]! =
                  -0.5 * (this.u[a + 1]! - this.u[a - 1]! + this.v[a + i]! - this.v[a - i]!)))
            }
          this.pressure.fill(0)
          for (let t = 0; t < 4; t++) {
            for (let t = 1; t < s - 1; t++)
              for (let e = 1; e < i - 1; e++) {
                const s = t * i + e
                this.pressureNext[s]! =
                  0.25 *
                  (this.divergence[s]! +
                    this.pressure[s - 1]! +
                    this.pressure[s + 1]! +
                    this.pressure[s - i]! +
                    this.pressure[s + i]!)
              }
            ;[this.pressure, this.pressureNext] = [this.pressureNext, this.pressure]
          }
          let o = 0
          for (let e = 1; e < s - 1; e++)
            for (let s = 1; s < i - 1; s++) {
              const a = e * i + s
              ;((this.u[a]! = Math.max(
                -80,
                Math.min(80, this.u[a]! - 0.5 * (this.pressure[a + 1]! - this.pressure[a - 1]!)),
              )),
                (this.v[a]! = Math.max(
                  -80,
                  Math.min(80, this.v[a]! - 0.5 * (this.pressure[a + i]! - this.pressure[a - i]!)),
                )),
                (this.driftX[a]! +=
                  (3.6 * this.u[a]! - 58 * this.offsetX[a]! - 12 * this.driftX[a]!) * t),
                (this.driftY[a]! +=
                  (3.6 * this.v[a]! - 58 * this.offsetY[a]! - 12 * this.driftY[a]!) * t),
                (this.offsetX[a]! = Math.max(
                  -2,
                  Math.min(2, this.offsetX[a]! + this.driftX[a]! * t),
                )),
                (this.offsetY[a]! = Math.max(
                  -2,
                  Math.min(2, this.offsetY[a]! + this.driftY[a]! * t),
                )),
                (this.signal[a]! =
                  1 - Math.exp(0.06 * -Math.hypot(this.u[a]!, this.v[a]!) - 0.16 * this.ink[a]!)),
                (o = Math.max(o, this.signal[a]!)))
            }
          this.peak = o
        }
        if (this.active)
          for (let t = 0; t < this.ink.length; t++) {
            const e = Math.round(65535 * Math.min(1, this.signal[t]!))
            ;((this.pixels[4 * t]! = e >>> 8),
              (this.pixels[4 * t + 1]! = 255 & e),
              (this.pixels[4 * t + 2]! = Math.round(128 + 63.5 * this.offsetX[t]!)),
              (this.pixels[4 * t + 3]! = Math.round(128 + 63.5 * this.offsetY[t]!)))
          }
        else this.clear()
      }
    }
    const StudioInteraction = class {
      mode: string
      amount: number
      radius: number
      lensX: number
      lensY: number
      lensStrength: number
      previous: { x: number; y: number } | null
      energy: number
      pending: boolean
      remainder: number
      columns: number
      rows: number
      xScale: number
      yScale: number
      trail: InstanceType<typeof StudioFluidTrail>
      contour: InstanceType<typeof StudioContour>
      afterimage: InstanceType<typeof StudioAfterimage>
      refraction: {
        width: number
        height: number
        pixels: Uint8Array
        strength: number
        mode: string
        focus: [number, number, number, number]
        edgeSafe?: boolean
      }
      heights: Float32Array
      velocity: Float32Array
      next: Float32Array
      normals: Float32Array
      edgeMask: Float32Array
      waterPixels: Uint8Array

      constructor(t = 1) {
        ;((this.mode = 'water'),
          (this.amount = 0.55),
          (this.radius = 0.2),
          (this.lensX = 0.5),
          (this.lensY = 0.5),
          (this.lensStrength = 0),
          (this.previous = null),
          (this.energy = 0),
          (this.pending = !1),
          (this.remainder = 0),
          (t = Math.max(0.25, Math.min(4, t))),
          (this.columns = Math.round(t >= 1 ? 128 : 128 * t)),
          (this.rows = Math.round(t >= 1 ? 128 / t : 128)),
          (this.xScale = Math.max(1, t)),
          (this.yScale = Math.max(1, 1 / t)),
          (this.heights = new Float32Array(this.columns * this.rows)),
          (this.velocity = new Float32Array(this.heights.length)),
          (this.next = new Float32Array(this.heights.length)),
          (this.normals = new Float32Array(2 * this.heights.length)),
          (this.edgeMask = new Float32Array(this.heights.length)))
        for (let e = 0; e < this.rows; e++)
          for (let i = 0; i < this.columns; i++)
            this.edgeMask[e * this.columns + i]! = studioEdge(
              i / (this.columns - 1),
              e / (this.rows - 1),
              t,
            )
        ;((this.refraction = {
          width: this.columns,
          height: this.rows,
          pixels: new Uint8Array(4 * this.heights.length),
          strength: 30,
          mode: 'water',
          focus: [0.5, 0.5, 0, 0.2],
        }),
          (this.waterPixels = this.refraction.pixels),
          (this.trail = new StudioFluidTrail(this.columns, this.rows)),
          (this.contour = new StudioContour(this.columns, this.rows)),
          (this.afterimage = new StudioAfterimage(this.columns, this.rows)),
          this.clear())
      }
      get invertsDensity() {
        return 'trail' === this.mode
      }
      get densityTrail() {
        return ['trail', 'contour', 'dissolve'].includes(this.mode)
      }
      get hasRefraction() {
        return this.active || this.lensStrength > 15e-5
      }
      get active() {
        return ['dissolve', 'silk', 'vortex'].includes(this.mode)
          ? this.afterimage.active
          : 'contour' === this.mode
            ? this.contour.active
            : 'trail' === this.mode
              ? this.trail.active
              : this.pending || this.energy > 15e-5
      }
      setMode(t: string) {
        t !== this.mode &&
          (this.clear(),
          (this.mode = t),
          (this.refraction.mode = t),
          ('dissolve' !== t && 'silk' !== t && 'vortex' !== t) || this.afterimage.setMode(t),
          (this.refraction.pixels =
            'trail' === t
              ? this.trail.pixels
              : 'contour' === t
                ? this.contour.pixels
                : ['dissolve', 'silk', 'vortex'].includes(t)
                  ? this.afterimage.pixels
                  : this.waterPixels),
          (this.refraction.strength =
            'water' === t
              ? (30 * this.amount) / 0.55
              : 'silk' === t
                ? 28 * this.amount
                : 'vortex' === t
                  ? 38 * this.amount
                  : 0))
      }
      configure(t: string, e = 0.55, i = 0.2, s = !1) {
        ;(this.setMode(t),
          (this.refraction.edgeSafe = s),
          (this.afterimage.edgeSafe = s),
          (this.amount = Number.isFinite(e) ? Math.max(0, Math.min(1, e)) : 0.55),
          (this.radius = Number.isFinite(i) ? Math.max(0.1, Math.min(1, i)) : 0.2),
          (this.refraction.strength =
            'water' === t
              ? (30 * this.amount) / 0.55
              : 'silk' === t
                ? 28 * this.amount
                : 'vortex' === t
                  ? 38 * this.amount
                  : 0),
          (this.refraction.focus[2]! = this.densityTrail
            ? this.amount
            : this.lensStrength * this.amount),
          (this.refraction.focus[3]! = this.radius))
      }
      move(t: number, e: number, i: number) {
        if ('none' === this.mode || 0 === this.amount) return
        if (!Number.isFinite(t + e)) return
        if (
          ((t = Math.max(0, Math.min(1, t))),
          (e = Math.max(0, Math.min(1, e))),
          ['dissolve', 'silk', 'vortex'].includes(this.mode))
        )
          return void this.afterimage.move(t, e, this.radius)
        if ('contour' === this.mode) return void this.contour.move(t, e, this.radius)
        if ('trail' === this.mode) return void this.trail.move(t, e, this.radius, i)
        if ('water' !== this.mode)
          return (
            !this.previous && this.lensStrength < 0.001 && ((this.lensX = t), (this.lensY = e)),
            (this.previous = { x: t, y: e }),
            void (this.pending = !0)
          )
        if (!this.previous) return void (this.previous = { x: t, y: e })
        const s = this.previous
        this.previous = { x: t, y: e }
        const a = (t - s.x) * this.xScale,
          r = (e - s.y) * this.yScale,
          o = Math.hypot(a, r)
        if (o < 1e-5) return
        const n = 0.035 + 0.1 * this.radius,
          h = 3 * n,
          l = Math.min(192, Math.max(1, Math.ceil(o / (0.5 * n)))),
          c = (95 * Math.min(o, 1)) / l
        for (let i = 0; i < l; i++) {
          const a = (i + 0.5) / l,
            r = s.x + (t - s.x) * a,
            o = s.y + (e - s.y) * a,
            m = Math.max(1, Math.floor((r - h / this.xScale) * (this.columns - 1))),
            d = Math.min(this.columns - 2, Math.ceil((r + h / this.xScale) * (this.columns - 1))),
            f = Math.max(1, Math.floor((o - h / this.yScale) * (this.rows - 1))),
            u = Math.min(this.rows - 2, Math.ceil((o + h / this.yScale) * (this.rows - 1)))
          for (let t = f; t <= u; t++)
            for (let e = m; e <= d; e++) {
              const i = (e / (this.columns - 1) - r) * this.xScale,
                s = (t / (this.rows - 1) - o) * this.yScale,
                a = Math.exp(-(i * i + s * s) / (n * n)) * c,
                h = t * this.columns + e
              this.velocity[h]! = Math.max(-12, this.velocity[h]! - a)
            }
        }
        this.pending = !0
      }
      leave() {
        ;(this.afterimage.leave(),
          this.contour.leave(),
          this.trail.leave(),
          (this.previous = null),
          'water' !== this.mode && this.lensStrength && (this.pending = !0))
      }
      clear() {
        ;(this.trail.clear(),
          this.contour.clear(),
          this.afterimage.clear(),
          this.heights.fill(0),
          this.velocity.fill(0),
          this.next.fill(0),
          this.normals.fill(0),
          (this.refraction.focus[2]! = 0),
          (this.previous = null),
          (this.lensStrength = 0),
          (this.energy = 0),
          (this.pending = !1),
          (this.remainder = 0))
        for (let t = 0; t < this.waterPixels.length; t += 4)
          ((this.waterPixels[t]! = this.waterPixels[t + 2]! = 128),
            (this.waterPixels[t + 1]! = this.waterPixels[t + 3]! = 0))
      }
      step(t: number) {
        if (!this.active || !Number.isFinite(t)) return
        if (['dissolve', 'silk', 'vortex'].includes(this.mode)) return void this.afterimage.step(t)
        if ('contour' === this.mode) return void this.contour.step(t)
        if ('trail' === this.mode) return void this.trail.step(t)
        if ('water' !== this.mode) return void this.stepLight(Math.max(0, Math.min(0.05, t)))
        this.remainder += Math.max(0, Math.min(0.05, t))
        const e = 1 / 120,
          i = Math.exp(-3.8 * e),
          s = 0.3 * Math.min(this.columns, this.rows)
        for (; this.remainder + 1e-8 >= e;) {
          this.remainder -= e
          let t = 0
          for (let a = 1; a < this.rows - 1; a++)
            for (let r = 1; r < this.columns - 1; r++) {
              const o = a * this.columns + r,
                n = this.heights[o]!,
                h =
                  this.heights[o - 1]! +
                  this.heights[o + 1]! +
                  this.heights[o - this.columns]! +
                  this.heights[o + this.columns]! -
                  4 * n,
                l = Math.min(r, a, this.columns - 1 - r, this.rows - 1 - a),
                c = l < 5 ? 0.88 + 0.024 * l : 1,
                m = (this.velocity[o]! + (h * s * s - 8 * n) * e) * i * c
              ;((this.velocity[o]! = m),
                (this.next[o]! = (n + m * e) * c),
                (t = Math.max(t, Math.abs(this.next[o]!), 0.1 * Math.abs(m))))
            }
          ;(this.heights.set(this.next), (this.energy = t), (this.pending = !1))
        }
        if (!this.active) return void this.clear()
        const a = 0.18 * Math.min(this.columns, this.rows)
        for (let t = 0; t < this.rows; t++)
          for (let e = 0; e < this.columns; e++) {
            const i = t * this.columns + e,
              s =
                (this.heights[t * this.columns + Math.max(0, e - 1)]! -
                  this.heights[t * this.columns + Math.min(this.columns - 1, e + 1)]!) *
                a,
              r =
                (this.heights[Math.max(0, t - 1) * this.columns + e]! -
                  this.heights[Math.min(this.rows - 1, t + 1) * this.columns + e]!) *
                a,
              o = Math.tanh(s) * (this.refraction.edgeSafe ? this.edgeMask[i]! : 1),
              n = Math.tanh(r) * (this.refraction.edgeSafe ? this.edgeMask[i]! : 1)
            ;((this.normals[2 * i]! = o), (this.normals[2 * i + 1]! = n))
            const h = Math.round(32767 * o + 32768),
              l = Math.round(32767 * n + 32768)
            ;((this.refraction.pixels[4 * i]! = h >>> 8),
              (this.refraction.pixels[4 * i + 1]! = 255 & h),
              (this.refraction.pixels[4 * i + 2]! = l >>> 8),
              (this.refraction.pixels[4 * i + 3]! = 255 & l))
          }
      }
      stepLight(t: number) {
        const e = this.previous,
          i = 1 - Math.exp(-30 * t),
          s = 1 - Math.exp(-12 * t)
        ;(e && ((this.lensX += (e.x - this.lensX) * i), (this.lensY += (e.y - this.lensY) * i)),
          (this.lensStrength += ((e ? 1 : 0) - this.lensStrength) * s),
          (this.energy = Math.max(
            e ? Math.abs(e.x - this.lensX) + Math.abs(e.y - this.lensY) : 0,
            Math.abs((e ? 1 : 0) - this.lensStrength),
          )),
          (this.pending = !1),
          e || this.active
            ? (this.refraction.focus = [
                this.lensX,
                this.lensY,
                this.lensStrength * this.amount,
                this.radius,
              ])
            : this.clear())
      }
      sample(t: number, e: number, i: Float32Array) {
        if (['dissolve', 'silk', 'vortex'].includes(this.mode))
          return (
            this.afterimage.sample(t, e, i),
            (i[0]! *= this.amount),
            (i[1]! *= this.amount),
            void (i[2]! *= this.amount)
          )
        if ('contour' === this.mode)
          return ((i[0]! = i[1]! = 0), void (i[2]! = this.contour.sample(t, e) * this.amount * 3))
        if ('trail' === this.mode)
          return ((i[0]! = i[1]! = 0), void (i[2]! = this.trail.sample(t, e) * this.amount * 3))
        const s = Math.max(0, Math.min(this.columns - 1.001, t * (this.columns - 1))),
          a = Math.max(0, Math.min(this.rows - 1.001, e * (this.rows - 1))),
          r = Math.floor(s),
          o = Math.floor(a),
          n = s - r,
          h = a - o,
          l = 2 * (o * this.columns + r),
          c = l + 2 * this.columns
        for (let t = 0; t < 2; t++)
          i[t]! =
            0.08 *
            ((this.normals[l + t]! * (1 - n) + this.normals[l + 2 + t]! * n) * (1 - h) +
              (this.normals[c + t]! * (1 - n) + this.normals[c + 2 + t]! * n) * h)
        ;((i[0]! *= this.amount / 0.55),
          (i[1]! *= this.amount / 0.55),
          (i[2]! =
            'light' === this.mode || 'scan' === this.mode
              ? (function (t, e, i, s) {
                  const [a, r, o, n] = i.focus,
                    h = ((t - a) * Math.max(1, s)) / n,
                    l = ((e - r) * Math.max(1, 1 / s)) / n
                  return 'light' === i.mode
                    ? Math.exp(-3 * (h * h + l * l)) * o
                    : 'scan' === i.mode
                      ? (1.3 * Math.exp(-h * h * 110) - 0.3 * Math.exp(-h * h * 12)) *
                        Math.exp(-l * l * 1.8) *
                        o
                      : 0
                })(t, e, this.refraction, this.xScale / this.yScale)
              : 0))
      }
    }

    return new StudioInteraction(ratio)
  }

  let interaction: ReturnType<typeof makeStudioInteraction> | null = null
  let interactionRatio = 0
  let interactionClock = -1
  let interactionMode = ''
  let interactionPointer: { x: number; y: number } | null = null
  const interactionSample = new Float32Array(3)
  const interactionOffset = new Float32Array(2)

  function sampleFluidField(x: number, y: number): ArtFluidFieldSample {
    const field = interaction?.mode === 'trail' ? interaction.trail : null
    if (!field?.active)
      return { velocityX: 0, velocityY: 0, offsetX: 0, offsetY: 0, density: 0, active: false }
    const px = clamp(x, 0, 1) * (field.width - 1),
      py = clamp(y, 0, 1) * (field.height - 1)
    return {
      velocityX: field.read(field.u, px, py) / (field.width - 1),
      velocityY: field.read(field.v, px, py) / (field.height - 1),
      offsetX: field.read(field.offsetX, px, py) / (field.width - 1),
      offsetY: field.read(field.offsetY, px, py) / (field.height - 1),
      density: field.sample(clamp(x, 0, 1), clamp(y, 0, 1)),
      active: true,
    }
  }
  let coverageOrder: number[] = []
  let coverageGlyphs: ArtFrame['glyphs'] | null = null
  const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
  const canvas = (width: number, height: number) => {
    const c = prototype.createSurface?.() ?? document.createElement('canvas')
    c.width = width
    c.height = height
    return c
  }
  function tile(glyphIndex: number, color: string) {
    const key = `${glyphIndex}:${color}`
    const existing = tinted.get(key)
    if (existing) {
      hits++
      return existing
    }
    misses++
    scratch ??=
      typeof OffscreenCanvas === 'undefined'
        ? canvas(frame.cellWidth, frame.cellHeight)
        : new OffscreenCanvas(frame.cellWidth, frame.cellHeight)
    const context = scratch.getContext('2d')! as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
    context.globalCompositeOperation = 'source-over'
    context.clearRect(0, 0, frame.cellWidth, frame.cellHeight)
    context.drawImage(frame.glyphs[glyphIndex]!.tile, 0, 0)
    context.globalCompositeOperation = 'source-in'
    context.fillStyle = color
    context.fillRect(0, 0, frame.cellWidth, frame.cellHeight)
    const bytes = frame.cellWidth * frame.cellHeight * 4
    // Saturation uses one reusable scratch, rather than evicting early cells and
    // rebuilding every color on the next frame. No color quantization or filtering.
    if (tinted.size >= maxEntries || backingBytes + bytes > maxBackingBytes) return scratch
    let result: HTMLCanvasElement | ImageBitmap
    if (typeof OffscreenCanvas !== 'undefined' && scratch instanceof OffscreenCanvas)
      result = scratch.transferToImageBitmap()
    else {
      result = canvas(frame.cellWidth, frame.cellHeight)
      result.getContext('2d')!.drawImage(scratch, 0, 0)
    }
    tinted.set(key, result)
    backingBytes += bytes
    return result
  }

  function clearTiles() {
    for (const value of tinted.values()) if ('close' in value) value.close()
    tinted.clear()
    backingBytes = 0
  }

  // Shared by ordinary Canvas, the area raster and the offline HTML runtime.
  // Positions change; glyph orientation, indices and phrase order never change.
  function* effects(options: ArtRenderOptions, w: number, h: number) {
    const motion = options.motion ?? 'none',
      hover = options.hover ?? 'displace'
    const expressive =
      options.effectProfile === 'expressive' ||
      options.motionStyle === 'cinematic' ||
      ['current', 'reform', 'caustics'].includes(motion) ||
      ['trail', 'rift', 'particles', 'water', 'silk', 'vortex', 'contour', 'dissolve'].includes(
        hover,
      )
    const time = (options.time ?? 0) * clamp(options.motionSpeed ?? 1, 0.2, 2)
    const interactionTime = options.hoverTime ?? options.time ?? 0
    const amount = clamp(options.motionStrength ?? 0.65, 0, 1)
    const cinematic = options.motionStyle === 'cinematic'
    buildMotionField(expressive ? motion : 'none', time, amount, cinematic)
    buildChoreography(motion, time, amount, cinematic)
    const pointer = options.pointer
    const fieldMode =
      hover === 'rift' || hover === 'particles'
        ? 'trail'
        : hover === 'ripple'
          ? 'water'
          : hover === 'displace'
            ? 'silk'
            : hover
    const strength =
      hover === 'particles' && frame.columns * frame.rows > 131072
        ? 0
        : clamp(options.hoverStrength ?? pointer?.strength ?? 0, 0, 1)
    if (hover !== 'particles' && particlePresentation.active) particlePresentation.reset()
    if (expressive && pointer && strength > 0) {
      if (!interaction || Math.abs(interactionRatio - w / h) > 0.001) {
        interaction = makeStudioInteraction(w / h)
        interactionRatio = w / h
        interactionClock = -1
        interactionPointer = null
      }
      if (interactionMode !== fieldMode || interactionTime < interactionClock) {
        interaction.clear()
        interactionPointer = null
      }
      interactionMode = fieldMode
      interaction.configure(fieldMode, strength, options.hoverRadius ?? 0.38, false)
      const gap = interactionTime - interactionClock
      if (
        (hover === 'particles' || hover === 'light') &&
        interactionClock >= 0 &&
        gap > 0.25 &&
        Number.isFinite(interactionTime) &&
        interactionTime <= 1e9
      ) {
        const startClock = interactionClock
        let clock = startClock,
          steps = 0,
          sliceStart = performance.now()
        const field = interaction
        function* advanceTo(end: number) {
          while (end - clock > 1e-8 && (field.active || particlePresentation.active)) {
            const step = Math.min(0.05, end - clock)
            field.step(step)
            clock += step
            if (hover === 'particles')
              particlePresentation.prepare(sampleFluidField, frame, strength, w, h, clock)
            steps++
            if (performance.now() - sliceStart >= 8) {
              yield {
                completedSeconds: Math.min(gap, Math.max(0, clock - startClock)),
                totalSeconds: gap,
                completedSteps: steps,
              }
              sliceStart = performance.now()
            }
          }
          // A quiet interval needs no PDE steps, but the spring clock still advances.
          clock = end
          if (hover === 'particles')
            particlePresentation.prepare(sampleFluidField, frame, strength, w, h, clock)
        }
        for (const sample of options.pointerSamples?.slice(-128) ?? []) {
          if (!Number.isFinite(sample.x + sample.y + sample.time)) continue
          yield* advanceTo(clamp(sample.time / 1000, clock, interactionTime))
          if (!sample.active) {
            field.leave()
            interactionPointer = null
          } else {
            field.move(clamp(sample.x, 0, 1), clamp(sample.y, 0, 1), sample.time)
            interactionPointer = { x: sample.x, y: sample.y }
          }
        }
        const active = pointer.active ?? pointer.strength > 0.001
        if (
          active &&
          (!interactionPointer ||
            pointer.x !== interactionPointer.x ||
            pointer.y !== interactionPointer.y)
        ) {
          yield* advanceTo(interactionTime)
          field.move(pointer.x, pointer.y, interactionTime * 1000)
          interactionPointer = { x: pointer.x, y: pointer.y }
        } else if (!active && interactionPointer) {
          field.leave()
          interactionPointer = null
        }
        yield* advanceTo(interactionTime)
        interactionClock = interactionTime
      } else {
        for (const sample of options.pointerSamples?.slice(-128) ?? []) {
          if (!sample.active) {
            interaction.leave()
            interactionPointer = null
          } else if (Number.isFinite(sample.x + sample.y + sample.time)) {
            interaction.move(clamp(sample.x, 0, 1), clamp(sample.y, 0, 1), sample.time)
            interactionPointer = { x: sample.x, y: sample.y }
          }
        }
        const active = pointer.active ?? pointer.strength > 0.001
        if (
          active &&
          (!interactionPointer ||
            pointer.x !== interactionPointer.x ||
            pointer.y !== interactionPointer.y)
        ) {
          interaction.move(pointer.x, pointer.y, interactionTime * 1000)
          interactionPointer = { x: pointer.x, y: pointer.y }
        } else if (!active && interactionPointer) {
          interaction.leave()
          interactionPointer = null
        }
        let delta = interactionClock < 0 ? 1 / 60 : Math.max(0, interactionTime - interactionClock)
        // Keep ordinary frames and the other Studio effects on their existing bounded clock.
        delta = Math.min(0.25, delta)
        while (delta > 1e-8) {
          const step = Math.min(0.05, delta)
          interaction.step(step)
          delta -= step
        }
        interactionClock = interactionTime
      }
    } else {
      interaction?.clear()
      interactionPointer = null
      interactionClock = -1
      interactionMode = ''
    }
    const trailPresentation =
      hover === 'particles' && expressive
        ? particlePresentation.prepare(sampleFluidField, frame, strength, w, h, interactionTime)
        : hover === 'rift' && expressive
          ? riftPresentation.prepare(sampleFluidField, frame, strength, w, h)
          : hover === 'trail' && expressive
            ? prototype.experimentalTrail?.(sampleFluidField, frame, strength, w, h)
            : null
    if (coverageGlyphs !== frame.glyphs) {
      coverageGlyphs = frame.glyphs
      coverageOrder = frame.glyphs
        .map((_, i) => i)
        .sort((a, b) => frame.glyphs[a]!.coverage - frame.glyphs[b]!.coverage)
    }
    function densityAt(tone: number) {
      let lo = 0,
        hi = coverageOrder.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (frame.glyphs[coverageOrder[mid]!]!.coverage < tone) lo = mid + 1
        else hi = mid
      }
      const glyph = coverageOrder[lo]!
      return { glyph, opacity: clamp(tone / Math.max(0.001, frame.glyphs[glyph]!.coverage), 0, 1) }
    }
    const cellCount = frame.columns * frame.rows
    if (cellCount * 73 <= effectCellLimit) {
      if (effectCellValid?.length !== cellCount) {
        effectCells = new Float64Array(cellCount * 9)
        effectCellValid = new Uint8Array(cellCount)
      }
      effectCellValid!.fill(0)
    } else effectCells = effectCellValid = null
    let cachedWidth = -1,
      cachedHeight = -1
    function computeCell(x: number, y: number, cw: number, ch: number, alpha: number) {
      const index = y * frame.columns + x
      let dx = 0,
        dy = 0,
        intensity = 1,
        opacity = alpha,
        ambientOpacity = 1,
        glow = 0,
        size = 1,
        traceX = 0,
        traceY = 0
      if (motionField) {
        const nx = (x + 0.5) / frame.columns,
          ny = (y + 0.5) / frame.rows
        // Exact per-glyph choreography avoids grid interpolation changing strand identity.
        if (choreography) for (let i = 0; i < 6; i++) motionSample[i] = choreography[index * 8 + i]!
        const sample = choreography
          ? motionSample
          : cinematic && (motion === 'assemble' || motion === 'reform')
            ? sampleCinematic(motion, nx, ny, time, amount, motionSample, index)
            : sampleMotionField(nx, ny)
        dx = sample[0]! * frame.columns * cw
        dy = sample[1]! * frame.rows * ch
        intensity = sample[2]!
        ambientOpacity = sample[3]!
        opacity = alpha * ambientOpacity
        glow = sample[4]!
        size = sample[5]!
        if (choreography) {
          traceX = choreography[index * 8 + 6]! * frame.columns * cw
          traceY = choreography[index * 8 + 7]! * frame.rows * ch
        } else if (cinematic && (motion === 'assemble' || motion === 'reform')) {
          const previous = sampleCinematic(
            motion,
            nx,
            ny,
            Math.max(0, time - 0.075),
            amount,
            motionSample,
            index,
          )
          traceX = previous[0]! * frame.columns * cw - dx
          traceY = previous[1]! * frame.rows * ch - dy
        }
      }
      let glyph = frame.indices[index]!
      if (
        (interaction?.hasRefraction || (hover === 'particles' && particlePresentation.active)) &&
        expressive
      ) {
        const nx = (x + 0.5) / frame.columns,
          ny = (y + 0.5) / frame.rows
        if (interaction?.hasRefraction) interaction.sample(nx, ny, interactionSample)
        else interactionSample.fill(0)
        const signal = interactionSample[2]! / 3
        const displacementScale = hover === 'ripple' ? 0.45 : hover === 'displace' ? 0.4 : 1
        dx += interactionSample[0]! * frame.columns * cw * displacementScale
        dy += interactionSample[1]! * frame.rows * ch * displacementScale
        if (hover === 'trail' || hover === 'rift' || hover === 'particles') {
          if (trailPresentation) {
            const detail = trailPresentation(nx, ny)
            dx += detail.offsetX * frame.columns * cw
            dy += detail.offsetY * frame.rows * ch
            intensity *= detail.light
            opacity *= detail.opacity
            glow += detail.glow
          } else if (hover !== 'particles' && interaction) {
            interaction.trail.displacement(nx, ny, interactionOffset)
            dx += interactionOffset[0]! * cw * strength
            dy += interactionOffset[1]! * ch * strength
            // Studio trail changes local density, rather than painting a cyan cursor blob.
            const blend = clamp(signal * 2.4, 0, 1)
            if (frame.settings.mode !== 'phrase' && frame.settings.mode !== 'contour') {
              const max = frame.statistics.maxCoverage
              const tone = frame.glyphs[glyph]!.coverage * alpha
              const targetTone = tone + (max - 2 * tone) * blend
              const mapped = densityAt(targetTone)
              glyph = mapped.glyph
              opacity = mapped.opacity * ambientOpacity
            } else opacity *= 1 - blend * 0.9
            glow += signal * 0.16
          }
        } else if (hover === 'light') {
          opacity += (1 - alpha) * signal * 0.8 * ambientOpacity
          glow += signal * 1.6
        } else if (hover === 'dissolve') {
          const noise = 0.5 + 0.5 * Math.sin(index * 12.9898)
          const dissolve = clamp(-signal, 0, 1)
          opacity *= 1 - dissolve * (0.55 + noise * 0.45)
          dy -= ch * dissolve * (1 + noise)
          glow += dissolve * (1 - noise) * 0.24
        } else if (hover === 'contour') {
          glow += signal * 1.25
          if (frame.settings.mode !== 'phrase' && frame.settings.mode !== 'contour') {
            const tone = frame.glyphs[glyph]!.coverage * alpha
            const mapped = densityAt(
              tone + (frame.statistics.maxCoverage - tone) * clamp(signal * 1.6, 0, 1),
            )
            glyph = mapped.glyph
            opacity = mapped.opacity * ambientOpacity
          } else opacity += (1 - alpha) * signal * 0.7 * ambientOpacity
        } else {
          const displacement = Math.hypot(interactionSample[0]! * w, interactionSample[1]! * h)
          glow += Math.min(0.45, (displacement / Math.max(1, Math.min(w, h))) * 14)
        }
      }
      return { dx, dy, intensity, opacity, glow, glyph, size, traceX, traceY }
    }
    function cell(x: number, y: number, cw: number, ch: number, alpha: number) {
      if (!effectCells || !effectCellValid) return computeCell(x, y, cw, ch, alpha)
      if (cw !== cachedWidth || ch !== cachedHeight) {
        effectCellValid.fill(0)
        cachedWidth = cw
        cachedHeight = ch
      }
      const index = y * frame.columns + x,
        at = index * 9
      if (!effectCellValid[index]) {
        const value = computeCell(x, y, cw, ch, alpha)
        effectCells[at] = value.dx
        effectCells[at + 1] = value.dy
        effectCells[at + 2] = value.intensity
        effectCells[at + 3] = value.opacity
        effectCells[at + 4] = value.glow
        effectCells[at + 5] = value.glyph
        effectCells[at + 6] = value.size
        effectCells[at + 7] = value.traceX
        effectCells[at + 8] = value.traceY
        effectCellValid[index] = 1
        return value
      }
      return {
        dx: effectCells[at]!,
        dy: effectCells[at + 1]!,
        intensity: effectCells[at + 2]!,
        opacity: effectCells[at + 3]!,
        glow: effectCells[at + 4]!,
        glyph: effectCells[at + 5]!,
        size: effectCells[at + 6]!,
        traceX: effectCells[at + 7]!,
        traceY: effectCells[at + 8]!,
      }
    }
    const needsGlow =
      Boolean(motionField) ||
      Boolean(interaction?.hasRefraction && expressive && hover !== 'displace')
    return {
      expressive,
      needsGlow,
      motionLight: Boolean(motionField),
      cinematicLight: cinematic && Boolean(motionField),
      sourceLight: Boolean(trailPresentation),
      motionTrace:
        cinematic && Boolean(motionField) && (motion === 'assemble' || motion === 'reform'),
      cell,
    }
  }

  type CanvasEffects =
    ReturnType<typeof effects> extends Generator<unknown, infer Result, unknown> ? Result : never

  function renderGlow(effect: CanvasEffects, w: number, h: number) {
    if (!effect.expressive || !effect.needsGlow) return
    // One bounded glyph-mask surface; no photographic layer or per-glyph blur.
    const scale = Math.min(1, 1536 / Math.max(w, h))
    const gw = Math.max(1, Math.round(w * scale)),
      gh = Math.max(1, Math.round(h * scale))
    let gc: CanvasRenderingContext2D | null = null
    const cw = gw / frame.columns,
      ch = gh / frame.rows
    for (let y = 0; y < frame.rows; y++)
      for (let x = 0; x < frame.columns; x++) {
        const i = y * frame.columns + x,
          alpha = frame.alpha[i]!
        const e = effect.cell(x, y, cw, ch, alpha)
        if (e.glow < 0.003 || e.opacity < 0.005 || frame.glyphs[e.glyph]!.coverage < 0.001) continue
        if (!gc) {
          glowCanvas ??= canvas(gw, gh)
          if (glowCanvas.width !== gw || glowCanvas.height !== gh) {
            glowCanvas.width = gw
            glowCanvas.height = gh
          }
          gc = glowCanvas.getContext('2d')!
          gc.clearRect(0, 0, gw, gh)
        }
        gc.globalAlpha = clamp(e.glow * Math.max(0.35, e.opacity) * e.intensity, 0, 1)
        let lightColor =
          effect.cinematicLight || effect.sourceLight ? frame.settings.ink : '#b5f5e9'
        if (
          (effect.motionLight || effect.sourceLight) &&
          (frame.settings.colored || frame.settings.mode === 'color')
        ) {
          const lift = (channel: number) => Math.min(255, frame.colors[i * 3 + channel]! + 64)
          lightColor = `rgb(${lift(0)},${lift(1)},${lift(2)})`
        }
        const glyphLight = tile(e.glyph, lightColor),
          dw = cw * e.size,
          dh = ch * e.size,
          left = x * cw + (cw - dw) * 0.5,
          top = y * ch + (ch - dh) * 0.5
        if (effect.motionTrace && e.glow > 0.12 && Math.hypot(e.traceX, e.traceY) > cw * 0.12) {
          // Two shutter samples along this glyph's actual time-dependent path.
          // No persistent image history: seeking never creates stale echoes.
          const lightAlpha = gc.globalAlpha
          gc.globalAlpha = lightAlpha * 0.12
          gc.drawImage(glyphLight, left + e.dx + e.traceX, top + e.dy + e.traceY, dw, dh)
          gc.globalAlpha = lightAlpha * 0.24
          gc.drawImage(
            glyphLight,
            left + e.dx + e.traceX * 0.5,
            top + e.dy + e.traceY * 0.5,
            dw,
            dh,
          )
          gc.globalAlpha = lightAlpha
        }
        gc.drawImage(glyphLight, left + e.dx, top + e.dy, dw, dh)
      }
    if (!gc) return
    const spread = Math.max(2, Math.min(w, h) * 0.018)
    outputCtx.save()
    outputCtx.globalCompositeOperation = 'screen'
    outputCtx.globalAlpha = 0.75
    outputCtx.filter = `blur(${spread}px)`
    outputCtx.drawImage(glowCanvas!, 0, 0, w, h)
    outputCtx.globalAlpha = 0.9
    outputCtx.filter = `blur(${Math.max(1, spread * 0.25)}px)`
    outputCtx.drawImage(glowCanvas!, 0, 0, w, h)
    outputCtx.filter = 'none'
    // Screen alone disappears into fully opaque pale ink. Tint the actual strokes
    // as well, so faithful/full-alpha characters still give visible feedback.
    outputCtx.globalCompositeOperation = 'source-over'
    outputCtx.globalAlpha = 0.85
    outputCtx.drawImage(glowCanvas!, 0, 0, w, h)
    outputCtx.restore()
  }

  function styleColor(value: string) {
    const cached = styleColors.get(value)
    if (cached) return cached
    colorProbe ??= canvas(1, 1)
    const probe = colorProbe.getContext('2d', { willReadFrequently: true })!
    probe.clearRect(0, 0, 1, 1)
    probe.fillStyle = '#000'
    probe.fillStyle = value
    probe.fillRect(0, 0, 1, 1)
    const color = [...probe.getImageData(0, 0, 1, 1).data].map((n) => n / 255)
    if (styleColors.size < 64) styleColors.set(value, color)
    return color
  }

  function prefixOf(index: number) {
    const cached = prefixes.get(index)
    if (cached) return cached
    const width = frame.cellWidth,
      height = frame.cellHeight,
      stride = width + 1
    const bytes = stride * (height + 1) * 4
    if (prefixBytes + maskBytes + bytes > softwareLimit) return null
    const pixels = frame.glyphs[index]!.tile.getContext('2d', {
      willReadFrequently: true,
    })!.getImageData(0, 0, width, height).data
    const prefix = new Float32Array(stride * (height + 1))
    for (let y = 0; y < height; y++) {
      let row = 0
      for (let x = 0; x < width; x++) {
        row += pixels[(y * width + x) * 4 + 3]! / 255
        prefix[(y + 1) * stride + x + 1] = prefix[y * stride + x + 1]! + row
      }
    }
    prefixes.set(index, prefix)
    prefixBytes += bytes
    return prefix
  }

  function softwareMask(index: number, cw: number, ch: number, fx: number, fy: number) {
    // Round position to 1/32px (maximum error 1/64px), preserving RGB and glyph order.
    fx = Math.round(fx * 32) / 32
    fy = Math.round(fy * 32) / 32
    const key = `${index}:${cw}:${ch}:${fx}:${fy}`
    const cached = softwareMasks.get(key)
    if (cached) return cached
    const prefix = prefixes.get(index)!,
      nativeWidth = frame.cellWidth,
      nativeHeight = frame.cellHeight
    const stride = nativeWidth + 1
    const width = Math.ceil(cw + fx),
      height = Math.ceil(ch + fy)
    const alpha = new Float32Array(width * height)
    function integral(x: number, y: number) {
      x = clamp(x, 0, nativeWidth)
      y = clamp(y, 0, nativeHeight)
      const ix = Math.min(nativeWidth - 1, Math.floor(x)),
        iy = Math.min(nativeHeight - 1, Math.floor(y))
      const dx = x - ix,
        dy = y - iy,
        i = iy * stride + ix
      const top = prefix[i]! * (1 - dx) + prefix[i + 1]! * dx
      const bottom = prefix[i + stride]! * (1 - dx) + prefix[i + stride + 1]! * dx
      return top * (1 - dy) + bottom * dy
    }
    const sx = nativeWidth / cw,
      sy = nativeHeight / ch,
      area = 1 / (sx * sy)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const left = (x - fx) * sx,
          right = (x + 1 - fx) * sx
        const top = (y - fy) * sy,
          bottom = (y + 1 - fy) * sy
        alpha[y * width + x] = clamp(
          (integral(right, bottom) -
            integral(left, bottom) -
            integral(right, top) +
            integral(left, top)) *
            area,
          0,
          1,
        )
      }
    const result = { width, height, alpha }
    if (prefixBytes + maskBytes + alpha.byteLength <= softwareLimit && softwareMasks.size < 16384) {
      softwareMasks.set(key, result)
      maskBytes += alpha.byteLength
    }
    return result
  }

  function renderSoftware(options: ArtRenderOptions, w: number, h: number, effect: CanvasEffects) {
    if (softwareGlyphs !== frame.glyphs) {
      prefixes.clear()
      softwareMasks.clear()
      prefixBytes = maskBytes = 0
      softwareGlyphs = frame.glyphs
    }
    const cw = w / frame.columns,
      ch = h / frame.rows,
      geometry = `${cw}:${ch}`
    if (softwareGeometry !== geometry) {
      softwareMasks.clear()
      maskBytes = 0
      softwareGeometry = geometry
    }
    // A native density trail can reveal atlas glyphs absent from the still frame.
    // Prepare their area integrals before drawing any strips; retain the same budget/fallback.
    const usedGlyphs =
      effect.expressive &&
      ['trail', 'contour'].includes(options.hover ?? '') &&
      interaction?.hasRefraction
        ? coverageOrder
        : new Set(frame.indices)
    for (const index of usedGlyphs)
      if (frame.glyphs[index]!.coverage > 0.001 && !prefixOf(index)) return false
    const stripRows = Math.min(h, Math.max(1, Math.floor(softwareWorkingLimit / (w * 20))))
    if (!softwareImage || softwareImage.width !== w || softwareImage.height !== stripRows) {
      softwareImage = outputCtx.createImageData(w, stripRows)
      softwarePixels = new Float32Array(w * stripRows * 4)
    }
    const pixels = softwarePixels!,
      image = softwareImage!
    const background = options.transparent ? [0, 0, 0, 0] : styleColor(frame.settings.background)
    const ink = styleColor(frame.settings.ink)
    const colored = frame.settings.colored || frame.settings.mode === 'color'
    const time = options.time ?? 0,
      motion = options.motion ?? 'none'
    for (let strip = 0; strip < h; strip += stripRows) {
      const activeRows = Math.min(stripRows, h - strip),
        count = w * activeRows * 4
      for (let i = 0; i < count; i += 4) {
        pixels[i] = background[0]! * background[3]!
        pixels[i + 1] = background[1]! * background[3]!
        pixels[i + 2] = background[2]! * background[3]!
        pixels[i + 3] = background[3]!
      }
      for (let y = 0; y < frame.rows; y++)
        for (let x = 0; x < frame.columns; x++) {
          const cell = y * frame.columns + x,
            alpha = frame.alpha[cell]!
          let index = frame.indices[cell]!
          if (!effect.expressive && (alpha < 0.005 || frame.glyphs[index]!.coverage < 0.001))
            continue
          let dx = 0,
            dy = 0,
            intensity = 1,
            opacity = alpha,
            size = 1
          if (effect.expressive) {
            const e = effect.cell(x, y, cw, ch, alpha)
            dx = e.dx
            dy = e.dy
            intensity = e.intensity
            opacity = e.opacity
            index = e.glyph
            size = e.size
          } else {
            if (motion === 'breathe')
              intensity = 0.92 + Math.sin(time * 0.9 + x * 0.02 + y * 0.02) * 0.08
            if (motion === 'wave') {
              dx = Math.sin(y * 0.075 + time * 0.75) * cw * 0.18
              dy = Math.cos(x * 0.055 + time * 0.6) * ch * 0.1
            }
            if (motion === 'assemble') {
              const amount = Math.exp(-Math.max(0, time) * 1.4)
              dx = Math.sin(cell * 12.9898) * cw * 12 * amount
              dy = Math.cos(cell * 7.13) * ch * 10 * amount
            }
            if (options.pointer?.strength) {
              const px = (x + 0.5) / frame.columns - options.pointer.x
              const py = (y + 0.5) / frame.rows - options.pointer.y
              const falloff = Math.exp(-(px * px + py * py) / 0.018) * options.pointer.strength
              if (options.hover === 'light') opacity += (1 - alpha) * falloff * 0.28
              else if (options.hover === 'ripple') {
                const distance = Math.hypot(px, py),
                  ripple = Math.sin(distance * 48 - time * 2.4) * falloff
                dx += (px / Math.max(0.01, distance)) * cw * ripple * 0.14
                dy += (py / Math.max(0.01, distance)) * ch * ripple * 0.14
                opacity += (1 - alpha) * falloff * 0.18
              } else {
                dx += px * cw * 14 * falloff
                dy += py * ch * 10 * falloff
              }
            }
          }
          if (opacity < 0.005 || frame.glyphs[index]!.coverage < 0.001) continue
          const dw = cw * size,
            dh = ch * size,
            px = x * cw + dx + (cw - dw) * 0.5,
            py = y * ch + dy + (ch - dh) * 0.5,
            left = Math.floor(px),
            top = Math.floor(py)
          if (
            top + Math.ceil(dh + 1) <= strip ||
            top >= strip + activeRows ||
            left >= w ||
            left + Math.ceil(dw + 1) <= 0
          )
            continue
          const mask = softwareMask(index, dw, dh, px - left, py - top)
          const x0 = Math.max(0, -left),
            x1 = Math.min(mask.width, w - left)
          const y0 = Math.max(0, strip - top),
            y1 = Math.min(mask.height, strip + activeRows - top)
          const red = colored ? frame.colors[cell * 3]! / 255 : ink[0]!
          const green = colored ? frame.colors[cell * 3 + 1]! / 255 : ink[1]!
          const blue = colored ? frame.colors[cell * 3 + 2]! / 255 : ink[2]!
          const multiplier = clamp(opacity * intensity * (colored ? 1 : ink[3]!), 0, 1)
          for (let my = y0; my < y1; my++)
            for (let mx = x0; mx < x1; mx++) {
              const a = mask.alpha[my * mask.width + mx]! * multiplier
              if (a < 0.00001) continue
              const i = ((my + top - strip) * w + mx + left) * 4,
                remaining = 1 - a
              pixels[i] = red * a + pixels[i]! * remaining
              pixels[i + 1] = green * a + pixels[i + 1]! * remaining
              pixels[i + 2] = blue * a + pixels[i + 2]! * remaining
              pixels[i + 3] = a + pixels[i + 3]! * remaining
            }
        }
      for (let i = 0; i < count; i += 4) {
        const a = pixels[i + 3]!,
          inverse = a > 0 ? 255 / a : 0
        image.data[i] = pixels[i]! * inverse
        image.data[i + 1] = pixels[i + 1]! * inverse
        image.data[i + 2] = pixels[i + 2]! * inverse
        image.data[i + 3] = a * 255
      }
      outputCtx.putImageData(image, 0, strip, 0, 0, w, activeRows)
    }
    return true
  }

  // Consume identical drawing commands synchronously or in bounded worker slices.
  // Only a completed frame is presented; yielding never changes glyph order or colors.
  function* renderSteps(next: ArtFrame, options: ArtRenderOptions = {}) {
    const start = performance.now()
    frame = next
    if (current !== frame) {
      current = frame
      // The bounded grid can be the same size for two different aspect ratios.
      // Frozen ambient time must still rebuild choreography for the new work.
      motionKey = ''
      choreographyKey = ''
      clearTiles()
      if (scratch) {
        scratch.width = frame.cellWidth
        scratch.height = frame.cellHeight
      }
    }
    const ratio = frame.width / frame.height,
      edge = clamp(Math.round(options.longEdge ?? 1200), 32, 8192)
    const w = ratio >= 1 ? edge : Math.max(1, Math.round(edge * ratio)),
      h = ratio >= 1 ? Math.max(1, Math.round(edge / ratio)) : edge
    if (target.width !== w || target.height !== h) {
      target.width = w
      target.height = h
    }
    const effect = yield* effects(options, w, h)
    if (
      frame.settings.softwareRaster &&
      (frame.settings.mode === 'color' ||
        (frame.settings.mode === 'density' && !frame.settings.colored)) &&
      renderSoftware(options, w, h, effect)
    ) {
      renderGlow(effect, w, h)
      return { width: w, height: h, renderMs: performance.now() - start }
    }
    const quality =
      frame.settings.mode === 'density' && !frame.settings.colored
        ? frame.settings.rasterQuality
        : 'legacy'
    const scale =
      quality === 'supersampled' && Math.max(w, h) * 2 <= 4096 && w * h * 16 <= 32 * 1024 * 1024
        ? 2
        : 1
    if (scale > 1) {
      supersample ??= canvas(w * scale, h * scale)
      if (supersample.width !== w * scale || supersample.height !== h * scale) {
        supersample.width = w * scale
        supersample.height = h * scale
      }
      ctx = supersample.getContext('2d')!
    } else ctx = outputCtx
    ctx.imageSmoothingQuality = quality && quality !== 'legacy' ? 'high' : 'low'
    ctx.globalAlpha = 1
    if (options.transparent) ctx.clearRect(0, 0, w * scale, h * scale)
    else {
      ctx.fillStyle = frame.settings.background
      ctx.fillRect(0, 0, w * scale, h * scale)
    }
    const cw = (w * scale) / frame.columns,
      ch = (h * scale) / frame.rows
    const time = options.time ?? 0,
      motion = options.motion ?? 'none'
    let sliceStart = performance.now()
    for (let y = 0; y < frame.rows; y++)
      for (let x = 0; x < frame.columns; x++) {
        const cell = y * frame.columns + x,
          alpha = frame.alpha[cell]!
        let index = frame.indices[cell]!
        if (!effect.expressive && (alpha < 0.005 || frame.glyphs[index]!.coverage < 0.001)) continue
        let color = frame.settings.ink
        if (frame.settings.colored || frame.settings.mode === 'color') {
          // Preserve the same sampled RGB as GPU; bound the raster cache separately.
          color = `rgb(${frame.colors[cell * 3]!},${frame.colors[cell * 3 + 1]!},${frame.colors[cell * 3 + 2]!})`
        }
        let dx = 0,
          dy = 0,
          intensity = 1,
          size = 1
        let hoveredAlpha = alpha
        if (effect.expressive) {
          const e = effect.cell(x, y, cw, ch, alpha)
          dx = e.dx
          dy = e.dy
          intensity = e.intensity
          hoveredAlpha = e.opacity
          index = e.glyph
          size = e.size
        } else {
          if (motion === 'breathe')
            intensity = 0.92 + Math.sin(time * 0.9 + x * 0.02 + y * 0.02) * 0.08
          if (motion === 'wave') {
            dx = Math.sin(y * 0.075 + time * 0.75) * cw * 0.18
            dy = Math.cos(x * 0.055 + time * 0.6) * ch * 0.1
          }
          if (motion === 'assemble') {
            const amount = Math.exp(-Math.max(0, time) * 1.4)
            dx = Math.sin(cell * 12.9898) * cw * 12 * amount
            dy = Math.cos(cell * 7.13) * ch * 10 * amount
          }
          if (options.pointer?.strength) {
            const px = (x + 0.5) / frame.columns - options.pointer.x,
              py = (y + 0.5) / frame.rows - options.pointer.y
            const falloff = Math.exp(-(px * px + py * py) / 0.018) * options.pointer.strength
            if (options.hover === 'light') {
              // Change only the ink alpha. Glyphs, word order and tone polarity stay fixed.
              hoveredAlpha += (1 - alpha) * falloff * 0.28
            } else if (options.hover === 'ripple') {
              const distance = Math.hypot(px, py)
              const ripple = Math.sin(distance * 48 - time * 2.4) * falloff
              // Below a quarter cell: no glyph can jump over its neighbouring word.
              dx += (px / Math.max(0.01, distance)) * cw * ripple * 0.14
              dy += (py / Math.max(0.01, distance)) * ch * ripple * 0.14
              hoveredAlpha += (1 - alpha) * falloff * 0.18
            } else {
              dx += px * cw * 14 * falloff
              dy += py * ch * 10 * falloff
            }
          }
        }
        if (hoveredAlpha < 0.005 || frame.glyphs[index]!.coverage < 0.001) continue
        ctx.globalAlpha = effect.expressive
          ? clamp(hoveredAlpha * intensity, 0, 1)
          : hoveredAlpha * intensity
        const dw = cw * size,
          dh = ch * size
        ctx.drawImage(
          tile(index, color),
          x * cw + dx + (cw - dw) * 0.5,
          y * ch + dy + (ch - dh) * 0.5,
          dw,
          dh,
        )
        if (performance.now() - sliceStart >= 8) {
          yield cell + 1
          sliceStart = performance.now()
        }
      }

    ctx.globalAlpha = 1
    if (ctx !== outputCtx) {
      outputCtx.globalAlpha = 1
      outputCtx.imageSmoothingQuality = 'high'
      if (options.transparent) outputCtx.clearRect(0, 0, w, h)
      outputCtx.drawImage(supersample!, 0, 0, w, h)
    }
    renderGlow(effect, w, h)
    return { width: w, height: h, renderMs: performance.now() - start }
  }

  return {
    render(next: ArtFrame, options: ArtRenderOptions = {}) {
      const steps = renderSteps(next, options)
      let result = steps.next()
      while (!result.done) result = steps.next()
      return result.value
    },
    async renderResponsive(
      next: ArtFrame,
      options: ArtRenderOptions = {},
      onProgress?: (completedCells: number, totalCells: number) => void,
      shouldAbort?: () => boolean,
      onInteractionProgress?: (progress: ArtInteractionRenderProgress) => void,
    ) {
      const steps = renderSteps(next, options)
      const advance = () => {
        if (shouldAbort?.()) {
          steps.return({ width: 0, height: 0, renderMs: 0 })
          throw new DOMException('绘制已取消', 'AbortError')
        }
        return steps.next()
      }
      let result = advance()
      while (!result.done) {
        // Drain queued GPU work inside the worker before yielding. Otherwise a
        // large final readback can stall the browser compositor despite the worker.
        if (typeof result.value === 'number') {
          outputCtx.getImageData(0, 0, 1, 1)
          onProgress?.(result.value, next.columns * next.rows)
        } else onInteractionProgress?.(result.value)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        result = advance()
      }
      return result.value
    },
    destroy() {
      particlePresentation.destroy()
      riftPresentation.destroy()
      effectCells = effectCellValid = null
      motionField = null
      motionColumns = motionRows = 0
      motionKey = ''
      choreography = null
      choreographyKey = ''
      current = null
      clearTiles()
      prefixes.clear()
      softwareMasks.clear()
      styleColors.clear()
      prefixBytes = maskBytes = 0
      softwareGlyphs = null
      softwarePixels = null
      softwareImage = null
      interaction?.clear()
      interaction = null
      coverageGlyphs = null
      coverageOrder = []
      if (glowCanvas) {
        glowCanvas.width = glowCanvas.height = 1
        glowCanvas = null
      }
      if (colorProbe) {
        colorProbe.width = colorProbe.height = 1
        colorProbe = null
      }
      if (supersample) {
        supersample.width = 1
        supersample.height = 1
        supersample = null
      }
      if (scratch) {
        scratch.width = 1
        scratch.height = 1
        scratch = null
      }
    },
    get interactionActive() {
      return Boolean(interaction?.active || particlePresentation.active)
    },
    /** Shared native field for future particles/light layers, without re-reading the source image. */
    sampleInteraction(x: number, y: number) {
      interactionSample.fill(0)
      interactionOffset.fill(0)
      if (interaction) {
        interaction.sample(clamp(x, 0, 1), clamp(y, 0, 1), interactionSample)
        if (interaction.mode === 'trail') interaction.trail.displacement(x, y, interactionOffset)
      }
      return {
        x: interactionSample[0]!,
        y: interactionSample[1]!,
        density: interactionSample[2]!,
        trailX: interactionOffset[0]!,
        trailY: interactionOffset[1]!,
      }
    },
    /** Read-only native trail state for prototype presentation; never advances the solver. */
    sampleFluidField,
    get cacheStats() {
      return {
        particles: particlePresentation.stats,
        rift: riftPresentation.stats,
        motionCells: motionColumns * motionRows,
        motionBytes: motionField?.byteLength ?? 0,
        choreographyBytes: choreography?.byteLength ?? 0,
        choreographyLimit,
        effectCellBytes: (effectCells?.byteLength ?? 0) + (effectCellValid?.byteLength ?? 0),
        effectCellLimit,
        entries: tinted.size,
        backingBytes,
        maxBackingBytes,
        scratchBytes: scratch ? scratch.width * scratch.height * 4 : 0,
        supersampleBytes: supersample ? supersample.width * supersample.height * 4 : 0,
        glowBytes: glowCanvas ? glowCanvas.width * glowCanvas.height * 4 : 0,
        interactionCells: interaction ? interaction.columns * interaction.rows : 0,
        interactionActive: interaction?.active ?? false,
        interactionBytes: interaction
          ? [
              ...new Set(
                [
                  interaction,
                  interaction.trail,
                  interaction.contour,
                  interaction.afterimage,
                ].flatMap((field) =>
                  Object.values(field)
                    .filter((v): v is Float32Array | Uint8Array => ArrayBuffer.isView(v))
                    .map((v) => v.buffer),
                ),
              ),
            ].reduce((sum, buffer) => sum + buffer.byteLength, 0)
          : 0,
        softwareMaskBytes: prefixBytes + maskBytes,
        softwareMaskEntries: softwareMasks.size,
        softwareWorkingBytes:
          (softwarePixels?.byteLength ?? 0) + (softwareImage?.data.byteLength ?? 0),
        hits,
        misses,
      }
    },
  }
}

export type ArtRendererCacheStats = ReturnType<typeof createCanvasArtRenderer>['cacheStats']
