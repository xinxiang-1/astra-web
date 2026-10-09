import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const context = await browser.newContext()
let externalRequests = 0, pendingLocalFonts = 0, releaseFonts
const localGate = new Promise(resolve => { releaseFonts = resolve })
await context.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => {
  externalRequests++
  return route.abort()
})
await context.route('**/fonts/brand/*.woff2', async route => {
  pendingLocalFonts++
  await localGate
  await route.continue()
})
const page = await context.newPage()
const errors = []
page.on('pageerror', error => errors.push(error.message))
const start = Date.now()
const report = {
  base: process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5198',
  scope:
    'Local brand font delayed; editor mounts with readable fallback, then exact font loads. Not real-device FPS certification.',
  externalRequests: 0,
  pendingLocalFonts: 0,
  domReady: false,
  appReady: false,
  fallbackHeaderVisible: false,
  fontReady: false,
  passed: false,
}
try {
  await page.goto(report.base + '/ascii-art', { waitUntil: 'domcontentloaded', timeout: 5000 })
  report.domReady = true
  await page.locator('input[type=file]').waitFor({ state: 'attached', timeout: 5000 })
  report.appReady = true
  await page.waitForFunction(() => document.fonts.status === 'loading', null, { timeout: 5000 })
  assert(pendingLocalFonts > 0, 'Local brand font requested before release')
  assert.equal(externalRequests, 0, 'No Google font request remains')
  const header = page.locator('.editor-header')
  assert(await header.isVisible())
  assert((await header.textContent()).trim().length > 0)
  report.fallbackHeaderVisible = true
  releaseFonts()
  report.fontReady = await page.evaluate(async () => (await document.fonts.load('400 16px "DM Sans"', 'Astra')).length > 0)
  assert(report.fontReady)
  await page.waitForLoadState('load', { timeout: 5000 })
  assert.deepEqual(errors, [])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  releaseFonts()
  report.externalRequests = externalRequests
  report.pendingLocalFonts = pendingLocalFonts
  report.errors = errors
  report.elapsedMs = Date.now() - start
  await writeFile(
    process.env.ASTRA_FONT_OUTPUT || `test-results/brand-font-startup-${Date.now()}.json`,
    JSON.stringify(report, null, 2) + '\n',
    { flag: 'wx' },
  )
  await context.close()
  await browser.close()
}
console.log(JSON.stringify(report))
