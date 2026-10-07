import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(
  process.env.ASTRA_REGION_OUTPUT || `test-results/signature-photo-region-${Date.now()}`,
)
const dev = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const base = process.env.ASTRA_UI_URL || 'http://127.0.0.1:5188'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
  reducedMotion: 'reduce',
  hasTouch: true,
  recordVideo: process.argv.includes('--record')
    ? { dir: path.join(out, 'video'), size: { width: 1440, height: 960 } }
    : undefined,
})
const page = await context.newPage()
const report = { browser: browser.version(), dev, production: base, errors: [], cases: [] }
page.on('pageerror', (e) => report.errors.push(e.message))
const hashes = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
for (const file of [
  'src/lib/image-region.ts',
  'src/components/ui/ImageRegionSelect.vue',
  'src/components/signature/SignatureCutoutDialog.vue',
  'src/lib/signature-portrait/cutout-client.ts',
  'src/lib/signature-portrait/signature-cutout.ts',
]) {
  ;(report.sourceHashes ??= {})[file] = await hashes(file)
}
try {
  await page.goto(dev + '/signature-portrait')
  const data = await page.evaluate(async () => {
    const { prepareSignaturePhoto, openSignaturePhoto, signatureRegionPixels, cutoutSignature } =
      await import('/src/lib/signature-portrait/cutout-client.ts')
    const { imageRegionBounds } = await import('/src/lib/image-region.ts')
    const check = (v, message) => {
      if (!v) throw Error(message)
    }
    const image = new Image()
    image.src = '/docs/research/2026-10-04-signature-capacity/beethoven-signature.svg'
    await image.decode()
    const source = document.createElement('canvas')
    source.width = 6000
    source.height = 3000
    const ctx = source.getContext('2d', { willReadFrequently: true })
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, source.width, source.height)
    ctx.drawImage(image, 2420, 1280, 1160, 160)
    ctx.fillStyle = '#142028'
    ctx.fillRect(200, 200, 900, 180)
    ctx.fillRect(4400, 2000, 300, 500)
    const region = { x: 0.4, y: 0.4, width: 0.2, height: 0.1 }
    const native = ctx.getImageData(2400, 1200, 1200, 300)
    const blob = await new Promise((resolve) => source.toBlob(resolve, 'image/png'))
    const file = new File([blob], 'historical-signature-paper.png', { type: 'image/png' })
    const full = await prepareSignaturePhoto(file, new AbortController().signal)
    const cropped = await prepareSignaturePhoto(file, new AbortController().signal, region)
    check(full.width === 2032 && full.height === 1016, 'whole photo bounded')
    check(
      cropped.width === 1200 && cropped.height === 300,
      'crop before downsample preserves native dimensions',
    )
    let changed = 0
    for (let i = 0; i < native.data.length; i++) if (native.data[i] !== cropped.data[i]) changed++
    check(changed === 0, 'native selected photo pixels exact')
    const a = await cutoutSignature(
      cropped,
      { polarity: 'auto', sensitivity: 60 },
      new AbortController().signal,
    )
    const b = await cutoutSignature(
      native,
      { polarity: 'auto', sensitivity: 60 },
      new AbortController().signal,
    )
    check(
      a.pixels.width === b.pixels.width &&
        a.pixels.height === b.pixels.height &&
        a.pixels.data.every((v, i) => v === b.pixels.data[i]),
      'extracted native handwriting exact',
    )
    const prepared = await openSignaturePhoto(file, new AbortController().signal)
    const recrop = signatureRegionPixels(prepared.image, region)
    prepared.dispose()
    check(
      recrop.data.every((v, i) => v === cropped.data[i]),
      'cached native decode recrop exact',
    )
    const badRegions = [
      { x: -0.01, y: 0, width: 0.2, height: 0.2 },
      { x: 0, y: 0, width: 0, height: 0.2 },
      { x: 0.9, y: 0.9, width: 0.2, height: 0.2 },
      { x: NaN, y: 0, width: 1, height: 1 },
    ]
    for (const r of badRegions) {
      let rejected = false
      try {
        imageRegionBounds(6000, 3000, r)
      } catch {
        rejected = true
      }
      check(rejected, 'invalid crop rejected')
    }
    const aborted = new AbortController()
    aborted.abort()
    let cancelled = false
    try {
      await prepareSignaturePhoto(file, aborted.signal, region)
    } catch (e) {
      cancelled = e.name === 'AbortError'
    }
    check(cancelled, 'preabort before decode')
    const tooWide = document.createElement('canvas')
    tooWide.width = 12001
    tooWide.height = 1
    const wideBlob = await new Promise((resolve) => tooWide.toBlob(resolve))
    tooWide.width = 1
    let wideRejected = false
    try {
      await prepareSignaturePhoto(
        new File([wideBlob], 'too-wide.png', { type: 'image/png' }),
        new AbortController().signal,
      )
    } catch (e) {
      wideRejected = e.message.includes('12000')
    }
    check(wideRejected, 'source long-side budget')
    const png = (pixels) => {
      const c = document.createElement('canvas')
      c.width = pixels.width
      c.height = pixels.height
      c.getContext('2d').putImageData(pixels, 0, 0)
      return c.toDataURL('image/png').split(',')[1]
    }
    const result = {
      original: source.toDataURL('image/png').split(',')[1],
      expected: png(a.pixels),
      width: a.pixels.width,
      height: a.pixels.height,
      crop: region,
      changed,
      wholePhoto: [full.width, full.height],
      nativeCrop: [cropped.width, cropped.height],
      fixtureFileBytes: blob.size,
      rejected: 6,
    }
    source.width = source.height = 1
    return result
  })
  const fixture = path.join(out, 'historical-signature-paper.png')
  const expectedBytes = Buffer.from(data.expected, 'base64')
  await writeFile(fixture, Buffer.from(data.original, 'base64'))
  await writeFile(path.join(out, 'expected-native.png'), expectedBytes)
  const expectedUrl = 'data:image/png;base64,' + data.expected
  delete data.original
  delete data.expected
  report.cases.push({ case: 'crop-original-before-resize-and-native-cutout', ...data })
  await page.goto(base + '/signature-portrait')
  let liveUrls = 0
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL)
    window.__regionUrls = new Set()
    URL.createObjectURL = (blob) => {
      const url = create(blob)
      window.__regionUrls.add(url)
      return url
    }
    URL.revokeObjectURL = (url) => {
      window.__regionUrls.delete(url)
      revoke(url)
    }
  })
  const upload = () => page.locator('input[type=file][multiple]').setInputFiles(fixture)
  const ready = async (button = '确认并加入画像') =>
    page.waitForFunction(
      (button) => {
        const el = [...document.querySelectorAll('dialog button')].find(
          (el) => el.textContent.trim() === button,
        )
        return el && !el.disabled
      },
      button,
      { timeout: 30000 },
    )
  const fields = async () => {
    for (const [label, value] of [
      ['宽度', '20'],
      ['高度', '10'],
      ['左侧', '40'],
      ['上侧', '40'],
    ]) {
      const input = page.getByLabel(`签名区域${label}百分比`)
      await input.fill(value)
      await input.press('Tab')
    }
    await ready()
  }
  const comparePreview = async () =>
    page.evaluate(
      async ({ expectedUrl, width, height }) => {
        const actual = document.querySelector('dialog .checker img')
        await actual.decode()
        const expected = new Image()
        expected.src = expectedUrl
        await expected.decode()
        if (actual.naturalWidth !== width || actual.naturalHeight !== height)
          return { dimensions: [actual.naturalWidth, actual.naturalHeight], changed: -1 }
        const pixels = (img) => {
          const c = document.createElement('canvas')
          c.width = width
          c.height = height
          c.getContext('2d').drawImage(img, 0, 0)
          return c.getContext('2d').getImageData(0, 0, width, height).data
        }
        const a = pixels(actual),
          b = pixels(expected)
        let changed = 0
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++
        return { dimensions: [actual.naturalWidth, actual.naturalHeight], changed }
      },
      { expectedUrl, width: data.width, height: data.height },
    )
  await upload()
  await ready()
  await fields()
  assert.equal((await comparePreview()).changed, 0)
  await page.screenshot({ path: path.join(out, 'crop-desktop.png') })
  await page.getByRole('button', { name: '使用整张图片', exact: true }).click()
  await ready()
  const stage = page.locator('.image-stage'),
    box = await stage.boundingBox()
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 12 })
  assert(await page.getByRole('button', { name: '确认并加入画像', exact: true }).isDisabled())
  await page.mouse.up()
  await ready()
  const pointer = await page.getByLabel('签名区域宽度百分比').inputValue()
  assert(Math.abs(Number(pointer) - 20) < 0.1)
  await stage.focus()
  await stage.press('ArrowRight')
  await ready()
  assert.equal(Number(await page.getByLabel('签名区域左侧百分比').inputValue()), 41)
  await fields()
  const corner = await page.locator('.corner.nw').boundingBox()
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2)
  await page.mouse.down()
  await page.mouse.move(
    corner.x + corner.width / 2 + box.width * 0.01,
    corner.y + corner.height / 2 + box.height * 0.01,
  )
  await page.mouse.up()
  await ready()
  assert(Math.abs(Number(await page.getByLabel('签名区域宽度百分比').inputValue()) - 19) < 0.1)
  assert(Math.abs(Number(await page.getByLabel('签名区域高度百分比').inputValue()) - 9) < 0.1)
  const edgeCorner = await page.locator('.corner.nw').boundingBox()
  await page.mouse.move(edgeCorner.x + edgeCorner.width / 2, edgeCorner.y + edgeCorner.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x - 20, box.y - 20)
  await page.mouse.up()
  await ready()
  assert.equal(Number(await page.getByLabel('签名区域左侧百分比').inputValue()), 0)
  assert.equal(Number(await page.getByLabel('签名区域上侧百分比').inputValue()), 0)
  // Restore an exact integer-aligned source crop for the acceptance/output check.
  await fields()
  assert.equal((await comparePreview()).changed, 0)
  await page.getByRole('button', { name: '确认并加入画像', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.stamps img[alt="historical-signature-paper.png"]').count(), 1)
  assert.equal(await page.evaluate(() => window.__regionUrls.size), liveUrls)
  report.cases.push({
    case: 'production-mouse-keyboard-native-preview-confirm-and-url-release',
    passed: true,
  })
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme)
    await upload()
    await ready()
    await fields()
    assert(await page.getByRole('dialog').evaluate((el) => el.scrollWidth <= el.clientWidth))
    await stage.scrollIntoViewIfNeeded()
    const client = await context.newCDPSession(page),
      touchBox = await stage.boundingBox()
    const tp = { x: touchBox.x + touchBox.width * 0.5, y: touchBox.y + touchBox.height * 0.45 }
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...tp, id: 1 }],
    })
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: tp.x + touchBox.width * 0.02, y: tp.y, id: 1 }],
    })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await client.detach()
    await ready()
    assert(Math.abs(Number(await page.getByLabel('签名区域左侧百分比').inputValue()) - 42) < 0.2)
    const cancelClient = await context.newCDPSession(page)
    await cancelClient.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: tp.x + touchBox.width * 0.02, y: tp.y, id: 2 }],
    })
    await cancelClient.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: tp.x + touchBox.width * 0.04, y: tp.y, id: 2 }],
    })
    await cancelClient.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await cancelClient.detach()
    await ready()
    assert(Math.abs(Number(await page.getByLabel('签名区域左侧百分比').inputValue()) - 42) < 0.2)
    assert((await page.getByRole('dialog').textContent()).includes('选区边缘仍有笔迹'))
    await fields()
    assert.equal((await comparePreview()).changed, 0)
    await page.screenshot({ path: path.join(out, `crop-${theme}-mobile.png`) })
    await page.getByLabel('取消签名抠图').click()
    assert.equal(await page.evaluate(() => window.__regionUrls.size), liveUrls)
  }
  report.cases.push({
    case: 'two-theme-mobile-real-touch-move-cancel-no-append-or-url-leak',
    passed: true,
  })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.locator('input[type=file][multiple]').setInputFiles([fixture, fixture])
  await ready('确认笔迹，下一张')
  await fieldsForBatch()
  await page.getByRole('button', { name: '确认笔迹，下一张', exact: true }).click()
  await ready()
  assert.equal(Number(await page.getByLabel('签名区域宽度百分比').inputValue()), 100)
  await page.getByRole('button', { name: '取消上传', exact: true }).click()
  assert.equal(await page.locator('.stamps img[alt="historical-signature-paper.png"]').count(), 1)
  report.cases.push({ case: 'batch-next-resets-crop-and-cancel-is-atomic', passed: true })
  async function fieldsForBatch() {
    for (const [label, value] of [
      ['宽度', '20'],
      ['高度', '10'],
      ['左侧', '40'],
      ['上侧', '40'],
    ]) {
      const input = page.getByLabel(`签名区域${label}百分比`)
      await input.fill(value)
      await input.press('Tab')
    }
    await ready('确认笔迹，下一张')
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (e) {
  report.failure = e.stack
  process.exitCode = 1
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
} finally {
  await context.close()
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    out,
    passed: report.passed,
    failure: report.failure,
    cases: report.cases.length,
  }),
)
