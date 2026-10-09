import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { openSignatureSection } from './signature-ui-helpers.mjs'
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:4210'
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const mobile = process.env.ASTRA_CREATIVE_MOBILE === '1'
const out = `test-results/creative-ui-${channel}${mobile ? '-mobile' : ''}`
const fixture = `${process.env.ASTRA_CREATIVE_CORE_OUTPUT || 'test-results/creative-workflow'}/source.astra-signature`
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel, headless: true })
const report = { browser: browser.version(), base, cases: [], errors: [], timings: {} }
try {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  const ready = async () => {
    await page.getByRole('button', { name: '生成预览', exact: true }).waitFor()
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent.trim() === '生成预览' && !b.disabled,
        ),
      null,
      { timeout: 90000 },
    )
    assert.equal(await page.locator('.error').count(), 0)
  }
  const download = async (label, name) => {
    if (label === '下载矢量 JSON') await openSignatureSection(page, '矢量导出')
    const waiting = page.waitForEvent('download', { timeout: 90000 })
    await page.getByRole('button', { name: label, exact: true }).click()
    const d = await waiting
    await d.saveAs(out + '/' + name)
    await ready()
    return readFile(out + '/' + name)
  }
  const update = async (action) => {
    const start = Date.now()
    await action()
    await page.waitForTimeout(400)
    await ready()
    return Date.now() - start
  }
  await page.locator('input[type=file][accept*="astra-signature"]').setInputFiles(fixture)
  await ready()
  const baseline = JSON.parse(await download('下载矢量 JSON', 'baseline.json'))
  assert.equal(baseline.renderOptions.toneGain, 0.4)
  report.timings.customMs = await update(async () => {
    await page.getByLabel('笔迹颜色', { exact: true }).selectOption('custom')
    await page.getByLabel('自定义墨色', { exact: true }).evaluate((el) => {
      el.value = '#1070a8'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  })
  const custom = JSON.parse(await download('下载矢量 JSON', 'custom.json'))
  assert.equal(custom.renderOptions.inkColorMode, 'custom')
  assert.deepEqual(custom.renderOptions.ink, { r: 16, g: 112, b: 168 })
  assert(custom.placements.every((p) => p.tint.r === 16 && p.tint.g === 112 && p.tint.b === 168))
  report.cases.push('automatic-custom-colour')
  const saved = await download('保存作品文件', 'custom.astra-signature')
  assert(saved.byteLength > 100)
  await page
    .locator('input[type=file][accept*="astra-signature"]')
    .setInputFiles(out + '/custom.astra-signature')
  await ready()
  assert.equal(await page.getByLabel('笔迹颜色', { exact: true }).inputValue(), 'custom')
  assert.equal(await page.getByLabel('自定义墨色', { exact: true }).inputValue(), '#1070a8')
  report.cases.push('saved-custom-controls-restore')
  report.timings.rapidMs = await update(async () => {
    const slider = page.getByLabel('笔迹浓度', { exact: true })
    for (const value of ['2.2', '0.7', '0.3'])
      await slider.evaluate((el, value) => {
        el.value = value
        el.dispatchEvent(new Event('input', { bubbles: true }))
      }, value)
  })
  const light = JSON.parse(await download('下载矢量 JSON', 'light.json'))
  assert.equal(light.renderOptions.toneGain, 0.3)
  assert(light.placements.every((p, i) => p.strength <= custom.placements[i].strength))
  report.cases.push('rapid-input-latest-concentration')
  report.timings.sourceMs = await update(() =>
    page.getByLabel('笔迹颜色', { exact: true }).selectOption('source'),
  )
  const source = JSON.parse(await download('下载矢量 JSON', 'source.json'))
  assert.equal(source.renderOptions.colorMode, 'source')
  assert(!source.renderOptions.ink)
  assert(
    source.placements.some((p) => p.tint.r > p.tint.b) &&
      source.placements.some((p) => p.tint.b > p.tint.r),
  )
  report.cases.push('automatic-regional-source-colour')
  await page.screenshot({ path: out + '/signature.png', fullPage: true })
  await openSignatureSection(page, '继续创作')
  const start = Date.now()
  const create = page.getByRole('button', { name: '创建动态字符项目', exact: true })
  if (mobile) await create.tap()
  else await create.click()
  const link = page.getByRole('link', { name: '打开动态字符项目', exact: true })
  await link.waitFor({ timeout: 90000 })
  report.timings.workflowMs = Date.now() - start
  const href = await link.getAttribute('href')
  const popupPromise = page.waitForEvent('popup')
  if (mobile) await link.tap()
  else await link.click()
  const ascii = await popupPromise
  ascii.on('pageerror', (e) => report.errors.push(e.message))
  await ascii.waitForURL(/ascii-art\?project=/)
  await ascii.waitForFunction(
    () => document.querySelector('.ascii-canvas')?.dataset.quality === 'faithful',
    null,
    { timeout: 90000 },
  )
  assert.equal(await ascii.getByRole('button', { name: '光晕', exact: true }).count(), 0)
  if (mobile) await ascii.getByRole('button', { name: '调整效果', exact: true }).tap()
  const details = ascii.locator('details.calibrated-effects')
  await details.locator('summary').click()
  assert.equal(await ascii.locator('#art-recipe').inputValue(), 'fluid-reveal')
  await ascii.locator('#art-recipe').selectOption('hologram')
  assert.equal(await ascii.locator('#art-recipe').inputValue(), 'hologram')
  if (mobile) {
    for (const target of [page, ascii]) {
      assert(
        await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'mobile page overflows',
      )
    }
    for (const control of [
      page.getByLabel('笔迹颜色', { exact: true }),
      ascii.locator('#art-recipe'),
    ]) {
      const box = await control.boundingBox()
      assert(box && box.x >= 0 && box.x + box.width <= 391, 'mobile control overflows')
    }
    report.cases.push('mobile-touch-workflow-and-control-bounds')
  }
  report.cases.push('signature-to-project-and-recipe-edit')
  await ascii.screenshot({ path: out + '/characters.png', fullPage: true })
  // A new supported image uses faithful; reset follows the same default.
  const advanced = ascii.locator('details.advanced-card')
  await advanced.locator('summary').first().click()
  await ascii.getByRole('button', { name: '恢复默认', exact: true }).click()
  await ascii.waitForFunction(
    () =>
      document.querySelector('.ascii-canvas')?.dataset.quality === 'faithful' &&
      document.querySelector('.ascii-canvas')?.dataset.mode === 'density',
    null,
    { timeout: 90000 },
  )
  report.cases.push('faithful-reset')
  const fresh = await context.newPage()
  await fresh.goto(base + '/ascii-art', { waitUntil: 'domcontentloaded' })
  assert.equal(
    await fresh
      .locator('button[data-quality="faithful"]')
      .getAttribute('class')
      .then((s) => s.includes('on')),
    true,
  )
  report.cases.push('faithful-new-project')
  report.project = href
  assert.deepEqual(report.errors, [])
  console.log(JSON.stringify(report))
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
