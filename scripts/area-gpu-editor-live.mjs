import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_AREA_EDITOR_OUTPUT || `output/playwright/area-editor-${Date.now()}`)
// Real-media acceptance uses an explicitly supplied local fixture; do not commit user media.
const gifFixture = process.env.ASTRA_GIF_FIXTURE
assert.ok(gifFixture, 'Set ASTRA_GIF_FIXTURE to a local GIF before running editor acceptance')
await mkdir(out, { recursive: false })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge' })
const report = { browser: browser.version(), errors: [], samples: [], passed: false }
let deadline
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.addInitScript(() => {
    const original = CanvasRenderingContext2D.prototype.drawImage
    window.__areaMeasure = { times: [], raf: [], enabled: false }
    CanvasRenderingContext2D.prototype.drawImage = function (...args) {
      if (window.__areaMeasure.enabled && this.canvas.classList?.contains('ascii-canvas')) window.__areaMeasure.times.push(performance.now())
      return original.apply(this, args)
    }
  })
  await page.goto((process.env.ASTRA_AREA_EDITOR_URL || 'http://127.0.0.1:4210') + '/ascii-art')
  deadline = setTimeout(() => { void page.close() }, 180000)
  const canvas = page.locator('.preview-canvas .ascii-canvas, .preview-area .ascii-canvas, .ascii-canvas').first()
  const ready = async target => {
    await target.waitFor()
    await target.and(page.locator('[data-raster-backend="area-gpu"][data-quality="faithful"][data-glow="false"]')).waitFor({ timeout: 60000 })
    assert.equal(await target.getAttribute('data-glow'), 'false')
  }
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('public/artwork/portrait.jpg'))
  await ready(canvas)
  const details = page.locator('details').filter({ hasText: '环境动效' })
  if (!(await details.getAttribute('open'))) await details.locator('summary').click()
  await page.getByRole('group', { name: '六模式微动', exact: true }).getByRole('button', { name: '流动', exact: true }).click()
  const sample = async label => {
    await canvas.scrollIntoViewIfNeeded()
    await page.evaluate(() => {
      const m = window.__areaMeasure; m.times = []; m.raf = []; m.enabled = true
      let last = performance.now()
      const frame = now => { m.raf.push(now - last); last = now; if (m.enabled) requestAnimationFrame(frame) }
      requestAnimationFrame(frame)
    })
    const box = await canvas.boundingBox()
    for (let i = 0; i < 60; i++) {
      await page.mouse.move(box.x + box.width * (.2 + .6 * i / 59), box.y + box.height * (.5 + Math.sin(i / 8) * .15))
      await page.waitForTimeout(16)
    }
    await page.waitForTimeout(1500)
    const result = await page.evaluate(() => {
      const m = window.__areaMeasure; m.enabled = false
      const gaps = m.times.slice(1).map((time, i) => time - m.times[i]).sort((a, b) => a - b)
      const raf = [...m.raf].sort((a, b) => a - b)
      return { presentedFrames: m.times.length, presentP50Ms: gaps[Math.floor(gaps.length * .5)], presentP95Ms: gaps[Math.floor(gaps.length * .95)], rafP95Ms: raf[Math.floor(raf.length * .95)], longFrames: gaps.filter(n => n > 50).length }
    })
    assert(result.presentedFrames > 5, 'Visible artwork must keep advancing')
    report.samples.push({ label, ...result })
  }
  await sample('real image with wave and hover')
  await page.getByRole('button', { name: '全屏 ↗', exact: true }).click()
  const fullscreen = page.locator('.fs-overlay .ascii-canvas')
  await ready(fullscreen)
  assert.equal(await fullscreen.getAttribute('data-raster-backend'), 'area-gpu')
  const theme = page.locator('.fs-overlay').getByRole('button', { name: /切换到/ })
  await theme.click()
  await page.screenshot({ path: path.join(out, 'fullscreen.png') })
  await page.keyboard.press('Escape')
  report.fullscreen = { areaGpu: true, themeToggle: true }
  await page.locator('input[type=file]').first().setInputFiles(path.resolve(gifFixture))
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor({ timeout: 60000 })
  await ready(canvas)
  report.gifDefault = { columns: await canvas.getAttribute('data-columns'), quality: await canvas.getAttribute('data-quality'), backend: await canvas.getAttribute('data-raster-backend') }
  assert.equal(report.gifDefault.columns, '80')
  await sample('real uploaded GIF default low resolution')
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await page.screenshot({ path: path.join(out, 'gif.png') })
  await page.getByRole('combobox', { name: '视频预览方式', exact: true }).selectOption('quality')
  await page.getByRole('combobox', { name: '视频帧率', exact: true }).selectOption('60')
  await page.getByRole('button', { name: /^高清/ }).click()
  await page.locator('.clip-panel').getByRole('button', { name: '自定义', exact: true }).click()
  const span = page.locator('.clip-custom-field input').first()
  await span.fill('0.5'); await span.dispatchEvent('change')
  await page.getByRole('button', { name: /解析并播放/ }).click()
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor({ timeout: 60000 })
  await page.waitForFunction(() => document.querySelector('.ascii-canvas')?.dataset.columns === '180')
  await ready(canvas)
  await sample('real GIF predecoded 180 columns, selected 60fps, wave and hover')
  report.predecodedHigh = { columns: await canvas.getAttribute('data-columns'), quality: await canvas.getAttribute('data-quality'), selectedFps: '60' }
  await page.goto((process.env.ASTRA_AREA_EDITOR_URL || 'http://127.0.0.1:4210') + '/art-lab')
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { clearTimeout(deadline); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ out, ...report }))
