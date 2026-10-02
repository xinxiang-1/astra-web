import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import ts from 'typescript'

const source = await readFile('src/lib/art-engine/canvas.ts', 'utf8')
const disabled = source.replace(
  'const choreographyLimit = 4 * 1024 * 1024',
  'const choreographyLimit = 0',
)
assert.notEqual(source, disabled, 'The reference disables only the bounded choreography cache')
const compile = (text) =>
  ts.transpileModule(text, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
const out = path.resolve(
  process.env.ASTRA_SPATIAL_CACHE_OUTPUT || `test-results/spatial-cache-${Date.now()}`,
)
await mkdir(out, { recursive: false })
const report = {
  passed: false,
  sourceSha256: createHash('sha256').update(source).digest('hex'),
  errors: [],
}
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
page.on('pageerror', (e) => report.errors.push(e.message))
try {
  await page.goto(`${process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'}/ascii-art`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  report.result = await page.evaluate(
    async ({ cached, uncached }) => {
      const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
      await document.fonts.ready
      const image = new Image()
      image.src = '/artwork/portrait-reference.png'
      await image.decode()
      const canvases = [document.createElement('canvas'), document.createElement('canvas')]
      const renderers = [cached, uncached].map((code, i) =>
        new Function('exports', code + ';return exports.createCanvasArtRenderer;')({})(canvases[i]),
      )
      const bytes = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const cases = [],
        timing = []
      let maxBytes = 0
      for (const mode of ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']) {
        const original = prepareArtFrame(image, image.width, image.height, {
          mode,
          columns: 96,
          phrase: '我爱你中国，光与影。',
        })
        // Same grid and timestamp, different projection aspect: catches a stale
        // per-glyph cache even when array lengths and the ambient key match.
        const resized = { ...original, width: original.width * 1.6 }
        for (const motion of ['assemble', 'reform'])
          for (const transparent of [false, true])
            for (const frame of [original, resized, original]) {
              const options = {
                longEdge: 620,
                effectProfile: 'expressive',
                motionStyle: 'cinematic',
                motion,
                motionStrength: 0.8,
                time: 1.8,
                transparent,
              }
              renderers.forEach((r) => r.render(frame, options))
              const a = bytes(canvases[0]),
                b = bytes(canvases[1])
              let changed = 0
              for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++
              maxBytes = Math.max(maxBytes, renderers[0].cacheStats.choreographyBytes)
              cases.push({ mode, motion, transparent, aspect: frame.width / frame.height, changed })
            }
        if (mode === 'density') {
          for (const motion of ['assemble', 'reform']) {
            const samples = [[], []]
            for (let i = 0; i < 12; i++)
              for (let r = 0; r < 2; r++) {
                const ms = renderers[r].render(original, {
                  longEdge: 720,
                  effectProfile: 'expressive',
                  motionStyle: 'cinematic',
                  motion,
                  motionStrength: 0.8,
                  time: 0.5 + i / 30,
                }).renderMs
                if (i >= 3) samples[r].push(ms)
              }
            const medians = samples.map((s) => s.sort((a, b) => a - b)[4])
            timing.push({
              motion,
              columns: original.columns,
              rows: original.rows,
              longEdge: 720,
              warmSamples: 9,
              cachedMedianMs: medians[0],
              uncachedMedianMs: medians[1],
            })
          }
        }
      }
      renderers.forEach((r) => r.destroy())
      return { cases, timing, maxBytes, destroyBytes: renderers[0].cacheStats.choreographyBytes }
    },
    { cached: compile(source), uncached: compile(disabled) },
  )
  assert.equal(report.result.cases.length, 72)
  for (const c of report.result.cases)
    assert.equal(c.changed, 0, `${c.mode}/${c.motion}/${c.aspect}: cache preserves exact pixels`)
  assert(report.result.maxBytes > 0 && report.result.maxBytes <= 4 * 1024 * 1024)
  assert.equal(report.result.destroyBytes, 0)
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (e) {
  report.failure = e.stack
  throw e
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(`PASS 72 cached/uncached projection cases and release: ${out}`)
