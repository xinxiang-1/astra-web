import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const dataDir = path.resolve(process.env.ASTRA_PRINT_DATA || 'test-results/signature-print-research')
const out = path.resolve(process.env.ASTRA_PRINT_UI_OUTPUT || `test-results/signature-print-ui-${channel}-${Date.now()}`)
const data = JSON.parse(await readFile(path.join(dataDir, 'report.json'), 'utf8'))
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel, headless: true })
const report = { browser: browser.version(), channel, errors: [], cases: [] }
const selections = [
  ['beethoven', 'porcelain', 'paper', 'candidate', '4096'],
  ['beethoven', 'portrait', 'night', 'ink', '2048'],
  ['chinese', 'porcelain', 'paper', 'cutout', '2048'],
  ['chinese', 'portrait', 'night', 'candidate', '4096'],
  ['english', 'porcelain', 'night', 'cutout', '2048'],
  ['english', 'portrait', 'paper', 'candidate', '4096'],
]
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
try {
  for (const mobile of [false, true]) {
    const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1100 }, reducedMotion: mobile ? 'reduce' : 'no-preference', acceptDownloads: true })
    page.on('pageerror', error => report.errors.push(error.message))
    await page.goto(base + '/docs/prototypes/v11-signature-print/index.html', { waitUntil: 'domcontentloaded' })
    const ready = () => page.waitForFunction(() => document.querySelector('#app')?.dataset.ready === 'true', undefined, { timeout: 90000 })
    await ready()
    const cases = mobile ? [selections[0], selections[5]] : selections
    for (const [template, source, palette, profile, size] of cases) {
      for (const [id, value] of [['template', template], ['source', source], ['palette', palette], ['profile', profile], ['size', size]]) {
        if (await page.locator(`#${id}`).inputValue() !== value) {
          await page.locator(`#${id}`).selectOption(value)
          await ready()
        }
      }
      const entry = await page.evaluate(async () => {
        const canvas = document.querySelector('#canvas-host canvas'), crop = document.querySelector('#crop canvas')
        const bytes = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        const native = crop.getContext('2d').getImageData(0, 0, crop.width, crop.height).data
        const x0 = Math.round(canvas.width * .5 - 140), y0 = Math.round(canvas.height * .36 - 90)
        let changed = 0
        for (let y = 0; y < 180; y++) for (let x = 0; x < 280; x++) for (let c = 0; c < 4; c++) if (native[(y * 280 + x) * 4 + c] !== bytes[((y0 + y) * canvas.width + x0 + x) * 4 + c]) changed++
        const controls = Array.from(document.querySelectorAll('select,button'), e => { const r = e.getBoundingClientRect(); return { width: r.width, height: r.height, disabled: e.disabled } })
        return { width: canvas.width, height: canvas.height, rgbaSha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join(''), cropChangedChannels: changed, cropChannels: native.length, overflow: document.documentElement.scrollWidth - window.innerWidth, controls }
      })
      const label = `${template}-${source}-${palette}-${size}`
      const expected = data.cases.find(c => c.label === label && c.profile === profile)
      assert.equal(entry.rgbaSha256, expected.rgbaSha256, 'Actual UI must match the measured complete raster')
      assert.equal(entry.cropChangedChannels, 0)
      assert.equal(entry.overflow, 0)
      assert(entry.controls.every(control => control.height >= 44 && !control.disabled))
      report.cases.push({ label, profile, mobile, ...entry })
    }
    const downloading = page.waitForEvent('download')
    await page.getByRole('button', { name: '免费下载研究 PNG', exact: true }).click()
    const artifact = await downloading
    const filename = path.join(out, mobile ? 'mobile-download.png' : 'desktop-download.png')
    await artifact.saveAs(filename)
    const expectedFile = path.join(dataDir, 'english-portrait-paper-4096-candidate.png')
    assert.equal(sha(await readFile(filename)), sha(await readFile(expectedFile)))
    await page.screenshot({ path: path.join(out, mobile ? 'mobile-long-name.png' : 'desktop-long-name.png'), fullPage: true })
    await page.locator('#template').focus()
    const focus = await page.locator('#template').evaluate(e => ({ focused: document.activeElement === e, outlineWidth: getComputedStyle(e).outlineWidth }))
    assert(focus.focused && parseFloat(focus.outlineWidth) >= 3)
    await page.close()
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) { report.passed = false; report.failure = error.stack; throw error }
finally { await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ out, passed: report.passed, cases: report.cases.length, errors: report.errors, failure: report.failure })); await browser.close() }
