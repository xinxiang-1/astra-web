import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_RECONCILIATION_PREVIEW_URL, backend = process.env.ASTRA_RECONCILIATION_API_URL
const admin = process.env.ASTRA_RECONCILIATION_ADMIN_TOKEN, renewed = process.env.ASTRA_RECONCILIATION_RENEWED_TOKEN
const other = process.env.ASTRA_RECONCILIATION_OTHER_ADMIN_TOKEN, buyer = process.env.ASTRA_RECONCILIATION_BUYER_TOKEN
const id = process.env.ASTRA_RECONCILIATION_ID, date = process.env.ASTRA_RECONCILIATION_DATE, out = process.env.ASTRA_RECONCILIATION_OUTPUT
assert.ok(base && backend && admin && renewed && other && buyer && id && date && out)
assert.equal(new URL(base).hostname, '127.0.0.1'); assert.equal(new URL(backend).hostname, '127.0.0.1')
await mkdir(out, { recursive: true })
const root = '/api/system/admin/reconciliations'
const report = { passed: false, scope: 'Built frontend + owned gateway/system/MySQL/Redis; mock statements; auth/me explicitly simulated503', checks: [], requests: [], injectedFailures: [], pageErrors: [], screenshots: [] }
const check = (text) => { report.checks.push(text); console.log(text) }
const capture = (method, url, response, body) => report.requests.push({ method, path: url, status: response.status(), body, headers: { cacheControl: response.headers()['cache-control'], requestId: response.headers()['x-request-id'], retryAfter: response.headers()['retry-after'] ?? '' }, viaGateway: true })
const coordinate = async (phase) => {
  await writeFile(path.join(out, `${phase}.request`), 'request')
  for (let i = 0; i < 150; i++) { try { await access(path.join(out, `${phase}.ack`)); return } catch { await new Promise((resolve) => setTimeout(resolve, 100)) } }
  throw new Error(`Owned worker coordination timeout: ${phase}`)
}
let drop = false, slow = false, failRead = false, shortPages = false
const posts = []
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })
  await context.route((url) => url.origin !== new URL(base).origin, (route) => route.abort())
  await context.route('**/api/auth/me', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":503,"msg":"Owned fixture has no auth service"}' }))
  const page = await context.newPage(); page.on('pageerror', (error) => report.pageErrors.push(error.message))
  await page.route('**/api/system/**', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method()
    assert.ok(method === 'GET' || (method === 'POST' && new RegExp(`^${root}/[0-9-]+/runs$`).test(url.pathname)), 'No unrelated financial writes')
    if (method === 'POST') posts.push({ key: request.headers()['idempotency-key'], body: request.postDataJSON(), path: url.pathname })
    if (failRead && url.pathname === `${root}/access`) {
      failRead = false; report.injectedFailures.push({ kind: 'read503', path: url.pathname })
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":503,"msg":"测试读取暂不可用，请重试"}' }); return
    }
    // Only reduce the real server page size to exercise a signed cursor with three actual persisted jobs.
    const forwarded = new URL(url)
    if (shortPages && method === 'GET' && url.pathname === root) forwarded.searchParams.set('limit', '1')
    const response = await route.fetch({ url: `${backend}${forwarded.pathname}${forwarded.search}` }), body = await response.json()
    capture(method, url.pathname, response, body)
    if (method === 'POST' && drop) {
      assert.equal(response.status(), 200); drop = false
      report.injectedFailures.push({ kind: 'accepted200-run-response-lost', path: url.pathname }); await route.abort('failed'); return
    }
    if (slow && url.pathname === `${root}/${id}`) await new Promise((resolve) => setTimeout(resolve, 900))
    await route.fulfill({ response })
  })
  const identity = async (token) => { await page.evaluate((value) => localStorage.setItem('astra_access_token', value), token); await page.reload({ waitUntil: 'domcontentloaded' }) }
  const row = page.locator(`[data-reconciliation="${id}"]`), area = page.getByRole('region', { name: '对账报告详情' }), form = page.getByRole('region', { name: '新建或重新核对' })
  const ready = () => page.locator('.admin-content[aria-busy="false"]').waitFor()
  const shot = async (name) => {
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: path.join(out, name), fullPage: true }); report.screenshots.push(name)
  }
  const theme = async (mode) => { if (await page.locator('html').getAttribute('data-theme') !== mode) await page.getByRole('button', { name: mode === 'dark' ? '切换到暗色' : '切换到亮色', exact: true }).click() }
  await page.goto(`${base}/admin/reconciliations`, { waitUntil: 'domcontentloaded' })
  const login = page.getByRole('link', { name: '前往登录', exact: true }); await login.waitFor()
  assert.equal(report.requests.length, 0); assert.equal(new URL(await login.getAttribute('href'), base).searchParams.get('returnTo'), '/admin/reconciliations')
  check('Anonymous page sends no private reconciliation calls and preserves exact login return')
  await identity(buyer); await page.getByText('当前账户没有对账管理权限。', { exact: true }).waitFor(); assert.equal(await row.count(), 0); assert.equal(posts.length, 0)
  check('Actual database role403 hides private records and operator actions')
  await identity(admin); await row.waitFor(); await row.click(); await area.locator('[data-reconcile-state="DONE"]').waitFor(); await ready()
  await area.getByText('发现23项差异，需进一步核查', { exact: true }).waitFor(); await area.getByRole('cell', { name: '¥897.00 23笔' }).waitFor()
  assert.equal(await area.locator('[data-reconcile-issue]').count(), 20); await area.getByRole('button', { name: '加载更多差异', exact: true }).click(); await ready()
  assert.equal(await area.locator('[data-reconcile-issue]').count(), 23)
  const issueIds = await area.locator('[data-reconcile-issue]').evaluateAll((rows) => rows.map((r) => r.dataset.reconcileIssue)); assert.equal(new Set(issueIds).size, 23)
  assert.equal(await area.getByRole('button', { name: '加载更多差异', exact: true }).count(), 0)
  check('Backend numeric totals and all23 paginated differences render without duplication; DONE remains an issue report')
  const issueList = area.getByRole('region', { name: '差异记录列表', exact: true })
  await issueList.getByText(`差异编号 ${issueIds[22]}`, { exact: true }).waitFor()
  await page.getByText('已读取 23 / 23 项，列表可滚动查看。', { exact: true }).waitFor()
  const bounded = await issueList.evaluate((el) => el.clientHeight < el.scrollHeight && el.clientHeight <= 562)
  assert.ok(bounded); await issueList.focus(); await page.keyboard.press('End')
  await page.waitForFunction(() => { const el = document.querySelector('.issue-scroll'); return el.scrollTop + el.clientHeight >= el.scrollHeight - 2 })
  await page.keyboard.press('Home'); await page.waitForFunction(() => document.querySelector('.issue-scroll').scrollTop === 0)
  check('All23 safe issue identifiers remain readable in a bounded keyboard-scrollable list; End/Home reach both ends')
  const colors = {}
  for (const mode of ['light', 'dark']) {
    await theme(mode); colors[mode] = await page.locator('.queue select').evaluate((el) => ({ background: getComputedStyle(el).backgroundColor, optionBackground: getComputedStyle(el.options[0]).backgroundColor, optionColor: getComputedStyle(el.options[0]).color }))
    await shot(`reconciliation-edge-${mode}-desktop.png`)
    const formShot = `reconciliation-edge-${mode}-form.png`
    await form.screenshot({ path: path.join(out, formShot) }); report.screenshots.push(formShot)
    await page.getByRole('button', { name: '发起核对', exact: true }).click(); assert.ok(await form.getByLabel('核对的账单日').evaluate((el) => document.activeElement === el))
    await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await shot(`reconciliation-edge-${mode}-mobile.png`); await page.setViewportSize({ width: 1440, height: 1000 })
  }
  assert.notEqual(colors.light.optionBackground, colors.dark.optionBackground); assert.notEqual(colors.light.optionColor, colors.dark.optionColor)
  await page.locator('.queue select').selectOption('DONE'); await page.getByRole('button', { name: '应用筛选', exact: true }).click(); await ready()
  assert.equal(await page.locator('[data-reconciliation]').count(), 1)
  check('Native themed dropdown filtering; Edge desktop/390px in both themes, keyboard-focusable controls and reduced motion')
  const earlier = new Date(`${date}T00:00:00Z`); earlier.setUTCDate(earlier.getUTCDate() - 20); const newDate = earlier.toISOString().slice(0, 10)
  await form.getByLabel('核对的账单日').fill(newDate); await form.getByRole('button', { name: '核对当天状态', exact: true }).click(); await ready()
  await page.locator('[data-confirmed-generation]').getByText(`确认 ${newDate}，当前第0轮；将提交第1轮。`, { exact: true }).waitFor()
  const submit = form.getByRole('button', { name: '确认提交核对', exact: true }), reason = form.getByLabel('核对说明（5至500字）'), consent = form.getByRole('checkbox')
  assert.ok(await submit.isDisabled()); assert.ok(!await consent.isChecked()); await reason.fill('短'); await consent.check(); assert.ok(await submit.isDisabled())
  await reason.fill('核查历史账单并保留完整报告'); await consent.uncheck(); assert.ok(await submit.isDisabled())
  check('Reads server date/current generation before allowing a5–500-character reason and explicit unchecked confirmation')
  drop = true; await consent.check(); await submit.dblclick(); await page.getByRole('alert').waitFor(); assert.equal(posts.length, 1)
  const pending = await page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('astra.reconcile-command.')))
  assert.equal(pending.length, 1); assert.ok(!JSON.stringify(pending).includes(admin) && !JSON.stringify(pending).includes('历史账单'))
  await identity(renewed); await page.getByRole('region', { name: '待确认对账操作' }).waitFor(); await ready()
  await page.getByRole('button', { name: '查询原任务', exact: true }).click(); await area.locator('[data-reconcile-state="READY"]').waitFor(); await ready()
  assert.equal(posts.length, 1); assert.equal(await page.getByRole('region', { name: '待确认对账操作' }).count(), 0)
  const original = report.requests.find((r) => r.method === 'POST' && r.status === 200).body.data.job.id
  assert.ok(report.requests.some((r) => r.path.includes('/commands/') && r.status === 200 && r.body.data.job.id === original))
  check('Accepted response loss/double click creates one task; reload and renewed JWT recover original viaGET without stored reason/token or anotherPOST')
  await coordinate('finish-original'); await area.getByRole('button', { name: '刷新报告', exact: true }).click(); await area.locator('[data-reconcile-state="DONE"]').waitFor(); await ready()
  await area.getByText('本轮未发现差异', { exact: true }).waitFor()
  check('Actual owned worker completes original queued job; manual refresh displays persisted immutable result')
  await form.getByLabel('核对的账单日').fill(date); await form.getByRole('button', { name: '核对当天状态', exact: true }).click(); await ready()
  await reason.fill('核对新一轮差异但保留历史报告'); await consent.check()
  const competing = await context.request.post(`${backend}${root}/${date}/runs`, { headers: { Authorization: `Bearer ${other}`, 'Idempotency-Key': crypto.randomUUID() }, data: { expectedGeneration: 1, reason: '另一管理员发起新一轮核对' } })
  const competingBody = await competing.json(); capture('POST', `${root}/${date}/runs`, competing, competingBody); assert.equal(competing.status(), 200)
  await form.getByRole('button', { name: '确认提交核对', exact: true }).click(); await page.getByText('对账代次已改变，请刷新后重新确认', { exact: true }).waitFor(); await ready()
  assert.ok(report.requests.some((r) => r.status === 409 && r.body.code === 43008)); assert.ok(await form.getByRole('button', { name: '确认提交核对', exact: true }).isDisabled())
  await form.getByRole('button', { name: '核对当天状态', exact: true }).click(); await page.getByText('当天任务仍在后台执行，请查看原任务，结束后再重核。', { exact: true }).waitFor(); await ready()
  assert.equal(posts.length, 2)
  check('Real competing administrator causes43008; old confirmation is discarded and active next generation blocks rerun')
  await coordinate('disable-execution'); await page.reload({ waitUntil: 'domcontentloaded' }); await page.getByText('后台当前关闭执行，既有报告仍可查看。', { exact: true }).waitFor(); await ready()
  assert.ok(await form.getByRole('button', { name: '核对当天状态', exact: true }).isDisabled()); await row.click(); await area.getByText('发现23项差异，需进一步核查', { exact: true }).waitFor(); await ready()
  await area.getByText('核对已完成 · 第1轮 / 最新第2轮', { exact: true }).waitFor()
  check('Actual backend execution switch disables creation while original23-issue history remains readable with latest generation2')
  shortPages = true
  await page.locator('.queue select').selectOption(''); await page.getByRole('button', { name: '应用筛选', exact: true }).click(); await ready()
  assert.equal(await page.locator('[data-reconciliation]').count(), 1)
  await page.locator('.queue select').selectOption('DEAD')
  await page.getByRole('button', { name: '加载更多任务', exact: true }).click(); await ready()
  assert.equal(await page.locator('[data-reconciliation]').count(), 2)
  await page.getByRole('button', { name: '加载更多任务', exact: true }).click(); await ready()
  assert.equal(await page.locator('[data-reconciliation]').count(), 3)
  assert.equal(await page.getByRole('button', { name: '加载更多任务', exact: true }).count(), 0)
  assert.equal(await page.getByRole('alert').count(), 0)
  check('Editing an unapplied filter keeps the original signed cursor; all three real jobs load without duplicates or400')
  shortPages = false; await page.locator('.queue select').selectOption('DONE')
  failRead = true; await page.getByRole('button', { name: '刷新列表', exact: true }).click(); await page.getByText('测试读取暂不可用，请重试', { exact: true }).waitFor(); await ready()
  assert.equal(await page.evaluate(() => localStorage.getItem('astra_access_token')), renewed)
  await page.getByRole('button', { name: '重新读取', exact: true }).click(); await row.waitFor(); await ready()
  check('Explicit read503 injection provides retry, retains JWT and never substitutes local success data')
  slow = true; await row.click(); await page.getByText('正在读取报告和差异…', { exact: true }).waitFor()
  await page.evaluate((value) => { localStorage.setItem('astra_access_token', value); window.dispatchEvent(new StorageEvent('storage', { key: 'astra_access_token' })) }, buyer)
  await page.getByText('当前账户没有对账管理权限。', { exact: true }).waitFor(); await new Promise((resolve) => setTimeout(resolve, 1100)); slow = false
  assert.equal(await area.count(), 0); assert.equal(await row.count(), 0); assert.equal(posts.length, 2)
  check('Delayed previously authorized response cannot restore private report after cross-tab account switch')
  const buyerRoleProbe = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/system/admin/access' && response.status() === 403)
  await page.goto(`${base}/account/orders`, { waitUntil: 'domcontentloaded' }); await page.getByRole('heading', { name: '我的订单', exact: true }).waitFor(); await buyerRoleProbe
  assert.equal(await page.getByRole('link', { name: '每日对账 ↗', exact: true }).count(), 0)
  await identity(renewed); await page.getByRole('link', { name: '每日对账 ↗', exact: true }).waitFor()
  check('Account discovers operator entry from database role; buyer does not get it')
  await context.close()
  const chrome = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const ctx = await chrome.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
    await ctx.route((url) => url.origin !== new URL(base).origin, (route) => route.abort())
    await ctx.route('**/api/auth/me', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: '{"code":503,"msg":"Owned fixture has no auth service"}' }))
    await ctx.addInitScript((value) => localStorage.setItem('astra_access_token', value), renewed)
    await ctx.route('**/api/system/**', async (route) => { assert.equal(route.request().method(), 'GET'); const url = new URL(route.request().url()), response = await route.fetch({ url: `${backend}${url.pathname}${url.search}` }); const body = await response.json(); capture('GET', url.pathname, response, body); await route.fulfill({ response }) })
    const cp = await ctx.newPage(); cp.on('pageerror', (error) => report.pageErrors.push(error.message))
    await cp.goto(`${base}/admin/reconciliations`, { waitUntil: 'domcontentloaded' }); await cp.locator(`[data-reconciliation="${id}"]`).click(); await cp.getByText('发现23项差异，需进一步核查', { exact: true }).waitFor()
    assert.ok(await cp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    for (const mode of ['light', 'dark']) { await cp.setViewportSize({ width: 1440, height: 1000 }); if (await cp.locator('html').getAttribute('data-theme') !== mode) await cp.getByRole('button', { name: mode === 'dark' ? '切换到暗色' : '切换到亮色', exact: true }).click(); await cp.setViewportSize({ width: 390, height: 844 }); await cp.evaluate(() => window.scrollTo(0, 0)); const name = `reconciliation-chrome-${mode}-mobile.png`; await cp.screenshot({ path: path.join(out, name), fullPage: true }); report.screenshots.push(name) }
    await ctx.close()
  } finally { await chrome.close() }
  check('Chrome390px reads real protected reports in both themes, creation stays closed, no financial writes')
  assert.deepEqual(report.pageErrors, [])
  report.passed = true
} finally {
  await writeFile(path.join(out, 'browser-report.json'), `${JSON.stringify(report, null, 2)}\n`)
  await browser.close()
}
