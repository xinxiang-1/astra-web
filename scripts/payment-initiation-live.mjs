import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PAYMENT_INITIATION_PREVIEW_URL
const backend = process.env.ASTRA_PAYMENT_INITIATION_API_URL
const owner = process.env.ASTRA_PAYMENT_INITIATION_OWNER_TOKEN
const other = process.env.ASTRA_PAYMENT_INITIATION_OTHER_TOKEN
const pending = process.env.ASTRA_PAYMENT_INITIATION_PENDING_ORDER
const paid = process.env.ASTRA_PAYMENT_INITIATION_PAID_ORDER
const closed = process.env.ASTRA_PAYMENT_INITIATION_CLOSED_ORDER
const phase = process.env.ASTRA_PAYMENT_INITIATION_PHASE
const out = process.env.ASTRA_PAYMENT_INITIATION_OUTPUT
assert.ok(base && backend && owner && other && pending && paid && closed && out, 'Owned Java fixture required')
assert.equal(new URL(base).hostname, '127.0.0.1')
assert.equal(new URL(backend).hostname, '127.0.0.1')
assert.ok(['initiation', 'settled'].includes(phase))
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { passed: false, phase, scope: 'Real owned gateway/system/MySQL/Redis; trusted mock worker settlement only; auth/me mocked503; explicit accepted response loss and capability503 injection', checks: [], requests: [], injectedFailures: [] }
const check = (name) => { report.checks.push(name); console.log(name) }
const keys = []
let lost = false, slow = false, failCaps = false
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
  await context.route((url) => url.origin !== new URL(base).origin, (route) => route.abort())
  await context.route('**/api/auth/me', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":503,"msg":"Owned fixture has no auth service"}' }))
  const page = await context.newPage()
  await page.route('**/api/system/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    assert.ok(method === 'GET' || (phase === 'initiation' && method === 'POST' && url.pathname === `/api/system/orders/${pending}/payments`), 'No other financial/order/download writes')
    if (failCaps && url.pathname === '/api/system/catalog/capabilities') {
      report.injectedFailures.push({ path: url.pathname, status: 503 })
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":503,"msg":"Explicit capability failure"}' }); return
    }
    if (method === 'POST') {
      assert.deepEqual(request.postDataJSON(), { channel: 'wechat_native' })
      keys.push(request.headers()['idempotency-key'])
    }
    const response = await route.fetch({ url: `${backend}${url.pathname}${url.search}` })
    const body = await response.json(), omitted = Boolean(body.data?.qrCodeUrl)
    if (omitted) {
      assert.equal(body.data.mock, true)
      assert.match(body.data.qrCodeUrl, /^astra-mock:\/\/checkout\/ASP/)
      delete body.data.qrCodeUrl
    }
    report.requests.push({ method, path: url.pathname, status: response.status(), body, checkoutUrlOmittedAfterLiveValidation: omitted,
      headers: { cacheControl: response.headers()['cache-control'], requestId: response.headers()['x-request-id'] } })
    if (method === 'POST' && lost) {
      assert.equal(response.status(), 200); assert.equal(body.data.state, 'INIT')
      lost = false
      report.injectedFailures.push({ path: url.pathname, kind: 'accepted200-first-payment-response-lost' })
      await route.abort('failed'); return
    }
    if (method === 'POST' && slow) await new Promise((resolve) => setTimeout(resolve, 650))
    await route.fulfill({ response })
  })
  await page.goto(`${base}/account/orders/${pending}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '前往登录' }).waitFor()
  assert.equal(report.requests.length, 0)
  if (phase === 'initiation') check('Anonymous first-payment order makes zero private requests or financial writes')
  await page.evaluate((value) => localStorage.setItem('astra_access_token', value), owner)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const paymentArea = page.locator('.payment-section')
  if (phase === 'settled') {
    await page.getByText('后台已确认付款', { exact: true }).waitFor()
    await page.getByRole('link', { name: '前往已购内容领取 ↗' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '核对模拟付款请求', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '恢复付款记录', exact: true }).count(), 0)
    assert.equal(keys.length, 0)
    assert.ok(report.requests.some((r) => r.body.data?.id === pending && r.body.data.state === 'PAID' && r.body.data.fulfillmentState === 'GRANTED'))
    check('After trusted mock worker settlement, browser reads backend PAID/GRANTED/SUCCEEDED and removes initiation/recovery actions')
    await page.getByRole('link', { name: '前往已购内容领取 ↗' }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-entitlement]').length === 2)
    assert.match(await page.locator('.account-list').innerText(), new RegExp(pending))
    assert.equal(keys.length, 0)
    await page.locator('.account-list').screenshot({ path: path.join(out, 'server-granted-library.png') })
    check('Actual server entitlement list contains the first-payment source order and two grants with zero delivery or financial writes')
  } else {
    await paymentArea.getByRole('button', { name: '核对模拟付款请求', exact: true }).click()
    const form = page.locator('[data-payment-confirmation]')
    assert.equal(await form.getByRole('button', { name: '确认创建模拟付款记录' }).isDisabled(), true)
    assert.equal(await form.locator('details[open]').count(), 3)
    assert.match(await form.innerText(), /¥39.00/)
    assert.equal(keys.length, 0)
    await paymentArea.screenshot({ path: path.join(out, 'first-payment-confirmation-desktop.png') })
    check('Original backend amount and full frozen policies appear before unchecked explicit mock-only initiation consent')
    await form.getByRole('checkbox').check()
    await form.getByRole('button', { name: '返回核对' }).click()
    await paymentArea.getByRole('button', { name: '核对模拟付款请求', exact: true }).click()
    assert.equal(await form.getByRole('checkbox').isChecked(), false)
    await form.getByRole('checkbox').check()
    await paymentArea.getByRole('button', { name: '刷新订单状态' }).click()
    await paymentArea.getByRole('button', { name: '核对模拟付款请求', exact: true }).click()
    assert.equal(await form.getByRole('checkbox').isChecked(), false)
    assert.equal(keys.length, 0)
    check('Leaving confirmation and refreshing server order reset consent; no automatic initiation POST')
    failCaps = true
    await paymentArea.getByRole('button', { name: '刷新订单状态' }).click()
    await page.getByText('这笔订单尚无付款记录。新付款入口尚未开放。', { exact: true }).waitFor()
    assert.equal(await page.locator('[data-order-detail]').count(), 1)
    assert.equal(await page.getByRole('button', { name: '核对模拟付款请求', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => Boolean(localStorage.getItem('astra_access_token'))), true)
    failCaps = false
    await paymentArea.getByRole('button', { name: '刷新订单状态' }).click()
    await paymentArea.getByRole('button', { name: '核对模拟付款请求', exact: true }).click()
    check('Capability503 disables new initiation while preserving original order/token; manual refresh recovers')
    await form.getByRole('checkbox').check()
    lost = true
    await form.getByRole('button', { name: '确认创建模拟付款记录' }).evaluate((button) => { button.click(); button.click() })
    await paymentArea.getByRole('alert').waitFor()
    assert.equal(keys.length, 1)
    assert.equal(await page.getByRole('link', { name: '前往已购内容领取 ↗' }).count(), 0)
    const stored = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('astra.payment-recovery.')))
    assert.equal(stored.length, 1)
    assert.match(stored[0][1], /^[a-f0-9-]{36}$/)
    assert.ok(!JSON.stringify(stored).includes(owner))
    check('Double-click first initiation sends one actual POST; accepted INIT response loss preserves UUID without granting access or marking paid')
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByText('记录初始化中', { exact: true }).waitFor()
    assert.equal(keys.length, 1)
    slow = true
    await paymentArea.getByRole('button', { name: '恢复付款记录', exact: true }).evaluate((button) => { button.click(); button.click() })
    await page.getByText('已恢复同一付款记录，订单状态已刷新。', { exact: true }).waitFor()
    slow = false
    assert.equal(keys.length, 2)
    assert.equal(keys[0], keys[1])
    assert.equal(await page.getByRole('button', { name: '核对模拟付款请求', exact: true }).count(), 0)
    assert.equal(await page.getByRole('link', { name: '前往已购内容领取 ↗' }).count(), 0)
    check('Reload reads original INIT payment and double-click recovery sends one POST with the identical first-payment key')
    await page.goto(`${base}/account/orders/${paid}`, { waitUntil: 'domcontentloaded' })
    await page.getByText('后台已确认付款', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '核对模拟付款请求', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '恢复付款记录', exact: true }).count(), 0)
    await page.goto(`${base}/account/orders/${closed}`, { waitUntil: 'domcontentloaded' })
    await page.getByText('已关闭', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '核对模拟付款请求', exact: true }).count(), 0)
    check('Paid and server-closed orders have no first-payment confirmation action; paid success has no recovery')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${base}/account/orders/${pending}`, { waitUntil: 'domcontentloaded' })
    await page.getByText('记录初始化中', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.equal(await page.locator('a[href^="astra-mock:"],img[src^="astra-mock:"]').count(), 0)
    await paymentArea.screenshot({ path: path.join(out, 'first-payment-init-mobile.png') })
    check('390px original INIT record fits without overflow and exposes no mock or real checkout URL')
    const second = await context.newPage()
    await second.goto(`${base}/help`, { waitUntil: 'domcontentloaded' })
    await second.evaluate((value) => localStorage.setItem('astra_access_token', value), other)
    await page.getByText('未找到这笔订单，请确认使用购买时的账户。', { exact: true }).waitFor()
    assert.equal(await page.locator('[data-order-detail]').count(), 0)
    assert.equal(keys.length, 2)
    check('Actual cross-tab identity switch clears first-payment details; other owner gets backend404 without POST')
    await second.evaluate(() => localStorage.removeItem('astra_access_token'))
    await page.getByRole('link', { name: '前往登录' }).waitFor()
    assert.equal(keys.length, 2)
    check('Real cross-tab logout clears private state and does not initiate or restore payment')
  }
  report.passed = true
} finally {
  await browser.close()
  await writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
}
