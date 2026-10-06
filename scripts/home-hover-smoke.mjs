import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(process.env.ASTRA_HOVER_OUTPUT || 'test-results/home-interaction')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
page.setDefaultNavigationTimeout(60000)
const errors = []
const results = []
page.on('pageerror', error => errors.push(error.message))
function upright(matrix) {
  assert(matrix.a > .99 && matrix.d > .99, `Unexpected mirror or scale: ${JSON.stringify(matrix)}`)
  assert(Math.abs(matrix.b) < .01 && Math.abs(matrix.c) < .01, `Unexpected rotation: ${JSON.stringify(matrix)}`)
}
async function geometry(locator) {
  return locator.evaluate(element => {
    const style = getComputedStyle(element)
    const matrix = new DOMMatrixReadOnly(style.transform)
    const rect = element.getBoundingClientRect()
    return { text: element.textContent.trim(), a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, opacity: Number(style.opacity), writingMode: style.writingMode, width: rect.width, height: rect.height }
  })
}
async function assertLink(locator, name) {
  await locator.scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(280)
  const before = await geometry(locator)
  await locator.hover()
  await page.waitForTimeout(400)
  const after = await geometry(locator)
  upright(after)
  assert.equal(after.writingMode, 'horizontal-tb', `${name} must stay horizontal`)
  assert.equal(after.opacity, before.opacity, `${name} must not inherit logo beam opacity`)
  assert(Math.abs(after.width - before.width) < 1 && Math.abs(after.height - before.height) < 1, `${name} must not rotate its bounding box`)
  results.push({ name, before, after })
}
try {
  await page.goto(base)
  await page.locator('.hero-art .ready').waitFor()
  const logo = page.locator('.art-header a').filter({ has: page.locator('.astra-logo') }).first()
  await assertLink(logo, 'navigation logo link')
  const star = await geometry(logo.locator('.mark-star'))
  assert(Math.abs(star.a) < .01 && star.b > .99, 'Only the logo star should rotate on hover')
  assert.equal(await logo.locator('.mark-beam').evaluate(e => Number(getComputedStyle(e).opacity)), .7)
  await assertLink(page.getByRole('link', { name: '作品', exact: true }), 'gallery navigation')
  await assertLink(page.locator('.hero-actions .primary'), 'hero primary button')
  await assertLink(page.locator('.hero-actions .art-link'), 'browse works link')
  await page.screenshot({ path: path.join(out, 'after-hero-hover.png') })
  await assertLink(page.locator('.featured-section .art-section-heading .art-link'), 'all works link')
  await assertLink(page.locator('.featured-grid .art-card').first(), 'featured artwork card')
  await page.locator('.engine-story').scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: /中文铺字/, exact: false }).click()
  await page.locator('.story-art .ready').waitFor()
  await page.getByRole('button', { name: '涟漪', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '涟漪', exact: true }).getAttribute('aria-pressed'), 'true')
  const canvas = page.locator('.story-art canvas')
  const bounds = await canvas.boundingBox()
  await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .4)
  await page.mouse.move(bounds.x + bounds.width * .7, bounds.y + bounds.height * .55, { steps: 20 })
  await page.waitForTimeout(150)
  await page.locator('.engine-story').screenshot({ path: path.join(out, 'after-story-hover.png') })
  await page.getByRole('button', { name: '光晕', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: '光晕', exact: true }).getAttribute('aria-pressed'), 'true')
  for (const width of [1100, 820, 620, 600, 550, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => scrollTo(0, 0))
    await assertLink(page.locator('.hero-actions .art-link'), `browse works / ${width}px`)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}px horizontal overflow`)
  }
  await page.screenshot({ path: path.join(out, 'after-mobile-hover.png') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.evaluate(() => scrollTo(0, 0))
  await logo.hover()
  await page.waitForTimeout(200)
  upright(await geometry(logo.locator('.mark-star')))
  await assertLink(page.locator('.hero-actions .art-link'), 'browse works / reduced motion')
  assert.deepEqual(errors, [])
  await writeFile(path.join(out, 'hover-regression.json'), JSON.stringify({ base, browser: await browser.version(), viewportWidths: [1440, 1100, 820, 620, 600, 550, 390], results, errors }, null, 2))
  console.log(`PASS: ${results.length} link checks, logo star/beam isolation, hover choices, reduced motion, mobile widths; no runtime exceptions.`)
} finally { await browser.close() }
