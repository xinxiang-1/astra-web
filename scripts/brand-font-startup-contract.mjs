import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
let pendingFontCss = 0
await context.route('https://fonts.googleapis.com/**', async () => {
  pendingFontCss++
  await new Promise((resolve) => context.once('close', resolve))
})
const page = await context.newPage()
const start = Date.now()
const report = {
  base: process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5194',
  scope:
    'Brand CSS remains pending; actual editor must mount. Not a remote font availability, layout shift or page FPS certification.',
  pendingFontCss: 0,
  domReady: false,
  appReady: false,
  passed: false,
}
try {
  await page.goto(report.base + '/ascii-art', { waitUntil: 'domcontentloaded', timeout: 5000 })
  report.domReady = true
  await page.locator('input[type=file]').waitFor({ state: 'attached', timeout: 5000 })
  report.appReady = true
  assert(pendingFontCss > 0, 'same brand font CSS is requested')
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  report.pendingFontCss = pendingFontCss
  report.elapsedMs = Date.now() - start
  await writeFile(
    process.env.ASTRA_FONT_OUTPUT || 'test-results/brand-font-startup.json',
    JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx' },
  )
  await context.close()
  await browser.close()
}
console.log(JSON.stringify(report))
