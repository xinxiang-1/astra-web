import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:4210'
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  out = `test-results/auth-ui-${channel}`
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel, headless: true }),
  report = {
    browser: browser.version(),
    cases: [],
    errors: [],
    scope:
      'Production App/AuthView/two-tab storage with controlled API responses; no real OAuth/payment',
  }
const payload = (id) => ({
  accessToken: 'public-test-token-' + id,
  expiresIn: 7200,
  user: { id, nickname: id, email: id + '@example.com' },
})
const ok = (route, data) =>
  route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ code: 0, msg: 'ok', data }),
  })
try {
  const context = await browser.newContext()
  await context.addInitScript(() => {
    const native = window.fetch
    window.__authAborts = []
    window.fetch = (url, init) => {
      if (String(url).startsWith('/api/auth/'))
        init?.signal?.addEventListener('abort', () => window.__authAborts.push(String(url)), {
          once: true,
        })
      return native(url, init)
    }
  })
  await context.route('**/api/auth/me', (r) =>
    ok(r, payload(r.request().headers().authorization?.endsWith('B') ? 'B' : 'A').user),
  )
  await context.route('**/api/system/**', (r) =>
    ok(r, { items: [], nextCursor: null, role: 'BUYER' }),
  )
  const page = await context.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/login?returnTo=/projects', { waitUntil: 'domcontentloaded' })
  let held, announce
  const requested = new Promise((r) => (announce = r))
  await page.route('**/api/auth/login/email', (r) => {
    held = r
    announce()
  })
  await page.getByRole('tab', { name: '邮箱', exact: true }).click()
  await page.locator('input[name=email]').fill('test@example.com')
  await page.locator('input[name=code]').fill('123456')
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await requested
  await page.getByRole('tab', { name: '密码', exact: true }).click()
  await page.waitForFunction(() => window.__authAborts.includes('/api/auth/login/email'))
  await ok(held, payload('A')).catch(() => {})
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => localStorage.getItem('astra_access_token')), null)
  assert(page.url().includes('/login'))
  report.cases.push('tab-change-aborts-login-and-late-navigation')
  await page.route('**/api/auth/wechat/session', (r) =>
    ok(r, { ticket: 'public-ticket', status: 'waiting', expireSeconds: 120 }),
  )
  let poll, notify
  const polled = new Promise((r) => (notify = r))
  await page.route('**/api/auth/wechat/session/public-ticket', (r) => {
    poll = r
    notify()
  })
  await page.getByRole('button', { name: '微信扫码登录', exact: true }).click()
  await polled
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.waitForFunction(() =>
    window.__authAborts.includes('/api/auth/wechat/session/public-ticket'),
  )
  await ok(poll, {
    ticket: 'public-ticket',
    status: 'confirmed',
    expireSeconds: 120,
    token: payload('A'),
  }).catch(() => {})
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => localStorage.getItem('astra_access_token')), null)
  assert(page.url().includes('/login') && !page.url().includes('/wechat'))
  report.cases.push('leave-wechat-aborts-poll-and-rejects-confirmation')
  const other = await context.newPage()
  other.on('pageerror', (e) => report.errors.push(e.message))
  await other.goto(base + '/account/library', { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    (token) => localStorage.setItem('astra_access_token', token),
    payload('B').accessToken,
  )
  await other.waitForFunction(() => !document.body.innerText.includes('登录后查看'))
  await other.goto(base + '/gallery', { waitUntil: 'domcontentloaded' })
  await other.getByRole('button', { name: '退出', exact: true }).waitFor()
  await page.evaluate(() => localStorage.clear())
  await other.getByRole('link', { name: '登录', exact: true }).waitFor()
  report.cases.push('production-storage-token-and-clear-cross-tab')
  await other.screenshot({ path: out + '/logged-out.png' })
  assert.deepEqual(report.errors, [])
  console.log(JSON.stringify(report))
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
