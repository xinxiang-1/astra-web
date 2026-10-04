import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_CAPACITY_OUTPUT || 'test-results/signature-capacity-research')
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce', acceptDownloads: true })
const report = { browser: browser.version(), declaration: 'signature-capacity-partition-v1', errors: [], cases: [], templates: {}, sourceHashes: {}, candidateTiming: [] }
page.on('pageerror', error => report.errors.push(error.message))
try {
  await page.goto(base + '/docs/prototypes/v10-signature-capacity/index.html', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('#app')?.dataset.ready === 'true', undefined, { timeout: 90000 })
  await page.screenshot({ path: path.join(out, 'desktop-default.png'), fullPage: true })
  for (const template of ['beethoven', 'chinese', 'english']) for (const source of ['porcelain', 'portrait']) for (const palette of ['paper', 'night']) {
    const label = `${template}-${source}-${palette}`
    const result = await page.evaluate(async ({ template, source, palette }) => {
      const api = await import('/src/lib/signature-portrait/index.ts')
      const engine = await import('/docs/prototypes/v10-signature-capacity/engine.ts')
      const { quality } = await import('/docs/prototypes/v10-signature-capacity/metrics.ts')
      window.__capacityTemplates ??= new Map()
      let stamps = window.__capacityTemplates.get(template)
      if (!stamps) {
        stamps = template === 'beethoven' ? await engine.historicalStamp() : await api.generateHandwritingVariants(template === 'chinese' ? '李云舟' : 'Alexander Montgomery', { count: 8, maxSide: 420, seed: 20261004, font: template === 'chinese' ? 'mashanzheng' : 'longcang' })
        window.__capacityTemplates.set(template, stamps)
      }
      const image = new Image()
      image.src = source === 'porcelain' ? '/artwork/porcelain-study-v1.png' : '/artwork/portrait-reference.png'
      await image.decode()
      const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('')
      const hash = surface => digest(surface.getContext('2d').getImageData(0, 0, surface.width, surface.height).data)
      const results = []
      for (const profile of ['ink', 'cutout', 'candidate']) {
        const start = performance.now()
        let output, count, scene, geometry
        if (profile === 'candidate') {
          scene = engine.partition(image, stamps, palette)
          output = engine.paint(scene, stamps); count = scene.cells.length
          const occupied = new Uint8Array(scene.width * scene.height)
          let overlaps = 0, escaped = 0, shortSide = []
          for (const cell of scene.cells) {
            const stamp = stamps[cell.index]
            if (cell.scale <= 0 || cell.dx < -1e-8 || cell.dy < -1e-8 || cell.dx + stamp.width * cell.scale > cell.w + 1e-8 || cell.dy + stamp.height * cell.scale > cell.h + 1e-8 || cell.x < 0 || cell.y < 0 || cell.x + cell.w > scene.width || cell.y + cell.h > scene.height) escaped++
            for (let y = cell.y; y < cell.y + cell.h; y++) for (let x = cell.x; x < cell.x + cell.w; x++) { const p = y * scene.width + x; if (occupied[p]) overlaps++; occupied[p] = 1 }
            shortSide.push(cell.shortSide)
          }
          shortSide.sort((a, b) => a - b)
          const repeated = engine.partition(image, stamps, palette)
          const replayed = engine.paint(scene, stamps)
          geometry = { overlaps, escaped, missingPixels: occupied.reduce((n, value) => n + (value === 0 ? 1 : 0), 0), shortSideMin: shortSide[0], shortSideP10: shortSide[Math.floor(.1 * (shortSide.length - 1))], sameScene: JSON.stringify(repeated) === JSON.stringify(scene), sourceFreeReplaySame: await hash(replayed) === await hash(output) }
          replayed.width = 1; replayed.height = 1
        } else {
          const options = { maxSide: 1024, density: 30, minSizeRatio: .014, maxSizeRatio: .04, angleRange: 12, seed: 42, skipPaint: true, inkStyle: profile, background: engine.palettes[palette].background, ink: palette === 'night' ? { r: 238, g: 234, b: 226 } : undefined, invertDensity: palette === 'night', colorize: false, coverFill: false, underlay: 0 }
          const generated = await api.renderSignaturePortrait(image, image.naturalWidth, image.naturalHeight, stamps, options)
          output = api.paintPlacementsScaled(generated.placements, stamps, generated.width, generated.height, generated.width, generated.height, { ...options, underlay: 0 })
          generated.canvas.width = 1; generated.canvas.height = 1
          count = generated.placements.length
        }
        const elapsed = performance.now() - start
        const metric = quality(image, output, palette)
        results.push({ profile, width: output.width, height: output.height, count, elapsedWithAuditMs: elapsed, metric, geometry, negativeCells: scene?.cells.filter(c => c.polarity === 'cutout').length, clippedToneCells: scene?.clippedToneCells, integralBytes: scene?.integralBytes, rgbaSha256: await hash(output), png: output.toDataURL('image/png').split(',')[1] })
        output.width = 1; output.height = 1
      }
      const timing = []
      for (let i = 0; i < 9; i++) {
        const start = performance.now(), scene = engine.partition(image, stamps, palette), output = engine.paint(scene, stamps)
        // Synchronize the complete raster. Keep readback inside every repeated measurement.
        const pixels = output.getContext('2d').getImageData(0, 0, output.width, output.height).data
        timing.push(performance.now() - start)
        if (pixels[3] !== 255) throw new Error('Output lost its opaque substrate')
        output.width = 1; output.height = 1
      }
      return { results, timing, traits: stamps.map(engine.measure), stampCount: stamps.length, templatePixels: stamps.reduce((n, stamp) => n + stamp.width * stamp.height, 0) }
    }, { template, source, palette })
    for (const entry of result.results) {
      await writeFile(path.join(out, `${label}-${entry.profile}.png`), Buffer.from(entry.png, 'base64'))
      delete entry.png
      if (entry.profile === 'candidate') {
        assert.equal(entry.geometry.overlaps, 0); assert.equal(entry.geometry.escaped, 0); assert.equal(entry.geometry.missingPixels, 0)
        assert(entry.geometry.shortSideMin >= 8 - 1e-8); assert(entry.geometry.shortSideP10 >= 8)
        assert(entry.geometry.sameScene && entry.geometry.sourceFreeReplaySame)
        assert(entry.integralBytes <= 24 * 1024 * 1024 && entry.count <= 16000)
      }
      report.cases.push({ label, ...entry })
    }
    report.templates[template] = { count: result.stampCount, pixels: result.templatePixels, traits: result.traits }
    const warm = result.timing.slice(2).sort((a, b) => a - b)
    report.candidateTiming.push({ label, coldMs: result.timing[0], warmupMs: result.timing[1], repeatsMs: result.timing.slice(2), p50Ms: warm[3], p95Ms: warm[6], scope: 'partition + prepare masks + paint + full synchronous RGBA readback; excludes font/template generation, UI, PNG encoding and audit' })
    await writeFile(path.join(out, 'report.partial.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ label, profiles: result.results.map(r => ({ profile: r.profile, ...r.metric })), p95Ms: warm[6] }))
  }
  for (const file of ['docs/prototypes/v10-signature-capacity/engine.ts', 'docs/prototypes/v10-signature-capacity/metrics.ts', 'docs/prototypes/v10-signature-capacity/main.ts', 'docs/research/2026-10-04-signature-capacity/beethoven-signature.svg', 'public/artwork/porcelain-study-v1.png', 'public/artwork/portrait-reference.png']) report.sourceHashes[file] = createHash('sha256').update(await readFile(file)).digest('hex')
  assert.equal(report.cases.length, 36)
  assert.deepEqual(report.errors, [])
  report.engineeringPassed = true
  report.candidateQualityPasses = report.cases.filter(c => c.profile === 'candidate' && c.metric.passed).length
  report.candidateQualityCases = 12
  report.commercialVisualPassed = false
  report.promotion = false
} catch (error) {
  report.engineeringPassed = false; report.failure = error.stack
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, engineeringPassed: report.engineeringPassed, candidateQualityPasses: report.candidateQualityPasses, failure: report.failure }))
  await browser.close()
}
