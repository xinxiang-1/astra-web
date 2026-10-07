import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_WASH_OUTPUT || `test-results/signature-wash-lab-${Date.now()}`)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const report = { browser: browser.version(), privateSource: Boolean(process.env.ASTRA_WASH_SOURCE), cases: [], errors: [] }
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true,
  ...(process.env.ASTRA_WASH_RECORD ? { recordVideo: { dir: out, size: { width: 1440, height: 1080 } } } : {}) })
try {
  const page = await context.newPage()
  const videoStart = Date.now()
  page.on('pageerror', e => report.errors.push(e.message))
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/docs/prototypes/v14-signature-wash/index.html')
  const state = () => page.evaluate(() => window.__astraSignatureWashLab.state)
  const idle = async (before) => {
    await page.waitForFunction(before => window.__astraSignatureWashLab.state.count > before && !window.__astraSignatureWashLab.state.busy, before, { timeout: 180000 })
  }
  await idle(0)
  if (process.env.ASTRA_WASH_SOURCE) {
    await page.selectOption('#source', 'upload')
    await page.setInputFiles('#upload', process.env.ASTRA_WASH_SOURCE)
  }
  const generate = async () => { const n = (await state()).count; await page.click('#generate'); await idle(n) }
  await page.selectOption('#size', process.env.ASTRA_WASH_SIZE || '1024')
  await generate()
  const hashes = async () => {
    const values = {}
    for (const id of ['source', 'duotone-v1', 'pop-v1']) {
      const data = await page.locator(`[data-profile="${id}"] .host canvas`).evaluate(c => c.toDataURL())
      values[id] = createHash('sha256').update(Buffer.from(data.split(',')[1], 'base64')).digest('hex')
    }
    return values
  }
  const original = await hashes()
  assert.equal(new Set(Object.values(original)).size, 3)
  const board = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1260; canvas.height = 900
    const c = canvas.getContext('2d'); c.fillStyle = '#f5f3ef'; c.fillRect(0, 0, 1260, 900)
    c.fillStyle = '#21372f'; c.font = '600 26px "Microsoft YaHei"'; c.fillText('完整签名＋三种彩绘底色 · 同一份排布', 24, 44)
    const ids = ['source', 'duotone-v1', 'pop-v1'], names = ['原色融合', '双色绘影', '波普彩绘']
    ids.forEach((id, at) => {
      const src = document.querySelector(`[data-profile="${id}"] .host canvas`), x = 24 + at * 414, fit = Math.min(390 / src.width, 520 / src.height)
      c.drawImage(src, x + (390 - src.width * fit) / 2, 90 + (520 - src.height * fit) / 2, src.width * fit, src.height * fit)
      c.fillStyle = '#21372f'; c.font = '600 20px "Microsoft YaHei"'; c.fillText(names[at], x, 650)
      c.drawImage(src, Math.max(0, Math.round(src.width * .5 - 160)), Math.max(0, Math.round(src.height * .4 - 95)), 320, 190, x + 35, 676, 320, 190)
    })
    return canvas.toDataURL()
  })
  await writeFile(path.join(out, 'comparison.png'), Buffer.from(board.split(',')[1], 'base64'))
  await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true })
  report.cases.push({ kind: 'visual', state: await state(), hashes: original })
  report.operationsVideoStart = (Date.now() - videoStart) / 1000
  if (process.env.ASTRA_WASH_RECORD) {
    // Recorded operation evidence needs visible dwell, unlike the fast assertions below.
    await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(700)
    await page.click('[data-view="duotone-v1"]'); await page.waitForTimeout(600)
    await page.click('[data-zoom="2"]'); await page.waitForTimeout(900)
    await page.click('[data-zoom="0.5"]'); await page.waitForTimeout(600)
    await page.keyboard.press('Escape')
    await page.click('#theme'); await page.waitForTimeout(700)
    await page.click('#generate'); await page.waitForTimeout(700)
    await page.click('#cancel'); await page.waitForTimeout(900)
    assert.deepEqual(await hashes(), original)
    report.operationsVideoEnd = (Date.now() - videoStart) / 1000
  }
  if (!process.env.ASTRA_WASH_VISUAL_ONLY) {
    const before = (await state()).count
    await page.selectOption('#palette', 'forest-rose'); await page.fill('#name', '李云舟')
    await page.waitForTimeout(200)
    assert.equal((await state()).count, before)
    assert.deepEqual(await hashes(), original)
    await page.click('[data-view="pop-v1"]')
    for (const z of [.5, 1, 2]) {
      await page.click(`[data-zoom="${z}"]`)
      assert(await page.locator('.viewer canvas').evaluate((c, z) => Math.abs(parseFloat(c.style.width) - c.width * z) <= .5, z))
    }
    await page.keyboard.press('Escape')
    assert.equal((await state()).count, before)
    const dl = page.waitForEvent('download'); await page.click('[data-save="pop-v1"]')
    await (await dl).saveAs(path.join(out, 'download.png'))
    assert.equal(createHash('sha256').update(await readFile(path.join(out, 'download.png'))).digest('hex'), original['pop-v1'])
    report.cases.push({ kind: 'unapplied-zoom-png' })
    await page.click('#generate'); await page.click('#cancel'); await page.waitForTimeout(200)
    assert.deepEqual(await hashes(), original)
    assert.equal((await state()).busy, false)
    await page.click('#generate')
    await page.waitForFunction(() => window.__astraSignatureWashLab.state.candidateCount > 0 && window.__astraSignatureWashLab.state.busy, undefined, { timeout: 60000, polling: 10 })
    await page.click('#cancel'); await page.waitForTimeout(200)
    assert.equal((await state()).count, before)
    assert.deepEqual(await hashes(), original)
    report.cases.push({ kind: 'cancel-immediate-and-partial' })
    await page.selectOption('#source', 'upload')
    await page.setInputFiles('#upload', { name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('invalid') })
    await page.click('#generate')
    await page.waitForFunction(() => !window.__astraSignatureWashLab.state.busy)
    assert.deepEqual(await hashes(), original)
    report.cases.push({ kind: 'bad-input-preserves-results' })
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 1080 })
      await page.evaluate(t => document.documentElement.dataset.theme = t, theme)
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: path.join(out, `${theme}-${width}.png`), fullPage: true })
    }
    report.cases.push({ kind: 'two-themes-two-widths' })
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await context.close(); await browser.close(); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ out, ...report })) }
