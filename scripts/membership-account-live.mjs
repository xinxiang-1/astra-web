import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_MEMBERSHIP_PREVIEW_URL
const backend = process.env.ASTRA_MEMBERSHIP_API_URL
const control = process.env.ASTRA_MEMBERSHIP_CONTROL_URL
const key = process.env.ASTRA_MEMBERSHIP_CONTROL_KEY
const owner = process.env.ASTRA_MEMBERSHIP_OWNER_TOKEN
const refreshed = process.env.ASTRA_MEMBERSHIP_REFRESHED_TOKEN
const other = process.env.ASTRA_MEMBERSHIP_OTHER_TOKEN
const grant = process.env.ASTRA_MEMBERSHIP_GRANT_ID
const order = process.env.ASTRA_MEMBERSHIP_ORDER_ID
const output = process.env.ASTRA_MEMBERSHIP_OUTPUT
assert(
  base && backend && control && key && owner && refreshed && other && grant && order && output,
  'Use only the resource-owning Java membership fixture',
)
for (const url of [base, backend, control]) {
  assert.equal(new URL(url).hostname, '127.0.0.1')
  assert.equal(new URL(url).protocol, 'http:')
}
const state = async (value) => {
  const response = await fetch(control + '/state', {
    method: 'POST',
    headers: { 'X-Fixture-Key': key },
    body: JSON.stringify({ state: value }),
    signal: AbortSignal.timeout(10_000),
  })
  assert.equal(response.status, 200, 'Owned fixture state change failed')
}
async function waitForRequest(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for ' + label)), 10_000)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}
const report = {
  passed: false,
  scope:
    'Real owned MySQL/Redis/system/gateway membership reads; fixture JWT and seeded membership/payment facts; controlled auth/me503 and cold-start401, damaged response and late transport; no real membership sale or cloud consumer',
  browsers: [],
}
await mkdir(output, { recursive: true })
for (const channel of ['msedge', 'chrome']) {
  await state('active')
  const browser = await chromium.launch({ channel })
  const record = { channel, version: browser.version(), checks: [], requests: [] }
  report.browsers.push(record)
  const check = (name) => {
    record.checks.push(name)
    console.log(channel + ': ' + name)
  }
  let release
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      reducedMotion: 'reduce',
    })
    await context.addInitScript((token) => {
      if (!sessionStorage.getItem('membershipFixtureInitialized')) {
        localStorage.setItem('astra_access_token', token)
        localStorage.setItem('astra-theme', 'light')
        sessionStorage.setItem('membershipFixtureInitialized', 'true')
      }
    }, owner)
    const page = await context.newPage()
    const errors = []
    record.pageErrors = errors
    page.on('pageerror', (error) => errors.push(error.message))
    let hold = false,
      damaged = '',
      held
    await page.route(
      (url) => url.origin !== new URL(base).origin,
      (route) => route.abort(),
    )
    await page.route('**/api/auth/me', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"code":503,"msg":"Owned membership fixture has no auth service"}',
      }),
    )
    await page.route('**/api/system/**', async (route) => {
      const request = route.request(),
        url = new URL(request.url())
      assert.equal(
        request.method(),
        'GET',
        'Membership UI must never mutate grants, quotas, orders or funds',
      )
      const response = await route.fetch({ url: backend + url.pathname + url.search })
      record.requests.push({
        method: request.method(),
        path: url.pathname,
        status: response.status(),
        cacheControl: response.headers()['cache-control'],
        requestId: response.headers()['x-request-id'],
        responseBody: await response.json(),
      })
      if (hold && url.pathname.endsWith('/membership')) {
        hold = false
        held?.()
        await new Promise((resolve) => {
          release = resolve
        })
        await route.fulfill({ response }).catch(() => {}) // Expected cancellation of the obsolete UI request.
      } else if (damaged && response.ok() && url.pathname.endsWith('/membership')) {
        const body = await response.json()
        if (damaged === 'balance') body.data.grants[0].quotas[0].remaining = '999999'
        else if (damaged === 'state') body.data.grants[0].state = ['ACTIVE']
        else body.data.grants[0].quotas[0].capability = ['CLOUD_BACKUP_BYTES']
        damaged = ''
        await route.fulfill({ response, json: body })
      } else await route.fulfill({ response })
    })
    const switchToken = async (token) =>
      page.evaluate((value) => {
        if (value) localStorage.setItem('astra_access_token', value)
        else localStorage.removeItem('astra_access_token')
        dispatchEvent(
          new StorageEvent('storage', { key: 'astra_access_token', storageArea: localStorage }),
        )
      }, token)
    const entry = page.locator('[data-membership]')
    const waitState = async (value) =>
      page.locator(`[data-membership][data-state="${value}"]`).waitFor()
    const refresh = async () => page.getByRole('button', { name: '刷新记录', exact: true }).click()
    const shot = async (name) =>
      page.screenshot({ path: path.join(output, `${channel}-${name}.png`), fullPage: true })
    await page.goto(base + '/account/library')
    await page.getByRole('link', { name: '会员与额度', exact: true }).click()
    await waitState('ACTIVE')
    assert.equal(await entry.getAttribute('data-membership'), grant)
    assert.equal(
      await page.getByRole('link', { name: '查看来源订单' }).getAttribute('href'),
      '/account/orders/' + order,
    )
    assert.equal(await page.locator('[data-capability]').count(), 2)
    assert.match(
      await page.locator('[data-capability="CLOUD_BACKUP_BYTES"]').innerText(),
      /100 字节/,
    )
    assert.match(await page.locator('[data-capability="SERVER_RENDER_TASKS"]').innerText(), /3 次/)
    await shot('desktop-light')
    check('Account navigation reads real owner grant, exact bigint IDs and two quota buckets')
    await page.getByRole('button', { name: '切换到暗色' }).click()
    await shot('desktop-dark')
    await page.setViewportSize({ width: 390, height: 844 })
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await shot('mobile-dark')
    await page.getByRole('button', { name: '切换到亮色' }).click()
    await shot('mobile-light')
    check('Desktop and 390px simulated width work in both themes without horizontal overflow')
    await page.clock.setFixedTime(new Date('2040-01-01T00:00:00Z'))
    await refresh()
    await waitState('ACTIVE')
    check('Changing client time to 2040 does not override the backend ACTIVE status')
    for (const [mode, result] of [
      ['scheduled', 'SCHEDULED'],
      ['frozen', 'FROZEN'],
      ['expired', 'EXPIRED'],
      ['refunded', 'REVOKED'],
    ]) {
      await state(mode)
      await refresh()
      await waitState(result)
      assert.match(await page.locator('.state-description').innerText(), /不能|不再可用/)
    }
    check(
      'Real backend scheduled, frozen, expired and refunded-source states are rendered distinctly',
    )
    await state('usage')
    await refresh()
    await waitState('ACTIVE')
    const quotaValues = async (capability) =>
      page.locator(`[data-capability="${capability}"] dd`).allTextContents()
    assert.deepEqual(await quotaValues('CLOUD_BACKUP_BYTES'), [
      '100 字节',
      '30 字节',
      '20 字节',
      '50 字节',
    ])
    assert.deepEqual(await quotaValues('SERVER_RENDER_TASKS'), ['3 次', '1 次', '1 次', '1 次'])
    await shot('usage-mobile')
    check('Committed and reserved service usage is displayed from the real ledger')
    await state('disabled')
    await refresh()
    await page.locator('[data-membership-disabled]').waitFor()
    assert.equal(await entry.count(), 0)
    await shot('disabled')
    await state('empty')
    await refresh()
    await page.locator('[data-membership-empty]').waitFor()
    check('Closed membership and an enabled empty account have separate actionable states')
    await state('active')
    await refresh()
    await waitState('ACTIVE')
    await state('unavailable')
    await refresh()
    await page.getByRole('alert').waitFor()
    assert.equal(await entry.count(), 0)
    assert(
      await page.evaluate((value) => localStorage.getItem('astra_access_token') === value, owner),
    )
    await state('active')
    await page.getByRole('button', { name: '重新读取' }).click()
    await waitState('ACTIVE')
    assert.equal(
      await page
        .getByRole('button', { name: '刷新记录', exact: true })
        .evaluate((el) => document.activeElement === el),
      true,
    )
    check(
      'Actual backend 503 clears stale entitlement display, preserves credentials and recovers by retry',
    )
    for (const kind of ['balance', 'state', 'capability']) {
      damaged = kind
      await refresh()
      await page.getByRole('alert').waitFor()
      assert.equal(await entry.count(), 0)
      await page.getByRole('button', { name: '重新读取' }).click()
      await waitState('ACTIVE')
    }
    check(
      'Controlled malformed balances and array-shaped state/capability fail visibly instead of displaying invalid records',
    )
    const heldReady = new Promise((resolve) => {
      held = resolve
    })
    hold = true
    await refresh()
    await waitForRequest(heldReady, 'held membership response')
    assert(await page.getByRole('button', { name: '刷新记录', exact: true }).isDisabled())
    assert.equal(await entry.count(), 0)
    await switchToken(other)
    await page.locator('[data-membership-empty]').waitFor()
    release()
    release = undefined
    await page.waitForTimeout(200)
    assert.equal(await entry.count(), 0)
    check('Late owner response cannot overwrite the second user after session revision changes')
    await switchToken(owner)
    await waitState('ACTIVE')
    const before = record.requests.length
    await switchToken(refreshed)
    await waitState('ACTIVE')
    assert(record.requests.length > before)
    check('Same-user JWT replacement reloads the record despite the unchanged account ID')
    await state('long-name')
    await refresh()
    await waitState('ACTIVE')
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await shot('long-name-mobile')
    check('A real 112-character plan name wraps on the narrow layout')
    await switchToken('invalid')
    await page.getByRole('link', { name: '前往登录', exact: true }).waitFor()
    assert.equal(await entry.count(), 0)
    await page.getByRole('link', { name: '前往登录', exact: true }).click()
    const loginUrl = new URL(page.url())
    assert.equal(loginUrl.pathname, '/login')
    assert.equal(loginUrl.searchParams.get('returnTo'), '/account/membership')
    await switchToken(null)
    await page.goto(base + '/account/membership')
    await page.getByRole('link', { name: '前往登录', exact: true }).waitFor()
    assert.equal(await entry.count(), 0)
    check('401 and logout remove private display and preserve a valid login return path')
    await state('active')
    for (const authFirst of [true, false]) {
      const cold = await browser.newContext()
      await cold.addInitScript(
        (token) => localStorage.setItem('astra_access_token', token),
        authFirst ? 'invalid' : owner,
      )
      const coldPage = await cold.newPage()
      coldPage.on('pageerror', (error) => errors.push(error.message))
      const authGate = Promise.withResolvers(),
        membershipGate = Promise.withResolvers()
      const authReady = Promise.withResolvers(),
        membershipReady = Promise.withResolvers()
      await coldPage.route(
        (url) => url.origin !== new URL(base).origin,
        (route) => route.abort(),
      )
      await coldPage.route('**/api/auth/me', async (route) => {
        authReady.resolve()
        await authGate.promise
        await route
          .fulfill({ status: 401, json: { code: 401, msg: 'Controlled expired session' } })
          .catch(() => {})
      })
      await coldPage.route('**/api/system/membership', async (route) => {
        assert.equal(route.request().method(), 'GET')
        const response = await route.fetch({ url: backend + '/api/system/membership' })
        record.requests.push({
          method: 'GET',
          path: '/api/system/membership',
          status: response.status(),
          cacheControl: response.headers()['cache-control'],
          requestId: response.headers()['x-request-id'],
          responseBody: await response.json(),
        })
        membershipReady.resolve()
        await membershipGate.promise
        await route.fulfill({ response }).catch(() => {})
      })
      try {
        await coldPage.goto(base + '/account/membership')
        await waitForRequest(
          Promise.all([authReady.promise, membershipReady.promise]),
          'cold-start auth and membership requests',
        )
        if (authFirst) {
          authGate.resolve()
          await coldPage.getByRole('link', { name: '前往登录', exact: true }).waitFor()
          membershipGate.resolve()
        } else {
          membershipGate.resolve()
          await coldPage.locator('[data-membership]').waitFor()
          authGate.resolve()
        }
        await coldPage.getByRole('link', { name: '前往登录', exact: true }).waitFor()
        assert.equal(await coldPage.locator('[data-membership]').count(), 0)
        assert.equal(
          await coldPage.evaluate(() => localStorage.getItem('astra_access_token')),
          null,
        )
      } finally {
        authGate.resolve()
        membershipGate.resolve()
        await cold.close()
      }
    }
    check(
      'Cold-start auth rejection clears pending or already displayed membership in both response orders',
    )
    assert.deepEqual(errors, [])
  } finally {
    release?.()
    await browser.close()
    await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  }
}
report.passed = true
await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
console.log('PASS: two browsers read actual owned membership APIs; no app mutation requests.')
