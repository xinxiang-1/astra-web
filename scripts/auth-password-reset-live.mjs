import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.env.ASTRA_AUTH_PREVIEW_URL
const backend = process.env.ASTRA_AUTH_API_URL
const inbox = process.env.ASTRA_AUTH_INBOX_URL
const inboxToken = process.env.ASTRA_AUTH_INBOX_TOKEN
const email = process.env.ASTRA_AUTH_TEST_EMAIL
const oldToken = process.env.ASTRA_AUTH_OLD_TOKEN
const password = process.env.ASTRA_AUTH_TEST_PASSWORD
const out = process.env.ASTRA_AUTH_OUTPUT
const variant = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
assert(
  base && backend && inbox && inboxToken && email && oldToken && password && out,
  'Owned Java fixture required',
)
for (const value of [base, backend, inbox]) assert.equal(new URL(value).hostname, '127.0.0.1')
assert(email.endsWith('@example.test'))
await mkdir(out, { recursive: true })
const secrets = new Set([inboxToken, oldToken, password])
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
    'Production frontend with owned actual auth/gateway/system/TLS SMTP; no success API mock or real funds',
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
    window.__resetAborts = []
    window.fetch = (url, init) => {
      if (String(url).includes('/api/auth/password/forgot'))
        init?.signal?.addEventListener('abort', () => window.__resetAborts.push(true), {
          once: true,
        })
      return native(url, init)
    }
  })
  async function transport(route) {
    const request = route.request(),
      url = new URL(request.url())
    const response = await route.fetch({ url: backend + url.pathname + url.search, timeout: 20000 })
    const data = await response.json()
    if (data?.data?.accessToken) secrets.add(data.data.accessToken)
    report.requests.push({
      method: request.method(),
      path: url.pathname,
      httpStatus: response.status(),
      businessCode: data.code,
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
  const emptyOrders = () =>
    page.locator('p.account-notice').filter({ hasText: /^还没有订单。\s*先看看免费模板 ↗$/ })
  await page.goto(base + '/account/orders', { waitUntil: 'domcontentloaded' })
  await page.evaluate((token) => localStorage.setItem('astra_access_token', token), oldToken)
  await page.reload()
  await emptyOrders().waitFor()
  assert(report.requests.some((r) => r.path === '/api/auth/me' && r.businessCode === 0))
  check('Actual auth-issued old session restores the buyer and reads orders before reset')

  await page.goto(base + '/forgot', { waitUntil: 'domcontentloaded' })
  await page.locator('input[name=email]').fill(email)
  async function solveCaptcha() {
    const image = page.locator('.captcha-shot img')
    if (!(await image.count())) return
    await image.waitFor()
    const svg = Buffer.from((await image.getAttribute('src')).split(',')[1], 'base64').toString(
      'utf8',
    )
    const proof = [...svg.matchAll(/<text[^>]*>([A-Z0-9])<\/text>/g)]
      .map((match) => match[1])
      .join('')
    assert(proof.length >= 4)
    secrets.add(proof)
    await page.locator('input[name=captcha]').fill(proof)
  }
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await Promise.race([
    page.locator('input[name=code]').waitFor(),
    page.locator('.captcha-shot img').waitFor(),
  ]).catch(() => {})
  if (!(await page.locator('input[name=code]').count())) {
    await solveCaptcha()
    await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  }
  await page.locator('input[name=code]').waitFor()
  assert(await page.getByRole('button', { name: /秒后重发/ }).isDisabled())
  const mail = await fetch(inbox + '/inbox/' + encodeURIComponent(email), {
    headers: { Authorization: 'Bearer ' + inboxToken },
  })
  assert.equal(mail.status, 200)
  const code = await mail.text()
  assert(/^\d{6}$/.test(code))
  secrets.add(code)
  check(
    'Forgot sends a real reset-scene TLS SMTP proof and disables resend during mailbox cooldown',
  )
  // Capture empty fields after transient notifications have disappeared; no OTP/password is present.
  await page.waitForFunction(() => !document.querySelector('.el-message'))
  await page.screenshot({ path: out + '/reset-light.png', fullPage: true })
  await page.getByRole('button', { name: '切换到暗色', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  await page.evaluate(async () => {
    await new Promise(requestAnimationFrame)
    await Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    )
  })
  await page.screenshot({ path: out + '/reset-dark.png', fullPage: true })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  check('Reset proof/password fields fit both themes on desktop or synthesized touch viewport')

  await page.locator('input[name=password]').fill(password)
  await page.locator('input[name=confirm]').fill(password)
  await page.getByRole('button', { name: '重置密码', exact: true }).click()
  await page.locator('.error').filter({ hasText: '请输入 6 位邮箱验证码' }).waitFor()
  assert.equal(report.requests.filter((r) => r.path === '/api/auth/password/reset').length, 0)
  await page.locator('input[name=code]').fill(code)
  await page.getByRole('button', { name: '重置密码', exact: true }).click()
  await page.waitForURL(base + '/login', { timeout: 20000 })
  assert.equal(await page.evaluate(() => localStorage.getItem('astra_access_token')), null)
  const old = await fetch(backend + '/api/system/orders', {
    headers: { Authorization: 'Bearer ' + oldToken },
  })
  assert.equal(old.status, 401)
  assert.equal((await old.json()).code, 401)
  assert(report.requests.some((r) => r.path === '/api/auth/password/reset' && r.businessCode === 0))
  check(
    'Valid proof changes password without auto-login, clears matching local session and server rejects its old token',
  )

  await page.locator('input[name=email]').fill(email)
  await page.locator('input[name=password]').fill(password)
  await page.getByRole('button', { name: '继续', exact: true }).click()
  await Promise.race([
    page.waitForURL(base + '/', { timeout: 10000 }),
    page.locator('.captcha-shot img').waitFor(),
  ]).catch(() => {})
  if (await page.locator('.captcha-shot img').count()) {
    await solveCaptcha()
    await page.getByRole('button', { name: '继续', exact: true }).click()
  }
  await page.waitForURL(base + '/', { timeout: 20000 })
  const fresh = await page.evaluate(() => localStorage.getItem('astra_access_token'))
  assert(fresh && fresh !== oldToken)
  secrets.add(fresh)
  await page.goto(base + '/account/orders', { waitUntil: 'domcontentloaded' })
  await emptyOrders().waitFor()
  check(
    'New password signs in with a fresh auth-issued version and still reads the backend-owned orders',
  )

  await page.goto(base + '/forgot', { waitUntil: 'domcontentloaded' })
  await page.locator('input[name=email]').fill('reset-stale-' + variant + '@example.test')
  let release, announce
  const gate = new Promise((resolve) => (release = resolve))
  const observed = new Promise((resolve) => (announce = resolve))
  await page.route(base + '/api/auth/password/forgot', async (route) => {
    const response = await transport(route)
    announce()
    await gate
    await route.fulfill({ response }).catch(() => {})
  })
  await page.getByRole('button', { name: '发送验证码', exact: true }).click()
  await observed
  await page.locator('input[name=email]').fill('reset-new-' + variant + '@example.test')
  await page.waitForFunction(() => window.__resetAborts.length > 0)
  release()
  await page.waitForTimeout(150)
  assert.equal(await page.locator('input[name=code]').count(), 0)
  assert.equal(await page.locator('.ok').count(), 0)
  assert(await page.getByRole('button', { name: '发送验证码', exact: true }).isEnabled())
  check(
    'Mailbox change cancels a real delayed forgot response; no stale proof step, message or cooldown is committed',
  )
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = redact(error?.message || error)
  if (page && !page.isClosed())
    report.diagnostics = {
      path: new URL(page.url()).pathname,
      notices: (await page.locator('.error,.ok,.account-notice').allTextContents()).map(redact),
    }
} finally {
  await context?.close()
  await browser.close()
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n')
}
console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, output: out }))
if (!report.passed) process.exitCode = 1
