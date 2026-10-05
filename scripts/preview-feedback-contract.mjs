import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5184'
const out = path.resolve(process.env.ASTRA_FEEDBACK_OUTPUT || `test-results/preview-feedback-${Date.now()}`)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'chrome', headless: true })
const report = { browser: browser.version(), base, errors: [], cases: [], passed: false,
  scope: 'Real production upload/controls/Worker pixels; completed Worker delivery is delayed 600ms to verify slow-operation feedback independently of device speed' }
report.sourceHashes = Object.fromEntries(await Promise.all(['src/views/AsciiArtView.vue', 'scripts/preview-feedback-contract.mjs'].map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
const recordCase = report.cases.push.bind(report.cases)
report.cases.push = (...entries) => {
  for (const entry of entries) console.log('preview-feedback: ' + entry.name + ' passed')
  return recordCase(...entries)
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' })
  page.on('pageerror', error => report.errors.push(error.message))
  page.setDefaultTimeout(60000)
  await page.addInitScript(() => {
    localStorage.setItem('astra-theme', 'dark')
    const Native = window.Worker
    window.__previewRequests = 0
    window.__previewWorkers = new Set()
    window.__previewDelay = 600
    window.Worker = class extends Native {
      constructor(url, options) {
        super(url, options)
        if (!String(url).includes('frame-render.worker')) return
        window.__previewWorkers.add(this)
        this.addEventListener('message', event => {
          if (event.data?.bitmap && window.__previewDelay) {
            event.stopImmediatePropagation()
            setTimeout(() => this.onmessage?.(event), window.__previewDelay)
          }
        })
        const send = this.postMessage.bind(this)
        this.postMessage = (data, ...rest) => {
          if (data?.frame) window.__previewRequests++
          return send(data, ...rest)
        }
      }
      terminate() { window.__previewWorkers.delete(this); super.terminate() }
    }
  })
  await page.goto(base + '/ascii-art')
  const canvas = page.locator('.ascii-scroll .ascii-canvas').first()
  const feedback = page.locator('.stage-feedback')
  const ready = mode => page.waitForFunction(mode => {
    const c = document.querySelector('.ascii-scroll .ascii-canvas')
    return c?.width > 100 && c.dataset.renderPending === 'false' && (!mode || c.dataset.mode === mode)
  }, mode, { timeout: 120000 })
  const pixels = () => canvas.evaluate(c => c.toDataURL())
  const monitor = (ms, minimumCompletions = 0) => page.evaluate(async ({ ms, minimumCompletions }) => {
    const requests = window.__previewRequests
    const start = performance.now()
    let loading = 0, completedFrames = 0, lastTime = document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.time
    do {
      if (document.querySelector('.stage-feedback')) loading++
      const time = document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.time
      if (time !== lastTime) { completedFrames++; lastTime = time }
      if (performance.now() - start > 120000) throw new Error('No advancing complete ambient frames within 120 seconds')
      await new Promise(resolve => setTimeout(resolve, 20))
    } while (performance.now() - start < ms || completedFrames < minimumCompletions)
    return { requests: window.__previewRequests - requests, loadingSamples: loading, completedFrames, elapsedMs: performance.now() - start }
  }, { ms, minimumCompletions })
  const source = path.resolve('public/artwork/porcelain-study-v1.png')
  await page.locator('input[type=file]').first().setInputFiles(source)
  await feedback.waitFor({ state: 'visible' })
  await ready('density'); await feedback.waitFor({ state: 'hidden' })
  report.cases.push({ name: 'initial-image', slowFeedbackVisible: true, clearsOnComplete: true })
  await page.locator('.six-modes button').filter({ hasText: '原色字符' }).click()
  await feedback.waitFor({ state: 'visible' }); await ready('color'); await feedback.waitFor({ state: 'hidden' })
  await page.locator('details.calibrated-effects').evaluate(d => d.open = true)
  await page.getByRole('group', { name: '六模式悬停', exact: true }).getByRole('button', { name: '字符聚散试用', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.hover === 'particles')
  await ready('color'); await feedback.waitFor({ state: 'hidden' })
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5)
  await page.waitForFunction(() => {
    const c = document.querySelector('.ascii-scroll .ascii-canvas')
    return c?.dataset.renderPending === 'false' && c.dataset.pointerStrength === '0.65' && c.dataset.interactionActive === 'false'
  }, {}, { timeout: 120000 })
  const still = await pixels(), stationary = await monitor(3000)
  assert.equal(stationary.requests, 0, 'Stationary settled pointer must not redraw identical frames')
  assert.equal(stationary.loadingSamples, 0, 'Stationary pointer has no loading overlay')
  assert.equal(await pixels(), still, 'Stopping idle scheduling preserves the exact completed image')
  report.cases.push({ name: 'stationary-color-180', ...stationary, exactPixels: true })

  const hoverMonitor = monitor(8000)
  for (let i = 0; i < 18; i++) {
    await page.mouse.move(box.x + box.width * (.15 + .7 * i / 17), box.y + box.height * (.5 + Math.sin(i / 17 * Math.PI * 2) * .14))
    await page.waitForTimeout(25)
  }
  await page.waitForFunction(() => Number(document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.particlePeak) > .005)
  assert.notEqual(await pixels(), still, 'Real input still produces visible movement')
  const hover = await hoverMonitor
  assert(hover.requests > 0); assert.equal(hover.loadingSamples, 0, 'Normal live hover must not be announced as another generation')
  await page.mouse.move(0, 0)
  await page.waitForFunction(baseline => {
    const c = document.querySelector('.ascii-scroll .ascii-canvas')
    return c?.dataset.renderPending === 'false' && c.dataset.pointerStrength === '0' && c.dataset.interactionActive === 'false' && c.toDataURL() === baseline
  }, still, { timeout: 60000, polling: 250 })
  report.cases.push({ name: 'hover-still-works', ...hover, visibleScatter: true, exactRecovery: true })

  await page.getByRole('group', { name: '六模式悬停', exact: true }).getByRole('button', { name: '光晕', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.hover === 'light')
  await ready('color')
  const lightBaseline = await pixels()
  report.lightBaseline = await canvas.evaluate(c => {
    window.__feedbackLightBase = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    window.__feedbackLightTrace = []
    new MutationObserver(() => window.__feedbackLightTrace.push({ at: performance.now(), data: { ...c.dataset } })).observe(c, { attributes: true, attributeFilter: ['data-pointer-strength'] })
    return { width: c.width, height: c.height, data: { ...c.dataset } }
  })
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5)
  await page.waitForFunction(() => {
    const c = document.querySelector('.ascii-scroll .ascii-canvas')
    return c?.dataset.renderPending === 'false' && c.dataset.pointerStrength === '0.65' && c.dataset.interactionActive === 'false'
  }, {}, { timeout: 120000 })
  const lightStill = await pixels(), stableLight = await monitor(2000)
  assert.equal(stableLight.requests, 0); assert.equal(stableLight.loadingSamples, 0)
  assert.equal(await pixels(), lightStill, 'Default light hover remains exact while idle')
  await page.mouse.move(0, 0)
  await page.waitForFunction(baseline => {
    const c = document.querySelector('.ascii-scroll .ascii-canvas')
    return c?.dataset.renderPending === 'false' && c.dataset.pointerStrength === '0' && c.dataset.interactionActive === 'false' && c.toDataURL() === baseline
  }, lightBaseline, { timeout: 60000, polling: 250 })
  report.cases.push({ name: 'stationary-default-light', ...stableLight, exactPixels: true, exactRecovery: true })

  for (const theme of ['dark', 'light']) {
    if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: /切换到/ }).click()
    await ready('color')
    const oldWidth = await canvas.evaluate(c => c.width)
    await page.getByRole('button', { name: '放大', exact: true }).first().click()
    await feedback.waitFor({ state: 'visible' })
    const pointerEvents = await feedback.evaluate(el => getComputedStyle(el).pointerEvents)
    assert.equal(pointerEvents, 'none')
    await ready('color'); await feedback.waitFor({ state: 'hidden' })
    const width = await canvas.evaluate(c => c.width)
    assert(width > oldWidth)
    report.cases.push({ name: 'explicit-zoom-' + theme, loadingVisible: true, pointerEvents, width, oldWidth })
  }

  await page.getByRole('button', { name: '全屏 ↗', exact: true }).click()
  await page.locator('.fs-overlay .status').filter({ hasText: '正在更新画面' }).waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('.fs-overlay .ascii-canvas')?.dataset.renderPending === 'false', {}, { timeout: 120000 })
  await page.locator('.fs-overlay .status').filter({ hasText: '正在更新画面' }).waitFor({ state: 'hidden' })
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => window.__previewWorkers.size), 1)
  report.cases.push({ name: 'fullscreen-first-frame', firstFeedbackVisible: true, clearsOnComplete: true, released: true })

  await page.getByRole('group', { name: '六模式微动', exact: true }).getByRole('button', { name: '流动', exact: true }).click()
  await feedback.waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.motion === 'wave', {}, { timeout: 120000 })
  await feedback.waitFor({ state: 'hidden' })
  const animated = await monitor(6000, 2)
  assert(animated.requests > 0); assert.equal(animated.loadingSamples, 0, 'Completed ambient preview continues without repeated loading overlays')
  await page.getByRole('button', { name: '暂停动效', exact: true }).click()
  await ready('color')
  report.cases.push({ name: 'ambient-updates', ...animated })
  await page.getByRole('group', { name: '六模式微动', exact: true }).getByRole('button', { name: '静态', exact: true }).click()
  await ready('color')
  const previousSource = await pixels()
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('public/artwork/portrait-reference.png'))
  await feedback.waitFor({ state: 'visible' })
  await page.waitForFunction(previous => {
    const c = document.querySelector('.ascii-scroll .ascii-canvas')
    return c?.dataset.renderPending === 'false' && c.toDataURL() !== previous
  }, previousSource, { timeout: 120000, polling: 250 })
  await feedback.waitFor({ state: 'hidden' })
  report.cases.push({ name: 'source-replacement', slowFeedbackVisible: true, clearsOnComplete: true })
  await page.screenshot({ path: path.join(out, 'feedback-cleared.png') })
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack; process.exitCode = 1
  const failedPage = browser.contexts()[0]?.pages()[0]
  report.failureState = await failedPage?.evaluate(() => ({
    requests: window.__previewRequests,
    feedback: [...document.querySelectorAll('.stage-feedback')].map(el => el.textContent),
    canvases: [...document.querySelectorAll('.ascii-canvas')].map(c => ({ width: c.width, height: c.height, data: { ...c.dataset } })),
  })).catch(() => null)
  report.lightTrace = await failedPage?.evaluate(() => window.__feedbackLightTrace).catch(() => null)
  report.lightDifference = await failedPage?.evaluate(() => {
    const c = document.querySelector('.ascii-scroll .ascii-canvas'), base = window.__feedbackLightBase
    if (!c || !base) return null
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let changes = 0, max = 0
    for (let i = 0; i < data.length; i++) { const delta = Math.abs(data[i] - base[i]); if (delta) { changes++; max = Math.max(max, delta) } }
    return { changes, max, baseLength: base.length, resultLength: data.length }
  }).catch(() => null)
  await failedPage?.screenshot({ path: path.join(out, 'failure.png'), timeout: 10000 }).catch(() => {})
}
finally { await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ out, ...report }))
