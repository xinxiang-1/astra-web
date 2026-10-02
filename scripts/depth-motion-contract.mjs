import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_DEPTH_OUTPUT || `test-results/depth-${Date.now()}`)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out)
const source = await readFile('src/lib/art-engine/canvas.ts', 'utf8')
const ast = ts.createSourceFile('canvas.ts', source, ts.ScriptTarget.Latest, true)
const declarations = []
function visit(node) {
  if (
    (ts.isFunctionDeclaration(node) &&
      ['sampleStudioAmbient', 'sampleCinematic'].includes(node.name?.text)) ||
    (ts.isVariableStatement(node) &&
      node.declarationList.declarations.some((d) => d.name.getText(ast) === 'motionSmooth'))
  )
    declarations.push(node.getText(ast))
  ts.forEachChild(node, visit)
}
visit(ast)
assert.equal(declarations.length, 3)
const code = ts.transpileModule(declarations.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText
const sample = new Function(
  'frame',
  'const ambientNative = new Float32Array(4);' + code + ';return sampleCinematic;',
)
const motions = ['breathe', 'wave', 'assemble', 'current', 'reform', 'caustics']
const field = { samples: 0, minScale: Infinity, maxScale: 0, maxDisplacement: 0, seams: [] }
for (const aspect of [0.5, 0.8, 1.3, 2.3]) {
  const sampler = sample({ width: 960 * aspect, height: 960 })
  const signal = new Float32Array(6)
  for (const motion of motions)
    for (const time of [-1, 0, 0.2, 0.5, 1.8, 3.1, 5, 7.9, 8.5, 12, 24])
      for (const x of [0, 0.1, 0.35, 0.5, 0.8, 1])
        for (const y of [0, 0.1, 0.35, 0.5, 0.8, 1]) {
          sampler(motion, x, y, time, 1, signal, 73)
          assert([...signal].every(Number.isFinite), 'All choreography signals are finite')
          assert(
            signal[5] >= 0.45 && signal[5] <= 1.5,
            'Upright glyph size is positive and bounded',
          )
          assert(signal[3] >= 0 && signal[3] <= 1, 'Opacity remains within the alpha contract')
          field.minScale = Math.min(field.minScale, signal[5])
          field.maxScale = Math.max(field.maxScale, signal[5])
          field.maxDisplacement = Math.max(field.maxDisplacement, Math.hypot(signal[0], signal[1]))
          field.samples++
        }
  for (const [motion, period] of [
    ['breathe', 7],
    ['reform', 12],
    ['caustics', 6],
  ]) {
    let error = 0
    for (const x of [0.1, 0.5, 0.9])
      for (const y of [0.1, 0.5, 0.9]) {
        sampler(motion, x, y, period - 1e-5, 1, signal, 73)
        const before = signal.slice()
        sampler(motion, x, y, period + 1e-5, 1, signal, 73)
        error = Math.max(error, ...signal.map((n, i) => Math.abs(n - before[i])))
      }
    assert(error < 1e-4, `${motion}: the repeating cycle has no jump`)
    field.seams.push({ aspect, motion, error })
  }
}
assert(field.minScale < 0.8 && field.maxScale > 1.1, 'The depth signal is perceptible')

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const report = {
  passed: false,
  browser: browser.version(),
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  field,
  errors: [],
}
page.on('pageerror', (e) => report.errors.push(e.message))
try {
  await page.goto(`${process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'}/ascii-art`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  report.raster = await page.evaluate(async () => {
    const { prepareArtFrame, createCanvasArtRenderer } =
      await import('/src/lib/art-engine/index.ts')
    await document.fonts.ready
    const image = new Image()
    image.src = '/artwork/portrait-reference.png'
    await image.decode()
    const cases = [],
      reconstruction = []
    const bytes = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const delta = (a, b) => a.reduce((n, value, i) => n + (value !== b[i] ? 1 : 0), 0)
    for (const mode of ['density', 'color']) {
      const frame = prepareArtFrame(image, image.width, image.height, {
        mode,
        columns: 96,
        fontWeight: 600,
        softwareRaster: true,
        colorFidelity: mode === 'color',
      })
      const canvas = document.createElement('canvas'),
        warm = createCanvasArtRenderer(canvas)
      // Revisiting fractional positions at different depth must not reuse a mask
      // rasterized for another width/height. Compare against an uncached renderer.
      for (const transparent of [false, true])
        for (const motion of ['breathe', 'wave', 'assemble', 'current', 'reform', 'caustics'])
          for (const time of [0.5, 2.1, 0.5, 7.8]) {
            const options = {
              longEdge: 360,
              transparent,
              time,
              motion,
              motionStyle: 'cinematic',
              effectProfile: 'expressive',
              motionStrength: 0.8,
            }
            warm.render(frame, options)
            const coldCanvas = document.createElement('canvas'),
              cold = createCanvasArtRenderer(coldCanvas)
            cold.render(frame, options)
            cases.push({
              mode,
              transparent,
              motion,
              time,
              changedChannels: delta(bytes(canvas), bytes(coldCanvas)),
            })
            cold.destroy()
          }
      for (const motion of ['wave', 'assemble', 'current', 'reform']) {
        const options = {
          longEdge: 360,
          transparent: true,
          time: 2.1,
          motion,
          motionStyle: 'cinematic',
          effectProfile: 'expressive',
          motionStrength: 0.8,
        }
        warm.render(frame, options)
        const small = bytes(canvas),
          width = canvas.width,
          height = canvas.height
        const referenceCanvas = document.createElement('canvas'),
          reference = createCanvasArtRenderer(referenceCanvas)
        // Independent Canvas supersampling is the reconstruction reference for
        // the variable-size area masks; box integration uses premultiplied RGB.
        reference.render(
          { ...frame, settings: { ...frame.settings, softwareRaster: false } },
          { ...options, longEdge: 1440 },
        )
        const large = bytes(referenceCanvas),
          factor = 4
        let sum = 0
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4
            for (let channel = 0; channel < 4; channel++) {
              let expected = 0
              for (let dy = 0; dy < factor; dy++)
                for (let dx = 0; dx < factor; dx++) {
                  const j = ((y * factor + dy) * referenceCanvas.width + x * factor + dx) * 4
                  expected +=
                    channel === 3
                      ? large[j + 3] / 255
                      : (large[j + channel] * large[j + 3]) / (255 * 255)
                }
              expected /= factor * factor
              const actual =
                channel === 3
                  ? small[i + 3] / 255
                  : (small[i + channel] * small[i + 3]) / (255 * 255)
              sum += Math.abs(actual - expected)
            }
          }
        reconstruction.push({ mode, motion, premultipliedMae: sum / small.length })
        reference.destroy()
      }
      warm.destroy()
    }
    return { cases, reconstruction }
  })
  assert.equal(report.raster.cases.length, 96)
  for (const test of report.raster.cases)
    assert.equal(test.changedChannels, 0, 'Warm/cold perspective masks match exactly')
  for (const test of report.raster.reconstruction)
    assert(
      test.premultipliedMae < 0.025,
      `${test.mode}/${test.motion}: area raster matches 4x reconstruction`,
    )
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(
  `PASS ${field.samples} depth samples, 12 cycle seams, 96 mask-cache cases and 8 area reconstructions: ${out}`,
)
