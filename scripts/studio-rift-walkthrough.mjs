import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_RIFT_DEMO_OUTPUT || `test-results/studio-rift-demo-${Date.now()}`,
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
const report = {
  passed: false,
  base,
  browser: browser.version(),
  errors: [],
  cases: [],
  hashes: {},
  timeline: [],
}
page.on('pageerror', (error) => report.errors.push(error.message))
for (const name of [
  'src/lib/art-engine/canvas.ts',
  'docs/prototypes/v7-studio-rift/presentation.ts',
  'docs/prototypes/v7-studio-rift/main.ts',
  'docs/prototypes/v7-studio-rift/index.html',
])
  report.hashes[name] = createHash('sha256')
    .update(await readFile(name))
    .digest('hex')
const started = Date.now()
let begin, end, raw
const pixels = (id) => page.locator(`#${id}`).evaluate((c) => c.toDataURL())
async function stroke(shape, duration, count = 36) {
  const began = Date.now()
  const rect = await page.locator('#rift').boundingBox()
  assert(rect)
  for (let i = 0; i <= count; i++) {
    const t = i / count
    const x =
      shape === 'circle'
        ? 0.5 + Math.cos(t * Math.PI * 2) * 0.23
        : shape === 'face'
          ? 0.3 + t * 0.25
          : 0.2 + t * 0.6
    const y =
      shape === 'circle'
        ? 0.42 + Math.sin(t * Math.PI * 2) * 0.17
        : 0.42 + Math.sin(t * Math.PI * 2) * 0.12
    await page.mouse.move(rect.x + x * rect.width, rect.y + y * rect.height)
    await page.waitForTimeout(duration / count)
  }
  return { requestedMs: duration, actualMs: Date.now() - began, moves: count + 1 }
}
async function settle() {
  await page.mouse.move(1, 1)
  await page.waitForFunction(
    () =>
      !window.astraRiftPrototype.state.pointer.active &&
      window.astraRiftPrototype.state.stats.peakOffset === 0,
    undefined,
    { timeout: 20000 },
  )
}
try {
  await page.goto(`${base}/docs/prototypes/v7-studio-rift/index.html`, {
    waitUntil: 'domcontentloaded',
  })
  await page.waitForFunction(() => window.astraRiftPrototype?.ready)
  await page.evaluate(async () =>
    window.astraRiftPrototype.setScene('landscape.jpg', 'phrase', 'software'),
  )
  assert(await page.locator('#quality').isDisabled())
  assert.equal(await page.locator('#quality').inputValue(), 'classic')
  await page.evaluate(async () =>
    window.astraRiftPrototype.setScene('portrait-reference.png', 'density'),
  )
  assert(await page.locator('#quality').isEnabled())
  report.cases.push({ name: '画质选项与实际适用模式一致', passed: true })
  const still = await pixels('rift')
  begin = (Date.now() - started) / 1000
  for (const [name, shape, duration] of [
    ['缓慢划动', 's', 3000],
    ['快速S路径', 's', 450],
    ['连续绕圈', 'circle', 1200],
  ]) {
    const input = await stroke(shape, duration, name === '快速S路径' ? 10 : 36)
    const state = await page.evaluate(() => window.astraRiftPrototype.state)
    assert(state.pointer.active && state.stats.peakOffset > 0)
    assert.notEqual(await pixels('rift'), await pixels('native'))
    report.timeline.push({ name, wallSeconds: (Date.now() - started) / 1000, state, input })
    await page.waitForTimeout(500)
  }
  await stroke('face', 250, 8)
  await page.screenshot({ path: path.join(out, 'fluid_rift_during_fast_stroke.png') })
  await settle()
  assert.equal(await pixels('rift'), still)
  report.cases.push({ name: '慢拖/快速S/绕圈/停住/离开', exactRecovery: true })
  await page.screenshot({ path: path.join(out, 'fluid_rift_after_recovery.png') })
  for (const [source, mode] of [
    ['pet.jpg', 'color'],
    ['landscape.jpg', 'phrase'],
  ]) {
    await page.evaluate(
      async ({ source, mode }) => window.astraRiftPrototype.setScene(source, mode),
      { source, mode },
    )
    const original = await pixels('rift')
    await stroke('s', 600)
    assert.notEqual(await pixels('rift'), original)
    report.timeline.push({
      name: mode,
      wallSeconds: (Date.now() - started) / 1000,
      state: await page.evaluate(() => window.astraRiftPrototype.state),
    })
    await page.waitForTimeout(600)
    await settle()
    assert.equal(await pixels('rift'), original)
    report.cases.push({ name: `实际${mode}素材交互`, exactRecovery: true })
  }
  end = (Date.now() - started) / 1000
  await page.evaluate(async () =>
    window.astraRiftPrototype.setScene('portrait-reference.png', 'density'),
  )
  await page.locator('#ambient').click()
  await page.locator('#pause').click()
  const before = await pixels('rift')
  await stroke('s', 650)
  assert.notEqual(await pixels('rift'), before)
  report.cases.push({ name: '环境暂停时仍可交互', passed: true })
  await settle()
  await page.locator('#ambient').click()
  await page.locator('#reset').click()
  await page.locator('#strength').fill('0')
  await page.locator('#strength').dispatchEvent('input')
  const zero = await pixels('rift')
  await stroke('s', 450)
  assert.equal(await pixels('rift'), zero)
  assert.equal(await pixels('rift'), await pixels('native'))
  report.cases.push({ name: '零强度原位', passed: true })
  await page.locator('#strength').fill('0.65')
  await page.locator('#strength').dispatchEvent('input')
  await settle()
  await page.locator('#full').click()
  await page.waitForFunction(() => !!document.fullscreenElement)
  await stroke('s', 450)
  assert((await page.evaluate(() => window.astraRiftPrototype.state)).pointer.active)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.fullscreenElement)
  await settle()
  report.cases.push({ name: '全屏坐标与释放', passed: true })
  await page.locator('.boards').evaluate((e) => {
    e.style.display = 'none'
  })
  await page.waitForTimeout(200)
  const hiddenClock = await page.evaluate(() => window.astraRiftPrototype.state.clock)
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => window.astraRiftPrototype.state.clock), hiddenClock)
  await page.locator('.boards').evaluate((e) => {
    e.style.display = ''
  })
  await page.waitForFunction((time) => window.astraRiftPrototype.state.clock > time, hiddenClock)
  report.cases.push({ name: '画布退出可见区域停止绘制/重新可见恢复', passed: true })
  const reduced = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  const rp = await reduced.newPage()
  rp.on('pageerror', (e) => report.errors.push(e.message))
  await rp.goto(`${base}/docs/prototypes/v7-studio-rift/index.html`)
  await rp.waitForFunction(() => window.astraRiftPrototype?.ready)
  const rStill = await rp.locator('#rift').evaluate((c) => c.toDataURL()),
    rRect = await rp.locator('#rift').boundingBox()
  await rp.mouse.move(rRect.x + rRect.width * 0.3, rRect.y + rRect.height * 0.5)
  await rp.mouse.move(rRect.x + rRect.width * 0.7, rRect.y + rRect.height * 0.5)
  await rp.waitForTimeout(300)
  assert.equal(await rp.locator('#rift').evaluate((c) => c.toDataURL()), rStill)
  report.cases.push({ name: '真实减少动效媒体查询', passed: true })
  await reduced.close()
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'no-preference',
  })
  const mp = await mobile.newPage()
  mp.on('pageerror', (e) => report.errors.push(e.message))
  await mp.goto(`${base}/docs/prototypes/v7-studio-rift/index.html`)
  await mp.waitForFunction(() => window.astraRiftPrototype?.ready)
  await mp.locator('#rift').scrollIntoViewIfNeeded()
  const mRect = await mp.locator('#rift').boundingBox(),
    mStill = await mp.locator('#rift').evaluate((c) => c.toDataURL())
  const cdp = await mobile.newCDPSession(mp)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: mRect.x + mRect.width * 0.25, y: mRect.y + mRect.height * 0.5 }],
  })
  for (let i = 1; i <= 12; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: mRect.x + mRect.width * (0.25 + (i / 12) * 0.5),
          y: mRect.y + mRect.height * (0.5 + Math.sin((i / 12) * Math.PI) * 0.15),
        },
      ],
    })
    await mp.waitForTimeout(30)
  }
  assert.notEqual(await mp.locator('#rift').evaluate((c) => c.toDataURL()), mStill)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await mp.waitForFunction(
    () =>
      !window.astraRiftPrototype.state.pointer.active &&
      window.astraRiftPrototype.state.stats.peakOffset === 0,
  )
  assert.equal(await mp.locator('#rift').evaluate((c) => c.toDataURL()), mStill)
  assert(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  report.cases.push({ name: '390px真实触控/释放/复原', passed: true })
  await mobile.close()
  assert.equal(report.errors.length, 0)
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  raw = await page.video().path()
  await context.close()
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
const movie = path.join(out, 'studio_native_and_fluid_rift.mp4')
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    String(begin),
    '-i',
    raw,
    '-t',
    String(end - begin),
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    '-y',
    movie,
  ],
  { windowsHide: true },
)
const metadata = JSON.parse(
  execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', movie], {
    encoding: 'utf8',
    windowsHide: true,
  }),
)
report.video = {
  file: path.basename(movie),
  sha256: createHash('sha256')
    .update(await readFile(movie))
    .digest('hex'),
  codec: metadata.streams[0].codec_name,
  width: metadata.streams[0].width,
  height: metadata.streams[0].height,
  duration: Number(metadata.format.duration),
}
await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(
  JSON.stringify({ passed: report.passed, cases: report.cases.length, video: report.video, out }),
)
