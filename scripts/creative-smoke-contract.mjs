import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.ASTRA_DEV_URL || 'http://localhost:5173'
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const out = `test-results/creative-smoke-lifecycle-${channel}`
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel,
  headless: true,
})
const report = { browser: browser.version(), cases: [], errors: [] }
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  const pattern = '**/src/effects/webgl-fluid/renderer.ts'
  await page.route(pattern, (r) => r.abort('failed'))
  await page.goto(base + '/webgl-fluid', { waitUntil: 'domcontentloaded' })
  await page.getByRole('alert').filter({ hasText: '彩烟资源加载失败' }).waitFor()
  await page.unroute(pattern)
  await page.getByRole('button', { name: '重新加载彩烟', exact: true }).click()
  await page.waitForFunction(
    () =>
      !document.querySelector('[role="alert"]') &&
      ![...document.querySelectorAll('[role="status"]')].some((e) =>
        e.textContent.includes('正在加载彩烟'),
      ),
  )
  report.cases.push('friendly-import-failure-and-real-reload')
  let held, notify
  const requested = new Promise((r) => (notify = r))
  await page.route(pattern, (r) => {
    held = r
    notify()
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await requested
  const link = page.locator('a[href="/gallery"]').first()
  await link.click()
  await page.waitForURL('**/gallery')
  await held.continue().catch(() => {})
  await page.waitForTimeout(600)
  assert.equal(await page.locator('canvas').count(), 0)
  assert.deepEqual(report.errors, [])
  report.cases.push('leave-while-renderer-import-pending')
  console.log(JSON.stringify(report))
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
