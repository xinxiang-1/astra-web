import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_DEPTH_PROTOTYPE_OUTPUT || `test-results/depth-prototype-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'no-preference',
  recordVideo: { dir: path.join(out, 'raw'), size: { width: 1440, height: 960 } },
})
const page = await context.newPage()
page.setDefaultTimeout(60000)
const errors = [],
  report = { passed: false, base, browser: browser.version(), errors, cases: [], hashes: {} }
page.on('pageerror', (error) => errors.push(error.message))
for (const name of [
  'scripts/fixtures/kinetic-v2-renderer.ts',
  'src/lib/art-engine/canvas.ts',
  'docs/prototypes/v3-depth-motion/main.ts',
  'docs/prototypes/v3-depth-motion/index.html',
])
  report.hashes[name] = createHash('sha256')
    .update(await readFile(name))
    .digest('hex')
let raw, start, end
const began = Date.now()
try {
  await page.goto(`${base}/docs/prototypes/v3-depth-motion/index.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  })
  await page.waitForFunction(() => window.astraMotionPrototype?.ready)
  await page.evaluate(() => window.astraMotionPrototype.seek(0))
  // A separate complete-image hold must equal both the old renderer and static source.
  for (const [source, mode] of [
    ['portrait-reference.png', 'density'],
    ['pet.jpg', 'color'],
    ['landscape.jpg', 'phrase'],
  ]) {
    await page.evaluate(
      async ({ source, mode }) => window.astraMotionPrototype.setScene(source, mode),
      { source, mode },
    )
    for (const motion of ['breathe', 'wave', 'assemble', 'current', 'reform', 'caustics']) {
      await page.evaluate((motion) => {
        window.astraMotionPrototype.select(motion)
        window.astraMotionPrototype.seek(1.8)
      }, motion)
      const pixels = await page.evaluate(() =>
        ['studio', 'baseline', 'candidate'].map((id) => document.getElementById(id).toDataURL()),
      )
      assert.notEqual(pixels[1], pixels[2], `${mode}/${motion} differs from preceding cinematic`)
      const file = `${mode}-${motion}.png`
      await writeFile(path.join(out, file), Buffer.from(pixels[2].split(',')[1], 'base64'))
      report.cases.push({ source, mode, motion, changed: true, file })
    }
  }
  await page.evaluate(async () =>
    window.astraMotionPrototype.setScene('portrait-reference.png', 'density'),
  )
  start = (Date.now() - began) / 1000
  for (const [motion, duration] of [
    ['breathe', 7],
    ['wave', 5],
    ['assemble', 5],
    ['current', 5],
    ['reform', 12],
    ['caustics', 6],
  ]) {
    await page.locator(`[data-motion="${motion}"]`).click()
    await page.evaluate(() => window.astraMotionPrototype.play())
    await page.waitForTimeout(duration * 1000)
  }
  end = (Date.now() - began) / 1000
  await page.evaluate(() => {
    window.astraMotionPrototype.select('wave')
    window.astraMotionPrototype.seek(1.8)
  })
  await page.screenshot({ path: path.join(out, 'comparison.png'), fullPage: true })
  assert.deepEqual(errors, [])
  raw = await page.video().path()
  report.passed = true
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await context.close()
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
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
    '-preset',
    'fast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    path.join(out, 'six_motion_comparison.mp4'),
  ],
  { windowsHide: true },
)
console.log(`PASS 18 prototype scenes and six-motion video: ${out}`)
