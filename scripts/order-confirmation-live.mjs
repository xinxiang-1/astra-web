import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_ORDER_CONFIRM_PREVIEW_URL
const backend = process.env.ASTRA_ORDER_CONFIRM_API_URL
const owner = process.env.ASTRA_ORDER_CONFIRM_OWNER_TOKEN
const other = process.env.ASTRA_ORDER_CONFIRM_OTHER_TOKEN
const out = process.env.ASTRA_ORDER_CONFIRM_OUTPUT
const closedId = process.env.ASTRA_ORDER_CONFIRM_CLOSED_ID
const closedKey = process.env.ASTRA_ORDER_CONFIRM_CLOSED_KEY
const closedRequest = process.env.ASTRA_ORDER_CONFIRM_CLOSED_REQUEST
assert.ok(base && backend && owner && other && out, 'Owned Java fixture required')
assert.equal(new URL(base).hostname, '127.0.0.1')
assert.equal(new URL(backend).hostname, '127.0.0.1')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { passed: false, scope: 'Real owned gateway/system/MySQL/Redis; no payments; auth/me mocked503; explicit accepted response loss and stale catalogue injection', checks: [], requests: [], injectedFailures: [] }
const check = (name) => { report.checks.push(name); console.log(name) }
const keys = []
let lost = false, slow = false, stale = false
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.route((url) => url.origin !== new URL(base).origin, (route) => route.abort())
  await context.route('**/api/auth/me', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":503,"msg":"Owned fixture has no auth service"}' }))
  const page = await context.newPage()
  await page.route('**/api/system/**', async (route) => {
    const req = route.request(), url = new URL(req.url()), method = req.method()
    assert.ok(method === 'GET' || (method === 'POST' && url.pathname === '/api/system/orders'), 'Only create/recover an order; no payment, refund or delivery writes')
    if (method === 'POST') {
      const body = req.postDataJSON()
      assert.deepEqual(Object.keys(body).sort(), ['licenseVersion', 'offerVersion', 'refundPolicyVersion', 'skuId', 'termsVersion'])
      keys.push({ sku: body.skuId, key: req.headers()['idempotency-key'] })
    }
    const response = await route.fetch({ url: `${backend}${url.pathname}${url.search}` })
    const body = await response.json()
    report.requests.push({ method, path: url.pathname, status: response.status(), body: structuredClone(body),
      headers: { cacheControl: response.headers()['cache-control'], requestId: response.headers()['x-request-id'] } })
    if (method === 'POST' && lost) {
      assert.equal(response.status(), 200)
      lost = false
      report.injectedFailures.push({ path: url.pathname, kind: 'accepted200-response-lost' })
      await route.abort('failed'); return
    }
    if (method === 'POST' && slow) await new Promise((resolve) => setTimeout(resolve, 650))
    if (stale && method === 'GET' && url.pathname.endsWith('/catalog/products/owned-theme-1')) {
      assert.equal(body.data.skus[0].offerVersion, 2)
      body.data.skus[0].offerVersion = 1
      report.injectedFailures.push({ path: url.pathname, kind: 'explicit-stale-offerVersion-1-from-real-2' })
      await route.fulfill({ response, json: body }); return
    }
    await route.fulfill({ response })
  })
  const area = page.locator('[data-order-confirmation]')
  const posts = () => keys.length
  await page.goto(`${base}/collections/owned-theme-0`, { waitUntil: 'domcontentloaded' })
  await area.getByRole('link', { name: '登录后继续 ↗' }).waitFor()
  assert.equal(posts(), 0)
  assert.match(await area.getByRole('link', { name: '登录后继续 ↗' }).getAttribute('href'), /returnTo=.*collections/)
  check('Anonymous product viewing makes zero private writes and preserves safe product login return')
  await page.evaluate((value) => localStorage.setItem('astra_access_token', value), owner)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await area.getByRole('button', { name: '核对版本与条款' }).click()
  const consent = area.getByRole('checkbox')
  const create = area.getByRole('button', { name: '确认并创建订单' })
  assert.equal(await create.isDisabled(), true)
  assert.equal(await area.locator('details[open]').count(), 3)
  assert.match(await area.innerText(), /¥39.00/)
  await area.scrollIntoViewIfNeeded()
  await area.screenshot({ path: path.join(out, 'order-confirmation-desktop.png') })
  assert.equal(posts(), 0)
  check('Full policy text and backend amount are reviewed before explicit unchecked consent; no writes on entry')
  await consent.check()
  lost = true
  await create.click()
  await area.getByRole('button', { name: '恢复原订单请求' }).waitFor()
  assert.equal(posts(), 1)
  assert.equal(await page.locator('[data-confirmed-order]').count(), 0)
  check('Accepted actual POST response loss leaves the original command available without granting rights')
  await page.reload({ waitUntil: 'domcontentloaded' })
  const recover = area.getByRole('button', { name: '恢复原订单请求' })
  await recover.waitFor()
  assert.equal(posts(), 1, 'Reload must not automatically POST')
  slow = true
  await recover.evaluate((button) => { button.click(); button.click() })
  await page.locator('[data-confirmed-order]').waitFor()
  slow = false
  assert.equal(posts(), 2)
  assert.equal(keys[0].key, keys[1].key)
  check('Same-tab reload and double click recover the exact command with one POST and the original key')
  const originalLink = await area.getByRole('link', { name: '查看订单详情 ↗' }).getAttribute('href')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await area.getByRole('button', { name: '读取原订单' }).click()
  await page.locator('[data-confirmed-order]').waitFor()
  assert.equal(posts(), 2)
  assert.equal(await area.getByRole('link', { name: '查看订单详情 ↗' }).getAttribute('href'), originalLink)
  check('Successful order refresh recovers by GET only and keeps its original detail link')
  stale = true
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}/collections/owned-theme-1`, { waitUntil: 'domcontentloaded' })
  await area.getByRole('button', { name: '核对版本与条款' }).click()
  await area.getByRole('checkbox').check()
  await area.getByRole('button', { name: '确认并创建订单' }).click()
  await area.getByRole('alert').waitFor()
  assert.match(await area.getByRole('alert').innerText(), /商品或条款已更新/)
  assert.equal(await page.locator('[data-confirmed-order]').count(), 0)
  assert.equal(report.requests.at(-1).status, 409)
  check('Actual backend stale offer409 creates no order and requires refresh with fresh consent')
  stale = false
  await page.reload({ waitUntil: 'domcontentloaded' })
  await area.getByRole('button', { name: '核对版本与条款' }).click()
  assert.equal(await area.getByRole('checkbox').isChecked(), false)
  assert.equal(await area.getByRole('button', { name: '确认并创建订单' }).isDisabled(), true)
  await area.getByRole('checkbox').check()
  await area.getByRole('button', { name: '返回核对' }).click()
  await area.getByRole('button', { name: '核对版本与条款' }).click()
  assert.equal(await area.getByRole('checkbox').isChecked(), false)
  check('Catalogue refresh and leaving review both reset consent; no inherited checkbox authorization')
  await area.getByRole('checkbox').check()
  await area.getByRole('button', { name: '确认并创建订单' }).click()
  await page.locator('[data-confirmed-order]').waitFor()
  assert.equal(posts(), 4)
  assert.notEqual(keys[2].key, keys[3].key)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await area.scrollIntoViewIfNeeded()
  await area.screenshot({ path: path.join(out, 'order-confirmed-mobile.png') })
  check('Fresh offer2 confirmation creates a separate valid order; 390px view has no horizontal overflow')
  const second = await context.newPage()
  await second.goto(`${base}/help`, { waitUntil: 'domcontentloaded' })
  await second.evaluate((value) => localStorage.setItem('astra_access_token', value), other)
  await area.getByRole('button', { name: '核对版本与条款' }).waitFor()
  assert.equal(await page.locator('[data-confirmed-order]').count(), 0)
  assert.equal(await area.getByRole('checkbox').count(), 0)
  assert.equal(posts(), 4)
  await page.goto(`${base}${originalLink}`, { waitUntil: 'domcontentloaded' })
  await page.getByText('未找到这笔订单，请确认使用购买时的账户。', { exact: true }).waitFor()
  assert.ok(report.requests.some((r) => r.method === 'GET' && r.path === `/api${originalLink.replace('/account', '/system')}` && r.status === 404))
  check('Real cross-tab account change clears private order and consent; other owner receives backend404')
  await second.evaluate(() => localStorage.removeItem('astra_access_token'))
  await page.goto(`${base}/collections/owned-theme-0`, { waitUntil: 'domcontentloaded' })
  await area.getByRole('link', { name: '登录后继续 ↗' }).waitFor()
  assert.equal(posts(), 4)
  check('Logout returns to login prompt without restoring another account command or writing')
  assert.ok(closedId && closedKey && closedRequest, 'Real closed-order fixture required')
  await page.evaluate(async ({ token, id, key, request }) => {
    localStorage.setItem('astra_access_token', token)
    const scope = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), (n) => n.toString(16).padStart(2, '0')).join('')
    sessionStorage.setItem(`astra.order-command.${scope}.owned-theme-2`, JSON.stringify({ key, request: JSON.parse(request), orderId: id }))
  }, { token: owner, id: closedId, key: closedKey, request: closedRequest })
  await page.goto(`${base}/collections/owned-theme-2`, { waitUntil: 'domcontentloaded' })
  await area.getByRole('button', { name: '读取原订单' }).click()
  await area.getByRole('button', { name: '重新核对新订单' }).click()
  await area.getByRole('button', { name: '核对版本与条款' }).click()
  assert.equal(await area.getByRole('checkbox').isChecked(), false)
  assert.equal(await area.getByRole('button', { name: '确认并创建订单' }).isDisabled(), true)
  assert.equal(posts(), 4)
  const closedReads = report.requests.filter((r) => r.method === 'GET' && r.path === `/api/system/orders/${closedId}`)
  assert.equal(closedReads.length, 2, 'Original read plus fresh CLOSED verification')
  assert.ok(closedReads.every((r) => r.body.data.state === 'CLOSED'))
  check('Real backend-closed order is rechecked through GET before explicit new confirmation; consent resets and zero extra POSTs')
  report.passed = true
} finally {
  await browser.close()
  await writeFile(path.join(out, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
}
