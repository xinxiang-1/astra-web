import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.ASTRA_PREVIEW_URL || 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'msedge' })
try {
  const page = await browser.newPage()
  await page.route(base + '/__delivery_failure', (r) => r.fulfill({ contentType: 'text/html', body: '<html></html>' }))
  await page.goto(base + '/__delivery_failure')
  const records = await page.evaluate(async () => {
    const source = await (await fetch('/src/stores/auth.ts')).text()
    const { createPinia, setActivePinia } = await import(source.match(/from "([^"]*\/pinia.js[^"]*)"/)[1])
    const { useAuthStore } = await import('/src/stores/auth.ts')
    const original = fetch, results = []
    for (const kind of ['offline', '503', '502-html', 'bad-200', 'smtp-rejected']) {
      setActivePinia(createPinia()); const auth = useAuthStore()
      window.fetch = async () => {
        if (kind === 'offline') throw new TypeError('Failed to fetch')
        if (kind === '502-html') return new Response('<html>Bad Gateway</html>', { status: 502 })
        if (kind === 'bad-200') return new Response('invalid JSON', { status: 200 })
        return Response.json({ code: kind === '503' ? 503 : 500, msg: '渠道不可用', data: null }, { status: kind === '503' ? 503 : 500 })
      }
      const captcha = { captchaId: 'isolated-fixture', captchaCode: 'fixture' }
      const sms = await auth.sendLoginSms('fixture', captcha)
      const email = await auth.requestEmailCode('fixture@example.invalid', 'register', captcha)
      results.push({ kind, sms, email: email.ok, message: auth.lastMessage, pending: auth.pending })
    }
    window.fetch = original
    return results
  })
  for (const r of records) assert(!r.sms && !r.email && !r.pending && !/已发送|成功/.test(r.message), JSON.stringify(r))
  const output = process.env.ASTRA_DELIVERY_FAILURE_OUTPUT || 'docs/validation/2026-10-10/auth-channels/frontend-failures.json'
  await mkdir(output.slice(0, output.lastIndexOf('/')), { recursive: true })
  await writeFile(output, JSON.stringify({ passed: true, scope: 'Controlled failures of actual auth store; no real recipients or OTPs', records }, null, 2))
  console.log('PASS: offline, channel503, gateway502, malformed200 and SMTP failure never report sent.')
} finally { await browser.close() }
