import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_FIELD_OUTPUT || `test-results/studio-field-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out, { recursive: false })
// The independent reference comes from the installed MIT Studio engine, not our adapter.
const upstream = await readFile('node_modules/asciify-engine/dist/studio.js', 'utf8')
const ast = ts.createSourceFile('studio.js', upstream, ts.ScriptTarget.Latest, true)
const pieces = new Map()
function scan(n) {
  if (ts.isFunctionDeclaration(n) && n.name?.text === 'F') pieces.set('F', n.getText(ast))
  if (
    ts.isVariableDeclaration(n) &&
    n.initializer &&
    ts.isClassExpression(n.initializer) &&
    ['R', 'T', 'I', 'C'].includes(n.name.getText(ast)) &&
    n.initializer.getText(ast).includes('this.')
  )
    pieces.set(n.name.getText(ast), `const ${n.getText(ast)};`)
  ts.forEachChild(n, scan)
}
scan(ast)
assert.equal(pieces.size, 5, 'Studio internals changed: explicitly review the new reference')
const reference =
  ['F', 'T', 'I', 'R', 'C'].map((n) => pieces.get(n)).join('\n') + ';return new C(ratio);'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
let report
try {
  await page.goto(`${base}/ascii-art`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  report = await page.evaluate(async (reference) => {
    const { prepareArtFrame, createCanvasArtRenderer } =
      await import('/src/lib/art-engine/index.ts')
    await document.fonts.ready
    const image = new Image()
    image.src = '/artwork/portrait-reference.png'
    await image.decode()
    const result = {
      cases: [],
      static: [],
      dynamics: [],
      batchedInput: [],
      maxFieldBytes: 0,
      maxNativeDifference: 0,
      passed: false,
    }
    const bytes = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const delta = (a, b) => {
      let sum = 0
      for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
      return sum / a.length
    }
    for (const ratio of [0.5, 1, 2]) {
      const frame = prepareArtFrame(image, image.width, image.height, { columns: 100 })
      const shaped = { ...frame, width: frame.height * ratio }
      for (const effect of [
        'trail',
        'water',
        'silk',
        'vortex',
        'contour',
        'dissolve',
        'light',
        'ripple',
        'displace',
      ]) {
        const native = new Function('ratio', reference)(ratio)
        const nativeMode = effect === 'ripple' ? 'water' : effect === 'displace' ? 'silk' : effect
        native.configure(nativeMode, 0.65, 0.38, false)
        const c = document.createElement('canvas'),
          r = createCanvasArtRenderer(c)
        let max = 0,
          amplitude = 0
        for (let i = 0; i < 36; i++) {
          const time = i / 30,
            x = 0.22 + (0.56 * i) / 35,
            y = 0.5 + Math.sin((i / 35) * Math.PI * 2) * 0.16
          native.move(x, y, time * 1000)
          native.step(i === 0 ? 1 / 60 : 1 / 30)
          r.render(shaped, {
            longEdge: 480,
            motion: 'none',
            hover: effect,
            effectProfile: 'expressive',
            hoverStrength: 0.65,
            hoverRadius: 0.38,
            hoverTime: time,
            pointer: { x, y, strength: 0.65, active: true },
          })
          for (const [px, py] of [
            [0.3, 0.5],
            [0.5, 0.55],
            [x, y],
          ]) {
            const expected = new Float32Array(3),
              drift = new Float32Array(2)
            native.sample(px, py, expected)
            if (effect === 'trail') native.trail.displacement(px, py, drift)
            const actual = r.sampleInteraction(px, py)
            max = Math.max(
              max,
              Math.abs(actual.x - expected[0]),
              Math.abs(actual.y - expected[1]),
              Math.abs(actual.density - expected[2]),
              Math.abs(actual.trailX - drift[0]),
              Math.abs(actual.trailY - drift[1]),
            )
            amplitude = Math.max(amplitude, ...Object.values(actual).map(Math.abs))
          }
          result.maxFieldBytes = Math.max(result.maxFieldBytes, r.cacheStats.interactionBytes)
        }
        const activeBeforeLeave = r.interactionActive
        let settledAt = null
        for (let i = 36; i < 360; i++) {
          r.render(shaped, {
            longEdge: 480,
            motion: 'none',
            hover: effect,
            effectProfile: 'expressive',
            hoverStrength: 0.65,
            hoverTime: i / 30,
            pointer: { x: 0.78, y: 0.5, strength: 0, active: false },
          })
          if (!r.interactionActive) {
            settledAt = i / 30 - 35 / 30
            break
          }
        }
        result.cases.push({
          ratio,
          effect,
          maxNativeDifference: max,
          amplitude,
          activeBeforeLeave,
          settledAt,
        })
        result.maxNativeDifference = Math.max(result.maxNativeDifference, max)
        r.destroy()
      }
    }
    const batchFrame = prepareArtFrame(image, image.width, image.height, { columns: 100 })
    for (const effect of ['trail', 'water', 'silk', 'vortex', 'contour', 'dissolve', 'light']) {
      const ratio = batchFrame.width / batchFrame.height
      const rasterRatio = ratio >= 1 ? 480 / Math.round(480 / ratio) : Math.round(480 * ratio) / 480
      const native = new Function('ratio', reference)(rasterRatio)
      native.configure(effect, 0.65, 0.38, false)
      const r = createCanvasArtRenderer(document.createElement('canvas'))
      let maxDifference = 0
      for (let frameIndex = 0; frameIndex < 20; frameIndex++) {
        const samples = Array.from({ length: 4 }, (_, k) => {
          const n = frameIndex * 4 + k,
            t = n / 79
          return {
            x: 0.22 + 0.56 * t,
            y: 0.5 + Math.sin(t * Math.PI * 3) * 0.15,
            time: 10000 + n * 8,
            active: true,
          }
        })
        for (const p of samples) native.move(p.x, p.y, p.time)
        native.step(frameIndex === 0 ? 1 / 60 : 1 / 30)
        const last = samples.at(-1)
        r.render(batchFrame, {
          longEdge: 480,
          effectProfile: 'expressive',
          motion: 'none',
          hover: effect,
          hoverStrength: 0.65,
          hoverTime: frameIndex / 30,
          pointer: { ...last, strength: 0.65 },
          pointerSamples: samples,
        })
        const expected = new Float32Array(3)
        native.sample(0.5, 0.5, expected)
        const actual = r.sampleInteraction(0.5, 0.5)
        maxDifference = Math.max(
          maxDifference,
          Math.abs(actual.x - expected[0]),
          Math.abs(actual.y - expected[1]),
          Math.abs(actual.density - expected[2]),
        )
      }
      result.batchedInput.push({ effect, maxDifference, events: 80, renderTicks: 20 })
      r.destroy()
    }
    const modes = ['density', 'color', 'phrase', 'contour', 'braille', 'halftone'].map((mode) => ({
      mode,
      quality: 'classic',
    }))
    modes.push(
      { mode: 'density', quality: 'detailed' },
      { mode: 'density', quality: 'smooth' },
      { mode: 'density', quality: 'faithful' },
      { mode: 'color', quality: 'faithful' },
    )
    for (const { mode, quality } of modes) {
      const frame = prepareArtFrame(image, image.width, image.height, {
        mode,
        columns: 100,
        phrase: '山河光影FJRq',
        ...(quality === 'faithful'
          ? { fontWeight: 600, softwareRaster: true, colorFidelity: true }
          : quality === 'classic'
            ? {}
            : { fontWeight: 600, rasterQuality: quality === 'detailed' ? 'high' : 'supersampled' }),
      })
      const c = document.createElement('canvas'),
        r = createCanvasArtRenderer(c)
      r.render(frame, { longEdge: 480 })
      const original = bytes(c)
      r.render(frame, { longEdge: 480, effectProfile: 'expressive' })
      result.static.push({ mode, quality, noPointerMAE: delta(original, bytes(c)) })
      for (const effect of [
        'trail',
        'water',
        'silk',
        'vortex',
        'contour',
        'dissolve',
        'light',
        'ripple',
        'displace',
      ]) {
        const options = {
          longEdge: 480,
          effectProfile: 'expressive',
          motion: 'none',
          hover: effect,
          hoverStrength: 0.65,
        }
        for (let i = 0; i < 24; i++)
          r.render(frame, {
            ...options,
            hoverTime: i / 30,
            pointer: {
              x: 0.2 + (i / 23) * 0.5,
              y: 0.42 + Math.sin((i / 23) * Math.PI) * 0.13,
              strength: 0.65,
              active: true,
            },
          })
        const wake = bytes(c)
        r.render(frame, {
          ...options,
          hoverTime: 0.85,
          pointer: { x: 0.7, y: 0.42, strength: 0, active: false },
        })
        const residual = bytes(c)
        r.render(frame, {
          ...options,
          hoverStrength: 0,
          hoverTime: 0.9,
          pointer: { x: 0.7, y: 0.42, strength: 0, active: false },
        })
        result.dynamics.push({
          mode,
          quality,
          effect,
          wakeMAE: delta(original, wake),
          residualMAE: delta(wake, residual),
          zeroStrengthMAE: delta(original, bytes(c)),
        })
      }
      r.destroy()
    }
    return result
  }, reference)
  for (const c of report.cases) {
    assert(c.maxNativeDifference < 0.00001, `native field mismatch ${JSON.stringify(c)}`)
    assert(c.amplitude > 0.001, `field must respond ${JSON.stringify(c)}`)
    assert(c.settledAt !== null && c.settledAt < 10, `wake must settle ${JSON.stringify(c)}`)
  }
  for (const c of report.static) assert.equal(c.noPointerMAE, 0)
  for (const c of report.batchedInput)
    assert(
      c.maxDifference < 0.00001,
      `coalesced input must match native events ${JSON.stringify(c)}`,
    )
  for (const c of report.dynamics) {
    assert(
      c.wakeMAE > 0.02 && c.residualMAE > 0,
      `actual glyph wake and independent residual ${JSON.stringify(c)}`,
    )
    assert.equal(
      c.zeroStrengthMAE,
      0,
      `zero strength must restore exact still ${JSON.stringify(c)}`,
    )
  }
  assert(report.maxFieldBytes <= 2 * 1024 * 1024)
  assert.deepEqual(errors, [])
  report.passed = true
} catch (e) {
  report ||= {}
  report.failure = e.stack
  throw e
} finally {
  report.errors = errors
  report.upstreamSha256 = createHash('sha256').update(upstream).digest('hex')
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(
  `PASS: ${report.cases.length} independent native-field cases, ${report.dynamics.length} actual six-mode/quality wakes, zero-strength/static restoration; ${out}`,
)
