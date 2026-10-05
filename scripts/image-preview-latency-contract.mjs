import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_IMAGE_OUTPUT || `test-results/image-latency-${Date.now()}`)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'chrome', headless: true })
const report = { browser: browser.version(), passed: false, errors: [], scope: 'Page timer/rAF and actual theme click during a native image Worker frame; these are not character output FPS' }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' })
  page.on('pageerror', e => report.errors.push(e.message))
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/ascii-art')
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('public/artwork/porcelain-study-v1.png'))
  await page.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.renderPending === 'false')
  await page.evaluate(async () => {
    const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
    const source = new Image(); source.src = '/artwork/porcelain-study-v1.png'; await source.decode()
    const frame = prepareArtFrame(source, source.width, source.height, {
      mode: 'phrase', columns: 180, phrase: '我爱你中国', colored: true,
      fontFamily: 'Microsoft YaHei', charAspect: .85,
    })
    const s = document.querySelector('.art-editor').__vueParentComponent.setupState
    s.artHover = 'none'; s.artMotion = 'none'
    window.__imageLatency = { start: performance.now(), timers: [], rafs: [], previousTimer: performance.now(), previousRaf: 0 }
    const trace = window.__imageLatency
    trace.timer = setInterval(() => { const now = performance.now(); trace.timers.push(now - trace.previousTimer); trace.previousTimer = now }, 20)
    const tick = now => { if (trace.previousRaf) trace.rafs.push(now - trace.previousRaf); trace.previousRaf = now; trace.raf = requestAnimationFrame(tick) }
    trace.raf = requestAnimationFrame(tick)
    s.artFrame = frame
  })
  const feedback = page.locator('.stage-feedback').filter({ hasText: '正在绘制字符画' })
  await feedback.waitFor({ timeout: 30000 })
  const geometry = () => page.locator('.ascii-scroll').first().evaluate(el => [el.clientWidth, el.clientHeight])
  const before = await geometry()
  assert.equal(await feedback.evaluate(el => getComputedStyle(el).pointerEvents), 'none')
  const clicked = Date.now()
  await page.getByRole('button', { name: /切换到/ }).click({ timeout: 3000 })
  report.themeClickMs = Date.now() - clicked
  assert(report.themeClickMs < 3000, 'Theme must stay operable during the image draw')
  assert.deepEqual(await geometry(), before, 'Theme/feedback must not resize the artwork')
  await page.screenshot({ path: path.join(out, 'large-image-progress.png') })
  await page.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.mode === 'phrase' && document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.renderPending === 'false', {}, { timeout: 120000 })
  report.nativeFrame = await page.evaluate(async () => {
    const trace = window.__imageLatency; clearInterval(trace.timer); cancelAnimationFrame(trace.raf)
    const s = document.querySelector('.art-editor').__vueParentComponent.setupState, c = document.querySelector('.ascii-scroll .ascii-canvas')
    const { createCanvasArtRenderer } = await import('/src/lib/art-engine/index.ts')
    const options = JSON.parse(s.previewRenderKeys.get(c))[5]
    options.time = Number(c.dataset.time); options.hoverTime = Number(c.dataset.interactionTime)
    const reference = document.createElement('canvas'); reference.getContext('2d', { willReadFrequently: false })
    const renderer = createCanvasArtRenderer(reference)
    const baselineStart = performance.now(); renderer.render(s.artFrame, options)
    const expected = reference.getContext('2d').getImageData(0, 0, reference.width, reference.height).data
    const baselineMs = performance.now() - baselineStart, actual = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let changed = 0, maxDelta = 0
    for (let i = 0; i < expected.length; i++) { const d = Math.abs(expected[i] - actual[i]); if (d) changed++; maxDelta = Math.max(d, maxDelta) }
    const summarize = values => { const ordered = values.slice().sort((a, b) => a - b); return { count: values.length, p95: ordered[Math.floor(ordered.length * .95)], max: Math.max(...values) } }
    const result = { settings: s.artFrame.settings, options, columns: s.artFrame.columns, rows: s.artFrame.rows, width: c.width, height: c.height,
      workerRenderMs: s.artRenderers.get(c).renderMs, baselineMs, changed, maxDelta, sameBytes: expected.length === actual.length,
      timer: summarize(trace.timers), pageRaf: summarize(trace.rafs), wallMs: trace.previousTimer - trace.start }
    renderer.destroy(); delete window.__imageLatency; return result
  })
  assert(report.nativeFrame.sameBytes && report.nativeFrame.changed === 0, 'Large image preserves native RGBA')
  assert(report.nativeFrame.timer.count > 20 && report.nativeFrame.timer.max < 1000, 'No second-long main-thread timer blockage during the draw')
  assert.deepEqual(await geometry(), before, 'Hiding image feedback must not resize the artwork')
  await page.locator('.ascii-scroll .ascii-canvas').screenshot({ path: path.join(out, 'large-image-complete.png') })
  assert.deepEqual(report.errors, []); report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally {
  report.sourceHashes = Object.fromEntries(await Promise.all(['src/lib/art-engine/canvas.ts', 'src/lib/art-engine/preview-render-client.ts', 'src/views/AsciiArtView.vue'].map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close()
}
console.log(JSON.stringify({ out, ...report }))
