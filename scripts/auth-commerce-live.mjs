import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_AUTH_PREVIEW_URL
const backend = process.env.ASTRA_AUTH_API_URL
const inbox = process.env.ASTRA_AUTH_INBOX_URL
const inboxToken = process.env.ASTRA_AUTH_INBOX_TOKEN
const email = process.env.ASTRA_AUTH_TEST_EMAIL
const password = process.env.ASTRA_AUTH_TEST_PASSWORD
const resetPassword = process.env.ASTRA_AUTH_RESET_PASSWORD
const otherEmail = process.env.ASTRA_AUTH_OTHER_EMAIL
const out = process.env.ASTRA_AUTH_OUTPUT
const variant = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
assert(base && backend && inbox && inboxToken && email && password && resetPassword && otherEmail && out, 'Owned Java fixture required')
for (const value of [base, backend, inbox]) assert.equal(new URL(value).hostname, '127.0.0.1')
assert(email.endsWith('@example.test') && otherEmail.endsWith('@example.test'))
const secrets = new Set([inboxToken, password, resetPassword])
function redact(value) {
  let text = String(value)
  for (const secret of secrets) text = text.split(secret).join('[redacted]')
  return text.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted-token]')
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const fixtures = 'docs/validation/2026-10-09/creative-workflow-package/core-edge/source'
const expectedWorkflow = await readFile(fixtures + '.astra-workflow')
const expectedSignature = await readFile(fixtures + '.astra-signature')
await mkdir(out, { recursive: true })
const mobile = variant === 'mobile'
const browser = await chromium.launch({ channel: mobile ? 'msedge' : variant, headless: true })
const report = {
  passed: false,
  scope: 'Actual auth password login/gateway/system/MySQL/Redis/TLS SMTP/private files; only the isolated external merchant ledger is simulated; no success API mocks',
  browser: browser.version(), mobile, checks: [], requests: [], errors: [],
}
const check = (name) => report.checks.push(name)
let page, paymentId
async function state() {
  return page.evaluate(async () => {
    const rows = await new Promise((resolve, reject) => {
      const request = indexedDB.open('astra-art-projects', 2)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['projects', 'signature-projects', 'creative-index'])
        const reads = ['projects', 'signature-projects', 'creative-index'].map((name) => tx.objectStore(name).getAll())
        tx.oncomplete = () => { db.close(); resolve(reads.map((read) => read.result)) }
        tx.onabort = () => { db.close(); reject(tx.error) }
      }
      request.onerror = () => reject(request.error)
    })
    return Promise.all(rows.map(async (entries) => Promise.all(entries.sort((a, b) => a.id.localeCompare(b.id)).map(async (entry) => {
      const result = { ...entry }
      if (typeof result.thumbnail === 'string') result.thumbnail = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(result.thumbnail))),
        (n) => n.toString(16).padStart(2, '0'),
      ).join('')
      for (const key of ['file', 'source']) if (result[key] instanceof Blob) {
        const file = result[key]
        result[key] = { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified,
          sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())), (n) => n.toString(16).padStart(2, '0')).join('') }
      }
      return result
    }))))
  })
}
async function api(method, route, token, body, expected = 200, code = 0) {
  const response = await fetch(backend + route, { method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  if (data.data?.ticket) secrets.add(data.data.ticket)
  report.requests.push({ source: 'test-actor', method, path: route.split('?')[0], status: response.status, businessCode: data.code })
  assert.equal(response.status, expected); assert.equal(data.code, code)
  return data.data
}
async function login(mailbox, credential) {
  await page.goto(base + '/login?returnTo=/account/orders', { waitUntil: 'domcontentloaded' })
  await page.locator('input[name=email]').fill(mailbox)
  await page.locator('input[name=password]').fill(credential)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await Promise.race([page.waitForURL(base + '/account/orders'), page.locator('.captcha-shot img').waitFor()]).catch(() => {})
  if (await page.locator('.captcha-shot img').count()) {
    const svg = Buffer.from((await page.locator('.captcha-shot img').getAttribute('src')).split(',')[1], 'base64').toString('utf8')
    const proof = [...svg.matchAll(/<text[^>]*>([A-Z0-9])<\/text>/g)].map((match) => match[1]).join('')
    assert(proof.length >= 4); secrets.add(proof)
    await page.locator('input[name=captcha]').fill(proof)
    await page.getByRole('button', { name: '继续', exact: true }).click()
  }
  await page.waitForURL(base + '/account/orders', { timeout: 20000 })
  const token = await page.evaluate(() => localStorage.getItem('astra_access_token'))
  assert(token); secrets.add(token); return token
}
try {
  const context = await browser.newContext({ acceptDownloads: true,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
    isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' })
  await context.route((url) => url.origin !== new URL(base).origin, (route) => route.abort())
  await context.route(base + '/api/**', async (route) => {
    try {
      const request = route.request(), url = new URL(request.url())
      if (url.pathname.endsWith('/download')) {
        assert.equal(request.headers().authorization, undefined)
        secrets.add(url.searchParams.get('ticket'))
      }
      const response = await route.fetch({ url: backend + url.pathname + url.search, maxRedirects: 0, timeout: 20000 })
      const contentType = response.headers()['content-type'] || ''
      const data = contentType.includes('application/json') ? await response.json() : null
      if (data?.data?.accessToken) secrets.add(data.data.accessToken)
      if (data?.data?.ticket) secrets.add(data.data.ticket)
      if (request.method() === 'POST' && /\/orders\/\d+\/payments$/.test(url.pathname)) paymentId = data?.data?.id
      report.requests.push({ source: 'browser', method: request.method(), path: url.pathname, status: response.status(), ...(data ? { businessCode: data.code } : { sha256: hash(await response.body()) }) })
      await route.fulfill({ response })
    } catch (error) { report.errors.push(redact(error.message)); await route.abort('failed').catch(() => {}) }
  })
  page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push(redact(error.message)))
  await page.goto(base + '/collections/auth-workflow', { waitUntil: 'domcontentloaded' })
  const area = page.locator('[data-order-confirmation]')
  await area.getByRole('link', { name: '登录后继续 ↗' }).waitFor()
  assert.equal(report.requests.filter((r) => r.method === 'POST').length, 0)
  const oldToken = await login(email, password)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '退出', exact: true }).waitFor()
  assert(report.requests.some((r) => r.path === '/api/auth/me' && r.businessCode === 0))
  check('Anonymous product is read-only; actual password login and auth/me restore the verified buyer')

  // Preserve a pre-existing free creation through the purchased import.
  await page.goto(base + '/templates', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-template="orbital-light"]').getByRole('button').first().click()
  await page.getByRole('button', { name: '用这个模板创作' }).click()
  await page.waitForURL((url) => url.pathname === '/ascii-art')
  const original = await state(); assert.equal(original[0].length, 1)
  await page.goto(base + '/collections/auth-workflow', { waitUntil: 'domcontentloaded' })
  await area.getByRole('button', { name: '核对版本与条款' }).click()
  const create = area.getByRole('button', { name: '确认并创建订单' })
  assert(await create.isDisabled()); assert.equal(await area.locator('details[open]').count(), 3)
  assert.match(await area.innerText(), /¥39.00/)
  await area.getByRole('checkbox').check(); await create.click()
  await page.locator('[data-confirmed-order]').waitFor()
  const orderHref = await area.getByRole('link', { name: '查看订单详情 ↗' }).getAttribute('href')
  assert.equal(report.requests.filter((r) => r.method === 'POST' && r.path === '/api/system/orders').length, 1)
  check('Backend price and three frozen policies precede explicit consent and exactly one actual order POST')

  await area.getByRole('link', { name: '查看订单详情 ↗' }).click()
  await page.getByRole('button', { name: '核对模拟付款请求', exact: true }).click()
  const form = page.locator('[data-payment-confirmation]')
  const pay = form.getByRole('button', { name: '确认创建模拟付款记录' })
  assert(await pay.isDisabled()); assert.equal(await form.locator('details[open]').count(), 3)
  await form.getByRole('checkbox').check(); await pay.click()
  await page.locator('[data-payment-state]').waitFor()
  assert(paymentId)
  assert.equal(report.requests.filter((r) => r.method === 'POST' && r.path.endsWith('/payments')).length, 1)
  check('Explicit mock-only consent creates one payment record through the real authenticated API')
  const settled = await fetch(inbox + '/settle/' + paymentId, { method: 'POST', headers: { Authorization: 'Bearer ' + inboxToken } })
  assert.equal(settled.status, 204)
  await page.getByRole('button', { name: '刷新订单状态', exact: true }).click()
  await page.getByText('后台已确认付款', { exact: true }).waitFor()
  await page.getByRole('link', { name: '前往已购内容领取 ↗' }).click()
  const workflow = page.locator('[data-asset="189304737000010304"]')
  const signature = page.locator('[data-asset="189304737000010305"]')
  await workflow.waitFor()
  check('The scheduled backend worker verifies the isolated merchant fact and grants the purchase before library access')

  const idle = () => page.waitForFunction(() => !document.querySelector('.transfer-status'))
  async function download(asset, expected, filename) {
    const pending = page.waitForEvent('download')
    await asset.getByRole('button', { name: '下载文件', exact: true }).click()
    const item = await pending; assert(item.suggestedFilename().endsWith(path.extname(filename)))
    await item.saveAs(path.join(out, filename)); assert.equal(hash(await readFile(path.join(out, filename))), hash(expected)); await idle()
  }
  await download(workflow, expectedWorkflow, 'received.astra-workflow'); assert.deepEqual(await state(), original)
  check('Real-auth private workflow delivery has exact hash and extension and does not write a local project')
  await workflow.getByRole('button', { name: '导入完整工作流', exact: true }).click(); await idle()
  await page.getByText('工作流已导入，', { exact: false }).waitFor()
  const saved = await state(); assert.equal(saved[0].length, 2); assert.equal(saved[1].length, 1); assert.equal(saved[2].length, 3)
  assert.deepEqual(saved[0].find((p) => p.id === original[0][0].id), original[0][0])
  assert.equal(saved[0].find((p) => p.workflowKey).origin.projectId, saved[1][0].id)
  await workflow.getByRole('button', { name: '导入完整工作流', exact: true }).click(); await idle()
  await page.getByText('此工作流版本已导入', { exact: false }).waitFor(); assert.deepEqual(await state(), saved)
  check('Workflow import atomically links both originals while preserving the free project and deduplicating a repeated claim')
  await download(signature, expectedSignature, 'received.astra-signature')
  await signature.getByRole('button', { name: '导入签名原作', exact: true }).click(); await idle()
  await page.getByText('签名原作已保存', { exact: false }).waitFor(); assert.deepEqual(await state(), saved)
  assert.equal(saved[1][0].file.sha256, hash(expectedSignature))
  check('Private signature download matches the original hash and separate import reuses the already saved original')

  await page.waitForFunction(() => !document.querySelector('.el-message'))
  for (const theme of ['dark', 'light']) {
    if (await page.evaluate((value) => document.documentElement.classList.contains('dark') !== (value === 'dark'), theme))
      await page.getByRole('button', { name: theme === 'dark' ? '切换到暗色' : '切换到亮色', exact: true }).click()
    await page.evaluate(async () => {
      await new Promise(requestAnimationFrame)
      await Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {})))
    })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    for (const button of await page.locator('.file-actions button').all()) {
      const box = await button.boundingBox(); assert(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= (mobile ? 391 : 1441))
    }
    await page.screenshot({ path: path.join(out, `library-${theme}.png`), fullPage: true })
  }
  assert(await page.evaluate(() => Object.values(localStorage).every((value) => !value.includes('?ticket='))))
  check('Desktop or touch controls fit both themes, screenshots contain no credentials, and tickets are not persisted in local storage')

  const ticket = await api('POST', '/api/system/assets/189304737000010304/download-ticket', oldToken)
  await api('POST', '/api/auth/password/forgot', null, { account: email })
  const mail = await fetch(inbox + '/inbox/' + encodeURIComponent(email), { headers: { Authorization: 'Bearer ' + inboxToken } })
  assert.equal(mail.status, 200); const proof = await mail.text(); assert(/^\d{6}$/.test(proof)); secrets.add(proof)
  await api('POST', '/api/auth/password/reset', null, { account: email, code: proof, newPassword: resetPassword })
  await api('GET', '/api/auth/me', oldToken, null, 401, 401)
  await api('GET', ticket.downloadPath + '?ticket=' + ticket.ticket, null, null, 410, 44001)
  check('Actual mailbox reset revokes the old auth-issued JWT and its previously issued standalone download ticket')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('link', { name: '前往登录' }).waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('astra_access_token')), null)
  const freshToken = await login(email, resetPassword)
  await page.goto(base + '/account/library', { waitUntil: 'domcontentloaded' }); await workflow.waitFor()
  await download(workflow, expectedWorkflow, 'reclaimed.astra-workflow'); assert.deepEqual(await state(), saved)
  check('Real auth/me401 clears the old frontend session; new-password login restores retained paid rights and leaves saved local projects intact')

  const otherToken = await login(otherEmail, password)
  await api('GET', '/api/system/orders/' + orderHref.split('/').at(-1), otherToken, null, 404, 404)
  await api('POST', '/api/system/assets/189304737000010304/download-ticket', otherToken, null, 404, 404)
  await page.goto(base + '/account/library', { waitUntil: 'domcontentloaded' })
  await page.locator('p.account-notice').filter({ hasText: '还没有已购内容' }).waitFor()
  assert.equal(await page.locator('[data-asset]').count(), 0); assert.deepEqual(await state(), saved)
  check('A second real login cannot read the buyer order or claim its asset; the current account library contains no paid items')
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await page.getByRole('link', { name: '前往登录' }).waitFor()
  await api('GET', '/api/system/orders', otherToken, null, 401, 401)
  await api('GET', '/api/system/orders', freshToken)
  assert.equal(await page.evaluate(() => localStorage.getItem('astra_access_token')), null)
  check('Actual logout blacklists only the departing session; backend rejects it and the buyer remains authorized')
  assert.equal(report.checks.length, 12); assert.deepEqual(report.errors, []); report.passed = true
} catch (error) {
  report.failure = redact(error.stack || error)
  await page?.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {})
  throw new Error(report.failure)
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
