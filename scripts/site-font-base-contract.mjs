import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'

const base = process.env.ASTRA_FONT_BASE_URL || 'http://127.0.0.1:4199/font-proof/'
const html = await readFile('test-results/site-local-font-base-dist/index.html', 'utf8')
const css = [...html.matchAll(/href="([^"]+\.css)"/g)].map(m => m[1])
assert(css.length > 0 && css.every(path => path.startsWith('/font-proof/assets/')))
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const page = await browser.newPage()
const fonts = [], errors = []
page.on('pageerror', e => errors.push(e.message))
page.on('request', request => { if (request.url().includes('/fonts/brand/')) fonts.push(new URL(request.url()).pathname) })
const report = { passed: false, browser: browser.version(), scope: 'Subdirectory compiled CSS and font assets only; not entire-site subdirectory routing', css, fonts, errors }
try {
  const url = base + '__font_base_contract'
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head>' + css.map(path => `<link rel="stylesheet" href="${path}">`).join('') + '</head><body>Astra Ångström Łódź Œuvre</body></html>' }))
  await page.goto(url)
  report.loaded = await page.evaluate(async () => {
    const results = []
    for (const specification of ['400 16px "DM Sans"', '500 16px "DM Sans"', '600 16px "DM Sans"', 'italic 400 16px "DM Sans"']) {
      const faces = await document.fonts.load(specification, 'Astra Ångström Łódź Œuvre')
      results.push({ specification, count: faces.length, loaded: faces.every(face => face.status === 'loaded') })
    }
    return results
  })
  assert(report.loaded.every(row => row.count === 2 && row.loaded))
  assert.equal(new Set(fonts).size, 4)
  assert(fonts.every(path => path.startsWith('/font-proof/fonts/brand/')))
  assert.deepEqual(errors, [])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(process.env.ASTRA_FONT_BASE_OUTPUT || `test-results/site-font-base-${Date.now()}.json`, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
}
console.log(JSON.stringify(report))
