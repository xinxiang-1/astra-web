import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const prototypePath = process.env.ASTRA_RIFT_PROTOTYPE || 'v7-studio-rift'
assert(['v7-studio-rift', 'v8-studio-rift'].includes(prototypePath))
const out = path.resolve(process.env.ASTRA_RIFT_OUTPUT || `test-results/studio-rift-${Date.now()}`)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out)
const hashes = {},
  protectedFiles = [
    'src/views/ArtHomeView.vue',
    'src/components/CharacterArtwork.vue',
    'src/lib/ascii/studio-preview.ts',
  ]
for (const name of [
  ...protectedFiles,
  'src/lib/art-engine/canvas.ts',
  `docs/prototypes/${prototypePath}/presentation.ts`,
  `docs/prototypes/${prototypePath}/main.ts`,
  `docs/prototypes/${prototypePath}/index.html`,
]) {
  const raw = await readFile(name)
  hashes[name] = createHash('sha256').update(raw).digest('hex')
  if (protectedFiles.includes(name))
    assert.equal(
      raw.toString().replaceAll('\r\n', '\n'),
      execFileSync('git', ['show', `0ad0a5f:${name}`], { encoding: 'utf8' }),
    )
}
const baseline = execFileSync('git', ['show', '0ad0a5f:src/lib/art-engine/canvas.ts'], {
  encoding: 'utf8',
})
const frozen = await readFile('scripts/fixtures/spatial-v6-renderer.ts', 'utf8')
assert.equal(
  frozen
    .replace("from '../../src/lib/art-engine/types'", "from './types'")
    .replaceAll('\r\n', '\n'),
  baseline,
)
const current = await readFile('src/lib/art-engine/canvas.ts', 'utf8')
const nativeBody = (s) =>
  s.slice(s.indexOf('  function makeStudioInteraction('), s.indexOf('  let interaction:'))
assert.equal(
  nativeBody(current).replaceAll('\r\n', '\n'),
  nativeBody(baseline),
  'Native solver remains untouched',
)
const upstream = await readFile('node_modules/asciify-engine/dist/studio.js', 'utf8')
const ast = ts.createSourceFile('studio.js', upstream, ts.ScriptTarget.Latest, true),
  pieces = new Map()
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
assert.equal(pieces.size, 5)
const reference =
  ['F', 'T', 'I', 'R', 'C'].map((n) => pieces.get(n)).join('\n') + ';return new C(ratio);'
const report = {
  passed: false,
  hashes,
  nativeSolverUnchanged: true,
  protectedFilesUnchanged: true,
  defaultCases: [],
  candidateCases: [],
  fieldCases: [],
  errors: [],
}
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'no-preference',
})
page.on('pageerror', (error) => report.errors.push(error.message))
page.setDefaultTimeout(60000)
try {
  await page.goto(`${base}/docs/prototypes/${prototypePath}/index.html`)
  await page.waitForFunction(() => window.astraRiftPrototype?.ready)
  await page.evaluate(() => window.astraRiftPrototype.setManual(true))
  Object.assign(
    report,
    await page.evaluate(
      async ({ reference, prototypePath }) => {
        const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
        const { createCanvasArtRenderer: renderer } = await import('/src/lib/art-engine/canvas.ts')
        const { createCanvasArtRenderer: old } =
          await import('/scripts/fixtures/spatial-v6-renderer.ts')
        const { createRiftPresentation } = await import(
          `/docs/prototypes/${prototypePath}/presentation.ts`
        )
        const image = new Image()
        image.src = '/artwork/portrait-reference.png'
        await image.decode()
        const pixels = (c) =>
          new Uint8ClampedArray(c.getContext('2d').getImageData(0, 0, c.width, c.height).data)
        const mae = (a, b) => {
          let sum = 0
          for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
          return sum / a.length
        }
        const require = (value, message) => {
          if (!value) throw new Error(message)
        }
        const defaultCases = [],
          candidateCases = [],
          fieldCases = []
        let maxBytes = 0,
          maxOffset = 0,
          maxFieldError = 0
        const motionOptions = (time, i, strength = 0.65, active = true) => ({
          longEdge: 560,
          effectProfile: 'expressive',
          motion: 'none',
          hover: 'trail',
          hoverTime: time,
          hoverStrength: strength,
          hoverRadius: 0.38,
          pointer: {
            x: 0.2 + 0.6 * Math.min(1, i / 23),
            y: 0.5 + Math.sin((i / 23) * Math.PI * 2) * 0.18,
            active,
            strength,
          },
        })
        const modes = ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']
        for (const mode of modes)
          for (const quality of ['density', 'color'].includes(mode)
            ? ['classic', 'high', 'software']
            : ['classic'])
            for (const transparent of [false, true]) {
              const frame = prepareArtFrame(image, image.width, image.height, {
                mode,
                columns: 96,
                phrase: '我爱你中国，光与影。',
                fontFamily: 'Microsoft YaHei, monospace',
                ...(quality !== 'classic' ? { fontWeight: 600, rasterQuality: 'high' } : {}),
                ...(quality === 'software'
                  ? { fontWeight: 400, softwareRaster: true, colorFidelity: mode === 'color' }
                  : {}),
              })
              const a = document.createElement('canvas'),
                b = document.createElement('canvas'),
                c = document.createElement('canvas')
              const ra = old(a),
                rb = renderer(b),
                presentation = createRiftPresentation(),
                rc = renderer(c, { experimentalTrail: presentation.prepare })
              const none = { ...motionOptions(0, 0, 0, false), transparent }
              rc.render(frame, none)
              const still = pixels(c)
              ra.render(frame, none)
              require(mae(pixels(a), still) ===
                0, `No input static ${mode}/${quality}/${transparent}`)
              let changed = 0
              for (let i = 0; i < 24; i++) {
                const options = { ...motionOptions(i / 30, i), transparent }
                ra.render(frame, options)
                rb.render(frame, options)
                rc.render(frame, options)
                require(mae(pixels(a), pixels(b)) ===
                  0, `Default old/new exact ${mode}/${quality}/${i}`)
                const before = rb.sampleFluidField(0.5, 0.5)
                for (let j = 0; j < 30; j++) rb.sampleFluidField(j / 29, 0.5)
                require(JSON.stringify(before) ===
                  JSON.stringify(rb.sampleFluidField(0.5, 0.5)), 'Read-only API')
                changed = Math.max(changed, mae(pixels(a), pixels(c)))
                maxBytes = Math.max(maxBytes, presentation.stats.bytes)
                maxOffset = Math.max(maxOffset, presentation.stats.peakOffset)
                require(presentation.stats.bytes <= presentation.stats.limit &&
                  Number.isFinite(presentation.stats.peakOffset) &&
                  presentation.stats.peakOffset <=
                    Math.sqrt(2) * 0.08 + 1e-6, 'Bounded presentation')
              }
              require(changed >
                0.1, `Candidate differs from native ${mode}/${quality}/${transparent}`)
              let settledAt = null
              for (let i = 1; i <= 180; i++) {
                const time = 23 / 30 + i / 20
                rc.render(frame, { ...motionOptions(time, 23, 0.65, false), transparent })
                if (!rc.interactionActive) {
                  settledAt = time
                  break
                }
              }
              require(settledAt !== null &&
                mae(still, pixels(c)) === 0, `Exact recovery ${mode}/${quality}/${transparent}`)
              rc.destroy()
              rc.render(frame, {
                ...motionOptions(0, 0),
                transparent,
                hoverStrength: 0,
                pointer: { x: 0.5, y: 0.5, active: true, strength: 0 },
              })
              require(mae(still, pixels(c)) ===
                0, `Zero amplitude ${mode}/${quality}/${transparent}`)
              defaultCases.push({ mode, quality, transparent, exactFrames: 24, readOnlyChecks: 24 })
              candidateCases.push({
                mode,
                quality,
                transparent,
                maxNativeMae: changed,
                settledAt,
                exactRecovery: true,
                zeroAmplitude: true,
              })
              ra.destroy()
              rb.destroy()
              rc.destroy()
            }
        const source = prepareArtFrame(image, image.width, image.height, { columns: 72 })
        for (const ratio of [0.5, 1, 2]) {
          const frame = { ...source, width: source.height * ratio },
            c = document.createElement('canvas'),
            r = renderer(c)
          const n = new Function('ratio', reference)(ratio)
          n.configure('trail', 0.65, 0.38, false)
          let error = 0,
            velocity = 0
          for (let i = 0; i < 24; i++) {
            const options = motionOptions(i / 30, i)
            n.move(options.pointer.x, options.pointer.y, (i / 30) * 1000)
            n.step(i === 0 ? 1 / 60 : 1 / 30)
            r.render(frame, options)
            for (const [x, y] of [
              [0.3, 0.5],
              [0.5, 0.55],
              [options.pointer.x, options.pointer.y],
            ]) {
              const f = n.trail,
                px = x * (f.width - 1),
                py = y * (f.height - 1),
                state = r.sampleFluidField(x, y)
              const expected = {
                velocityX: f.read(f.u, px, py) / (f.width - 1),
                velocityY: f.read(f.v, px, py) / (f.height - 1),
                offsetX: f.read(f.offsetX, px, py) / (f.width - 1),
                offsetY: f.read(f.offsetY, px, py) / (f.height - 1),
                density: f.sample(x, y),
              }
              for (const key of Object.keys(expected))
                error = Math.max(error, Math.abs(state[key] - expected[key]))
              velocity = Math.max(velocity, Math.hypot(state.velocityX, state.velocityY))
            }
          }
          require(error < 1e-7 && velocity > 0.001, `Independent native units ${ratio}`)
          maxFieldError = Math.max(maxFieldError, error)
          fieldCases.push({ ratio, samples: 72, maxError: error, maxVelocity: velocity })
          r.destroy()
        }
        const speeds = []
        for (const step of [1 / 120, 1 / 12]) {
          const c = document.createElement('canvas'),
            r = renderer(c),
            p = createRiftPresentation()
          let peak = 0
          const rr = renderer(document.createElement('canvas'), { experimentalTrail: p.prepare })
          for (let i = 0; i < 24; i++) {
            const options = motionOptions(i * step, i)
            r.render(source, options)
            rr.render(source, options)
            peak = Math.max(
              peak,
              Math.hypot(
                r.sampleFluidField(options.pointer.x, options.pointer.y).velocityX,
                r.sampleFluidField(options.pointer.x, options.pointer.y).velocityY,
              ),
            )
          }
          speeds.push({
            secondsPerEvent: step,
            peakVelocity: peak,
            peakRiftOffset: p.stats.peakOffset,
          })
          r.destroy()
          rr.destroy()
        }
        require(speeds[0].peakVelocity > speeds[1].peakVelocity * 1.2, 'True speed sensitivity')
        return {
          defaultCases,
          candidateCases,
          fieldCases,
          maxBytes,
          maxOffset,
          maxFieldError,
          speeds,
        }
      },
      { reference, prototypePath },
    ),
  )
  assert.equal(report.errors.length, 0)
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
console.log(
  JSON.stringify({
    passed: report.passed,
    defaultCases: report.defaultCases.length,
    candidateCases: report.candidateCases.length,
    fieldCases: report.fieldCases.length,
    maxBytes: report.maxBytes,
    maxFieldError: report.maxFieldError,
    out,
  }),
)
