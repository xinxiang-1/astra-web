import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_REFUND_VERIFICATION_PREVIEW_URL, backend = process.env.ASTRA_REFUND_VERIFICATION_API_URL
const admin = process.env.ASTRA_REFUND_VERIFICATION_ADMIN_TOKEN, renewed = process.env.ASTRA_REFUND_VERIFICATION_RENEWED_TOKEN
const other = process.env.ASTRA_REFUND_VERIFICATION_OTHER_ADMIN_TOKEN, buyer = process.env.ASTRA_REFUND_VERIFICATION_BUYER_TOKEN
const refund = process.env.ASTRA_REFUND_VERIFICATION_REFUND, second = process.env.ASTRA_REFUND_VERIFICATION_SECOND_REFUND
const unapproved = process.env.ASTRA_REFUND_VERIFICATION_UNAPPROVED_REFUND
const reconciliation = process.env.ASTRA_REFUND_VERIFICATION_RECONCILIATION, out = process.env.ASTRA_REFUND_VERIFICATION_OUTPUT
assert.ok(base && backend && admin && renewed && other && buyer && refund && second && unapproved && reconciliation && out)
assert.equal(new URL(base).hostname, '127.0.0.1'); assert.equal(new URL(backend).hostname, '127.0.0.1')
await mkdir(out, { recursive: true })
const root = `/api/system/admin/refunds/${refund}/reconcile`, view = `/admin/refunds/${refund}/verification`
const report = { passed: false, scope: 'Built frontend + owned system/gateway/MySQL/Redis; persisted mock refund facts; auth/me explicitly simulated503', checks: [], requests: [], injectedFailures: [], pageErrors: [], screenshots: [] }
const check = (text) => { report.checks.push(text); console.log(text) }
const capture = (method, url, response, body) => report.requests.push({ method, path: url, status: response.status(), body, headers: { cacheControl: response.headers()['cache-control'], requestId: response.headers()['x-request-id'], retryAfter: response.headers()['retry-after'] ?? '' }, viaGateway: true })
const coordinate = async (phase) => {
  await writeFile(path.join(out, `${phase}.request`), 'request')
  for (let i = 0; i < 150; i++) { try { await access(path.join(out, `${phase}.ack`)); return } catch { await new Promise((resolve) => setTimeout(resolve, 100)) } }
  throw new Error(`Owned worker coordination timeout: ${phase}`)
}
let dropBefore = false, dropAfter = false, slow = false, failRead = false
const posts = []
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.route((url) => url.origin !== new URL(base).origin, (route) => route.abort())
  await context.route('**/api/auth/me', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":503,"msg":"Owned fixture has no auth service"}' }))
  const page = await context.newPage(); page.on('pageerror', (error) => report.pageErrors.push(error.message))
  await page.route('**/api/system/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    assert.ok(method === 'GET' || (method === 'POST' && url.pathname === root), 'No unrelated financial writes')
    if (method === 'POST') {
      posts.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON() })
      if (dropBefore) { dropBefore = false; report.injectedFailures.push({ kind: 'before-acceptance-POST-network-loss', path: url.pathname }); await route.abort('failed'); return }
    }
    if (failRead && url.pathname === root && method === 'GET') {
      failRead = false; report.injectedFailures.push({ kind: 'read503', path: url.pathname })
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":503,"msg":"测试读取暂不可用，请重试"}' }); return
    }
    const response = await route.fetch({ url: `${backend}${url.pathname}${url.search}` }), body = await response.json()
    capture(method, url.pathname, response, body)
    if (method === 'POST' && dropAfter) {
      assert.equal(response.status(), 200); dropAfter = false; report.injectedFailures.push({ kind: 'accepted200-query-response-lost', path: url.pathname }); await route.abort('failed'); return
    }
    if (slow && url.pathname === root && method === 'GET') await new Promise((resolve) => setTimeout(resolve, 900))
    await route.fulfill({ response })
  })
  const identity = async (token) => { await page.evaluate((value) => localStorage.setItem('astra_access_token', value), token); await page.reload({ waitUntil: 'domcontentloaded' }) }
  const ready = () => page.locator('.admin-content[aria-busy="false"]').waitFor()
  const refresh = async () => { await page.getByRole('button', { name: '刷新状态', exact: true }).click(); await page.locator('[data-refund-version]').waitFor(); await ready() }
  const form = page.getByRole('region', { name: '发起原退款查询', exact: true }), outcome = page.getByRole('region', { name: '核查结果', exact: true })
  const text = '核查原退款并保留查询记录'
  const confirm = async () => { await page.locator('#verification-reason').fill(text); await form.getByRole('checkbox').check() }
  const screenshot = async (name) => { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(out, name), fullPage: true }); report.screenshots.push(name) }
  const theme = async (mode) => { if (await page.locator('html').getAttribute('data-theme') !== mode) await page.getByRole('button', { name: mode === 'dark' ? '切换到暗色' : '切换到亮色', exact: true }).click() }
  await page.goto(`${base}${view}`, { waitUntil: 'domcontentloaded' }); const login = page.getByRole('link', { name: '前往登录', exact: true }); await login.waitFor()
  assert.equal(new URL(await login.getAttribute('href'), base).searchParams.get('returnTo'), view); assert.equal(report.requests.length, 0)
  await page.goto(`${base}/admin/refunds/0/verification`, { waitUntil: 'domcontentloaded' }); await page.getByText('退款地址无效，请从原对账差异或退款记录进入。', { exact: true }).waitFor(); assert.equal(report.requests.length, 0)
  check('Anonymous and invalid-refund routes make no private calls; valid login return preserves exact original refund')
  await page.goto(`${base}${view}`, { waitUntil: 'domcontentloaded' }); await identity(buyer); await page.getByText('当前账户没有退款核查权限。', { exact: true }).waitFor(); assert.equal(await form.count(), 0)
  check('Actual database role403 clears private refund, history and actions')
  await identity(admin); await page.locator('[data-refund-version]').waitFor(); await ready()
  await page.goto(`${base}/admin/refunds/${unapproved}/verification`, { waitUntil: 'domcontentloaded' }); await page.locator('[data-refund-version]').waitFor(); await ready()
  assert.ok(await page.locator('#verification-reason').isDisabled()); assert.ok(await page.getByRole('button', { name: '发起查询', exact: true }).isDisabled()); assert.equal(posts.length, 0)
  await page.goto(`${base}/admin/refunds`, { waitUntil: 'domcontentloaded' }); await page.locator('#refund-filter').selectOption('APPROVED'); await page.locator(`[data-refund="${refund}"]`).click()
  const workbenchLink = page.getByRole('link', { name: '核查原退款', exact: true }); await workbenchLink.waitFor(); assert.equal(await workbenchLink.getAttribute('href'), view); await workbenchLink.click(); await page.locator('[data-refund-version]').waitFor(); await ready()
  check('Original refund workbench links to exact query context; unapproved refund stays readonly and cannot bypass approval')
  await page.goto(`${base}/admin/reconciliations`, { waitUntil: 'domcontentloaded' }); await page.locator(`[data-reconciliation="${reconciliation}"]`).click()
  const originLink = page.getByRole('link', { name: '核查原退款', exact: true }); await originLink.waitFor(); assert.equal(await originLink.getAttribute('href'), view); await originLink.click()
  await page.locator('[data-refund-version]').waitFor(); await ready(); assert.equal(await page.locator('[data-refund-version]').innerText(), '2')
  await page.getByRole('region', { name: '原订单核对', exact: true }).getByText('¥39.00 / ¥0.00', { exact: true }).waitFor()
  check('Actual reconciliation difference links to its original refund and displays server amount, local payment and version')
  const history = page.getByRole('region', { name: '可滚动的核查记录', exact: true })
  assert.equal(await history.locator('[data-verification-job]').count(), 20); await page.getByText('更早记录未在本页展开，本列表不代表完整审计历史。', { exact: true }).waitFor()
  assert.ok(await history.evaluate((el) => el.clientHeight < el.scrollHeight && el.clientHeight <= 480)); await history.focus(); await page.keyboard.press('End')
  await page.waitForFunction(() => { const el = document.querySelector('.history-scroll'); return el.scrollTop + el.clientHeight >= el.scrollHeight - 2 }); await page.keyboard.press('Home')
  await page.waitForFunction(() => document.querySelector('.history-scroll').scrollTop === 0)
  await outcome.getByText('查询已完成，退款仍在处理中；本次结果不代表退款到账。', { exact: true }).waitFor()
  check('21 actual prior queries render latest20 with truncation and bounded End/Home history; DONE-PENDING is not payment success')
  const colors = {}
  for (const mode of ['light', 'dark']) {
    await page.setViewportSize({ width: 1440, height: 1000 }); await theme(mode)
    colors[mode] = await page.locator('#verification-reason').evaluate((el) => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }))
    await screenshot(`refund-verification-edge-${mode}-desktop.png`)
    const name = `refund-verification-edge-${mode}-form.png`; await form.screenshot({ path: path.join(out, name) }); report.screenshots.push(name)
    await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await page.getByRole('button', { name: '发起查询', exact: true }).click(); assert.equal(await page.evaluate(() => document.activeElement.id), 'verification-reason'); await screenshot(`refund-verification-edge-${mode}-mobile.png`)
  }
  assert.notDeepEqual(colors.light, colors.dark); await page.setViewportSize({ width: 1440, height: 1000 })
  check('Edge desktop/390px and form share both themes without horizontal overflow; header action focuses query form and confirmation stays unchecked')
  assert.equal(await form.getByRole('checkbox').isChecked(), false); await page.locator('#verification-reason').fill(text); assert.ok(await form.getByRole('button', { name: '确认提交查询', exact: true }).isDisabled())
  await form.getByRole('checkbox').check(); await page.locator('#verification-reason').fill(`${text} `); assert.equal(await form.getByRole('checkbox').isChecked(), false)
  await confirm(); await coordinate('change-version'); await form.getByRole('button', { name: '确认提交查询', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '原退款版本已改变' }).waitFor(); await ready(); assert.equal(await form.count(), 0)
  await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.locator('[data-refund-version]').waitFor(); await ready(); assert.equal(await page.locator('[data-refund-version]').innerText(), '3'); assert.equal(await form.getByRole('checkbox').isChecked(), false)
  check('Explicit consent resets on edits; real stale-version409 discards confirmation and requires fresh server version')
  await confirm(); dropBefore = true; await form.getByRole('button', { name: '确认提交查询', exact: true }).click(); await page.getByRole('button', { name: '查询原请求', exact: true }).waitFor(); await ready()
  const intent = await page.evaluate(() => sessionStorage.getItem('astra.refund-verification-command.122'))
  assert.deepEqual(Object.keys(JSON.parse(intent)).sort(), ['bodyHash', 'expectedVersion', 'key', 'refundId']); assert.ok(!intent.includes(admin) && !intent.includes(text))
  const command404 = page.waitForResponse((r) => new URL(r.url()).pathname.includes('/commands/') && r.status() === 404)
  await page.getByRole('button', { name: '查询原请求', exact: true }).click(); await command404; await ready(); assert.equal(posts.length, 2)
  assert.equal(await page.evaluate(() => sessionStorage.getItem('astra.refund-verification-command.122')), intent)
  check('Pre-acceptance network loss retains safe original UUID/hash; actual command404 preserves intent and performs no automatic POST')
  await confirm(); dropAfter = true; await form.getByRole('button', { name: '使用原标识重试', exact: true }).dblclick(); await page.getByRole('alert').filter({ hasText: '结果尚未确认' }).waitFor(); await ready()
  assert.equal(posts.length, 3); assert.deepEqual(posts[1], posts[2]); assert.equal(JSON.parse(intent).key, posts[2].key)
  check('Explicit retry retains original key/body; actual accepted200 response loss and double click create one durable query')
  await identity(other); await page.locator('[data-refund-version]').waitFor(); await ready(); assert.equal(await page.getByRole('button', { name: '查询原请求', exact: true }).count(), 0)
  assert.equal(await page.evaluate(() => sessionStorage.getItem('astra.refund-verification-command.122')), intent)
  check('Another real administrator cannot adopt the first account’s pending intent')
  await coordinate('disable-execution'); await identity(renewed); await page.getByRole('button', { name: '查询原请求', exact: true }).waitFor(); await ready()
  await page.getByRole('button', { name: '查询原请求', exact: true }).click(); await page.getByText('已查回原任务，没有新增查询。请查看后台执行状态。', { exact: true }).waitFor(); await ready()
  assert.equal(posts.length, 3); assert.equal(await page.evaluate(() => sessionStorage.getItem('astra.refund-verification-command.122')), null)
  await outcome.locator('[data-verification-state="READY"]').waitFor(); assert.ok(await form.getByRole('button', { name: '确认提交查询', exact: true }).isDisabled())
  assert.equal(await outcome.locator('.render-spinner').evaluate((el) => getComputedStyle(el).animationName), 'none')
  check('Same-account renewed JWT and disabled execution recover original query with GET only; background feedback honors reduced motion')
  await coordinate('enable-execution'); await coordinate('finish-original'); await refresh(); await outcome.locator('[data-verification-state="DONE"]').waitFor()
  await page.locator('[data-local-refund-state="FAILED"]').waitFor(); await outcome.getByText('渠道确认退款未成功', { exact: true }).waitFor(); assert.equal(await page.locator('[data-refund-version]').innerText(), '4')
  await page.locator('[data-local-order-state]').filter({ hasText: '已付款 / 已授予' }).waitFor()
  await page.getByRole('region', { name: '原退款核对', exact: true }).getByText('¥39.00 / ¥0.00', { exact: true }).waitFor()
  check('Actual trusted FAILED fact is applied without refunding money or revoking source rights; DONE is not refund success')
  await confirm(); await form.getByRole('button', { name: '确认提交查询', exact: true }).click(); await outcome.locator('[data-verification-state="READY"]').waitFor(); await ready(); await coordinate('finish-correction'); await refresh()
  await page.locator('[data-local-refund-state="SUCCEEDED"]').waitFor(); await outcome.getByText('渠道确认退款成功', { exact: true }).waitFor(); assert.equal(await page.locator('[data-refund-version]').innerText(), '5')
  await page.locator('[data-local-order-state]').filter({ hasText: '已付款 / 已撤销' }).waitFor(); await page.getByRole('region', { name: '原退款核对', exact: true }).getByText('¥39.00 / ¥39.00', { exact: true }).waitFor()
  check('Later trusted SUCCEEDED fact corrects the same original refund, writes full refund and revokes only its source entitlement')
  await confirm(); await form.getByRole('button', { name: '确认提交查询', exact: true }).click(); await outcome.locator('[data-verification-state="READY"]').waitFor(); await ready(); await coordinate('finish-repeat'); await refresh()
  await outcome.locator('[data-verification-state="DONE"]').waitFor(); assert.equal(posts.length, 5)
  check('Repeated confirmed query uses original refund; Java verifies one successful refund event and unchanged other source rights')
  await confirm(); await form.getByRole('button', { name: '确认提交查询', exact: true }).click(); await outcome.locator('[data-verification-state="READY"]').waitFor(); await ready(); await coordinate('finish-mismatch'); await refresh()
  await outcome.getByText('查询结果与原退款不一致', { exact: true }).waitFor(); await coordinate('exhaust-mismatch'); await refresh()
  await outcome.locator('[data-verification-state="DEAD"]').waitFor(); await outcome.getByText('查询已停止 · 已尝试 8 次', { exact: true }).waitFor(); await page.locator('[data-local-order-state]').filter({ hasText: '已付款 / 已撤销' }).waitFor(); assert.equal(posts.length, 6)
  check('Contradictory persisted FAILED fact renders MISMATCH then8-attempt DEAD without reversing refund or restoring revoked rights')
  const oldTask = history.locator('[data-verification-job]').last(); await oldTask.click(); await ready(); await outcome.getByText('查询已完成，退款仍在处理中；本次结果不代表退款到账。', { exact: true }).waitFor(); assert.equal(posts.length, 6)
  check('Historical task lookup is readonly and keeps its original pending observation distinct from current refund success')
  await coordinate('close-execution')
  failRead = true; await page.getByRole('button', { name: '刷新状态', exact: true }).click(); await page.getByText('测试读取暂不可用，请重试', { exact: true }).waitFor(); await ready()
  assert.equal(await page.evaluate(() => localStorage.getItem('astra_access_token')), renewed); await page.getByRole('button', { name: '重新读取', exact: true }).click(); await page.locator('[data-refund-version]').waitFor(); await ready()
  assert.ok(await form.getByRole('button', { name: '确认提交查询', exact: true }).isDisabled())
  check('Closed execution retains history; explicit read503 keeps JWT/storage, shows friendly retry and recovers real context')
  slow = true; await page.getByRole('button', { name: '刷新状态', exact: true }).click(); await page.getByText('正在读取原退款与后台状态…', { exact: true }).waitFor()
  await page.evaluate((value) => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(value), `/admin/refunds/${second}/verification`)
  await page.locator('[data-refund-version]').waitFor(); await ready(); await new Promise((resolve) => setTimeout(resolve, 1100)); slow = false
  assert.equal(await page.getByRole('region', { name: '原退款核对' }).getAttribute('data-refund-id'), second); assert.equal(await page.locator('[data-refund-version]').innerText(), '2'); assert.equal(await page.locator('[data-verification-job]').count(), 0)
  check('Same-component route change aborts slow original-refund response; another refund cannot inherit its history')
  await page.evaluate((value) => document.querySelector('#app').__vue_app__.config.globalProperties.$router.push(value), view); await page.locator('[data-refund-version]').waitFor(); await ready()
  slow = true; await page.getByRole('button', { name: '刷新状态', exact: true }).click(); await page.getByText('正在读取原退款与后台状态…', { exact: true }).waitFor()
  await page.evaluate((value) => { localStorage.setItem('astra_access_token', value); window.dispatchEvent(new StorageEvent('storage', { key: 'astra_access_token' })) }, buyer)
  await page.getByText('当前账户没有退款核查权限。', { exact: true }).waitFor(); await new Promise((resolve) => setTimeout(resolve, 1100)); slow = false
  assert.equal(await form.count(), 0); assert.equal(await outcome.count(), 0); assert.equal(posts.length, 6)
  check('Cross-tab account switch clears refund/results immediately; delayed authorized response cannot restore private UI')
  await context.close()
  const chrome = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const ctx = await chrome.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    await ctx.route((url) => url.origin !== new URL(base).origin, (route) => route.abort())
    await ctx.route('**/api/auth/me', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":503,"msg":"Owned fixture has no auth service"}' }))
    await ctx.addInitScript((value) => localStorage.setItem('astra_access_token', value), renewed)
    await ctx.route('**/api/system/**', async (route) => { assert.equal(route.request().method(), 'GET'); const url = new URL(route.request().url()), response = await route.fetch({ url: `${backend}${url.pathname}${url.search}` }); capture('GET', url.pathname, response, await response.json()); await route.fulfill({ response }) })
    const cp = await ctx.newPage(); cp.on('pageerror', (error) => report.pageErrors.push(error.message)); await cp.goto(`${base}${view}`, { waitUntil: 'domcontentloaded' }); await cp.locator('[data-refund-version]').waitFor()
    for (const mode of ['light', 'dark']) { await cp.setViewportSize({ width: 1440, height: 1000 }); if (await cp.locator('html').getAttribute('data-theme') !== mode) await cp.getByRole('button', { name: mode === 'dark' ? '切换到暗色' : '切换到亮色', exact: true }).click(); await cp.setViewportSize({ width: 390, height: 844 }); assert.ok(await cp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); const name = `refund-verification-chrome-${mode}-mobile.png`; await cp.screenshot({ path: path.join(out, name), fullPage: true }); report.screenshots.push(name) }
    await ctx.close()
  } finally { await chrome.close() }
  check('Chrome390px reads actual original refund and protected history in both themes with no financial writes')
  assert.deepEqual(report.pageErrors, []); report.passed = true
} finally { await writeFile(path.join(out, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`); await browser.close() }
