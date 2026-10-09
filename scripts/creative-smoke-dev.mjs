import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const base = process.env.ASTRA_DEV_URL || 'http://localhost:5173'
const second = process.env.ASTRA_SECOND_DEV_URL || 'http://127.0.0.1:5210'
const out = process.env.ASTRA_CREATIVE_CORE_OUTPUT || 'test-results/creative-workflow'
await mkdir(out, { recursive: true })
const report = { modules: [], browsers: [] }
for (const origin of [base, second]) {
  const url = origin + '/src/effects/webgl-fluid/renderer.ts'
  const response = await fetch(url)
  const code = await response.text()
  const dependency = code.match(/from "([^"]*webgl-fluid.js[^"]*)"/)[1]
  const dep = await fetch(new URL(dependency, origin))
  assert.equal(response.status, 200)
  assert.equal(dep.status, 200)
  assert.ok(dependency.includes('.vite-astra/serve-development-'))
  report.modules.push({ base: origin, dependency, status: dep.status })
}
for (const channel of ['msedge', 'chrome']) {
  const browser = await chromium.launch({ channel, headless: true })
  try {
    const page = await browser.newPage()
    const errors = [],
      failed = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('response', (r) => {
      if (r.status() >= 400 && /webgl-fluid|\.vite/.test(r.url()))
        failed.push({ url: r.url(), status: r.status() })
    })
    await page.goto(base + '/webgl-fluid', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
    assert.equal(await page.getByRole('alert').count(), 0)
    assert.equal(await page.locator('canvas').count(), 1)
    await page.mouse.move(250, 250)
    await page.mouse.move(700, 420, { steps: 16 })
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${out}/smoke-dev-${channel}.png` })
    assert.deepEqual(errors, [])
    assert.deepEqual(failed, [])
    report.browsers.push({ channel, version: browser.version(), errors, failed })
  } finally {
    await browser.close()
  }
}
await writeFile(out + '/smoke-dev.json', JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report))
