import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_ORDER_RECOVERY_PREVIEW_URL,
  backend = process.env.ASTRA_ORDER_RECOVERY_API_URL
const owner = process.env.ASTRA_ORDER_RECOVERY_OWNER_TOKEN,
  other = process.env.ASTRA_ORDER_RECOVERY_OTHER_TOKEN
const pending = process.env.ASTRA_ORDER_RECOVERY_PENDING_ORDER,
  paid = process.env.ASTRA_ORDER_RECOVERY_PAID_ORDER,
  closed = process.env.ASTRA_ORDER_RECOVERY_CLOSED_ORDER
const out = process.env.ASTRA_ORDER_RECOVERY_OUTPUT
assert.ok(
  base && backend && owner && other && pending && paid && closed && out,
  'Owned Java fixture required',
)
assert.equal(new URL(base).hostname, '127.0.0.1')
assert.equal(new URL(backend).hostname, '127.0.0.1')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  scope:
    'Owned real MySQL/Redis/system/gateway order/payment ledger; trusted mock channel settlement; auth/me mocked503; accepted response loss, slow response and read503 injected',
  checks: [],
  requests: [],
  injectedFailures: [],
  passed: false,
}
const check = (name) => {
  report.checks.push(name)
  console.log(name)
}
const keys = []
let lost = false,
  slow = false,
  failRead = false,
  postStarted
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  await context.route(
    (url) => url.origin !== new URL(base).origin,
    (route) => route.abort(),
  )
  await context.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"code":503,"msg":"Owned fixture has no auth service"}',
    }),
  )
  const page = await context.newPage()
  await page.route('**/api/system/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      method = request.method()
    assert.ok(
      method === 'GET' ||
        (method === 'POST' && url.pathname === `/api/system/orders/${pending}/payments`),
      'Never create a new order or arbitrary payment',
    )
    if (failRead && method === 'GET' && url.pathname === `/api/system/orders/${pending}`) {
      report.injectedFailures.push({ path: url.pathname, status: 503 })
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"code":503,"msg":"Explicit read failure"}',
      })
      return
    }
    if (method === 'POST') {
      keys.push(request.headers()['idempotency-key'])
      assert.deepEqual(request.postDataJSON(), { channel: 'wechat_native' })
    }
    const response = await route.fetch({ url: `${backend}${url.pathname}${url.search}` })
    const body = await response.json(),
      omitted = Boolean(body.data?.qrCodeUrl)
    if (omitted) {
      assert.equal(body.data.mock, true)
      assert.match(body.data.qrCodeUrl, /^astra-mock:\/\/checkout\/ASP/)
      delete body.data.qrCodeUrl
    }
    report.requests.push({
      method,
      path: url.pathname,
      status: response.status(),
      body,
      checkoutUrlOmittedAfterLiveValidation: omitted,
      headers: {
        cacheControl: response.headers()['cache-control'],
        requestId: response.headers()['x-request-id'],
      },
    })
    if (method === 'POST' && lost) {
      lost = false
      report.injectedFailures.push({ path: url.pathname, kind: 'accepted200-response-lost' })
      await route.abort('failed')
      return
    }
    if (method === 'POST' && slow) {
      postStarted?.()
      await new Promise((resolve) => setTimeout(resolve, 600))
    }
    await route.fulfill({ response })
  })
  await page.goto(`${base}/help`, { waitUntil: 'domcontentloaded' })
  await page.evaluate((token) => localStorage.setItem('astra_access_token', token), owner)
  await page.goto(`${base}/account/orders`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('[data-order]').length === 3)
  await page
    .locator(`[data-order="${pending}"]`)
    .getByRole('link', { name: '查看订单详情 ↗' })
    .click()
  await page.locator('[data-payment-state]').waitFor()
  assert.equal(await page.locator('[data-order-detail]').getAttribute('data-order-detail'), pending)
  assert.equal(await page.locator('[data-order-amount]').innerText(), '¥39.00')
  await page.getByText('这是一笔模拟支付记录，不涉及真实资金。', { exact: true }).waitFor()
  assert.equal(await page.locator('a[href^="astra-mock:"],img[src^="astra-mock:"]').count(), 0)
  check(
    'Order list opens exact bigint detail; real pending record has server price and explicit mock status without checkout links',
  )
  lost = true
  await page.getByRole('button', { name: '恢复付款记录', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(keys.length, 1)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('[data-payment-state]').waitFor()
  await page.getByRole('button', { name: '恢复付款记录', exact: true }).click()
  await page.getByText('已恢复同一付款记录，订单状态已刷新。', { exact: true }).waitFor()
  assert.equal(keys.length, 2)
  assert.equal(keys[0], keys[1])
  check(
    'Actual accepted POST response loss and tab reload reuse identical command UUID and recover one existing payment',
  )
  slow = true
  const started = new Promise((resolve) => {
    postStarted = resolve
  })
  await page.getByRole('button', { name: '恢复付款记录', exact: true }).evaluate((button) => {
    button.click()
    button.click()
  })
  await started
  assert.equal(keys.length, 3)
  await page.getByText('已恢复同一付款记录，订单状态已刷新。', { exact: true }).waitFor()
  slow = false
  assert.equal(keys[2], keys[0])
  const stored = await page.evaluate(() =>
    Object.entries(sessionStorage).filter(([key]) => key.startsWith('astra.payment-recovery.')),
  )
  assert.equal(stored.length, 1)
  assert.ok(
    stored.every(
      ([key, value]) =>
        !key.includes(owner) && !value.includes(owner) && !value.includes('checkout'),
    ),
  )
  check(
    'Double-click while pending sends only one POST; session storage contains command UUID rather than token, checkout or entitlement',
  )
  failRead = true
  await page.getByRole('button', { name: '刷新订单状态' }).click()
  await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('[data-order-detail]').count(), 0)
  assert.equal(await page.evaluate(() => localStorage.getItem('astra_access_token')), owner)
  failRead = false
  await page.getByRole('button', { name: '重新读取' }).click()
  await page.locator('[data-payment-state]').waitFor()
  check(
    'Read503 clears stale private detail, preserves identity and recovers without another payment command',
  )
  await page.getByRole('link', { name: '我的订单', exact: true }).first().click()
  await page.locator(`[data-order="${paid}"]`).getByRole('link', { name: '查看订单详情 ↗' }).click()
  await page.getByText('后台已确认付款', { exact: true }).waitFor()
  await page.getByRole('heading', { name: '中文测试商品1', exact: true }).waitFor()
  await page.locator('summary').filter({ hasText: '使用许可' }).click()
  assert.match(
    await page.locator('.policy-copy').first().innerText(),
    /测试LICENSE条款，未用于销售/,
  )
  assert.equal(await page.getByRole('button', { name: '恢复付款记录', exact: true }).count(), 0)
  await page.getByRole('link', { name: '前往已购内容领取 ↗' }).waitFor()
  await page.evaluate(() => scrollTo(0, 0))
  await page.screenshot({ path: path.join(out, 'order-paid-desktop.png'), fullPage: true })
  check(
    'Trusted paid/granted order keeps original product and license after catalogue rename/delisting; no recovery action on success',
  )
  await page.goto(`${base}/account/orders/${closed}`, { waitUntil: 'domcontentloaded' })
  await page.getByText('已关闭', { exact: true }).waitFor()
  await page.getByText('这笔订单尚无付款记录。新付款入口尚未开放。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '恢复付款记录', exact: true }).count(), 0)
  check('Backend-closed unpaid order stays closed with no new payment action')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(out, 'order-closed-mobile.png'), fullPage: true })
  check('390px order facts and controls fit without horizontal overflow')
  await page.goto(`${base}/account/orders/${pending}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-payment-state]').waitFor()
  const second = await context.newPage()
  await second.goto(`${base}/help`, { waitUntil: 'domcontentloaded' })
  await second.evaluate((token) => localStorage.setItem('astra_access_token', token), other)
  await page.getByText('未找到这笔订单，请确认使用购买时的账户。', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-order-detail]').count(), 0)
  assert.ok(
    report.requests.some((r) => r.status === 404 && r.path === `/api/system/orders/${pending}`),
  )
  await second.close()
  check(
    'Real cross-tab identity change clears owner detail and backend rejects other user404 without recovery POST',
  )
  await page.evaluate(() => localStorage.setItem('astra_access_token', 'invalid-jwt'))
  await page.goto(`${base}/account/orders/${pending}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '前往登录' }).click()
  assert.equal(new URL(page.url()).searchParams.get('returnTo'), `/account/orders/${pending}`)
  check(
    'Invalid JWT clears private detail and login carries only the exact implemented order return path',
  )
  await page.evaluate(() => localStorage.removeItem('astra_access_token'))
  const before = report.requests.length
  await page.goto(`${base}/account/orders/${paid}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '前往登录' }).waitFor()
  assert.equal(report.requests.length, before)
  assert.equal(keys.length, 3)
  check(
    'Anonymous direct order URL sends no private request; whole workflow never creates orders or new payment attempts',
  )
  report.passed = true
  console.log(`Order recovery browser: ${report.checks.length} checks passed.`)
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
