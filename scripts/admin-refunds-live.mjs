import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_ADMIN_REFUNDS_PREVIEW_URL, backend = process.env.ASTRA_ADMIN_REFUNDS_API_URL
const admin = process.env.ASTRA_ADMIN_REFUNDS_ADMIN_TOKEN, otherAdmin = process.env.ASTRA_ADMIN_REFUNDS_OTHER_ADMIN_TOKEN
const buyer = process.env.ASTRA_ADMIN_REFUNDS_BUYER_TOKEN, id = process.env.ASTRA_ADMIN_REFUNDS_ID, out = process.env.ASTRA_ADMIN_REFUNDS_OUTPUT
assert.ok(base && backend && admin && otherAdmin && buyer && id && out)
assert.equal(new URL(base).hostname, '127.0.0.1'); assert.equal(new URL(backend).hostname, '127.0.0.1')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = { passed: false, scope: 'Built frontend + owned gateway/system/MySQL/Redis; trusted mock payment; auth/me explicitly mocked503', checks: [], requests: [], injectedFailures: [] }
const check = (text) => { report.checks.push(text); console.log(text) }
const posts = []
let drop = false, slow = false
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.route((url) => url.origin !== new URL(base).origin, (route) => route.abort())
  await context.route('**/api/auth/me', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":503,"msg":"Owned fixture has no auth service"}' }))
  const page = await context.newPage()
  const capture = (method, url, status, body, headers) => report.requests.push({ method, path: url, status, body, headers: { cacheControl: headers['cache-control'], requestId: headers['x-request-id'] }, viaGateway: true })
  await page.route('**/api/system/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    assert.ok(method === 'GET' || (method === 'POST' && url.pathname === `/api/system/admin/refunds/${id}/decisions`), 'No unrelated financial writes')
    if (method === 'POST') posts.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() })
    const response = await route.fetch({ url: `${backend}${url.pathname}${url.search}` }), body = await response.json()
    capture(method, url.pathname, response.status(), body, response.headers())
    if (method === 'POST' && drop) {
      assert.equal(response.status(), 200); assert.equal(body.data.state, 'REJECTED'); drop = false
      report.injectedFailures.push({ kind: 'accepted200-decision-response-lost', path: url.pathname }); await route.abort('failed'); return
    }
    if (method === 'POST' && slow) await new Promise((resolve) => setTimeout(resolve, 600))
    await route.fulfill({ response })
  })
  const identity = async (token) => { await page.evaluate((value) => localStorage.setItem('astra_access_token', value), token); await page.reload({ waitUntil: 'domcontentloaded' }) }
  await page.goto(`${base}/admin/refunds`, { waitUntil: 'domcontentloaded' })
  const login = page.getByRole('link', { name: '前往登录', exact: true })
  await login.waitFor(); assert.equal(report.requests.length, 0); assert.equal(new URL(await login.getAttribute('href'), base).searchParams.get('returnTo'), '/admin/refunds')
  check('Anonymous workbench has no private calls and exact login return route')
  await identity(buyer); await page.getByText('当前账户没有退款管理权限。', { exact: true }).waitFor()
  assert.equal(await page.locator('[data-refund]').count(), 0); assert.equal(posts.length, 0)
  check('Real gateway role403 hides private list/context and actions')
  await identity(admin)
  const row = page.locator(`[data-refund="${id}"]`), area = page.getByRole('region', { name: '退款审核详情' })
  await row.waitFor(); await row.click(); await area.locator('[data-refund-state="REQUESTED"]').waitFor()
  await area.getByText('申请原因：工作台测试质量诉求需退款', { exact: true }).waitFor()
  await area.getByText('¥39.00 / ¥39.00', { exact: true }).waitFor()
  await area.getByText('传输开始不等于完整收到或成功使用文件；已领取和超过七天的质量诉求仍需人工核查。', { exact: true }).waitFor()
  await area.locator('summary').click(); await area.getByText(/测试REFUND_POLICY条款/).waitFor()
  check('Protected original order/full amount/policy/reason and accurate delivery explanation come from backend context')
  const reason = area.getByLabel('审核说明（5至500字）'), consent = area.getByRole('checkbox')
  const action = (name) => area.getByRole('button', { name, exact: true })
  assert.ok(await action('批准全额退款').isDisabled()); assert.ok(!await consent.isChecked())
  await reason.fill('短'); await consent.check(); assert.ok(await action('拒绝申请').isDisabled())
  await reason.fill('已核对原订单与质量诉求'); await consent.uncheck(); assert.ok(await action('拒绝申请').isDisabled())
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: path.join(out, 'admin_refund_desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: path.join(out, 'admin_refund_mobile.png'), fullPage: true }); await page.setViewportSize({ width: 1440, height: 1000 })
  check('Default unchecked review, Unicode reason guard and390px workbench without horizontal overflow')
  drop = true; await consent.check(); await action('拒绝申请').click(); await page.getByRole('alert').waitFor()
  assert.equal(posts.length, 1); assert.ok(!await consent.isChecked())
  await reason.fill('修改审核说明不能另建请求'); await consent.check(); await action('拒绝申请').click()
  await page.getByText(/已有待确认审核/).waitFor(); assert.equal(posts.length, 1)
  await reason.fill('已核对原订单与质量诉求'); await consent.check(); slow = true; await action('拒绝申请').dblclick()
  await area.locator('[data-refund-state="REJECTED"]').waitFor(); slow = false
  assert.equal(posts.length, 2); assert.equal(posts[0].key, posts[1].key); assert.deepEqual(posts[0].body, posts[1].body)
  assert.equal(await action('批准全额退款').count(), 0)
  check('Accepted rejection response loss and double click recover same key/body; changed text blocked before transport')
  await reason.fill('补充材料后重新受理质量申诉'); await consent.check(); await action('重新受理').click()
  await area.locator('[data-refund-state="REQUESTED"]').waitFor()
  check('Reopen keeps original refund and requires a separate approval with new version')
  const external = await context.request.post(`${backend}/api/system/admin/refunds/${id}/decisions`, { headers: { Authorization: `Bearer ${otherAdmin}`, 'Idempotency-Key': crypto.randomUUID() }, data: { decision: 'REJECT', expectedVersion: 3, reason: '另一管理员核对后拒绝申请' } })
  const externalBody = await external.json(); assert.equal(external.status(), 200)
  capture('POST', `/api/system/admin/refunds/${id}/decisions`, external.status(), externalBody, external.headers())
  await reason.fill('当前版本申请批准全额退款'); await consent.check(); await action('批准全额退款').click()
  await page.getByText('申请已被其他操作更新，请重新选择并核对最新版本。', { exact: true }).waitFor()
  assert.ok(report.requests.some((r) => r.status === 409 && r.body.code === 43008)); assert.equal(await area.locator('textarea').count(), 0)
  check('Real competing admin update yields43008 and discards old approval context')
  await row.click(); await area.locator('[data-refund-state="REJECTED"]').waitFor()
  await reason.fill('核对补充资料后重新受理'); await consent.check(); await action('重新受理').click(); await area.locator('[data-refund-state="REQUESTED"]').waitFor()
  await reason.fill('补充资料确认后批准全额退款'); await consent.check(); await action('批准全额退款').click(); await area.locator('[data-refund-state="APPROVED"]').waitFor()
  assert.equal(await area.locator('textarea').count(), 0); await area.getByText('等待执行 · 已尝试 0 次', { exact: true }).waitFor()
  const latest = report.requests.filter((r) => r.path === `/api/system/admin/refunds/${id}` && r.status === 200).at(-1).body.data
  assert.equal(latest.order.totalRefundedCent, 0); assert.equal(latest.order.fulfillmentState, 'GRANTED'); assert.equal(latest.audits.length, 5); assert.equal(latest.tasks.length, 1)
  check('Final approval reads five audits/one task, leaves granted rights and money unchanged pending trusted settlement')
  const stored = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('astra.refund-decision.')))
  assert.ok(stored.length > 0 && !JSON.stringify(stored).includes(admin) && !JSON.stringify(stored).includes('核对'))
  assert.ok(stored.every(([, value]) => Object.keys(JSON.parse(value)).sort().join(',') === 'bodyHash,key'))
  check('Decision session persists UUID/body hash only, no JWT or review explanation')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: path.join(out, 'admin_refund_approved.png'), fullPage: true })
  const postCount = posts.length
  await page.evaluate((value) => { localStorage.setItem('astra_access_token', value); window.dispatchEvent(new StorageEvent('storage', { key: 'astra_access_token' })) }, buyer)
  await page.getByText('当前账户没有退款管理权限。', { exact: true }).waitFor()
  assert.equal(await area.count(), 0); assert.equal(await page.getByText('申请原因：工作台测试质量诉求需退款', { exact: true }).count(), 0); assert.equal(posts.length, postCount)
  check('Cross-tab switch to buyer immediately removes admin context/reason/actions and role403 remains enforced')
  await page.goto(`${base}/account/orders`, { waitUntil: 'domcontentloaded' }); await page.getByRole('heading', { name: '我的订单', exact: true }).waitFor()
  await page.locator('[data-order]').first().waitFor(); assert.equal(await page.getByRole('link', { name: '退款工作台 ↗' }).count(), 0)
  await identity(admin); await page.getByRole('link', { name: '退款工作台 ↗' }).waitFor()
  check('Buyer account has no operator entry; active DB-role admin discovers entry through real access endpoint')
  report.passed = true
} finally {
  await writeFile(path.join(out, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await browser.close()
}
