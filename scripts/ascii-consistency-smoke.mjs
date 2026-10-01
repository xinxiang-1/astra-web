import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5173'
const output = path.resolve('test-results/ascii-consistency')
await mkdir(output, { recursive: true })

const fixtures = [
  'public/artwork/portrait.jpg',
  'public/artwork/landscape.jpg',
  'public/artwork/pet.jpg',
  'public/artwork/portrait-reference.png',
  'public/demos/ascii-live/aristotle-bust.webp',
]
const resolutions = [
  ['低清', 80],
  ['标清', 120],
  ['高清', 180],
  ['超清', 240],
  ['极清', 360],
]

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
page.setDefaultTimeout(30000)
const records = []
const errors = []
page.on('pageerror', error => errors.push(error.message))

async function stageBox() {
  return page.locator('.ascii-host').evaluate((node) => {
    const rect = node.getBoundingClientRect()
    const canvas = node.querySelector('canvas')
    const data = canvas?.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let hash = 2166136261
    if (data) for (let i = 0; i < data.length; i += 37) hash = Math.imul(hash ^ data[i], 16777619)
    return {
      hash,
      width: rect.width,
      height: rect.height,
      rasterWidth: canvas?.width ?? 0,
      rasterHeight: canvas?.height ?? 0,
    }
  })
}

try {
  // This suite deliberately tests the preserved Studio entry; six-mode contracts are separate.
  await page.goto(`${base}/ascii-art?engine=legacy`)
  const fileInput = page.locator('input[type="file"]').first()
  for (let fixtureIndex = 0; fixtureIndex < fixtures.length; fixtureIndex++) {
    await fileInput.setInputFiles(path.resolve(fixtures[fixtureIndex]))
    await page.waitForFunction(() => /\d+ × \d+ 字符/.test(document.body.innerText))

    for (const [label, columns] of resolutions) {
      await page.getByRole('button', { name: new RegExp(`^${label}`) }).click()
      await page.waitForFunction(
        (expected) => document.body.innerText.includes(`${expected} ×`),
        columns,
      )
      await page.waitForFunction(
        () => document.querySelector('.ascii-host canvas')?.width > 0,
      )
      // The result label updates before the scheduled canvas paint.
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      const before = await stageBox()

      await page
        .locator('details')
        .filter({ hasText: '动态效果' })
        .evaluate((details) => {
          details.open = true
        })
      await page.getByRole('button', { name: '拖尾', exact: true }).click()
      await page.locator('.ascii-host.live').waitFor()
      // Studio loads asynchronously; the .live class precedes its first frame.
      await page.waitForFunction(({ width, height }) => {
        const canvas = document.querySelector('.ascii-host.live canvas')
        const dpr = Math.min(devicePixelRatio, 2, 1920 / Math.max(width, height))
        return canvas?.width === Math.round(width * dpr) && canvas?.height === Math.round(height * dpr)
      }, before)
      const after = await stageBox()

      assert(Math.abs(before.width - after.width) <= 1, `${label}: stage width changed`)
      assert(Math.abs(before.height - after.height) <= 1, `${label}: stage height changed`)
      const dpr = Math.min(1, 1920 / Math.max(before.width, before.height))
      assert.equal(after.rasterWidth, Math.round(before.width * dpr), `${label}: Studio did not fit its stage`)

      await page.getByRole('button', { name: '关闭', exact: true }).first().click()
      await page.waitForFunction((expected) => {
        const canvas = document.querySelector('.ascii-host:not(.live) canvas')
        return canvas?.width === expected
      }, before.rasterWidth)
      const stillAgain = await stageBox()
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      )
      const settled = await stageBox()
      assert.equal(settled.hash, before.hash, `${label}: static/hover-off pixels differ`)
      // Legacy has separate text/Studio rasters; turning Studio off restores the original.
      assert.equal(
        stillAgain.rasterWidth,
        before.rasterWidth,
        `${label}: restored static raster differs`,
      )
      records.push({ fixture: fixtures[fixtureIndex], columns, before, animated: after, restored: settled })
    }

    await page.screenshot({
      path: path.join(output, `${String(fixtureIndex + 1).padStart(2, '0')}.png`),
      fullPage: true,
    })
  }
  console.log(
    'PASS: legacy 5 fixtures × 5 clarity presets preserve fitted stage and restore static pixels; native grid parity is covered by ascii-studio-render, calibrated media by art-editor.',
  )
  console.log(`Screenshots: ${output}`)
  assert.deepEqual(errors, [])
} finally {
  await writeFile(path.join(output, 'contract.json'), JSON.stringify({ scope: 'Legacy stage/static restoration, not cross-renderer pixel or grid equality', records, errors }, null, 2))
  await browser.close()
}
