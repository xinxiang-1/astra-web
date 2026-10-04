import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const folder = path.resolve(process.env.ASTRA_PRINT_DATA || 'test-results/signature-print-research')
const data = JSON.parse(await readFile(path.join(folder, 'report.json')))
assert(data.engineeringPassed)
for (const [file, hash] of Object.entries(data.sourceHashes)) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), hash, file)
const report = { scope: 'separate timing audit after development/build/UI jobs; same frozen engine and sources; 1 cold + 1 warmup + 7 repeats; partition, stencil preparation, paint and full sync RGBA readback; excludes font/template generation, UI, PNG and audit', cases: [], errors: [] }
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
report.browser = browser.version()
try {
  const page = await browser.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/docs/research/2026-10-04-signature-capacity/experiment-r2.json')
  for (const expected of data.cases.filter(c => c.profile === 'candidate')) {
    const [template, source, palette] = expected.label.split('-')
    const result = await page.evaluate(async ({ template, source, palette, size }) => {
      const api = await import('/src/lib/signature-portrait/index.ts')
      const engine = await import('/docs/prototypes/v11-signature-print/engine.ts')
      window.__timingTemplates ??= new Map()
      let stamps = window.__timingTemplates.get(template)
      if (!stamps) {
        stamps = template === 'beethoven' ? await engine.historicalStamp() : await api.generateHandwritingVariants(template === 'chinese' ? '李云舟' : 'Alexander Montgomery', { count: 8, maxSide: 420, seed: 20261004, font: template === 'chinese' ? 'mashanzheng' : 'longcang' })
        window.__timingTemplates.set(template, stamps)
      }
      const image = new Image(); image.src = source === 'porcelain' ? '/artwork/porcelain-study-v1.png' : '/artwork/portrait-reference.png'; await image.decode()
      const samples = []
      let rgbaSha256
      for (let i = 0; i < 9; i++) {
        const start = performance.now(), scene = engine.partition(image, stamps, palette, size), output = engine.paint(scene, stamps)
        const pixels = output.getContext('2d').getImageData(0, 0, output.width, output.height).data
        samples.push(performance.now() - start)
        if (i === 8) rgbaSha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), n => n.toString(16).padStart(2, '0')).join('')
        output.width = 1; output.height = 1
      }
      return { samples, rgbaSha256 }
    }, { template, source, palette, size: expected.size })
    assert.equal(result.rgbaSha256, expected.rgbaSha256)
    const warm = result.samples.slice(2).sort((a, b) => a - b)
    const entry = { label: expected.label, size: expected.size, coldMs: result.samples[0], warmupMs: result.samples[1], repeatsMs: result.samples.slice(2), p50Ms: warm[3], p95Ms: warm[6], budgetPassed: warm[6] <= 2000, rgbaSha256: result.rgbaSha256 }
    report.cases.push(entry)
    await writeFile(path.join(folder, 'timing.partial.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ label: entry.label, p95Ms: entry.p95Ms, budgetPassed: entry.budgetPassed }))
  }
  assert.equal(report.cases.length, 24)
  assert.deepEqual(report.errors, [])
  report.engineeringPassed = true
  report.timingBudgetPassed = report.cases.every(c => c.budgetPassed)
} finally {
  await writeFile(path.join(folder, 'timing.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ cases: report.cases.length, timingBudgetPassed: report.timingBudgetPassed }))
