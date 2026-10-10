import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const engine = process.env.ASTRA_AREA_FALLBACK_ENGINE || '/src/lib/art-engine'
assert.match(engine, /^\/(?:src\/lib\/art-engine|sandbox\/ascii-optimizer\/engine\/[a-z0-9-]+)$/)
const out = path.resolve(process.env.ASTRA_AREA_FALLBACK_OUTPUT || `output/playwright/area-fallback-${Date.now()}`)
await mkdir(out, { recursive: false })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge' })
const report = { browser: browser.version(), engine, errors: [], cases: [], passed: false }
let deadline
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(process.env.ASTRA_PREVIEW_URL || 'http://localhost:5173')
  deadline = setTimeout(() => { void page.close() }, 90000)
  report.cases = await page.evaluate(async engine => {
    const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
    const { createCanvasArtRenderer } = await import(`${engine}/canvas.ts`)
    const { createAreaGlyphGpu } = await import(`${engine}/area-gpu.ts`)
    const image = new Image()
    image.src = '/artwork/porcelain-study-v1.png'
    await image.decode()
    const frame = prepareArtFrame(image, image.width, image.height, {
      mode: 'color', columns: 32, fontWeight: 600, softwareRaster: true, colorFidelity: true,
    })
    const require = (value, message) => { if (!value) throw new Error(message) }
    const cases = []
    const prototype = OffscreenCanvas.prototype
    const original = prototype.getContext
    const options = index => ({
      longEdge: 320, glow: false, motion: 'wave', motionStyle: 'cinematic',
      effectProfile: 'expressive', hover: 'trail', time: index / 30, hoverTime: index / 30,
      pointer: { x: .2 + index * .15, y: .5, strength: .65, active: true },
      pointerSamples: [{ x: .2 + index * .15, y: .5, time: index * 1000 / 30, active: true }],
    })
    for (const reason of ['no-webgl', 'context-loss', 'texture-limit', 'ready']) {
      const native = document.createElement('canvas'), actual = document.createElement('canvas')
      const reference = createCanvasArtRenderer(native)
      let gl, gpu, renderer, batches = 0
      const originalParameter = WebGL2RenderingContext.prototype.getParameter
      try {
        prototype.getContext = function (kind, ...args) {
          if (reason === 'no-webgl' && kind === 'webgl2') return null
          const result = original.call(this, kind, ...args)
          if (kind === 'webgl2') gl = result
          return result
        }
        if (reason === 'texture-limit') {
          WebGL2RenderingContext.prototype.getParameter = function (parameter) {
            return parameter === this.MAX_TEXTURE_SIZE ? 32 : originalParameter.call(this, parameter)
          }
        }
        gpu = createAreaGlyphGpu(actual)
      } finally {
        prototype.getContext = original
        WebGL2RenderingContext.prototype.getParameter = originalParameter
      }
      try {
        require(reason === 'no-webgl' ? gpu === null : Boolean(gpu), `${reason}: context expectation`)
        if (reason === 'context-loss') {
          gl.getExtension('WEBGL_lose_context').loseContext()
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        renderer = createCanvasArtRenderer(actual, {
          canRasterBatch: (frame, w, h) => Boolean(gpu?.canRaster(frame, w, h)),
          rasterBatch: (...args) => { batches++; return Boolean(gpu?.rasterBatch(...args)) },
        })
        let max = 0, sum = 0
        for (let i = 0; i < 3; i++) {
          reference.render(frame, options(i))
          renderer.render(frame, options(i))
          const a = native.getContext('2d').getImageData(0, 0, native.width, native.height).data
          const b = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data
          require(a.length === b.length, `${reason}: source geometry`)
          for (let p = 0; p < a.length; p++) {
            const delta = Math.abs(a[p] - b[p]); max = Math.max(max, delta); sum += delta
          }
          if (reason !== 'ready') require(max === 0, `${reason}: fallback pixels must remain exact`)
        }
        const commands = renderer.cacheStats.softwareCommandBytes
        if (reason === 'ready') {
          require(batches === 3 && commands > 0, 'Supported GPU must keep accelerating')
          require(max <= 12 && sum / (actual.width * actual.height * 4 * 3) < 1, 'Supported GPU fidelity')
        } else require(batches === 0 && commands === 0, `${reason}: no unused geometry or allocation`)
        cases.push({ reason, comparedFrames: 3, gpuCalls: batches, commandBytes: commands, maxPixelDelta: max })
      } finally { renderer?.destroy(); reference.destroy(); gpu?.destroy() }
    }
    const gpu = createAreaGlyphGpu(document.createElement('canvas'))
    try {
      require(gpu && !gpu.canRaster(frame, 8192, 8192), 'Output budget must reject before commands')
      cases.push({ reason: 'output-budget', rejectedBeforeAllocation: true })
    } finally { gpu?.destroy() }
    return cases
  }, engine)
  assert.equal(report.cases.length, 5)
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { clearTimeout(deadline); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ out, passed: report.passed, cases: report.cases, failure: report.failure }))
