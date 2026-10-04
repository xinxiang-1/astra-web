import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { openSignatureSection } from './signature-ui-helpers.mjs'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_THEME_UI_OUTPUT || `test-results/signature-theme-ui-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = { browser: browser.version(), cases: [], errors: [] }
const colors = (el) => {
  const s = getComputedStyle(el),
    r = el.getBoundingClientRect()
  return {
    color: s.color,
    background: s.backgroundColor,
    border: s.borderColor,
    width: r.width,
    height: r.height,
  }
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'no-preference',
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/signature-portrait')
  await page.locator('.source-panel').waitFor()
  const common = page.getByRole('region', { name: '常用创作操作' })
  // Section with an accessible label is exposed as a region.
  assert(await common.getByRole('button', { name: '生成预览', exact: true }).isVisible())
  assert(await common.getByRole('button', { name: '下载 PNG', exact: true }).isVisible())
  await page.getByLabel('名字', { exact: true }).fill('李云舟')
  await page.getByLabel('目标遍数', { exact: true }).fill('10')
  assert(await page.getByRole('button', { name: '一键生成 10 种写法', exact: true }).isVisible())
  await page.getByRole('button', { name: '一键生成 10 种写法', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.bank-grid li').length === 10)
  assert(!(await page.getByRole('button', { name: '清空本库', exact: true }).isVisible()))
  assert(!(await page.getByRole('button', { name: '下载矢量 JSON', exact: true }).isVisible()))
  await openSignatureSection(page, '亲手签名')
  const pad = page.locator('.pad')
  await pad.scrollIntoViewIfNeeded()
  const box = await pad.boundingBox()
  await page.mouse.move(box.x + 30, box.y + 40)
  await page.mouse.down()
  await page.mouse.move(box.x + 100, box.y + 90, { steps: 12 })
  await page.mouse.up()
  assert(await page.getByRole('button', { name: '存入名字库', exact: true }).isEnabled())
  await page
    .locator('details')
    .filter({ has: page.locator('summary strong').filter({ hasText: '亲手签名' }) })
    .locator('summary')
    .click()
  await openSignatureSection(page, '亲手签名')
  assert(
    await page.getByRole('button', { name: '存入名字库', exact: true }).isEnabled(),
    'Fold/unfold retains writing',
  )
  await page.getByRole('button', { name: '存入名字库', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.bank-grid li').length === 11)
  await page
    .locator('details')
    .filter({ has: page.locator('summary strong').filter({ hasText: '亲手签名' }) })
    .locator('summary')
    .click()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    for (const theme of ['light', 'dark']) {
      if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== theme)
        await page
          .getByRole('button', {
            name: theme === 'dark' ? '切换到暗色' : '切换到亮色',
            exact: true,
          })
          .click()
      await page.waitForTimeout(200)
      const controls = await page
        .locator('.name-fields .astra-control, .settings-panel select')
        .evaluateAll((els) =>
          els.map((el) => {
            const s = getComputedStyle(el),
              r = el.getBoundingClientRect()
            return {
              color: s.color,
              background: s.backgroundColor,
              height: r.height,
              radius: s.borderRadius,
              border: s.borderColor,
              scheme: s.colorScheme,
            }
          }),
        )
      for (const c of controls) {
        assert(c.height >= 44)
        assert.notEqual(c.radius, '0px')
        assert.equal(c.scheme, theme)
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
      assert.equal(await page.evaluate(() => localStorage.getItem('astra-theme')), theme)
      const pathName = `signature-${theme}-${width}.png`
      await page.screenshot({ path: path.join(out, pathName), fullPage: true })
      report.cases.push({ kind: 'controls', theme, width, controls, screenshot: pathName })
    }
  }
  // Shared captcha is exercised through the real failed login, with a deterministic API fixture.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="148" height="42"><rect width="148" height="42" fill="#f6efe3"/><text x="22" y="30" font-size="25" fill="#20312a">A7K2</text></svg>`
  let captchaRequests = 0
  await page.route('**/api/auth/**', async (route) => {
    const isCaptcha = route.request().url().endsWith('/captcha')
    if (isCaptcha) captchaRequests++
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(
        isCaptcha
          ? {
              code: 0,
              data: {
                captchaId: 'fixture-id',
                image: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'),
                expireSeconds: 120,
              },
            }
          : { code: 401, msg: '请完成图形验证码', data: null },
      ),
    })
  })
  await page.goto(base + '/login')
  await page.locator('input[name=email]').fill('ui-fixture@example.com')
  await page.locator('input[name=password]').fill('Fixture-password-24')
  await page.locator('button[type=submit]').click()
  await page.getByLabel('图形验证码', { exact: true }).waitFor()
  for (const theme of ['light', 'dark']) {
    if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== theme)
      await page
        .getByRole('button', { name: theme === 'dark' ? '切换到暗色' : '切换到亮色', exact: true })
        .click()
    await page.waitForTimeout(200)
    const style = await page.getByLabel('图形验证码', { exact: true }).evaluate(colors)
    assert(style.height >= 44)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
    await page.screenshot({ path: path.join(out, `captcha-${theme}.png`), fullPage: true })
    report.cases.push({ kind: 'captcha', theme, style })
  }
  await page.getByLabel('图形验证码', { exact: true }).fill('A7K2')
  await page.getByRole('button', { name: '刷新图形验证码', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('input[name=captcha]')?.value === '')
  assert.equal(captchaRequests, 2)
  // Verify the theme switch exists even on marketing pages and the separate editor header.
  for (const route of [
    '/',
    '/gallery',
    '/templates',
    '/help',
    '/projects',
    '/ascii-art',
    '/art-lab',
  ]) {
    await page.goto(base + route)
    const toggle = page.locator('.theme-toggle')
    assert.equal(await toggle.count(), 1, route)
    assert(await toggle.isVisible(), route)
    const before = await page.locator('#main-content > *').evaluate(colors)
    await toggle.click()
    const after = await page.locator('#main-content > *').evaluate(colors)
    assert.notEqual(before.background, after.background, route + ' actual page color must change')
    report.cases.push({ kind: 'theme-route', route, before, after })
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (e) {
  report.passed = false
  report.failure = e.stack
  throw e
} finally {
  report.fxButtonSha256 = createHash('sha256')
    .update(await readFile('src/components/ui/FxButton.vue'))
    .digest('hex')
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({
      out,
      passed: report.passed,
      cases: report.cases.length,
      failure: report.failure,
    }),
  )
  await browser.close()
}
