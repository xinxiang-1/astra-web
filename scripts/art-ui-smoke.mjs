import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5173'
const out = path.resolve('test-results/art-ui')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
  reducedMotion: 'reduce',
})
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.setDefaultTimeout(20000)
async function screenshot(name) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})))
  })
  await page.screenshot({ path: path.join(out, name), fullPage: true })
}
async function checkOverflow() {
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'horizontal overflow',
  )
}
try {
  await page.goto(base)
  await page.locator('.hero-art .character-art.ready').waitFor()
  await checkOverflow()
  await screenshot('01-home-desktop.png')
  await page.goto(`${base}/gallery`)
  await page.locator('.character-art.ready').first().waitFor()
  await page.getByRole('button', { name: '中文铺字', exact: true }).click()
  assert.equal(await page.locator('.gallery-grid .art-card').count(), 2)
  await page.getByLabel('搜索作品').fill('无此作品')
  await page.getByRole('heading', { name: '还没找到想要的作品？' }).waitFor()
  await page.getByRole('button', { name: '重置筛选' }).click()
  await screenshot('02-gallery.png')
  await page.locator('.gallery-grid .art-card').first().click()
  await page.locator('.ascii-canvas').first().waitFor()
  await page.waitForFunction(() => document.querySelector('.ascii-canvas')?.width > 100)
  await page.getByLabel('作品名称').fill('光影测试作品')
  await page.locator('.editor-save').click()
  await page.getByRole('status').filter({ hasText: '已保存到此浏览器' }).waitFor()
  await screenshot('03-editor.png')
  await page.locator('.editor-header-actions .art-button').click()
  await page.getByRole('heading', { name: '导出作品', exact: true }).waitFor()
  await screenshot('04-export.png')
  await page.getByRole('button', { name: '1080 px', exact: true }).click()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '免费下载作品' }).click()
  const download = await downloadEvent
  assert.match(download.suggestedFilename(), /光影测试作品\.png$/)
  await download.saveAs(path.join(out, 'export.png'))
  const png = await readFile(path.join(out, 'export.png'))
  assert.equal(Math.max(png.readUInt32BE(16), png.readUInt32BE(20)), 1080)
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: '我的项目' }).click()
  await page.locator('.project-open').first().waitFor()
  await screenshot('05-projects.png')
  await page.locator('.project-open').first().click()
  await page.getByRole('status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
  assert.equal(await page.getByLabel('作品名称').inputValue(), '光影测试作品')
  await page.reload()
  await page.getByRole('status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
  await page.locator('.editor-presets button').filter({ hasText: '山河万里' }).click()
  await page.waitForFunction(
    () => document.querySelector('.inspector-modes .selected')?.textContent === '中文铺字',
  )
  assert.equal(await page.locator('input[maxlength="64"]').inputValue(), '山河万里')
  await page.locator('input[type="file"]').setInputFiles(path.resolve('public/artwork/pet.jpg'))
  await page.waitForFunction(() => document.querySelector('.ascii-canvas')?.width > 100)
  await checkOverflow()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base)
  await page.locator('.hero-art .character-art.ready').waitFor()
  await checkOverflow()
  await screenshot('06-home-mobile.png')
  await page.getByLabel('切换导航菜单').click()
  await page.locator('.art-header nav').getByRole('link', { name: '作品', exact: true }).click()
  await checkOverflow()
  await page.locator('.gallery-grid .art-card').first().click()
  await page.waitForFunction(() => document.querySelector('.ascii-canvas')?.width > 100)
  await checkOverflow()
  await screenshot('07-editor-mobile.png')
  await page.getByRole('button', { name: '调整效果', exact: true }).click()
  assert(await page.locator('.inspector-panel').isVisible())
  await page.locator('.editor-header-actions .art-button').click()
  await page.getByRole('heading', { name: '导出作品', exact: true }).waitFor()
  await checkOverflow()
  await screenshot('08-export-mobile.png')
  assert.deepEqual(errors, [])
  console.log(
    'PASS: homepage, gallery filters/search, presets, upload, local save/reload, PNG dimensions, mobile navigation/editor/export; no runtime exceptions.',
  )
  console.log(`Screenshots: ${out}`)
} finally {
  await browser.close()
}
