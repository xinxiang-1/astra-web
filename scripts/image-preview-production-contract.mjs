import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_IMAGE_OUTPUT || `test-results/image-production-${Date.now()}`)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'chrome', headless: true })
const report = { browser: browser.version(), passed: false, errors: [], modes: [], scope: 'Built application, actual upload/click/mouse and DOM only; low-resolution interaction, not the unresolved 180-column recovery' }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' })
  await page.addInitScript(() => {
    const Native = Worker; window.__frameWorkers = { live: 0, peak: 0 }
    window.Worker = class extends Native {
      constructor(url, options) { super(url, options); this.frame = String(url).includes('frame-render.worker'); if (this.frame) { window.__frameWorkers.live++; window.__frameWorkers.peak = Math.max(window.__frameWorkers.peak, window.__frameWorkers.live) } }
      terminate() { if (this.frame) { this.frame = false; window.__frameWorkers.live-- } super.terminate() }
    }
  })
  page.on('pageerror', e => report.errors.push(e.message))
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5184') + '/ascii-art')
  await page.getByRole('button', { name: /^低清/ }).click()
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('public/artwork/porcelain-study-v1.png'))
  const canvas = page.locator('.ascii-scroll .ascii-canvas').first()
  const idle = mode => page.waitForFunction(mode => {
    const c = document.querySelector('.ascii-scroll .ascii-canvas')
    return c?.dataset.renderBackend === 'worker' && c.dataset.renderPending === 'false' && (!mode || c.dataset.mode === mode)
  }, mode, { timeout: 60000 })
  await idle()
  for (const [label, mode] of [['光影字符', 'density'], ['原色字符', 'color'], ['中文铺字', 'phrase'], ['轮廓线稿', 'contour'], ['点阵细节', 'braille'], ['印刷网点', 'halftone']]) {
    await page.locator('.six-modes button').filter({ hasText: label }).click(); await idle(mode)
    report.modes.push(await canvas.evaluate(c => ({ mode: c.dataset.mode, columns: c.dataset.columns, backend: c.dataset.renderBackend })))
  }
  await page.locator('.six-modes button').filter({ hasText: '光影字符' }).click(); await idle('density')
  await page.locator('details.calibrated-effects').evaluate(d => { d.open = true })
  await page.getByRole('group', { name: '六模式悬停', exact: true }).getByRole('button', { name: '字符聚散试用', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.hover === 'particles')
  await idle()
  const baseline = await canvas.evaluate(c => c.toDataURL()), box = await canvas.boundingBox()
  for (let i = 0; i < 12; i++) { await page.mouse.move(box.x + box.width * (.15 + .7 * i / 11), box.y + box.height * (.5 + Math.sin(i / 11 * Math.PI * 2) * .14)); await page.waitForTimeout(50) }
  await page.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.interactionActive === 'true', {}, { timeout: 60000 })
  assert.notEqual(await canvas.evaluate(c => c.toDataURL()), baseline)
  const release = Date.now(); await page.mouse.move(0, 0)
  await page.waitForFunction(baseline => {
    const c = document.querySelector('.ascii-scroll .ascii-canvas')
    return c?.dataset.renderPending === 'false' && c.dataset.interactionActive === 'false' && c.dataset.pointerStrength === '0' && c.toDataURL() === baseline
  }, baseline, { timeout: 60000 })
  report.particles = { visible: true, exactRecovery: true, releaseToRecoveryMs: Date.now() - release }
  await page.getByRole('button', { name: '全屏 ↗', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.fs-overlay .ascii-canvas')?.dataset.renderBackend === 'worker' && document.querySelector('.fs-overlay .ascii-canvas')?.dataset.renderPending === 'false')
  assert.equal(await page.evaluate(() => window.__frameWorkers.live), 2)
  await page.keyboard.press('Escape'); await idle()
  assert.equal(await page.evaluate(() => window.__frameWorkers.live), 1)
  report.workers = await page.evaluate(() => window.__frameWorkers)
  const oldTheme = await page.locator('html').getAttribute('data-theme')
  await page.getByRole('button', { name: /切换到/ }).click()
  assert.notEqual(await page.locator('html').getAttribute('data-theme'), oldTheme)
  await page.getByRole('button', { name: '放大', exact: true }).first().click(); await idle()
  report.zoomAndTheme = true
  await page.screenshot({ path: path.join(out, 'production-image.png') })
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5184') + '/art')
  await page.waitForFunction(() => window.__frameWorkers.live === 0)
  report.unmountReleased = true
  assert.deepEqual(report.errors, []); report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ out, ...report }))
