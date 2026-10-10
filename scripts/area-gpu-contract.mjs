import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(
  process.env.ASTRA_AREA_OUTPUT || `output/playwright/area-gpu-${Date.now()}`,
)
await mkdir(out, { recursive: false })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge' })
const report = { browser: browser.version(), errors: [], cases: [], passed: false }
let deadline
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://localhost:5173') + '/ascii-art')
  deadline = setTimeout(() => {
    void page.close()
  }, 180000)
  report.cases = await page.evaluate(async () => {
    const { prepareArtFrame, createCanvasArtRenderer } =
      await import('/src/lib/art-engine/index.ts')
    const { createFrameRenderWorker } = await import('/src/lib/art-engine/frame-render-client.ts')
    const { createAreaGlyphGpu } = await import('/src/lib/art-engine/area-gpu.ts')
    const image = new Image()
    image.src = '/artwork/porcelain-study-v1.png'
    await image.decode()
    const require = (v, m) => {
      if (!v) throw new Error(m)
    }
    const cases = []
    for (const mode of ['density', 'color'])
      for (const hover of [
        'trail',
        'rift',
        'particles',
        'light',
        'water',
        'silk',
        'vortex',
        'contour',
        'dissolve',
      ]) {
        const frame = prepareArtFrame(image, image.width, image.height, {
          mode,
          columns: 32,
          fontWeight: 600,
          softwareRaster: true,
          colorFidelity: true,
        })
        const native = document.createElement('canvas'),
          actual = document.createElement('canvas')
        const reference = createCanvasArtRenderer(native)
        let resolve, reject
        const worker = createFrameRenderWorker(
          (result) => {
            actual.width = result.bitmap.width
            actual.height = result.bitmap.height
            actual.getContext('2d').drawImage(result.bitmap, 0, 0)
            resolve(result)
          },
          () => reject(new Error('GPU worker failed')),
        )
        require(worker, 'Real worker required')
        try {
          for (let i = 0; i < 3; i++) {
            const options = {
              glow: false,
              longEdge: 320,
              transparent: i === 0,
              motion: 'wave',
              motionStyle: 'cinematic',
              effectProfile: 'expressive',
              time: i / 30,
              hoverTime: i / 30,
              hover,
              hoverStrength: 0.65,
              hoverRadius: 0.38,
              pointer: { x: 0.2 + i * 0.2, y: 0.5, strength: 0.65, active: true },
              pointerSamples: [{ x: 0.2 + i * 0.2, y: 0.5, time: (i / 30) * 1000, active: true }],
            }
            reference.render(frame, options)
            const result = await new Promise((r, j) => {
              resolve = r
              reject = j
              worker.render(frame, options)
            })
            require(result.cacheStats.rasterGpu?.active, 'Expected GPU area raster was not active')
            const a = native.getContext('2d').getImageData(0, 0, native.width, native.height).data
            const b = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data
            require(a.length === b.length, 'Geometry differs')
            let total = 0,
              max = 0,
              alphaMax = 0
            for (let p = 0; p < a.length; p += 4) {
              alphaMax = Math.max(alphaMax, Math.abs(a[p + 3] - b[p + 3]))
              for (let c = 0; c < 3; c++) {
                const d = Math.abs((a[p + c] * a[p + 3]) / 255 - (b[p + c] * b[p + 3]) / 255)
                total += d
                max = Math.max(max, d)
              }
            }
            const mae = total / ((a.length / 4) * 3)
            require(mae < 1 &&
              max <= 12 &&
              alphaMax <= 3, `Area coverage differs ${mode}/${hover}: ${mae}/${max}/${alphaMax}`)
            cases.push({
              mode,
              hover,
              frame: i,
              transparent: i === 0,
              premultipliedMae: mae,
              maxDelta: max,
              alphaMax,
            })
          }
        } finally {
          worker.dispose()
          reference.destroy()
        }
      }
    // Unavailable WebGL and lost context must reject the accelerator, preserving CPU rendering.
    const prototype = OffscreenCanvas.prototype,
      original = prototype.getContext
    prototype.getContext = function (kind, ...args) {
      return kind === 'webgl2' ? null : original.call(this, kind, ...args)
    }
    try {
      require(createAreaGlyphGpu(document.createElement('canvas')) ===
        null, 'No WebGL must use CPU')
    } finally {
      prototype.getContext = original
    }
    cases.push({ noWebglFallback: true })
    let gl
    prototype.getContext = function (kind, ...args) {
      const context = original.call(this, kind, ...args)
      if (kind === 'webgl2') gl = context
      return context
    }
    const surface = document.createElement('canvas'),
      gpu = createAreaGlyphGpu(surface)
    prototype.getContext = original
    require(gpu, 'GPU fixture required')
    try {
      const frame = prepareArtFrame(image, image.width, image.height, { columns: 32 })
      require(gpu.rasterBatch(
        frame,
        { glow: false },
        8192,
        8192,
        new Map(),
        new Float64Array(0),
        0,
      ) === false, 'Large surfaces must reject before allocation')
      cases.push({ outputBudgetFallback: true })
      gl.getExtension('WEBGL_lose_context').loseContext()
      await new Promise((resolve) => setTimeout(resolve, 50))
      require(gpu.rasterBatch(
        frame,
        { glow: false },
        320,
        320,
        new Map(),
        new Float64Array(0),
        0,
      ) === false, 'Lost context must retain CPU fallback')
      cases.push({ contextLossFallback: true })
    } finally {
      gpu.destroy()
    }
    return cases
  })
  assert.equal(report.cases.length, 57)
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(
  JSON.stringify({
    out,
    passed: report.passed,
    cases: report.cases.length,
    failure: report.failure,
  }),
)
