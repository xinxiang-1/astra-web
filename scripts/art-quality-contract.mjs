import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const root = 'sandbox/ascii-optimizer/experiments/2026-10-01-quality-v4'
const defaultOnly = process.argv.includes('--default-only')
const output =
  process.env.ASTRA_QUALITY_OUTPUT ||
  (defaultOnly ? 'test-results/art-quality-default-contract' : 'test-results/art-quality-contract')
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'))
const development = JSON.parse(await readFile(`${root}/development-r2/report.json`, 'utf8'))
const ids = new Set(development.cases.map((c) => c.fixture))
const fixtures = manifest.fixtures.filter((f) => f.split !== 'holdout' && ids.has(f.id))
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ args: ['--enable-gpu', '--use-angle=d3d11'] })
const report = {
  browser: await browser.version(),
  cases: [],
  errors: [],
  scope: 'Production port parity on train/dev only; never reruns frozen holdout',
}
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(`${base}/ascii-art`)
  for (const fixture of defaultOnly ? [] : fixtures) {
    const records = await page.evaluate(async (fixture) => {
      const production = await import('/src/lib/art-engine/index.ts')
      const frozen = await import('/sandbox/ascii-optimizer/quality-v4/engine/index.ts')
      const image = new Image()
      image.src = `/${fixture.path}`
      await image.decode()
      const records = []
      const common = {
        mode: 'density',
        columns: 120,
        charset: ' .,:;i1tfLCG08@',
        fontFamily: 'Consolas, monospace',
        charAspect: 0.55,
        normalize: false,
        contrast: 0,
        exposure: 0,
        invert: true,
        fillAll: true,
        ditherStrength: 0,
        background: '#111615',
        ink: '#eeeae2',
      }
      for (const rasterQuality of ['high', 'supersampled']) {
        const settings = { ...common, fontWeight: 600, rasterQuality }
        const frame = production.prepareArtFrame(image, image.width, image.height, settings)
        const expected = frozen.prepareArtFrame(image, image.width, image.height, {
          ...settings,
          colorFidelity: true,
        })
        const arraysEqual = ['alpha', 'indices', 'colors'].every(
          (key) =>
            frame[key].length === expected[key].length &&
            frame[key].every((n, i) => n === expected[key][i]),
        )
        const glyphsEqual = frame.glyphs.every(
          (g, i) =>
            g.coverage === expected.glyphs[i].coverage &&
            g.tile.toDataURL() === expected.glyphs[i].tile.toDataURL(),
        )
        const a = document.createElement('canvas'),
          b = document.createElement('canvas')
        const renderer = production.createCanvasArtRenderer(a),
          reference = frozen.createCanvasArtRenderer(b)
        for (const edge of [720, 1080, 3840]) {
          renderer.render(frame, { longEdge: edge, transparent: true })
          reference.render(expected, { longEdge: edge, transparent: true })
          records.push({
            fixture: fixture.id,
            rasterQuality,
            edge,
            passed:
              arraysEqual &&
              glyphsEqual &&
              frame.text === expected.text &&
              a.toDataURL() === b.toDataURL(),
            memory: renderer.cacheStats,
          })
        }
        renderer.destroy()
        reference.destroy()
        records.push({
          fixture: fixture.id,
          rasterQuality,
          released: true,
          passed:
            renderer.cacheStats.backingBytes === 0 &&
            renderer.cacheStats.supersampleBytes === 0 &&
            renderer.cacheStats.scratchBytes === 0,
        })
        a.width = a.height = b.width = b.height = 1
      }
      return records
    }, fixture)
    report.cases.push(...records)
    for (const record of records) assert(record.passed, JSON.stringify(record))
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  }
  report.defaults = []
  for (const fixture of fixtures.slice(0, 3)) {
    const records = await page.evaluate(async (fixture) => {
      const engine = await import('/src/lib/art-engine/index.ts')
      const baseline =
        await import('/sandbox/ascii-optimizer/experiments/2026-10-01-quality-v4/baseline/index.ts')
      const image = new Image()
      image.src = `/${fixture.path}`
      await image.decode()
      const results = []
      for (const mode of ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']) {
        const settings = {
          mode,
          columns: 48,
          phrase: '山河万里',
          fontFamily: mode === 'phrase' ? '"Microsoft YaHei"' : 'Consolas',
          charAspect: mode === 'phrase' ? 0.85 : 0.55,
        }
        const frame = engine.prepareArtFrame(image, image.width, image.height, settings)
        const expected = baseline.prepareArtFrame(image, image.width, image.height, settings)
        const a = document.createElement('canvas'),
          b = document.createElement('canvas')
        const renderer = engine.createCanvasArtRenderer(a),
          old = baseline.createCanvasArtRenderer(b)
        const options = {
          longEdge: 720,
          transparent: true,
          motion: 'wave',
          time: 0.6,
          hover: 'light',
          pointer: { x: 0.4, y: 0.5, strength: 0.7 },
        }
        renderer.render(frame, options)
        old.render(expected, options)
        results.push({
          fixture: fixture.id,
          mode,
          passed:
            frame.text === expected.text &&
            frame.alpha.every((n, i) => n === expected.alpha[i]) &&
            a.toDataURL() === b.toDataURL(),
        })
        renderer.destroy()
        old.destroy()
        a.width = a.height = b.width = b.height = 1
      }
      return results
    }, fixture)
    for (const record of records) assert(record.passed, JSON.stringify(record))
    report.defaults.push(...records)
  }
  report.backend = await page.evaluate(async () => {
    const engine = await import('/src/lib/art-engine/index.ts')
    const source = document.createElement('canvas')
    source.width = source.height = 24
    source.getContext('2d').fillRect(0, 0, 24, 24)
    const frame = engine.prepareArtFrame(source, 24, 24, {
      rasterQuality: 'high',
      fontWeight: 600,
      columns: 24,
    })
    const target = document.createElement('canvas'),
      renderer = engine.createArtRenderer(target)
    renderer.render(frame, { longEdge: 64 })
    const backend = renderer.backend
    renderer.destroy()
    return backend
  })
  assert.equal(report.backend, 'canvas2d', 'Quality requests must use the validated raster backend')
  assert.deepEqual(report.errors, [])
  report.passed = true
  console.log(
    JSON.stringify({
      passed: true,
      cases: report.cases.length,
      defaults: report.defaults.length,
      output,
    }),
  )
} finally {
  report.hashes = Object.fromEntries(
    await Promise.all(
      ['core', 'canvas', 'index', 'types'].map(async (name) => [
        name,
        createHash('sha256')
          .update(await readFile(`src/lib/art-engine/${name}.ts`))
          .digest('hex'),
      ]),
    ),
  )
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
