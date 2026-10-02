import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const phase = process.env.ASTRA_PARITY_PHASE || 'final'
const out = path.resolve(
  process.env.ASTRA_PARITY_OUTPUT || `test-results/hover-parity-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out, { recursive: false })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'no-preference',
})
const page = await context.newPage()
page.setDefaultTimeout(30000)
page.setDefaultNavigationTimeout(60000)
const report = {
  phase,
  base,
  browser: browser.version(),
  errors: [],
  sourceHashes: {},
  cases: [],
  passed: false,
}
page.on('pageerror', (e) => report.errors.push(e.message))
for (const file of [
  'src/components/CharacterArtwork.vue',
  'src/views/ArtHomeView.vue',
  'src/lib/ascii/studio-preview.ts',
  'src/lib/art-engine/canvas.ts',
]) {
  report.sourceHashes[file] = createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
}
async function stroke(canvas, name) {
  await page.mouse.move(0, 0)
  await page.waitForTimeout(1700)
  await canvas.screenshot({ path: path.join(out, `${name}-rest.png`) })
  await canvas.evaluate((c) => {
    window.__hoverRest = new Uint8ClampedArray(
      c.getContext('2d').getImageData(0, 0, c.width, c.height).data,
    )
  })
  const rect = await canvas.boundingBox()
  let peakMAE = 0
  const difference = () =>
    canvas.evaluate((c) => {
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += Math.abs(data[i] - window.__hoverRest[i])
      return sum / data.length
    })
  // An actual timed S-shaped path, rather than a single stationary pixel comparison.
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    await page.mouse.move(
      rect.x + rect.width * (0.23 + 0.55 * t),
      rect.y + rect.height * (0.48 + Math.sin(t * Math.PI * 2) * 0.16),
    )
    await page.waitForTimeout(16)
    if (i % 6 === 0) peakMAE = Math.max(peakMAE, await difference())
  }
  await canvas.screenshot({ path: path.join(out, `${name}-wake.png`) })
  const wakeMAE = await difference()
  peakMAE = Math.max(peakMAE, wakeMAE)
  await page.waitForTimeout(300)
  await canvas.screenshot({ path: path.join(out, `${name}-after-300ms.png`) })
  await page.mouse.move(0, 0)
  await page.waitForTimeout(2300)
  await canvas.screenshot({ path: path.join(out, `${name}-leave.png`) })
  let settledMAE = null
  if (phase !== 'baseline' && name.startsWith('editor-')) {
    assert(peakMAE > 0.02, `${name}: actual trajectory must affect the artwork`)
    await page.waitForFunction(
      () => document.querySelector('.ascii-scroll canvas')?.dataset.interactionActive === 'false',
      undefined,
      { timeout: 15000 },
    )
    settledMAE = await canvas.evaluate((c) => {
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      let sum = 0
      for (let i = 0; i < data.length; i++) sum += Math.abs(data[i] - window.__hoverRest[i])
      return sum / data.length
    })
    assert.equal(settledMAE, 0, `${name}: leave must restore exact still pixels`)
  }
  report.cases.push({
    name,
    wakeMAE,
    peakMAE,
    settledMAE,
    timedPath: '24 segments / 16ms minimum event interval / S curve',
    canvas: rect,
  })
}
try {
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.locator('.hero-art .ready').waitFor()
  const hero = page.locator('.hero-art canvas')
  // Reveal the rendered side so the reference is not obscured by the comparison photograph.
  await page.locator('.hero-art input[type=range]').fill('0')
  await stroke(hero, 'home-native-trail')
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
  const canvas = page.locator('.ascii-scroll canvas')
  const hovers = page.getByRole('group', { name: '六模式悬停', exact: true })
  for (const [id, label] of [
    ['trail', '拖尾'],
    ['water', '水面'],
    ['silk', '丝绸'],
    ['vortex', '漩涡'],
    ['light', '光晕'],
    ['ripple', '涟漪'],
    ['displace', '轻推'],
    ['contour', '等高'],
    ['dissolve', '溶解'],
  ]) {
    await hovers.getByRole('button', { name: label, exact: true }).click()
    await page.mouse.move(0, 0)
    await stroke(canvas, `editor-${id}`)
  }
  if (phase !== 'baseline') {
    await hovers.getByRole('button', { name: '拖尾', exact: true }).click()
    for (const quality of ['detailed', 'smooth', 'faithful']) {
      await page.locator(`button[data-quality="${quality}"]`).click()
      await page.waitForFunction(
        (q) => document.querySelector('.ascii-scroll canvas')?.dataset.quality === q,
        quality,
      )
      await stroke(canvas, `editor-${quality}-trail`)
    }
    await page.locator('.six-modes button').filter({ hasText: '原色字符' }).click()
    await page.locator('button[data-quality="faithful"]').click()
    await page.waitForFunction(() => {
      const c = document.querySelector('.ascii-scroll canvas')
      return c?.dataset.quality === 'faithful' && c?.dataset.mode === 'color'
    })
    await stroke(canvas, 'editor-color-faithful-trail')
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (e) {
  report.failure = e.stack
  throw e
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(
  `PASS ${phase}: native home, all 9 editor hover trajectories, quality trails and exact restoration; ${out}`,
)
