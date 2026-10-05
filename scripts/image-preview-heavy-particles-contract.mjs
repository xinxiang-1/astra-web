import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_IMAGE_OUTPUT || `test-results/image-heavy-particles-${Date.now()}`)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'chrome', headless: true })
const report = { browser: browser.version(), passed: false, scope: 'Three native active frames at the prior slow fixture dimensions; page clock is not character output FPS and simulated recovery is not real recovery' }
try {
  const page = await browser.newPage()
  page.on('console', m => { if (m.text().startsWith('image-heavy:')) console.log(m.text()) })
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/ascii-art')
  report.result = await page.evaluate(async () => {
    const { prepareArtFrame, createCanvasArtRenderer } = await import('/src/lib/art-engine/index.ts')
    const { createPreviewRenderClient } = await import('/src/lib/art-engine/preview-render-client.ts')
    const source = new Image(); source.src = '/artwork/porcelain-study-v1.png'; await source.decode()
    const frame = prepareArtFrame(source, source.width, source.height, { mode: 'phrase', columns: 180,
      phrase: '我爱你中国', colored: true, charAspect: .85, fontFamily: 'Microsoft YaHei, monospace' })
    const reference = document.createElement('canvas'), output = document.createElement('canvas')
    reference.getContext('2d', { willReadFrequently: false }); output.getContext('2d', { willReadFrequently: false })
    document.body.append(output)
    const renderer = createCanvasArtRenderer(reference), cases = []
    let resolve, reject
    const client = createPreviewRenderClient(output, { isCurrent: () => true, onProgress() {},
      onFallback() { reject(new Error('Unexpected fallback')) }, onError: e => reject(e), onResult() { resolve() },
    })
    const summarize = values => { const sorted = values.slice().sort((a, b) => a - b); return { count: sorted.length, p95: sorted[Math.floor(sorted.length * .95)], max: Math.max(...sorted) } }
    try {
      const references = []
      for (let i = 0; i < 3; i++) {
        const time = (i + 1) / 30, pointer = { x: .15 + .25 * i, y: .5, active: true, strength: .65 }
        const options = { longEdge: 713, motion: 'none', hover: 'particles', hoverTime: time,
          hoverStrength: .65, hoverRadius: .38, pointer, pointerSamples: [{ ...pointer, time: time * 1000 }] }
        const baselineStart = performance.now(); renderer.render(frame, options)
        const expected = reference.getContext('2d').getImageData(0, 0, reference.width, reference.height).data
        const baselineMs = performance.now() - baselineStart
        references.push({ i, options, expected, baselineMs, nativePeak: renderer.cacheStats.particles.peak })
      }
      // Fence the synchronous reference phase before starting page-clock measurements.
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      for (const { i, options, expected, baselineMs, nativePeak } of references) {
        const timers = [], rafs = []; let previousTimer = performance.now(), previousRaf = 0, raf
        const timer = setInterval(() => { const now = performance.now(); timers.push(now - previousTimer); previousTimer = now }, 20)
        const tick = now => { if (previousRaf) rafs.push(now - previousRaf); previousRaf = now; raf = requestAnimationFrame(tick) }
        raf = requestAnimationFrame(tick)
        try { await new Promise((r, j) => { resolve = r; reject = j; client.render(frame, options) }) }
        finally { clearInterval(timer); cancelAnimationFrame(raf) }
        const actual = output.getContext('2d').getImageData(0, 0, output.width, output.height).data
        let changed = 0, maxDelta = 0
        for (let j = 0; j < expected.length; j++) { const delta = Math.abs(expected[j] - actual[j]); if (delta) changed++; maxDelta = Math.max(delta, maxDelta) }
        if (changed || expected.length !== actual.length) throw new Error(`Heavy active frame ${i} differs: ${changed}, max ${maxDelta}`)
        if (client.cacheStats.particles.peak !== nativePeak) throw new Error('Native interaction peak differs')
        const item = { i, baselineMs, workerRenderMs: client.renderMs, changed, maxDelta, timer: summarize(timers), pageRaf: summarize(rafs), nativePeak, particles: client.cacheStats.particles }
        cases.push(item); console.log('image-heavy: ' + JSON.stringify(item))
      }
      return { settings: frame.settings, columns: frame.columns, rows: frame.rows, width: output.width, height: output.height, cases }
    } finally { client.destroy(); renderer.destroy(); output.remove() }
  })
  assert.equal(report.result.cases.length, 3)
  assert(report.result.cases.every(c => c.timer.count > 20 && c.timer.max < 1000))
  assert(report.result.cases.at(-1).particles.peak > .005, 'The same native input sequence produces visible particle energy')
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ out, passed: report.passed, failure: report.failure }))
