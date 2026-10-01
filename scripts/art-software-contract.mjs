import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const root = 'sandbox/ascii-optimizer/experiments/2026-10-01-quality-v5'
const output = process.env.ASTRA_SOFTWARE_CONTRACT_OUTPUT || 'test-results/art-software-contract'
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
  defaults: [],
  errors: [],
  scope: 'Selective production port parity on train/dev; no rerendering any frozen holdout',
}
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(`${base}/ascii-art`)
  for (const fixture of fixtures) {
    console.log(`port ${fixture.id}`)
    const records = await page.evaluate(async (fixture) => {
      const production = await import('/src/lib/art-engine/index.ts')
      const frozen = await import('/sandbox/ascii-optimizer/quality-v5/engine/index.ts')
      const image = new Image()
      image.src = `/${fixture.path}`
      await image.decode()
      const records = []
      for (const mode of ['density', 'color']) {
        const settings = {
          mode,
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
          fontWeight: 600,
          softwareRaster: true,
          colorFidelity: true,
        }
        const frame = production.prepareArtFrame(image, image.width, image.height, settings)
        const expected = frozen.prepareArtFrame(image, image.width, image.height, settings)
        const equalFrame =
          ['alpha', 'indices', 'colors'].every(
            (key) =>
              frame[key].length === expected[key].length &&
              frame[key].every((n, i) => n === expected[key][i]),
          ) &&
          frame.text === expected.text &&
          frame.glyphs.every(
            (g, i) =>
              g.coverage === expected.glyphs[i].coverage &&
              g.tile.toDataURL() === expected.glyphs[i].tile.toDataURL(),
          )
        const a = document.createElement('canvas'),
          b = document.createElement('canvas')
        const renderer = production.createCanvasArtRenderer(a),
          reference = frozen.createCanvasArtRenderer(b)
        for (const edge of [720, 1080, 3840])
          for (const transparent of [false, true]) {
            const options = {
              longEdge: edge,
              transparent,
              motion: edge === 720 ? 'wave' : 'none',
              time: 0.7,
              hover: 'ripple',
              pointer: edge === 720 ? { x: 0.4, y: 0.5, strength: 0.6 } : undefined,
            }
            renderer.render(frame, options)
            reference.render(expected, options)
            const memory = renderer.cacheStats
            records.push({
              fixture: fixture.id,
              mode,
              edge,
              transparent,
              passed:
                equalFrame &&
                a.toDataURL() === b.toDataURL() &&
                memory.softwareMaskBytes <= 4 * 1024 * 1024 &&
                memory.softwareWorkingBytes <= 16 * 1024 * 1024,
              memory,
            })
          }
        const target = document.createElement('canvas'),
          wrapper = production.createArtRenderer(target)
        wrapper.render(frame, { longEdge: 720 })
        renderer.render(frame, { longEdge: 720 })
        records.push({
          fixture: fixture.id,
          mode,
          factory: true,
          passed: wrapper.backend === 'canvas2d' && target.toDataURL() === a.toDataURL(),
        })
        wrapper.destroy()
        target.width = target.height = 1
        renderer.destroy()
        reference.destroy()
        const memory = renderer.cacheStats
        records.push({
          fixture: fixture.id,
          mode,
          released: true,
          passed:
            memory.softwareMaskBytes === 0 &&
            memory.softwareWorkingBytes === 0 &&
            memory.backingBytes === 0,
        })
        a.width = a.height = b.width = b.height = 1
      }
      return records
    }, fixture)
    report.cases.push(...records)
    assert(
      records.every((r) => r.passed),
      JSON.stringify(records.filter((r) => !r.passed)),
    )
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  }
  for (const fixture of fixtures.slice(0, 3)) {
    const records = await page.evaluate(async (fixture) => {
      const engine = await import('/src/lib/art-engine/index.ts')
      const previous =
        await import('/sandbox/ascii-optimizer/experiments/2026-10-01-quality-v5/baseline/index.ts')
      const image = new Image()
      image.src = `/${fixture.path}`
      await image.decode()
      const records = []
      for (const mode of ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']) {
        const settings = {
          mode,
          columns: 48,
          phrase: '山河万里',
          fontFamily: mode === 'phrase' ? '"Microsoft YaHei"' : 'Consolas',
        }
        const frame = engine.prepareArtFrame(image, image.width, image.height, settings)
        const old = previous.prepareArtFrame(image, image.width, image.height, settings)
        const a = document.createElement('canvas'),
          b = document.createElement('canvas')
        const current = engine.createCanvasArtRenderer(a),
          reference = previous.createCanvasArtRenderer(b)
        const options = {
          longEdge: 512,
          motion: 'wave',
          time: 0.7,
          transparent: true,
          hover: 'light',
          pointer: { x: 0.4, y: 0.5, strength: 0.6 },
        }
        current.render(frame, options)
        reference.render(old, options)
        records.push({
          fixture: fixture.id,
          mode,
          passed: frame.text === old.text && a.toDataURL() === b.toDataURL(),
        })
        if (['phrase', 'contour', 'braille', 'halftone'].includes(mode)) {
          const unsupported = engine.prepareArtFrame(image, image.width, image.height, {
            ...settings,
            fontWeight: 600,
            softwareRaster: true,
            colorFidelity: true,
          })
          current.render(unsupported, options)
          records.push({
            fixture: fixture.id,
            mode,
            unsupportedFlags: true,
            passed: a.toDataURL() === b.toDataURL(),
          })
        }
        current.destroy()
        reference.destroy()
        a.width = a.height = b.width = b.height = 1
      }
      return records
    }, fixture)
    report.defaults.push(...records)
    assert(
      records.every((r) => r.passed),
      JSON.stringify(records.filter((r) => !r.passed)),
    )
  }
  assert.deepEqual(report.errors, [])
  report.completed = true
} finally {
  report.hashes = Object.fromEntries(
    await Promise.all(
      ['index.ts', 'core.ts', 'canvas.ts', 'types.ts'].map(async (name) => [
        name,
        createHash('sha256')
          .update(await readFile(`src/lib/art-engine/${name}`))
          .digest('hex'),
      ]),
    ),
  )
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
  console.log(
    JSON.stringify({
      output,
      completed: report.completed,
      cases: report.cases.length,
      defaults: report.defaults.length,
    }),
  )
}
