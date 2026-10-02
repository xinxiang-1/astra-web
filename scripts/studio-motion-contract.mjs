import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_MOTION_OUTPUT || `test-results/studio-motion-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out)
const vendor = await readFile('node_modules/asciify-engine/dist/studio.js', 'utf8')
const source = await readFile('src/lib/art-engine/canvas.ts', 'utf8')
const motionStyle =
  process.env.ASTRA_MOTION_STYLE || (process.argv.includes('--cinematic') ? 'cinematic' : 'studio')
assert(['studio', 'cinematic'].includes(motionStyle))
const baselineSource = execFileSync('git', ['show', '38bcb37:src/lib/art-engine/canvas.ts'], {
  encoding: 'utf8',
  windowsHide: true,
})
const baselineCode = ts.transpileModule(baselineSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const vendorAst = ts.createSourceFile('studio.js', vendor, ts.ScriptTarget.Latest, true)
const sourceAst = ts.createSourceFile('canvas.ts', source, ts.ScriptTarget.Latest, true)
let nativeFunction, nativeSmooth, localFunction
const scan = (node, ast, kind) => {
  if (
    ts.isFunctionDeclaration(node) &&
    node.name?.text === (kind === 'vendor' ? 'y' : 'sampleStudioAmbient')
  ) {
    if (kind === 'vendor') nativeFunction = node.getText(ast)
    else localFunction = node.getText(ast)
  }
  if (
    kind === 'vendor' &&
    ts.isVariableDeclaration(node) &&
    node.name.getText(ast) === 'w' &&
    node.initializer &&
    node.initializer.getText(ast).includes('3-2')
  )
    nativeSmooth = node.getText(ast)
  ts.forEachChild(node, (child) => scan(child, ast, kind))
}
scan(vendorAst, vendorAst, 'vendor')
scan(sourceAst, sourceAst, 'local')
assert(
  nativeFunction && nativeSmooth && localFunction,
  'Explicitly review changes to the native ambient reference',
)
const reference = `const ${nativeSmooth}; ${nativeFunction}; return y;`
const local = ts.transpileModule(localFunction + ';return sampleStudioAmbient;', {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
page.setDefaultTimeout(180000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const report = {
  base,
  browser: browser.version(),
  errors,
  scope: 'Chromium desktop; CPU timing samples are not device-independent FPS guarantees',
  passed: false,
  motionStyle,
  baselineCommit: '38bcb37de8ceeebc04be7bf09a08d675a5442e6a',
  baselineRendererSha256: createHash('sha256').update(baselineSource).digest('hex'),
  hashes: {},
}
for (const file of [
  'src/lib/art-engine/canvas.ts',
  'src/lib/art-engine/core.ts',
  'src/lib/art-engine/types.ts',
  'src/lib/art-engine/index.ts',
  'src/lib/art-engine/embed.ts',
  'src/views/AsciiArtView.vue',
  'scripts/studio-motion-contract.mjs',
  'scripts/studio-motion-walkthrough.mjs',
  'node_modules/asciify-engine/dist/studio.js',
])
  report.hashes[file] = createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
try {
  await page.goto(`${base}/ascii-art`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  report.api = await page.evaluate(
    async ({ reference, local, motionStyle, baselineCode }) => {
      const native = new Function(reference)()
      const sampler = new Function(local)()
      const expected = new Float32Array(4),
        actual = new Float32Array(4)
      let maxNativeError = 0,
        nativeSamples = 0
      for (const mode of ['current', 'reform', 'caustics'])
        for (const time of [-3, 0, 0.25, 3.8, 4.3, 5.2, 12, 18.4])
          for (const x of [0, 0.15, 0.35, 0.5, 0.85, 1])
            for (const y of [0, 0.13, 0.45, 0.72, 1]) {
              native(mode, x, y, time, expected)
              sampler(mode, x, y, time, actual)
              for (let i = 0; i < 4; i++)
                maxNativeError = Math.max(maxNativeError, Math.abs(expected[i] - actual[i]))
              nativeSamples++
            }
      const { prepareArtFrame, createCanvasArtRenderer } =
        await import('/src/lib/art-engine/index.ts')
      const makePrevious = new Function(
        'exports',
        baselineCode + ';return exports.createCanvasArtRenderer',
      )({})
      const previousCanvas = document.createElement('canvas'),
        previous = makePrevious(previousCanvas)
      await document.fonts.ready
      const image = new Image()
      image.src = '/artwork/portrait-reference.png'
      await image.decode()
      const c = document.createElement('canvas'),
        r = createCanvasArtRenderer(c)
      const bytes = () => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const delta = (a, b) => {
        let sum = 0,
          changed = 0
        for (let i = 0; i < a.length; i++) {
          const d = Math.abs(a[i] - b[i])
          sum += d
          if (d) changed++
        }
        return { mean: sum / a.length, channels: changed }
      }
      const scenarios = [
        ...['density', 'color', 'phrase', 'contour', 'braille', 'halftone'].map((mode) => ({
          name: mode,
          settings: { mode },
        })),
        {
          name: 'density-high',
          settings: { mode: 'density', fontWeight: 600, rasterQuality: 'high' },
        },
        {
          name: 'density-supersampled',
          settings: { mode: 'density', fontWeight: 600, rasterQuality: 'supersampled' },
        },
        {
          name: 'density-software',
          settings: { mode: 'density', fontWeight: 600, softwareRaster: true },
        },
        {
          name: 'color-software',
          settings: { mode: 'color', fontWeight: 600, softwareRaster: true, colorFidelity: true },
        },
      ]
      const cases = [],
        holds = [],
        timings = []
      let maxBytes = 0,
        maxCells = 0
      for (const scene of scenarios) {
        const frame = prepareArtFrame(image, image.width, image.height, {
          columns: 120,
          phrase: '我爱你中国，光与影。',
          ...scene.settings,
        })
        const indices = frame.indices.slice(),
          text = frame.text
        for (const transparent of [false, true]) {
          const common = {
            longEdge: 720,
            effectProfile: 'expressive',
            motionStrength: 0.65,
            motionStyle,
            transparent,
          }
          r.render(frame, { ...common, motion: 'none' })
          const still = bytes()
          for (const motion of ['breathe', 'wave', 'assemble', 'current', 'reform', 'caustics']) {
            const options = { ...common, motion, time: 0.5 }
            r.render(frame, options)
            const first = bytes()
            previous.render(frame, { ...options, motionStyle: undefined })
            r.render(frame, { ...options, motionStyle: 'studio' })
            const studioParity = delta(
              previousCanvas.getContext('2d').getImageData(0, 0, c.width, c.height).data,
              bytes(),
            )
            r.render(frame, { ...options, time: 1.1 })
            const phase = delta(first, bytes())
            r.render(frame, { ...options, motionStrength: 0 })
            const zero = delta(still, bytes())
            r.render(frame, { ...options, time: 1, motionSpeed: 0.5 })
            const speed = delta(first, bytes())
            r.render(frame, { ...options, time: 3.25 })
            r.render(frame, options)
            const seek = delta(first, bytes())
            maxBytes = Math.max(maxBytes, r.cacheStats.motionBytes)
            maxCells = Math.max(maxCells, r.cacheStats.motionCells)
            cases.push({
              scene: scene.name,
              motion,
              transparent,
              changed: delta(still, first),
              phase,
              zero,
              speed,
              seek,
              studioParity,
              newStyle: delta(
                first,
                previousCanvas.getContext('2d').getImageData(0, 0, c.width, c.height).data,
              ),
            })
          }
          for (const [motion, time] of [
            ['assemble', 5],
            ['reform', 8.5],
          ]) {
            r.render(frame, { ...common, motion, time })
            holds.push({ scene: scene.name, transparent, motion, delta: delta(still, bytes()) })
          }
        }
        if (frame.text !== text || !frame.indices.every((value, i) => value === indices[i]))
          throw new Error('Motion must preserve source glyph identity and phrase sequence')
        if (['density', 'density-software', 'color-software'].includes(scene.name))
          for (const motion of ['breathe', 'wave', 'assemble', 'current', 'reform', 'caustics']) {
            const samples = []
            for (let i = 0; i < 10; i++)
              samples.push(
                r.render(frame, {
                  longEdge: 720,
                  effectProfile: 'expressive',
                  motion,
                  time: 0.3 + i / 30,
                  motionStrength: 0.65,
                  motionStyle,
                }).renderMs,
              )
            const sorted = samples.slice(2).sort((a, b) => a - b)
            timings.push({
              scene: scene.name,
              motion,
              columns: frame.columns,
              rows: frame.rows,
              longEdge: 720,
              warmSamples: sorted.length,
              medianMs: sorted[Math.floor(sorted.length / 2)],
              maxMs: sorted.at(-1),
            })
          }
      }
      const frame = prepareArtFrame(image, image.width, image.height, { columns: 180 })
      r.render(frame, {
        longEdge: 4096,
        motion: 'current',
        effectProfile: 'expressive',
        motionStrength: 1,
        motionStyle,
        time: 1.2,
      })
      const highResolution = { width: c.width, height: c.height, ...r.cacheStats }
      r.destroy()
      previous.destroy()
      return {
        nativeSamples,
        maxNativeError,
        cases,
        holds,
        timings,
        maxBytes,
        maxCells,
        highResolution,
        destroyBytes: r.cacheStats.motionBytes,
      }
    },
    { reference, local, motionStyle, baselineCode },
  )
  assert(
    report.api.maxNativeError <= 1e-6,
    'Native kernel must match the independent installed Studio reference',
  )
  assert.equal(report.api.nativeSamples, 720)
  assert.equal(report.api.cases.length, 120)
  for (const item of report.api.cases) {
    assert(
      item.changed.channels > 0 && item.phase.channels > 0,
      `${item.scene}/${item.motion}/${item.transparent}: real motion must respond`,
    )
    assert.equal(item.zero.channels, 0, 'Zero strength restores exact still pixels')
    assert.equal(item.speed.channels, 0, 'Equivalent speed/time gives the same output')
    assert.equal(item.seek.channels, 0, 'Seek and replay are deterministic')
    assert.equal(item.studioParity.channels, 0, 'Old Studio output preserves exact pixels')
    if (motionStyle === 'cinematic')
      assert(item.newStyle.channels > 0, 'New presentation differs visibly from Studio')
  }
  for (const item of report.api.holds)
    assert.equal(
      item.delta.channels,
      0,
      `${item.scene}/${item.motion}: complete-image hold must be exact`,
    )
  // Six bounded channels now include positive glyph size for cinematic depth.
  assert(report.api.maxCells <= 96 * 96 && report.api.maxBytes <= 96 * 96 * 6 * 4)
  assert(report.api.highResolution.glowBytes <= 1536 * 1536 * 4)
  assert.equal(report.api.destroyBytes, 0)
  assert.deepEqual(errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(
  `PASS ${report.api.nativeSamples} native ambient samples, ${report.api.cases.length} mode/quality/transparent motion cases, deterministic export and bounded fields: ${out}`,
)
