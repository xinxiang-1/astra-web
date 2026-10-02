import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5194'
const out = path.resolve(
  process.env.ASTRA_WALKTHROUGH_OUTPUT || `test-results/studio-walkthrough-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out, { recursive: false })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'no-preference',
  recordVideo: { dir: path.join(out, 'raw-video'), size: { width: 1440, height: 960 } },
})
const created = Date.now()
const page = await context.newPage()
page.setDefaultNavigationTimeout(60000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const cases = []
let start, end, raw
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
  await page.waitForFunction(() => {
    const thumbnails = [...document.querySelectorAll('.editor-presets .character-art')]
    return thumbnails.length > 0 && thumbnails.every(e => e.classList.contains('ready'))
  }, undefined, {timeout:60000})
  await page.locator('details.calibrated-effects').evaluate((d) => {
    d.open = true
  })
  const choices = page.getByRole('group', { name: '六模式悬停', exact: true })
  await choices.scrollIntoViewIfNeeded()
  const canvas = page.locator('.ascii-scroll canvas')
  start = (Date.now() - created) / 1000
  for (const name of ['拖尾', '水面', '丝绸', '漩涡', '等高', '溶解', '涟漪', '轻推', '光晕']) {
    await page.mouse.move(0, 0)
    await choices.getByRole('button', { name, exact: true }).click()
    const rect = await canvas.boundingBox()
    for (let i = 0; i <= 30; i++) {
      const t = i / 30
      await page.mouse.move(
        rect.x + rect.width * (0.25 + 0.5 * t),
        rect.y + rect.height * (0.46 + Math.sin(t * Math.PI * 2) * 0.13),
      )
      await page.waitForTimeout(22)
    }
    await page.waitForTimeout(350)
    assert.equal(
      await choices
        .getByRole('button', { name, exact: true })
        .evaluate((b) => b.classList.contains('on')),
      true,
    )
    if (name === '水面') await page.screenshot({ path: path.join(out, 'studio_water_editor.png') })
    await page.mouse.move(0, 0)
    await page.waitForTimeout(650)
    cases.push(name)
  }
  end = (Date.now() - created) / 1000
  assert.deepEqual(errors, [])
  raw = await page.video().path()
} finally {
  await context.close()
  await browser.close()
}
// Deliver only the successful actual interaction interval, without setup or debugging.
const video = path.join(out, 'studio_nine_hover_effects.mp4')
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(start),
    '-i',
    raw,
    '-t',
    String(end - start),
    '-an',
    '-c:v',
    'libx264',
    '-crf',
    '20',
    '-preset',
    'fast',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    video,
  ],
  { windowsHide: true },
)
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    '2',
    '-i',
    video,
    '-frames:v',
    '1',
    path.join(out, 'review_first.png'),
  ],
  { windowsHide: true },
)
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-sseof',
    '-1',
    '-i',
    video,
    '-frames:v',
    '1',
    path.join(out, 'review_last.png'),
  ],
  { windowsHide: true },
)
await writeFile(
  path.join(out, 'report.json'),
  JSON.stringify({ passed: true, base, cases, errors, duration: end - start, video }, null, 2),
)
console.log(`PASS actual production walkthrough: ${video}`)
