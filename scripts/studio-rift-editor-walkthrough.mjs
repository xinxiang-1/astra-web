import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5194'
const out = path.resolve(
  process.env.ASTRA_RIFT_DEMO_OUTPUT || `test-results/rift-editor-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out)
const sha = (b) => createHash('sha256').update(b).digest('hex')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'no-preference',
  acceptDownloads: true,
  recordVideo: { dir: path.join(out, 'raw'), size: { width: 1440, height: 960 } },
})
const page = await context.newPage()
page.setDefaultTimeout(60000)
page.on('dialog', (d) => d.accept())
const report = { passed: false, base, errors: [], cases: [], offline: [], input: [], video: null }
page.on('pageerror', (e) => report.errors.push(e.message))
await page.goto('about:blank')
await page.screenshot()
await page.waitForTimeout(200)
const epoch = Date.now()
let begin, end, raw, offlineTouchHtml
const canvas = page.locator('.ascii-scroll canvas')
const pixels = (c) => c.evaluate((c) => c.toDataURL())
async function setup(p) {
  await p.goto(`${base}/ascii-art`, { waitUntil: 'domcontentloaded' })
  await p
    .locator('input[type=file]')
    .setInputFiles(path.resolve('public/artwork/portrait-reference.png'))
  await p.waitForFunction(
    () =>
      document.querySelector('.ascii-scroll canvas')?.width > 100 &&
      !document.querySelector('.editor-package')?.disabled,
  )
  if (await p.locator('.mobile-editor-tabs').isVisible())
    await p.locator('.mobile-editor-tabs button').nth(1).click()
  await p
    .getByRole('group', { name: '采样清晰度', exact: true })
    .getByRole('button', { name: '标清', exact: true })
    .click()
  await p.waitForFunction(
    () => document.querySelector('.ascii-scroll canvas')?.dataset.columns === '120',
  )
  await p.locator('details.calibrated-effects').evaluate((d) => {
    d.open = true
  })
  await p
    .getByRole('group', { name: '六模式悬停', exact: true })
    .getByRole('button', { name: '撕裂试用', exact: true })
    .click()
  await p.waitForFunction(
    () => document.querySelector('.ascii-scroll canvas')?.dataset.hover === 'rift',
  )
}
async function stroke(p, c, shape = 's', count = 12, delay = 24) {
  await c.scrollIntoViewIfNeeded()
  const rect = await c.boundingBox()
  const start = Date.now()
  for (let i = 0; i <= count; i++) {
    const t = i / count
    const x = shape === 'circle' ? 0.5 + Math.cos(t * Math.PI * 2) * 0.2 : 0.2 + t * 0.6
    const y =
      shape === 'circle'
        ? 0.5 + Math.sin(t * Math.PI * 2) * 0.18
        : 0.5 + Math.sin(t * Math.PI * 2) * 0.15
    await p.mouse.move(rect.x + rect.width * x, rect.y + rect.height * y)
    await p.waitForTimeout(delay)
  }
  return { shape, moves: count + 1, actualMs: Date.now() - start }
}
async function touchStroke(p, c, host) {
  await c.scrollIntoViewIfNeeded()
  const rect = await c.boundingBox(),
    before = await pixels(c)
  assert.equal(await c.evaluate((c) => getComputedStyle(c).touchAction), 'none')
  await host.evaluate((host) => {
    const counters = { pointerdown: 0, pointermove: 0, pointerup: 0, pointercancel: 0 }
    host.astraTouchCounters = counters
    for (const type of Object.keys(counters))
      host.addEventListener(type, (event) => {
        if (event.pointerType === 'touch') counters[type]++
      })
  })
  const cdp = await p.context().newCDPSession(p)
  try {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: rect.x + rect.width * 0.25, y: rect.y + rect.height * 0.5 }],
    })
    for (let i = 1; i <= 10; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: rect.x + rect.width * (0.25 + i / 20),
            y: rect.y + rect.height * (0.5 + Math.sin((i / 10) * Math.PI) * 0.12),
          },
        ],
      })
      await p.waitForTimeout(40)
    }
    assert.notEqual(await pixels(c), before, 'continuous touch feedback')
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    const counters = await host.evaluate((host) => host.astraTouchCounters)
    assert.equal(counters.pointerdown, 1)
    assert(counters.pointermove >= 9, JSON.stringify(counters))
    assert.equal(counters.pointerup, 1)
    assert.equal(counters.pointercancel, 0)
    await p.waitForFunction(
      ({ selector, before }) => document.querySelector(selector)?.toDataURL() === before,
      {
        selector: await c.evaluate((c) =>
          c.closest('.fs-scroll')
            ? '.fs-scroll canvas'
            : c.closest('.ascii-scroll')
              ? '.ascii-scroll canvas'
              : 'canvas',
        ),
        before,
      },
      { timeout: 20000 },
    )
    return { counters, changed: true, exactRecovery: true }
  } finally {
    await cdp.detach()
  }
}
async function selectProfile(mode, label, quality) {
  await page.locator('.six-modes button').filter({ hasText: label }).click()
  if (mode === 'density') {
    const color = page.getByRole('button', { name: '彩色', exact: true })
    if (await color.evaluate((button) => button.classList.contains('on'))) await color.click()
  }
  if (mode === 'density' || mode === 'color')
    await page.locator(`button[data-quality="${quality}"]`).click()
  await page.waitForFunction(
    ({ mode, quality }) => {
      const c = document.querySelector('.ascii-scroll canvas')
      return c?.dataset.mode === mode && c.dataset.quality === quality
    },
    { mode, quality },
  )
}
async function settle(p, selector = '.ascii-scroll canvas') {
  await p.mouse.move(1, 1)
  await p.waitForFunction(
    (selector) => {
      const c = document.querySelector(selector)
      return (
        c && c.dataset.interactionActive === 'false' && Number(c.dataset.pointerStrength) < 0.002
      )
    },
    selector,
    { timeout: 20000 },
  )
}
async function download(format, name, pngOptions) {
  await page.locator('.editor-header-actions .art-button').click()
  await page.locator('.format-grid button').filter({ hasText: format }).click()
  if (pngOptions) {
    await page.locator('.size-options').getByRole('button', { name: '4K', exact: true }).click()
    await page.locator('.transparent-toggle input').setChecked(pngOptions.transparent)
  }
  const pending = page.waitForEvent('download', { timeout: 120000 })
  await page.getByRole('button', { name: '免费下载作品', exact: true }).click()
  const result = await pending
  const dest = path.join(out, name + path.extname(result.suggestedFilename()))
  await result.saveAs(dest)
  await page.keyboard.press('Escape')
  return dest
}
try {
  await setup(page)
  begin = (Date.now() - epoch) / 1000
  const profiles = [
    ['density', '光影字符', 'classic'],
    ['color', '原色字符', 'classic'],
    ['phrase', '中文铺字', 'classic'],
    ['contour', '轮廓线稿', 'classic'],
    ['braille', '点阵细节', 'classic'],
    ['halftone', '印刷网点', 'classic'],
    ['density', '光影字符', 'detailed'],
    ['density', '光影字符', 'smooth'],
    ['density', '光影字符', 'faithful'],
    ['color', '原色字符', 'faithful'],
  ]
  for (const [mode, label, quality] of profiles) {
    await selectProfile(mode, label, quality)
    await settle(page)
    const still = await pixels(canvas)
    report.input.push({ mode, quality, ...(await stroke(page, canvas)) })
    assert.notEqual(await pixels(canvas), still, `${mode}/${quality} actual input feedback`)
    if (mode === 'density' && quality === 'classic')
      await page.screenshot({ path: path.join(out, 'during.png') })
    await settle(page)
    assert.equal(await pixels(canvas), still, `${mode}/${quality} exact recovery`)
    report.cases.push({ mode, quality, hover: 'rift', changed: true, exactRecovery: true })
  }
  end = (Date.now() - epoch) / 1000
  await selectProfile('density', '光影字符', 'classic')
  await settle(page)
  await page.screenshot({ path: path.join(out, 'recovered.png') })
  await page
    .getByRole('group', { name: '六模式微动', exact: true })
    .getByRole('button', { name: '流动', exact: true })
    .click()
  await page.getByRole('button', { name: '暂停动效', exact: true }).click()
  await page.waitForFunction(() => {
    const c = document.querySelector('.ascii-scroll canvas')
    return c?.dataset.paused === 'true' && c.dataset.motion === 'wave'
  })
  await settle(page)
  const paused = await pixels(canvas),
    time = await canvas.getAttribute('data-time')
  await stroke(page, canvas)
  assert.notEqual(await pixels(canvas), paused)
  assert.equal(await canvas.getAttribute('data-time'), time)
  await settle(page)
  assert.equal(await pixels(canvas), paused)
  report.cases.push({ name: 'paused ambient still interacts', passed: true })
  await page
    .getByRole('group', { name: '六模式微动', exact: true })
    .getByRole('button', { name: '静态', exact: true })
    .click()
  await page.locator('#art-hover-strength').fill('0')
  await page.locator('#art-hover-strength').dispatchEvent('input')
  await page.waitForFunction(() => {
    const c = document.querySelector('.ascii-scroll canvas')
    return c?.dataset.motion === 'none' && c.dataset.hoverStrength === '0'
  })
  await settle(page)
  const zero = await pixels(canvas)
  await stroke(page, canvas)
  assert.equal(await pixels(canvas), zero)
  report.cases.push({ name: 'zero strength', passed: true })
  await page.locator('#art-hover-strength').fill('0.65')
  await page.locator('#art-hover-strength').dispatchEvent('input')
  await page.waitForFunction(
    () => document.querySelector('.ascii-scroll canvas')?.dataset.hoverStrength === '0.65',
  )
  await settle(page)
  await page.locator('.stage-fullscreen').click()
  const full = page.locator('.fs-overlay canvas')
  await full.waitFor()
  await page.waitForFunction(() => {
    const c = document.querySelector('.fs-overlay canvas')
    return c?.dataset.hover === 'rift' && c.width > 100 && c.height > 200
  })
  await settle(page, '.fs-overlay canvas')
  const fullStill = await pixels(full)
  await stroke(page, full, 'circle')
  assert.notEqual(await pixels(full), fullStill)
  await settle(page, '.fs-overlay canvas')
  assert((await pixels(full)) === fullStill, 'fullscreen exact recovery')
  await page.getByRole('button', { name: '退出全屏', exact: true }).click()
  report.cases.push({ name: 'fullscreen input and exact recovery', passed: true })
  const hiddenClock = await canvas.getAttribute('data-interaction-time')
  await page.waitForTimeout(350)
  assert.equal(await canvas.getAttribute('data-interaction-time'), hiddenClock)
  report.cases.push({ name: 'idle stops painting', passed: true })
  // Actual UI exports; open the downloaded standalone page with networking disabled.
  for (const [mode, label, quality] of profiles) {
    await selectProfile(mode, label, quality)
    await settle(page)
    const key = `${mode}-${quality}`
    const png = await download('PNG', key)
    await page
      .getByRole('group', { name: '六模式悬停', exact: true })
      .getByRole('button', { name: '关闭', exact: true })
      .click()
    const offPng = await download('PNG', `${key}-hover-off`)
    assert.equal(
      sha(await readFile(png)),
      sha(await readFile(offPng)),
      'hover keeps static PNG exact',
    )
    await page
      .getByRole('group', { name: '六模式悬停', exact: true })
      .getByRole('button', { name: '撕裂试用', exact: true })
      .click()
    const html = await download('动态网页', key),
      text = await readFile(html, 'utf8')
    if (mode === 'density' && quality === 'classic') offlineTouchHtml = html
    const payload = JSON.parse(
      text.match(/<script id="art-data" type="application\/json">([\s\S]*?)<\/script>/)[1],
    )
    assert.equal(payload.hover, 'rift')
    assert.equal(payload.hoverStrength, 0.65)
    assert.equal(payload.hoverRadius, 0.38)
    assert.equal(payload.frame.settings.mode, mode)
    const off = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      reducedMotion: 'no-preference',
    })
    await off.setOffline(true)
    const op = await off.newPage()
    op.on('pageerror', (e) => report.errors.push(e.message))
    const requests = []
    op.on('request', (r) => {
      if (/^https?:/.test(r.url())) requests.push(r.url())
    })
    await op.goto(pathToFileURL(html).href)
    await op.waitForFunction(() => document.querySelector('canvas')?.dataset.ready === 'true')
    const oc = op.locator('canvas'),
      before = await pixels(oc)
    await stroke(op, oc, 's', 12, 32)
    assert.notEqual(await pixels(oc), before, `${mode} offline feedback`)
    await op.mouse.move(1, 1)
    await op.waitForFunction(
      (before) => document.querySelector('canvas')?.toDataURL() === before,
      before,
      { timeout: 20000 },
    )
    assert.deepEqual(requests, [])
    await off.close()
    report.offline.push({
      mode,
      quality,
      staticPngExact: true,
      pngHash: sha(await readFile(png)),
      htmlHash: sha(await readFile(html)),
      actualRift: true,
      exactRecovery: true,
      httpRequests: 0,
    })
  }
  await selectProfile('density', '光影字符', 'classic')
  await settle(page)
  const textFile = await download('文本', 'rift-text'),
    textPayload = JSON.parse(
      (await readFile(offlineTouchHtml, 'utf8')).match(
        /<script id="art-data" type="application\/json">([\s\S]*?)<\/script>/,
      )[1],
    )
  assert.equal((await readFile(textFile, 'utf8')).replace(/^\uFEFF/, ''), textPayload.frame.text)
  const transparent4k = await download('PNG', 'rift-transparent-4k', { transparent: true })
  await page
    .getByRole('group', { name: '六模式悬停', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click()
  const static4k = await download('PNG', 'static-transparent-4k', { transparent: true })
  assert.deepEqual(await readFile(transparent4k), await readFile(static4k))
  const pngDetails = await page.evaluate(
    async (base64) => {
      const image = new Image()
      image.src = 'data:image/png;base64,' + base64
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(image, 0, 0)
      const data = ctx.getImageData(0, 0, image.width, image.height).data
      let clearPixels = 0,
        visiblePixels = 0
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] === 0) clearPixels++
        else visiblePixels++
      }
      return { width: image.width, height: image.height, clearPixels, visiblePixels }
    },
    (await readFile(transparent4k)).toString('base64'),
  )
  assert.equal(Math.max(pngDetails.width, pngDetails.height), 3840)
  assert(pngDetails.clearPixels > 0 && pngDetails.visiblePixels > 0)
  report.cases.push({
    name: 'free actual TXT and transparent 4K static output',
    txtExact: true,
    staticPngExact: true,
    txtHash: sha(await readFile(textFile)),
    pngHash: sha(await readFile(transparent4k)),
    ...pngDetails,
  })
  const reduced = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      reducedMotion: 'reduce',
    }),
    rp = await reduced.newPage()
  rp.on('pageerror', (e) => report.errors.push(e.message))
  await setup(rp)
  const rc = rp.locator('.ascii-scroll canvas'),
    rStill = await pixels(rc)
  assert.equal(await rc.evaluate((c) => getComputedStyle(c).touchAction), 'auto')
  await stroke(rp, rc)
  assert.equal(await pixels(rc), rStill)
  await reduced.close()
  report.cases.push({ name: 'real reduced motion', passed: true })
  const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: 'no-preference',
    }),
    mp = await mobile.newPage()
  mp.on('pageerror', (e) => report.errors.push(e.message))
  await setup(mp)
  const mc = mp.locator('.ascii-scroll canvas')
  const mobileTouch = await touchStroke(mp, mc, mp.locator('.ascii-scroll'))
  report.cases.push({ name: '390px continuous touch release and exact recovery', ...mobileTouch })
  await mp.locator('.stage-fullscreen').click()
  await mp.waitForFunction(
    () => document.querySelector('.fs-scroll canvas')?.dataset.hover === 'rift',
  )
  const mobileFullTouch = await touchStroke(
    mp,
    mp.locator('.fs-scroll canvas'),
    mp.locator('.fs-scroll'),
  )
  report.cases.push({ name: '390px fullscreen continuous touch', ...mobileFullTouch })
  await mp.getByRole('button', { name: '退出全屏', exact: true }).click()
  await mp.getByRole('button', { name: '原图', exact: true }).click()
  assert.equal(await mc.evaluate((c) => getComputedStyle(c).touchAction), 'auto')
  await mp.getByRole('button', { name: '效果', exact: true }).click()
  await mp.locator('#art-hover-strength').fill('0')
  await mp.locator('#art-hover-strength').dispatchEvent('input')
  assert.equal(await mc.evaluate((c) => getComputedStyle(c).touchAction), 'auto')
  await mp.locator('#art-hover-strength').fill('0.65')
  await mp.locator('#art-hover-strength').dispatchEvent('input')
  await mp
    .getByRole('group', { name: '六模式悬停', exact: true })
    .getByRole('button', { name: '拖尾', exact: true })
    .click()
  assert.equal(await mc.evaluate((c) => getComputedStyle(c).touchAction), 'auto')
  await mp
    .getByRole('group', { name: '六模式悬停', exact: true })
    .getByRole('button', { name: '撕裂试用', exact: true })
    .click()
  await mp.emulateMedia({ reducedMotion: 'reduce' })
  await mp.waitForFunction(
    () => getComputedStyle(document.querySelector('.ascii-scroll canvas')).touchAction === 'auto',
  )
  report.cases.push({
    name: 'touch scope: original, zero strength, old trail, dynamic reduced motion',
    passed: true,
  })
  assert(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await mobile.close()
  const offlineMobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    reducedMotion: 'no-preference',
  })
  await offlineMobile.setOffline(true)
  const omp = await offlineMobile.newPage(),
    offlineRequests = []
  omp.on('pageerror', (e) => report.errors.push(e.message))
  omp.on('request', (r) => {
    if (/^https?:/.test(r.url())) offlineRequests.push(r.url())
  })
  await omp.goto(pathToFileURL(offlineTouchHtml).href)
  await omp.waitForFunction(() => document.querySelector('canvas')?.dataset.ready === 'true')
  const offlineMobileTouch = await touchStroke(
    omp,
    omp.locator('canvas'),
    omp.locator('#art-stage'),
  )
  assert.deepEqual(offlineRequests, [])
  await omp.emulateMedia({ reducedMotion: 'reduce' })
  await omp.waitForFunction(
    () => getComputedStyle(document.querySelector('canvas')).touchAction === 'auto',
  )
  report.cases.push({
    name: '390px offline continuous touch, recovery and reduced motion',
    httpRequests: 0,
    ...offlineMobileTouch,
  })
  await offlineMobile.close()
  assert.equal(report.errors.length, 0)
  report.passed = true
} catch (e) {
  report.failure = String(e)
  throw e
} finally {
  raw = await page.video().path()
  await context.close()
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
const movie = path.join(out, 'studio_rift_editor.mp4')
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
  sha256: sha(await readFile(movie)),
  codec: metadata.streams[0].codec_name,
  width: metadata.streams[0].width,
  height: metadata.streams[0].height,
  duration: Number(metadata.format.duration),
}
await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(
  JSON.stringify({
    passed: report.passed,
    cases: report.cases.length,
    offline: report.offline.length,
    video: report.video,
    out,
  }),
)
