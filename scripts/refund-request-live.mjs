import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_REFUND_APPLICATION_PREVIEW_URL
const backend = process.env.ASTRA_REFUND_APPLICATION_API_URL
const owner = process.env.ASTRA_REFUND_APPLICATION_OWNER_TOKEN
const other = process.env.ASTRA_REFUND_APPLICATION_OTHER_TOKEN
const order = process.env.ASTRA_REFUND_APPLICATION_ORDER
const phase = process.env.ASTRA_REFUND_APPLICATION_PHASE
const out = process.env.ASTRA_REFUND_APPLICATION_OUTPUT
assert.ok(base && backend && owner && other && order && out)
assert.equal(new URL(base).hostname, '127.0.0.1'); assert.equal(new URL(backend).hostname, '127.0.0.1')
assert.ok(['request', 'settled'].includes(phase))
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { passed: false, phase, scope: 'Owned gateway/system/MySQL/Redis; trusted mock refunds; auth/me explicitly mocked503', checks: [], requests: [], injectedFailures: [] }
const check = (text) => { report.checks.push(text); console.log(text) }
const keys = [], bodies = []
let drop = false, slow = false
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
  await context.route((url) => url.origin !== new URL(base).origin, (route) => route.abort())
  await context.route('**/api/auth/me', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":503,"msg":"Owned fixture has no auth service"}' }))
  const page = await context.newPage()
  await page.route('**/api/system/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    assert.ok(method === 'GET' || (phase === 'request' && method === 'POST' && url.pathname === `/api/system/orders/${order}/refund-requests`), 'No unrelated financial/download writes')
    if (method === 'POST') {
      assert.deepEqual(Object.keys(request.postDataJSON()), ['reason'])
      keys.push(request.headers()['idempotency-key']); bodies.push(request.postDataJSON())
    }
    const response = await route.fetch({ url: `${backend}${url.pathname}${url.search}` }), body = await response.json()
    assert.ok(!body.data?.qrCodeUrl, 'Paid refund flow does not expose checkout')
    report.requests.push({ method, path: url.pathname, status: response.status(), body,
      headers: { cacheControl: response.headers()['cache-control'], requestId: response.headers()['x-request-id'] } })
    if (method === 'POST' && drop) {
      assert.equal(response.status(), 200); assert.equal(body.data.state, 'REQUESTED'); drop = false
      report.injectedFailures.push({ path: url.pathname, kind: 'accepted200-refund-response-lost' }); await route.abort('failed'); return
    }
    if (method === 'POST' && slow) await new Promise((resolve) => setTimeout(resolve, 600))
    await route.fulfill({ response })
  })
  await page.goto(`${base}/account/orders/${order}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '前往登录' }).waitFor(); assert.equal(report.requests.length, 0)
  if (phase === 'request') check('Anonymous page performs no private requests')
  await page.evaluate((value) => localStorage.setItem('astra_access_token', value), owner)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const area = page.locator('.refund-section')
  if (phase === 'request') {
    const submit = area.getByRole('button', { name: '提交退款申请', exact: true })
    await submit.waitFor(); assert.ok(await submit.isDisabled())
    const reason = area.getByLabel('退款原因', { exact: true }), consent = area.getByRole('checkbox')
    await reason.fill('短'); await consent.check(); assert.ok(await submit.isDisabled())
    await reason.fill('文件无法恢复希望核查退款'); await consent.uncheck(); assert.ok(await submit.isDisabled())
    check('Reason minimum and initially unchecked policy consent required')
    await area.screenshot({ path: path.join(out, 'refund_request_form_desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await area.screenshot({ path: path.join(out, 'refund_request_form_mobile.png') })
    await page.setViewportSize({ width: 1440, height: 960 })
    drop = true; await consent.check(); await submit.click()
    await area.getByRole('alert').waitFor(); assert.equal(keys.length, 1); assert.ok(await submit.isDisabled())
    check('Actual backend accepted200 response loss retains original form without pretending refund completed')
    slow = true; await consent.check(); await submit.dblclick()
    await area.locator('[data-refund-state]').filter({ hasText: '已申请' }).waitFor(); await area.getByText('申请原因：文件无法恢复希望核查退款', { exact: true }).waitFor()
    assert.equal(keys.length, 2); assert.equal(keys[0], keys[1]); assert.deepEqual(bodies[0], bodies[1])
    check('Lost result and double click recover same UUID/reason, exactly two HTTP attempts and one backend command')
    await page.getByRole('link', { name: '前往已购内容领取 ↗' }).waitFor()
    assert.equal(await area.locator('textarea').count(), 0); check('Pending application leaves backend-granted rights available and hides repeated application form')
    const stored = await page.evaluate(() => Object.entries(sessionStorage).filter(([k]) => k.startsWith('astra.refund-request.')))
    assert.equal(stored.length, 1); assert.ok(!JSON.stringify(stored).includes(owner) && !JSON.stringify(stored).includes(bodies[0].reason))
    check('Session storage contains command UUID/body hash only, no JWT or complaint text')
    await area.screenshot({ path: path.join(out, 'refund_requested_desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 }); await page.reload({ waitUntil: 'domcontentloaded' })
    await area.getByText('申请原因：文件无法恢复希望核查退款', { exact: true }).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await area.screenshot({ path: path.join(out, 'refund_requested_mobile.png') }); check('390px reload restores actual original refund detail without another POST or horizontal overflow')
    await page.evaluate((value) => { localStorage.setItem('astra_access_token', value); window.dispatchEvent(new StorageEvent('storage', { key: 'astra_access_token' })) }, other)
    await page.getByText('未找到这笔订单，请确认使用购买时的账户。', { exact: true }).waitFor()
    assert.equal(await page.getByText('申请原因：文件无法恢复希望核查退款', { exact: true }).count(), 0); assert.equal(keys.length, 2)
    check('Cross-tab account switch removes private reason and requests with current identity only')
  } else {
    await area.locator('[data-refund-state]').filter({ hasText: '已完成' }).waitFor(); await area.getByText('审核说明：已核对原订单与申请说明', { exact: true }).waitFor()
    assert.equal(await area.getByRole('button', { name: '提交退款申请', exact: true }).count(), 0)
    assert.equal(await page.getByRole('link', { name: '前往已购内容领取 ↗' }).count(), 0)
    assert.equal(keys.length, 0); check('Actual approved/trusted refund settlement renders completion/decision and no new request or source delivery link')
    assert.ok(report.requests.some((r) => r.body.data?.totalRefundedCent === 3900 && r.body.data?.fulfillmentState === 'REVOKED'))
    check('Refund amount and revoked fulfillment are read from backend order, no local grants')
    await area.screenshot({ path: path.join(out, 'refund_settled_desktop.png') })
  }
  report.passed = true
} finally {
  await writeFile(path.join(out, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await browser.close()
}
