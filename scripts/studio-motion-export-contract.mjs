import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5194'
const out = path.resolve(
  process.env.ASTRA_MOTION_EXPORT_OUTPUT || `test-results/studio-motion-exports-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
  reducedMotion: 'no-preference',
})
const page = await context.newPage()
page.setDefaultTimeout(60000)
const report = { base, cases: [], errors: [], passed: false }
page.on('pageerror', (e) => report.errors.push(e.message))
const sha = (value) => createHash('sha256').update(value).digest('hex')
async function download(format, name) {
  await page.locator('.editor-header-actions .art-button').click()
  await page.locator('.format-grid button').filter({ hasText: format }).click()
  const pending = page.waitForEvent('download', { timeout: 120000 })
  await page.getByRole('button', { name: '免费下载作品', exact: true }).click()
  const result = await pending
  const file = path.join(out, name + path.extname(result.suggestedFilename()))
  await result.saveAs(file)
  await page.keyboard.press('Escape')
  return file
}
try {
  await page.goto(`${base}/ascii-art`, { waitUntil: 'domcontentloaded' })
  await page
    .locator('input[type=file]')
    .setInputFiles(path.resolve('public/artwork/portrait-reference.png'))
  await page.waitForFunction(
    () =>
      document.querySelector('.ascii-scroll canvas')?.width > 100 &&
      !document.querySelector('.editor-package')?.disabled,
  )
  await page.locator('details.calibrated-effects').evaluate((d) => {
    d.open = true
  })
  await page
    .getByRole('group', { name: '六模式悬停', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  const choices = page.getByRole('group', { name: '六模式微动', exact: true })
  let staticPngHash
  for (const [id, label] of [
    ['breathe', '光息'],
    ['wave', '流动'],
    ['assemble', '聚合'],
    ['current', '慢流'],
    ['reform', '重组'],
    ['caustics', '光斑'],
  ]) {
    await choices.getByRole('button', { name: label, exact: true }).click()
    for (const [control, value] of [
      ['art-motion-strength', 0.8],
      ['art-motion-speed', 0.7],
    ])
      await page.locator('#' + control).evaluate((input, value) => {
        input.value = String(value)
        input.dispatchEvent(new Event('input', { bubbles: true }))
      }, value)
    await page.waitForTimeout(120)
    if (await page.getByRole('button', { name: '暂停动效', exact: true }).count())
      await page.getByRole('button', { name: '暂停动效', exact: true }).click()
    const png = await download('PNG', id)
    const pngHash = sha(await readFile(png))
    staticPngHash ??= pngHash
    assert.equal(pngHash, staticPngHash, `${label}: free PNG retains the same static art`)
    const html = await download('动态网页', id)
    const text = await readFile(html, 'utf8')
    const payload = JSON.parse(
      text.match(/<script id="art-data" type="application\/json">([\s\S]*?)<\/script>/)[1],
    )
    assert.equal(payload.motion, id)
    assert.equal(payload.motionSpeed, 0.7)
    assert.equal(payload.motionStrength, 0.8)
    assert.equal(payload.effectProfile, 'expressive')
    assert.equal(payload.motionStyle, 'cinematic')
    assert(text.includes('MIT License') && text.includes('Copyright (c) 2026 ayangabryl'))
    const offlineContext = await browser.newContext({
      viewport: { width: 900, height: 800 },
      reducedMotion: 'no-preference',
    })
    await offlineContext.setOffline(true)
    const offline = await offlineContext.newPage()
    offline.on('pageerror', (e) => report.errors.push(e.message))
    const network = []
    offline.on('request', (request) => {
      if (/^https?:/.test(request.url())) network.push(request.url())
    })
    await offline.goto(pathToFileURL(html).href, { waitUntil: 'domcontentloaded' })
    await offline.waitForFunction(() => document.querySelector('canvas')?.dataset.ready === 'true')
    const snapshot = () => offline.locator('canvas').evaluate((c) => c.toDataURL())
    const paused = await snapshot()
    await offline.waitForTimeout(180)
    assert.equal(await snapshot(), paused, `${label}: exported pause is exact`)
    await offline.locator('#play').click()
    await offline.waitForTimeout(300)
    const first = await snapshot()
    await offline.waitForTimeout(450)
    const next = await snapshot()
    assert.notEqual(first, next, `${label}: production offline motion is live`)
    assert.deepEqual(network, [], `${label}: exported art needs no network`)
    await offlineContext.close()
    report.cases.push({
      id,
      pngHash,
      htmlHash: sha(text),
      offlineMotion: true,
      pausedExact: true,
      sourceParameters: true,
      networkRequests: 0,
      license: true,
    })
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await context.close()
  await browser.close()
}
console.log(`PASS six actual static PNG and offline HTML motion exports: ${out}`)
