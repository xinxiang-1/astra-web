import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5192'
const out = path.resolve(
  process.env.ASTRA_EFFECTS_MEDIA_OUTPUT || 'sandbox/art-effects/2026-10-01-v2/media-final',
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out, { recursive: false })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'no-preference',
  acceptDownloads: true,
})
page.setDefaultTimeout(30000)
page.setDefaultNavigationTimeout(60000)
const report = { base, errors: [], passed: false }
page.on('pageerror', (e) => report.errors.push(e.message))
const snapshot = () => page.locator('.ascii-scroll canvas').evaluate((c) => c.toDataURL())
async function exportFile(format, name) {
  await page.locator('.editor-header-actions .art-button').click()
  await page.locator('.format-grid button').filter({ hasText: format }).click()
  const pending = page.waitForEvent('download', { timeout: 120000 })
  await page.getByRole('button', { name: '免费下载作品', exact: true }).click()
  const download = await pending,
    dest = path.join(out, name + path.extname(download.suggestedFilename()))
  await download.saveAs(dest)
  await page.keyboard.press('Escape')
  return dest
}
async function range(id, value) {
  await page.locator('#' + id).evaluate((input, value) => {
    input.value = String(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}
try {
  await page.goto(`${base}/ascii-art`, { waitUntil: 'domcontentloaded' })
  await page.locator('input[type=file]').setInputFiles(path.resolve('public/artwork/portrait.jpg'))
  await page.waitForFunction(
    () =>
      document.querySelector('.ascii-scroll canvas')?.width > 100 &&
      !document.querySelector('.editor-package')?.disabled,
  )
  await page.locator('.calibrated-effects').evaluate((d) => {
    d.open = true
  })
  await page
    .getByRole('group', { name: '六模式微动' })
    .getByRole('button', { name: '流动', exact: true })
    .click()
  await page.waitForTimeout(350)
  await page.getByRole('button', { name: '暂停动效', exact: true }).click()
  const frozen = await page.locator('.ascii-scroll canvas').getAttribute('data-time')
  const box = await page.locator('.ascii-scroll canvas').boundingBox()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4)
  await page.waitForTimeout(550)
  assert.equal(await page.locator('.ascii-scroll canvas').getAttribute('data-time'), frozen)
  assert(
    Number(await page.locator('.ascii-scroll canvas').getAttribute('data-interaction-time')) >
      Number(frozen),
  )
  await page.mouse.move(box.x - 8, box.y + box.height * 0.4)
  await page.waitForFunction(
    () => document.querySelector('.ascii-scroll canvas')?.dataset.pointerStrength === '0' && document.querySelector('.ascii-scroll canvas')?.dataset.interactionActive === 'false',
  )
  const settled = await snapshot()
  await page.waitForTimeout(250)
  assert((await snapshot()) === settled)
  report.pause = { ambientTimeFrozen: true, hoverTimeContinues: true, outsideCanvasFades: true }
  await page
    .getByRole('group', { name: '六模式微动' })
    .getByRole('button', { name: '静态', exact: true })
    .click()
  await page.getByRole('button', { name: '光晕', exact: true }).scrollIntoViewIfNeeded()
  // Full-page screenshot includes controls; the canvas screenshot shows actual glyph light.
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4)
  await page.waitForTimeout(450)
  await page.screenshot({ path: path.join(out, 'editor-effects-controls.png') })
  await page.locator('.ascii-scroll canvas').screenshot({ path: path.join(out, 'glyph-light.png') })
  await page.mouse.move(0, 0)
  await page
    .locator('input[type=file]')
    .setInputFiles(path.resolve('test-results/editor-contract-source.mp4'))
  await page.waitForFunction(
    () =>
      document.querySelector('.video-thumb.show')?.readyState >= 2 &&
      !document.querySelector('.editor-package')?.disabled,
  )
  await page.getByRole('button', { name: /^超清/ }).click()
  await page.locator('.clip-panel').waitFor()
  await page.locator('.clip-panel').getByRole('button', { name: '自定义', exact: true }).click()
  await page.locator('.clip-custom-field input').first().fill('0.5')
  await page.locator('.clip-custom-field input').first().dispatchEvent('change')
  await page.getByLabel('片段起点').evaluate((input) => {
    input.value = '0.2'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByRole('button', { name: /^低清/ }).click()
  await page
    .getByRole('group', { name: '六模式微动' })
    .getByRole('button', { name: '聚合', exact: true })
    .click()
  await range('art-motion-speed', 0.4)
  await range('art-motion-strength', 0.9)
  const htmlFile = await exportFile('动态网页', 'video-effects')
  const html = await readFile(htmlFile, 'utf8'),
    data = JSON.parse(
      html.match(/<script id="art-data" type="application\/json">([\s\S]*?)<\/script>/)[1],
    )
  const movie = await exportFile('视频', 'video-effects')
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', movie],
      { encoding: 'utf8' },
    ),
  )
  const stream = probe.streams.find((s) => s.codec_type === 'video')
  assert(stream?.width === 1280 && Math.abs(Number(probe.format.duration) - 0.5) < 0.09)
  const decoded = path.join(out, 'decoded-frame-3.png')
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-i',
    movie,
    '-vf',
    'select=eq(n\\,3)',
    '-frames:v',
    '1',
    decoded,
  ])
  const reference = await browser.newPage()
  await reference.goto('http://127.0.0.1:5180/ascii-art', { waitUntil: 'domcontentloaded' })
  report.encoded = await reference.evaluate(
    async ({ data, decoded }) => {
      const { createArtCore, createCanvasArtRenderer, ART_DEFAULTS, ART_ENGINE_VERSION } =
        await import('/src/lib/art-engine/index.ts')
      const glyphs = await Promise.all(
        data.frame.glyphs.map(async (g) => {
          const image = new Image()
          image.src = g.png
          await image.decode()
          const tile = document.createElement('canvas')
          tile.width = image.width
          tile.height = image.height
          tile.getContext('2d').drawImage(image, 0, 0)
          return { char: g.char, coverage: g.coverage, tile }
        }),
      )
      const core = createArtCore(ART_DEFAULTS, ART_ENGINE_VERSION)
      core.primeAtlas({ ...data.frame, glyphs })
      const video = document.createElement('video')
      video.muted = true
      video.src = data.source.dataUrl
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve
        video.onerror = reject
      })
      await new Promise((resolve) => {
        video.onseeked = resolve
        video.currentTime = data.source.start + 3 / 15
      })
      const frame = core.prepareArtFrame(
        video,
        video.videoWidth,
        video.videoHeight,
        data.frame.settings,
      )
      const c = document.createElement('canvas'),
        r = createCanvasArtRenderer(c)
      const image = new Image()
      image.src = decoded
      await image.decode()
      const actual = document.createElement('canvas')
      actual.width = image.width
      actual.height = image.height
      actual.getContext('2d').drawImage(image, 0, 0)
      const pixels = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data
      function error(options) {
        r.render(frame, { longEdge: 1280, motion: data.motion, time: 3 / 15, ...options })
        const expected = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
        let sum = 0
        for (let i = 0; i < pixels.length; i++) sum += Math.abs(expected[i] - pixels[i])
        return sum / (pixels.length * 255)
      }
      const correct = error({
        effectProfile: data.effectProfile,
        motionSpeed: data.motionSpeed,
        motionStrength: data.motionStrength,
      })
      const ignored = error({})
      const wrongSpeed = error({
        effectProfile: data.effectProfile,
        motionSpeed: 1,
        motionStrength: data.motionStrength,
      })
      const wrongStrength = error({
        effectProfile: data.effectProfile,
        motionSpeed: data.motionSpeed,
        motionStrength: 0.2,
      })
      r.destroy()
      return {
        correct,
        ignored,
        wrongSpeed,
        wrongStrength,
        motion: data.motion,
        motionSpeed: data.motionSpeed,
        motionStrength: data.motionStrength,
      }
    },
    { data, decoded: 'data:image/png;base64,' + (await readFile(decoded)).toString('base64') },
  )
  assert(report.encoded.correct < 0.04)
  assert(report.encoded.correct < report.encoded.ignored * 0.8)
  assert(report.encoded.correct < report.encoded.wrongSpeed * 0.9)
  assert(report.encoded.correct < report.encoded.wrongStrength * 0.8)
  report.video = {
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    duration: probe.format.duration,
    selectedStart: data.source.start,
    selectedEnd: data.source.end,
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  await browser.close()
  console.log(JSON.stringify(report))
}
