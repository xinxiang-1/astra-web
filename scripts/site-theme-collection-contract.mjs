import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5184'
const out = path.resolve(
  process.env.ASTRA_SITE_THEME_OUTPUT || `test-results/site-theme-collection-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = { browser: browser.version(), base, cases: [], errors: [], passed: false }
const manifest = JSON.parse(
  await readFile('public/artwork/collection-20261005/manifest.json', 'utf8'),
)
const hash = (value) => createHash('sha256').update(value).digest('hex')
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  async function theme(mode) {
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== mode) {
      await page
        .getByRole('button', { name: mode === 'dark' ? '切换到暗色' : '切换到亮色', exact: true })
        .click()
    }
    await page.waitForFunction((mode) => document.documentElement.dataset.theme === mode, mode)
    assert.equal(await page.evaluate(() => localStorage.getItem('astra-theme')), mode)
  }
  const pageColors = async (selectors) =>
    page.evaluate(
      (selectors) =>
        selectors.map((selector) => {
          const el = document.querySelector(selector),
            s = getComputedStyle(el)
          return { selector, color: s.color, background: s.backgroundColor, border: s.borderColor }
        }),
      selectors,
    )
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    await page.goto(base + '/')
    await page.locator('.hero-art .character-art.ready').waitFor({ timeout: 60000 })
    let originalPixels
    const themes = {}
    for (const mode of ['light', 'dark']) {
      await theme(mode)
      const data = await page.locator('.hero-art canvas').evaluate((c) => c.toDataURL())
      if (originalPixels)
        assert.equal(
          hash(data),
          originalPixels,
          'Theme must not recolor or alter the protected hero artwork',
        )
      originalPixels = hash(data)
      themes[mode] = await pageColors([
        '.art-header',
        '.hero-gallery',
        '.engine-story',
        '.closing-strip',
        '.art-footer',
      ])
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      await page.screenshot({ path: path.join(out, `home-${mode}-${width}.png`) })
      const featured = await page.locator('.featured-grid .art-card h3').allTextContents()
      assert.deepEqual(featured, ['云海之巅', '悬日之城', '星际潮汐'])
      report.cases.push({
        kind: 'home-theme',
        width,
        mode,
        colors: themes[mode],
        heroPixels: originalPixels,
        featured,
      })
    }
    for (let i = 0; i < themes.light.length; i++)
      assert.notEqual(
        themes.light[i].background,
        themes.dark[i].background,
        themes.light[i].selector + ' must actually switch its background',
      )
    if (width === 390) {
      await page.getByRole('button', { name: '切换导航菜单' }).click()
      assert(await page.getByRole('navigation', { name: '主导航' }).isVisible())
      await page.keyboard.press('Escape')
      assert.equal(
        await page.getByRole('button', { name: '切换导航菜单' }).getAttribute('aria-expanded'),
        'false',
      )
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  const artworkRequests = []
  page.on('request', (request) => {
    if (request.url().includes('/artwork/collection-20261005/')) artworkRequests.push(request.url())
  })
  await page.goto(base + '/gallery')
  const cards = page.locator('.gallery-grid .art-card')
  assert.equal(await cards.count(), 6)
  const names = await cards.locator('h3').allTextContents()
  assert.deepEqual(names, ['云海之巅', '悬日之城', '星际潮汐', '黑金沙海', '苍穹之翼', '万里归舟'])
  for (let i = 0; i < 6; i++) {
    await cards.nth(i).scrollIntoViewIfNeeded()
    await cards
      .nth(i)
      .locator('img')
      .evaluate((img) => img.decode())
  }
  assert.equal(
    await page.locator('.gallery-grid canvas').count(),
    0,
    'Static cards should not recompute glyphs while browsing',
  )
  assert(
    !artworkRequests.some((url) => !url.includes('-characters.webp')),
    'Gallery must not fetch six full-resolution source images',
  )
  for (const mode of ['light', 'dark']) {
    await theme(mode)
    await page.locator('.gallery-heading').scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(out, `gallery-${mode}-1440.png`), fullPage: true })
    report.cases.push({ kind: 'gallery-theme', mode, names, requests: artworkRequests })
  }
  await page.getByRole('button', { name: '建筑', exact: true }).click()
  assert.equal(await cards.count(), 1)
  assert.equal(await cards.locator('h3').textContent(), '悬日之城')
  await page.getByRole('button', { name: '全部', exact: true }).click()
  await page.getByLabel('搜索作品').fill('星际')
  assert.equal(await cards.count(), 1)
  await page.getByLabel('搜索作品').fill('不存在的关键词')
  await page.getByRole('button', { name: '重置筛选' }).click()
  assert.equal(await cards.count(), 6)
  await page.setViewportSize({ width: 390, height: 844 })
  await cards.nth(0).scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: path.join(out, 'gallery-mobile.png') })
  report.cases.push({ kind: 'gallery-filter-search-mobile', cards: 6, width: 390 })

  await page.goto(base + '/signature-portrait')
  const select = page.getByLabel('签名走向', { exact: true })
  await select.waitFor()
  const picker = await page.evaluate(() => CSS.supports('appearance', 'base-select'))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    for (const mode of ['light', 'dark']) {
      await theme(mode)
      await select.scrollIntoViewIfNeeded()
      await select.selectOption('classic')
      await select.click()
      if (picker) assert.equal(await select.evaluate((el) => el.matches(':open')), true)
      const options = await select.locator('option').evaluateAll((options) =>
        options.map((option) => {
          const s = getComputedStyle(option),
            rect = option.getBoundingClientRect()
          return {
            value: option.value,
            text: option.textContent,
            color: s.color,
            background: s.backgroundColor,
            width: rect.width,
            height: rect.height,
          }
        }),
      )
      assert(
        options.every((o) => o.color !== 'rgba(0, 0, 0, 0)' && o.background !== 'rgba(0, 0, 0, 0)'),
      )
      if (picker) assert(options.every((o) => o.height >= 42 && o.width > 100))
      await page.screenshot({ path: path.join(out, `select-open-${mode}-${width}.png`) })
      if (picker) await select.locator('option[value=flow]').click()
      else {
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')
      }
      assert.equal(await select.inputValue(), 'flow', 'Popup choice must update the real model')
      await select.focus()
      await page.keyboard.press('Space')
      await page.keyboard.press('Home')
      await page.keyboard.press('Enter')
      assert.equal(await select.inputValue(), 'classic', 'Keyboard selection must stay usable')
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      )
      report.cases.push({ kind: 'open-select', width, mode, picker, options })
    }
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  for (const [id, title] of [
    ['mountain', '云海之巅'],
    ['architecture', '悬日之城'],
    ['cosmos', '星际潮汐'],
    ['portrait', '云海之巅'],
  ]) {
    await page.goto(base + '/ascii-art?preset=' + id)
    await page.waitForFunction(
      () =>
        document.querySelector('.ascii-canvas')?.dataset.engine === 'calibrated' &&
        document.querySelector('.ascii-canvas')?.width > 100 &&
        !document.querySelector('.render-feedback'),
      undefined,
      { timeout: 120000 },
    )
    assert(
      await page.locator('.editor-presets button.selected').filter({ hasText: title }).count(),
      'New and old preset URLs must resolve the new artwork',
    )
    const result = await page
      .locator('.ascii-canvas')
      .evaluate((canvas) => ({
        width: canvas.width,
        height: canvas.height,
        mode: canvas.dataset.mode,
        engine: canvas.dataset.engine,
      }))
    report.cases.push({ kind: 'real-editor-preset', id, title, result })
  }
  for (const source of manifest.sources) {
    const original = await readFile(`design/artwork-collection-20261005/${source.name}.png`)
    const webp = await readFile(`public/artwork/collection-20261005/${source.name}.webp`)
    assert.equal(hash(original), source.sourceSha256)
    assert.equal(hash(webp), source.webpSha256)
    const preview = manifest.characterPreviews.cases.find((c) => c.id === source.name)
    assert.equal(hash(await readFile(`public${preview.preview}`)), preview.webpSha256)
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(
  JSON.stringify({
    out,
    passed: report.passed,
    cases: report.cases.length,
    failure: report.failure,
    errors: report.errors,
  }),
)
