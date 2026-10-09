import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.ASTRA_AUTH_PREVIEW_URL
const backend = process.env.ASTRA_AUTH_API_URL
const inbox = process.env.ASTRA_AUTH_INBOX_URL
const inboxToken = process.env.ASTRA_AUTH_INBOX_TOKEN
const run = process.env.ASTRA_AUTH_TEST_RUN
const password = process.env.ASTRA_AUTH_TEST_PASSWORD
const out = process.env.ASTRA_AUTH_OUTPUT
const variant = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
assert(
  base && backend && inbox && inboxToken && run && password && out,
  'Owned Java auth fixture required',
)
for (const address of [base, backend, inbox]) assert.equal(new URL(address).hostname, '127.0.0.1')
assert(/^[a-f0-9]{12}$/.test(run))
await mkdir(out, { recursive: true })
const secrets = new Set([inboxToken, password])
const redact = (value) => {
  let text = String(value)
  for (const secret of secrets) text = text.split(secret).join('[redacted]')
  return text.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted-token]')
}
const mobile = variant === 'mobile'
const browser = await chromium.launch({ channel: mobile ? 'msedge' : variant, headless: true })
const report = {
  passed: false,
  scope:
    'Production frontend transported to owned real auth/gateway/system and TLS SMTP inbox; no API success mocks or real funds',
  browser: browser.version(),
  mobile,
  checks: [],
  requests: [],
  errors: [],
}
const check = (name) => report.checks.push(name)
let context, page
try {
  context = await browser.newContext(
    mobile
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1280, height: 960 } },
  )
  await context.addInitScript(() => {
    const native = window.fetch
    window.__authCodeAborts = []
    window.fetch = (url, init) => {
      if (String(url).includes('/api/auth/email/send'))
        init?.signal?.addEventListener('abort', () => window.__authCodeAborts.push(String(url)), {
          once: true,
        })
      return native(url, init)
    }
  })
  async function transport(route) {
    const request = route.request()
    const url = new URL(request.url())
    const response = await route.fetch({ url: backend + url.pathname + url.search, timeout: 20000 })
    const body = await response.json()
    if (body?.data?.accessToken) secrets.add(body.data.accessToken)
    report.requests.push({
      path: url.pathname,
      method: request.method(),
      httpStatus: response.status(),
      businessCode: body.code,
    })
    return response
  }
  await context.route(base + '/api/**', async (route) => {
    try {
      await route.fulfill({ response: await transport(route) })
    } catch {
      await route.abort('failed').catch(() => {})
    }
  })
  page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push(redact(error.message)))
  const email = `browser-${variant}-${run}@example.test`
  await page.goto(base + '/register?returnTo=/account/orders', { waitUntil: 'domcontentloaded' })
  assert.equal(await page.locator('input[name=phone]').count(), 0)
  await page.locator('input[name=name]').fill('注册验证')
  await page.locator('input[name=email]').fill(email)
  await page.locator('input[name=password]').fill(password)
  await page.locator('input[name=confirm]').fill(password)
  await page.getByRole('button', { name: '创建账户', exact: true }).click()
  await page.locator('.error').filter({ hasText: '请输入 6 位邮箱验证码' }).waitFor()
  assert.equal(report.requests.filter((r) => r.path === '/api/auth/register').length, 0)
  check(
    'Register requires mailbox proof before HTTP submission and exposes no unverified phone field',
  )

  async function solveImageCaptcha() {
    const image = page.locator('.captcha-shot img')
    if (!(await image.count())) return
    await image.waitFor()
    const svg = Buffer.from((await image.getAttribute('src')).split(',')[1], 'base64').toString(
      'utf8',
    )
    const code = [...svg.matchAll(/<text[^>]*>([A-Z0-9])<\/text>/g)].map((m) => m[1]).join('')
    assert(code.length >= 4, 'Owned graphic proof unreadable')
    secrets.add(code)
    await page.locator('input[name=captcha]').fill(code)
  }
  async function sendCode() {
    await page.getByRole('button', { name: '获取验证码', exact: true }).click()
    if (!(await page.locator('.ok').count())) {
      await Promise.race([
        page.locator('.ok').waitFor(),
        page.locator('.captcha-shot img').waitFor(),
      ]).catch(() => {})
      if (await page.locator('.captcha-shot img').count()) {
        await solveImageCaptcha()
        await page.getByRole('button', { name: '获取验证码', exact: true }).click()
      }
    }
    await page.getByRole('button', { name: /秒后重发/ }).waitFor()
    const response = await fetch(inbox + '/inbox/' + encodeURIComponent(email), {
      headers: { Authorization: 'Bearer ' + inboxToken },
    })
    assert.equal(response.status, 200)
    const code = await response.text()
    assert(/^\d{6}$/.test(code))
    secrets.add(code)
    return code
  }
  const code = await sendCode()
  assert(report.requests.some((r) => r.path === '/api/auth/email/send' && r.businessCode === 0))
  assert(await page.getByRole('button', { name: /秒后重发/ }).isDisabled())
  check(
    'Register scene sends through real TLS SMTP; owned inbox holds a six-digit proof and resend is disabled',
  )
  await page.screenshot({ path: out + '/register-light.png', fullPage: true })
  await page.getByRole('button', { name: '切换到暗色', exact: true }).click()
  await page.screenshot({ path: out + '/register-dark.png', fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  check(
    'Register layout fits desktop or touch viewport in both themes; screenshots contain no OTP or plaintext password',
  )

  await page.locator('input[name=emailCode]').fill(code)
  await solveImageCaptcha()
  await page.getByRole('button', { name: '创建账户', exact: true }).click()
  await page.waitForURL(base + '/account/orders', { timeout: 20000 })
  const emptyOrders = page
    .locator('p.account-notice')
    .filter({ hasText: /^还没有订单。\s*先看看免费模板 ↗$/ })
  await emptyOrders.waitFor()
  const stored = await page.evaluate(() => localStorage.getItem('astra_access_token'))
  assert(stored)
  secrets.add(stored)
  assert(report.requests.some((r) => r.path === '/api/auth/register' && r.businessCode === 0))
  assert(report.requests.some((r) => r.path === '/api/system/orders' && r.businessCode === 0))
  check(
    'Real registration returns an auth-issued token and navigates to the backend-owned order list',
  )
  await page.reload()
  await emptyOrders.waitFor()
  assert(report.requests.some((r) => r.path === '/api/auth/me' && r.businessCode === 0))
  check('Production App restores the actual verified account through auth/me after reload')
  const revoke = await fetch(backend + '/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + stored },
  })
  assert.equal((await revoke.json()).code, 0)
  await page.reload()
  await page.getByRole('heading', { name: '登录后查看你的订单', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => localStorage.getItem('astra_access_token')), null)
  assert(report.requests.some((r) => r.path === '/api/auth/me' && r.businessCode === 401))
  check(
    'Backend logout invalidates restore; frontend clears the revoked token and shows login requirement',
  )

  await page.goto(base + '/register', { waitUntil: 'domcontentloaded' })
  const staleEmail = `stale-${variant}-${run}@example.test`
  await page.locator('input[name=email]').fill(staleEmail)
  let release, announced
  const observed = new Promise((resolve) => (announced = resolve))
  const gate = new Promise((resolve) => (release = resolve))
  await page.route(base + '/api/auth/email/send', async (route) => {
    const response = await transport(route)
    announced()
    await gate
    await route.fulfill({ response }).catch(() => {})
  })
  await page.getByRole('button', { name: '获取验证码', exact: true }).click()
  await observed
  await page.locator('input[name=email]').fill(`new-${variant}-${run}@example.test`)
  await page.waitForFunction(() => window.__authCodeAborts.length > 0)
  release()
  await page.waitForTimeout(150)
  assert.equal(await page.locator('.ok').count(), 0)
  assert.equal(await page.locator('input[name=emailCode]').inputValue(), '')
  assert(await page.getByRole('button', { name: '获取验证码', exact: true }).isEnabled())
  check(
    'Changing mailbox aborts a real delayed send response; it cannot attach message, proof or cooldown to the new address',
  )
  await page.unroute(base + '/api/auth/email/send')
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = redact(error?.message || error)
  if (page && !page.isClosed()) {
    report.diagnostics = {
      path: new URL(page.url()).pathname,
      notices: (await page.locator('.account-notice, .error, .ok').allTextContents()).map(redact),
    }
  }
} finally {
  await context?.close()
  await browser.close()
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, output: out }))
if (!report.passed) process.exitCode = 1
