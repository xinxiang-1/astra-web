import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const phase = process.env.ASTRA_MOTION_PHASE || 'candidate'
const motionStyle = process.env.ASTRA_MOTION_STYLE || 'cinematic'
const out = path.resolve(
  process.env.ASTRA_MOTION_DEMO_OUTPUT || `test-results/studio-motion-demo-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out)
await mkdir(path.join(out, 'source'))
const hashes = {}
for (const file of [
  'src/lib/art-engine/canvas.ts',
  'src/views/AsciiArtView.vue',
  'src/components/CharacterArtwork.vue',
  'src/views/ArtHomeView.vue',
  'src/lib/ascii/studio-preview.ts',
]) {
  hashes[file] = createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
  await copyFile(file, path.join(out, 'source', file.replaceAll('/', '__')))
}
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'no-preference',
  recordVideo: { dir: path.join(out, 'raw'), size: { width: 1440, height: 960 } },
})
const page = await context.newPage()
// Flush the initial compositor frame so the video epoch cannot begin only
// after a slow production-page load. Trim times start after this known paint.
await page.goto('about:blank')
await page.screenshot()
await page.waitForTimeout(200)
const created = Date.now()
page.setDefaultTimeout(60000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const report = {
  phase,
  base,
  motionStyle,
  browser: browser.version(),
  hashes,
  cases: [],
  errors,
  passed: false,
}
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
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.editor-presets .character-art')].every((e) =>
      e.classList.contains('ready'),
    ),
  )
  await page.locator('details.calibrated-effects').evaluate((d) => {
    d.open = true
  })
  const styleChoice = page
    .getByRole('group', { name: '动效风格', exact: true })
    .getByRole('button', { name: motionStyle === 'studio' ? 'Studio' : '电影感', exact: true })
  await styleChoice.click()
  assert.equal(await styleChoice.getAttribute('aria-pressed'), 'true')
  await page
    .getByRole('group', { name: '六模式悬停', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  await page.mouse.move(0, 0)
  const choices = page.getByRole('group', { name: '六模式微动', exact: true })
  await choices.scrollIntoViewIfNeeded()
  const canvas = page.locator('.ascii-scroll canvas')
  start = (Date.now() - created) / 1000
  for (const [id, label, duration] of [
    ['breathe', '光息', 6],
    ['wave', '流动', 5],
    ['assemble', '聚合', 5],
    ['current', '慢流', 5],
    ['reform', '重组', 12],
    ['caustics', '光斑', 6],
  ]) {
    const caseStart = (Date.now() - created) / 1000
    await choices.getByRole('button', { name: label, exact: true }).click()
    assert(
      await choices
        .getByRole('button', { name: label, exact: true })
        .evaluate((b) => b.classList.contains('on')),
    )
    await page.waitForFunction(
      () => Number(document.querySelector('.ascii-scroll canvas')?.dataset.time) > 0,
    )
    const intervals = [0.6, 1.8, duration - 0.2]
    const snapshots = []
    const observed = []
    for (const point of intervals) {
      // The editor caps long frame gaps. Wait on its rendered clock, rather
      // than assuming a wall-clock delay proves a complete regrouping cycle.
      await page.waitForFunction((point) => {
        const c = document.querySelector('.ascii-scroll canvas')
        const speed = Number(document.getElementById('art-motion-speed')?.value || 1)
        return Number(c?.dataset.time) * speed >= point
      }, point)
      const capture = await canvas.evaluate((c) => ({
        image: c.toDataURL(),
        time: Number(c.dataset.time),
        speed: Number(document.getElementById('art-motion-speed')?.value || 1),
      }))
      const snapshot = capture.image
      await writeFile(
        path.join(out, `${id}-${point.toFixed(1)}.png`),
        Buffer.from(snapshot.split(',')[1], 'base64'),
      )
      snapshots.push(snapshot)
      observed.push({ targetSeconds: point, ambientSeconds: capture.time, effectiveSeconds: capture.time * capture.speed, speed: capture.speed })
    }
    assert.notEqual(snapshots[0], snapshots[1], `${label} must have a visible animation process`)
    report.cases.push({
      id,
      label,
      startSeconds: caseStart - start,
      endSeconds: (Date.now() - created) / 1000 - start,
      observed,
    })
  }
  end = (Date.now() - created) / 1000
  report.recordedSeconds = end - start
  assert.deepEqual(errors, [])
  report.uiPassed = true
  raw = await page.video().path()
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await context.close()
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
const video = path.join(out, `studio_six_motions_${phase}.mp4`)
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
try {
  const metadata = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_name,width,height',
        '-of',
        'json',
        video,
      ],
      { encoding: 'utf8', windowsHide: true },
    ),
  )
  const duration = Number(metadata.format.duration)
  assert(
    Math.abs(duration - report.recordedSeconds) < 1,
    'The video contains the complete walkthrough',
  )
  assert.equal(metadata.streams[0].codec_name, 'h264')
  assert.equal(metadata.streams[0].width, 1440)
  assert.equal(metadata.streams[0].height, 960)
  report.video = { file: path.basename(video), duration, width: 1440, height: 960, codec: 'h264' }
  report.passed = true
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(`PASS actual six motion walkthrough: ${video}`)
