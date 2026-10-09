import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5210'
const out = process.env.ASTRA_IDENTITY_OUTPUT || 'test-results/auth-identity'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
try {
  const page = await browser.newPage()
  await page.route(base + '/__identity', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }),
  )
  await page.goto(base + '/__identity')
  const rows = await page.evaluate(async () => {
    const source = await (await fetch('/src/stores/auth.ts')).text()
    const { createPinia, setActivePinia } = await import(
      source.match(/from "([^"]*\/pinia.js[^"]*)"/)[1]
    )
    const { useAuthStore } = await import('/src/stores/auth.ts')
    const original = window.fetch,
      rows = []
    const payload = (label) => ({
      accessToken: `public-test-token-${label}`,
      expiresIn: 7200,
      user: { id: label, nickname: label },
    })
    const response = (data, status = 200, code = 0) =>
      Response.json({ code, msg: 'controlled response', data }, { status })
    const check = (v, label) => {
      if (!v) throw new Error(label)
    }
    const fresh = () => {
      localStorage.clear()
      setActivePinia(createPinia())
      return useAuthStore()
    }
    const deferred = () => {
      const queue = []
      window.fetch = (url, options) =>
        new Promise((resolve) => queue.push({ url, options, resolve }))
      return queue
    }
    const identity = (auth, id) => {
      check(auth.user?.id === id, `expected identity ${id}, got ${auth.user?.id}`)
      check(
        localStorage.getItem('astra_access_token') === payload(id).accessToken,
        'token/user disagree',
      )
    }
    try {
      for (const [label, status, code] of [
        ['success', 200, 0],
        ['http401', 401, 401],
        ['business401', 200, 401],
      ]) {
        const auth = fresh()
        auth.acceptToken(payload('A'))
        const q = deferred()
        const pending = auth.restoreSession()
        auth.acceptToken(payload('B'))
        q[0].resolve(response(payload('A').user, status, code))
        check((await pending) === false, 'late restore accepted')
        identity(auth, 'B')
        rows.push({ case: 'late-restore-' + label, passed: true })
      }
      for (const status of [200, 503]) {
        const auth = fresh()
        auth.acceptToken(payload('A'))
        const q = deferred()
        const pending = auth.logout()
        check(!auth.user && !localStorage.getItem('astra_access_token'), 'logout not immediate')
        check(
          q[0].options.headers.get('Authorization') === 'Bearer ' + payload('A').accessToken,
          'wrong revoke token',
        )
        auth.acceptToken(payload('B'))
        q[0].resolve(response(null, status, status === 200 ? 0 : 503))
        await pending
        identity(auth, 'B')
        check(auth.lastMessage === '', 'late logout message')
        rows.push({ case: 'late-logout-' + status, passed: true })
      }
      const attempts = [
        [
          'password',
          (a, s) => a.login('account', 'password', { captchaId: 'public', captchaCode: 'test' }, s),
        ],
        ['phone', (a, s) => a.loginByPhone('13800000000', '123456', s)],
        ['email', (a, s) => a.loginByEmail('test@example.com', '123456', s)],
        [
          'register',
          (a, s) =>
            a.register(
              'name',
              'test@example.com',
              'password',
              '123456',
              { captchaId: 'public', captchaCode: 'test' },
              s,
            ),
        ],
        ['wechat-mock', (a, s) => a.loginWithWechat('public-ticket', s)],
      ]
      for (const [label, login] of attempts) {
        const auth = fresh(),
          q = deferred()
        const older = login(auth),
          newer = login(auth)
        check(q[0].options.signal.aborted, 'older request not aborted')
        q[0].resolve(response(payload('A')))
        check((await older) === false, 'old login accepted')
        check(auth.pending, 'old finalizer cleared new pending')
        q[1].resolve(response(payload('B')))
        check((await newer) === true, 'latest login failed')
        identity(auth, 'B')
        check(!auth.pending, 'pending stuck')
        rows.push({ case: 'latest-' + label, passed: true })
        const cancelled = fresh(),
          cq = deferred(),
          c = new AbortController()
        c.abort()
        check(
          (await login(cancelled, c.signal)) === false && cq.length === 0,
          'pre-aborted login requested',
        )
        const running = new AbortController(),
          task = login(cancelled, running.signal)
        running.abort()
        cq[0].resolve(response(payload('A')))
        check((await task) === false && !cancelled.user, 'aborted login committed')
        rows.push({ case: 'cancel-' + label, passed: true })
      }
      {
        const auth = fresh(),
          q = deferred(),
          login = auth.loginByEmail('test@example.com', '123456')
        check(
          (await auth.restoreSession()) === false && q.length === 1,
          'background restore superseded login',
        )
        q[0].resolve(response(payload('B')))
        check(await login, 'explicit login cancelled')
        identity(auth, 'B')
        rows.push({ case: 'background-during-login', passed: true })
      }
      {
        const auth = fresh()
        auth.acceptToken(payload('A'))
        const q = deferred()
        const old = auth.restoreSession(),
          latest = auth.restoreSession()
        q[1].resolve(response(payload('A').user))
        check(await latest, 'latest restore failed')
        q[0].resolve(response(null, 401, 401))
        check((await old) === false, 'old restore cleared identity')
        identity(auth, 'A')
        rows.push({ case: 'concurrent-restores', passed: true })
      }
      {
        const auth = fresh()
        auth.acceptToken(payload('A'))
        const q = deferred(),
          old = auth.restoreSession()
        localStorage.setItem('astra_access_token', payload('B').accessToken)
        const rotated = auth.synchronizeSession()
        check(auth.user === null, 'old user shown with new token')
        q[1].resolve(response(payload('B').user))
        check(await rotated, 'rotation restore failed')
        q[0].resolve(response(payload('A').user))
        await old
        identity(auth, 'B')
        check(
          (await auth.synchronizeSession()) === false && q.length === 2,
          'same token restored again',
        )
        localStorage.clear()
        await auth.synchronizeSession()
        check(!auth.user, 'clear retained user')
        rows.push({ case: 'storage-rotate-and-clear', passed: true })
      }
      return rows
    } finally {
      window.fetch = original
      localStorage.clear()
    }
  })
  assert.equal(rows.length, 18)
  await writeFile(
    out + '/report.json',
    JSON.stringify(
      {
        browser: browser.version(),
        scope:
          'Real browser Pinia/store/API/http, controlled deferred fetch; no real authentication or payments',
        rows,
      },
      null,
      2,
    ) + '\n',
  )
  console.log(`Auth identity contract: ${rows.length} cases passed.`)
} finally {
  await browser.close()
}
