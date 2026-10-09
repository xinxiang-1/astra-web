import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:4198'
const out = path.resolve(process.env.ASTRA_SITE_FONT_OUTPUT || `test-results/site-local-font-${Date.now()}`)
await mkdir(out, { recursive: false })
const provenance = JSON.parse(await readFile('docs/research/2026-10-09-site-fonts/sources.json', 'utf8'))
const originalCss = (await readFile('docs/research/2026-10-09-site-fonts/google-original.css', 'utf8')).replaceAll('\r\n', '\n')
const localCss = (await readFile('src/styles/brand-fonts.css', 'utf8')).replaceAll('\r\n', '\n')
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
let reverted = localCss.replace(/^\/\* Exact DM Sans[^\n]+\*\/\n/, '')
for (const file of provenance.localFiles) reverted = reverted.replaceAll('/fonts/brand/' + file.file, file.url)
assert.equal(reverted.trim(), originalCss.trim(), 'Style, weight, display and Unicode declarations unchanged')
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const report = { passed: false, browser: browser.version(), assets: [], pixels: [], routes: [], failures: [], errors: [] }
try {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', e => report.errors.push(e.message))
  for (const file of provenance.localFiles) {
    const bytes = await readFile('public/fonts/brand/' + file.file)
    assert.equal(digest(bytes), file.sha256)
    await context.route(file.url, route => route.fulfill({ contentType: 'font/woff2', body: bytes }))
    const response = await context.request.get(base + '/fonts/brand/' + file.file)
    assert.equal(response.status(), 200)
    assert.match(response.headers()['content-type'], /font\/woff2/)
    assert.equal(digest(await response.body()), file.sha256)
    report.assets.push({ file: file.file, bytes: bytes.length, sha256: file.sha256, status: 200, mime: response.headers()['content-type'] })
  }
  await page.route(base + '/__site_font_contract', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto(base + '/__site_font_contract')
  await page.addStyleTag({ content: originalCss.replaceAll("'DM Sans'", "'Astra DM Sans Reference'") + '\n' + localCss })
  report.pixels = await page.evaluate(async () => {
    const rows = []
    const texts = ['Astra 0123456789', 'Ångström Łódź Œuvre', 'Light → Dark — zoom +', '名字画 Astra 16K']
    const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 160
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
    for (const [style, weight] of [['normal', 400], ['normal', 500], ['normal', 600], ['italic', 400]]) {
      for (const size of [12, 16, 32, 72]) for (const text of texts) {
        await document.fonts.load(`${style} ${weight} ${size}px "DM Sans"`, text)
        await document.fonts.load(`${style} ${weight} ${size}px "Astra DM Sans Reference"`, text)
        const loaded = [...document.fonts].filter(f => f.family === 'DM Sans' && f.status === 'loaded')
        if (!loaded.length) throw Error('Actual local FontFace not loaded')
        const draw = family => {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
          ctx.font = `${style} ${weight} ${size}px "${family}", system-ui`
          ctx.fillStyle = '#151918'; ctx.fillText(text, 10, 100)
          return { width: ctx.measureText(text).width, rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data }
        }
        const reference = draw('Astra DM Sans Reference'), current = draw('DM Sans')
        if (reference.width !== current.width || reference.rgba.some((v, i) => v !== current.rgba[i])) throw Error('Font pixels changed')
        rows.push({ style, weight, size, text, width: current.width, differingBytes: 0, rgbaSha256: await hash(current.rgba) })
      }
    }
    return rows
  })
  assert.equal(report.pixels.length, 64)
  await context.close()

  const ui = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
  const external = [], requests = []
  await ui.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => { external.push(route.request().url()); return route.abort() })
  const real = await ui.newPage()
  real.on('pageerror', e => report.errors.push(e.message))
  real.on('request', request => { if (request.url().includes('/fonts/brand/')) requests.push(request.url()) })
  for (const width of [1440, 390]) {
    await real.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    for (const theme of ['light', 'dark']) {
      await real.addInitScript(theme => localStorage.setItem('astra-theme', theme), theme)
      for (const route of ['/tools', '/signature-portrait', '/login', '/ascii-art']) {
        await real.goto(base + route, { waitUntil: 'load', timeout: 30000 })
        await real.locator('#main-content > *').waitFor()
        const metrics = await real.evaluate(async () => {
          const faces = await document.fonts.load('400 16px "DM Sans"', 'Astra')
          return { fontLoaded: faces.some(f => f.status === 'loaded'), bodyFamily: getComputedStyle(document.body).fontFamily, theme: document.documentElement.dataset.theme, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }
        })
        assert(metrics.fontLoaded)
        assert.match(metrics.bodyFamily, /DM Sans/)
        assert.equal(metrics.theme, theme)
        assert(metrics.scrollWidth <= width + 1)
        report.routes.push({ route, theme, width, ...metrics })
        if (route === '/tools') await real.screenshot({ path: path.join(out, `tools-${theme}-${width}.png`) })
      }
    }
  }
  assert.deepEqual(external, [])
  assert(requests.length > 0)
  report.noExternalFontRequests = true
  report.localFontRequests = requests
  await ui.close()

  const fallback = await browser.newContext({ reducedMotion: 'reduce' })
  await fallback.route('**/fonts/brand/*.woff2', route => route.fulfill({ status: 404, body: 'unavailable' }))
  const failed = await fallback.newPage()
  failed.on('pageerror', e => report.errors.push(e.message))
  await failed.goto(base + '/signature-portrait', { waitUntil: 'load', timeout: 30000 })
  const name = failed.getByLabel('名字', { exact: true })
  await name.fill('李云舟')
  assert.equal(await name.inputValue(), '李云舟')
  await failed.getByLabel('书写字体', { exact: true }).selectOption('zcoolkuaile')
  await failed.waitForFunction(() => document.querySelector('.font-preview .sample')?.textContent === '李云舟')
  assert.equal(await failed.getByRole('button', { name: '一键生成 100 种写法', exact: true }).isEnabled(), true)
  report.failures.push({ case: 'brand-font-404', editorOperable: true, separateSignatureFontLoaded: true })
  await fallback.close()
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' })
}
console.log(JSON.stringify({ out, passed: report.passed, pixels: report.pixels.length, routes: report.routes.length, failure: report.failure }))
