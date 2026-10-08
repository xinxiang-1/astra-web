import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_ACCOUNT_PREVIEW_URL
const backend = process.env.ASTRA_ACCOUNT_API_URL
const ownerToken = process.env.ASTRA_ACCOUNT_OWNER_TOKEN
const otherToken = process.env.ASTRA_ACCOUNT_OTHER_TOKEN
const out = process.env.ASTRA_ACCOUNT_OUTPUT
assert.ok(
  base && backend && ownerToken && otherToken && out,
  'Use the owned Java integration fixture; never a production token',
)
assert.equal(new URL(backend).hostname, '127.0.0.1')
assert.equal(new URL(base).hostname, '127.0.0.1')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  scope:
    'Live isolated MySQL/Redis/system/gateway; simulated payment settlements; auth/me unavailable',
  browser: browser.version(),
  checks: [],
  requests: [],
}
const check = (name) => report.checks.push(name)
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  await context.addInitScript(
    (token) => localStorage.setItem('astra_access_token', token),
    ownerToken,
  )
  const page = await context.newPage()
  await page.route((url) => url.origin !== new URL(base).origin, (route) => route.abort())
  let failLibrary = false
  let singlePage = false
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"code":503,"msg":"集成夹具无auth服务"}',
    }),
  )
  await page.route('**/api/system/**', async (route) => {
    const url = new URL(route.request().url())
    assert.equal(route.request().method(), 'GET', 'This stage never writes orders or funds')
    if (failLibrary && url.pathname.endsWith('/entitlements')) {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"code":503,"msg":"暂不可用"}',
      })
      return
    }
    if (singlePage && url.pathname.endsWith('/entitlements')) url.searchParams.set('limit', '1')
    const response = await route.fetch({ url: `${backend}${url.pathname}${url.search}` })
    report.requests.push({ path: url.pathname, query: url.search, status: response.status() })
    await route.fulfill({ response })
  })
  await page.goto(`${base}/account/orders`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-order]')
  assert.equal(await page.locator('[data-order]').count(), 3)
  assert.equal(await page.getByText('付款：已付款 · 内容：已发放', { exact: true }).count(), 3)
  check('Owner sees three real paid orders; payment and fulfillment shown separately')
  await page.getByRole('link', { name: '已购内容', exact: true }).click()
  await page.waitForSelector('[data-entitlement]')
  assert.equal(await page.locator('[data-entitlement]').count(), 3)
  const ids = await page
    .locator('[data-entitlement]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-entitlement')))
  assert.ok(ids.every((id) => /^\d+$/.test(id) && BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER)))
  assert.equal(new Set(ids).size, 3)
  await page.locator('summary').first().click()
  await page.locator('.policy-copy').first().waitFor({ state: 'visible' })
  check('Owned release, file metadata and frozen license rendered; bigint IDs retained exactly')
  await page.screenshot({ path: path.join(out, 'library-desktop.png'), fullPage: true })
  singlePage = true
  await page.getByRole('button', { name: '刷新记录' }).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-entitlement]').length === 1)
  for (const size of [2, 3]) {
    await page.getByRole('button', { name: '读取更多' }).click()
    await page.waitForFunction((expected) => document.querySelectorAll('[data-entitlement]').length === expected, size)
  }
  assert.equal(await page.getByRole('button', { name: '读取更多' }).count(), 0)
  const pagedIds = await page.locator('[data-entitlement]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-entitlement')))
  assert.deepEqual(pagedIds, ids)
  check('Three actual limit=1 backend pages append through returned opaque cursors without loss or duplication')
  singlePage = false
  failLibrary = true
  await page.getByRole('button', { name: '刷新记录' }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('astra_access_token')), ownerToken)
  failLibrary = false
  await page.getByRole('button', { name: '重新读取' }).click()
  await page.waitForSelector('[data-entitlement]')
  check('503 preserves credential and recovers by user retry without any purchase write')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(out, 'library-mobile.png'), fullPage: true })
  check('390px simulated viewport has no horizontal overflow')
  await page.evaluate((token) => localStorage.setItem('astra_access_token', token), otherToken)
  await page.getByRole('button', { name: '刷新记录' }).click()
  await page.getByText('还没有已购内容。', { exact: false }).waitFor()
  assert.equal(await page.locator('[data-entitlement]').count(), 0)
  await page.getByRole('link', { name: '我的订单', exact: true }).click()
  await page.getByText('还没有订单。', { exact: false }).waitFor()
  check('Second real backend user cannot see owner orders or content')
  await page.evaluate(() => localStorage.setItem('astra_access_token', 'invalid'))
  await page.getByRole('button', { name: '刷新记录' }).click()
  await page.getByRole('link', { name: '前往登录' }).waitFor()
  assert.equal(await page.locator('[data-order]').count(), 0)
  await page.getByRole('link', { name: '前往登录' }).click()
  await page.waitForURL((url) => url.pathname === '/login' && url.searchParams.get('returnTo') === '/account/orders', { waitUntil: 'domcontentloaded' })
  check('Invalid JWT shows login and removes private rows; internal return path retained')
  await page.evaluate(() => localStorage.removeItem('astra_access_token'))
  const before = report.requests.length
  // Navigation stays in the same document so addInitScript cannot re-seed a token.
  await page.evaluate(() => {
    history.pushState({}, '', '/account/library')
    dispatchEvent(new PopStateEvent('popstate'))
  })
  await page.getByRole('link', { name: '前往登录' }).waitFor()
  assert.equal(report.requests.length, before)
  check('Anonymous account view requires login and makes no protected request')
  assert.ok(report.requests.some((r) => r.status === 401))
  report.passed = true
  console.log(
    `Account live UI: ${report.checks.length} checks, ${report.requests.length} actual gateway requests passed.`,
  )
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
