import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(
  process.env.ASTRA_SIGNATURE_PROJECT_OUTPUT || `test-results/signature-project-${Date.now()}`,
)
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const restoreBrowser = await chromium.launch({
  channel: process.env.ASTRA_RESTORE_BROWSER_CHANNEL || 'chrome',
  headless: true,
})
const report = {
  sourceBrowser: browser.version(),
  restoreBrowser: restoreBrowser.version(),
  errors: [],
  rejections: [],
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
let restorePage = null
async function download(page, button, filename) {
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: button, exact: true }).click()
  const file = await downloading
  await file.saveAs(path.join(out, filename))
  await page.getByRole('button', { name: '生成预览', exact: true }).waitFor()
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (b) => b.textContent.trim() === '生成预览' && !b.disabled,
    ),
  )
  return await readFile(path.join(out, filename))
}
async function layout(page, label) {
  return JSON.parse(await download(page, '下载矢量 JSON', `${label}.json`))
}
async function native(page) {
  await page.getByRole('button', { name: '原大', exact: true }).click()
  await page.locator('.stage').evaluate((el) => {
    el.scrollLeft = 0
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
  })
  await page.locator('.sharp-viewport-canvas').waitFor({ state: 'attached', timeout: 90000 })
  return await page.locator('.sharp-viewport-canvas').evaluate(async (canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    return {
      width: canvas.width,
      height: canvas.height,
      region: JSON.parse(canvas.dataset.region),
      hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), (n) =>
        n.toString(16).padStart(2, '0'),
      ).join(''),
    }
  })
}
async function fit(page) {
  await page.getByRole('button', { name: '适应', exact: true }).click()
  await page.locator('.sharp-viewport-canvas').waitFor({ state: 'detached' })
  return await page.locator('.result-canvas').evaluate(async (canvas) => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let darkPixels = 0,
      opaquePixels = 0
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]) {
        opaquePixels++
        if (pixels[i] < 200) darkPixels++
      }
    }
    return {
      width: canvas.width,
      height: canvas.height,
      darkPixels,
      opaquePixels,
      hash: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), (n) =>
        n.toString(16).padStart(2, '0'),
      ).join(''),
    }
  })
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  const page = await context.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '2K', exact: true }).click()
  await page.getByRole('button', { name: '一键试用示例', exact: true }).click()
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent.trim() === '生成预览' && !b.disabled,
      ),
    undefined,
    { timeout: 180000 },
  )
  assert.equal(await page.locator('.error').count(), 0)
  const original = await layout(page, 'original')
  const originalNative = await native(page)
  const originalPng = await download(page, '下载 PNG', 'original.png')
  const originalSvg = await download(page, '下载 Path SVG', 'original.svg')
  const originalPackage = await download(page, '保存作品文件', 'original.astra-signature')
  await page
    .locator('label.ink-control')
    .filter({ hasText: '墨量' })
    .locator('input[type=range]')
    .evaluate((el) => {
      el.value = '12'
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  assert.equal(
    sha(await download(page, '保存作品文件', 'unapplied-controls.astra-signature')),
    sha(originalPackage),
  )
  report.unappliedControlsRetainProject = true
  report.original = {
    width: original.width,
    height: original.height,
    stamps: original.stampCount,
    placements: original.placements.length,
    packageBytes: originalPackage.length,
    pngSha256: sha(originalPng),
    svgSha256: sha(originalSvg),
    native: originalNative,
  }
  // Bad portrait decoding must leave both the source label and the fixed generated result intact.
  await page
    .locator('.paint-strip input[type=file]')
    .setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a PNG') })
  await page.locator('.error').filter({ hasText: '无法读取图片' }).waitFor()
  assert.deepEqual(await layout(page, 'after-bad-portrait'), original)
  assert.deepEqual(await native(page), originalNative)
  assert((await page.locator('.paint-strip').textContent()).includes('示例 · 亚里士多德胸像'))
  report.badPortraitPreservesWork = true
  // Valid decoding followed by a native name-bank read failure also preserves both inputs.
  await page.evaluate(() => {
    window.__idbOpen = indexedDB.open
    indexedDB.open = function (name, ...args) {
      if (name === 'astra-signature-bank') throw new Error('Intentional bank read failure')
      return window.__idbOpen.call(this, name, ...args)
    }
  })
  await page.locator('.paint-strip input[type=file]').setInputFiles({
    name: 'decoded-but-bank-failed.webp',
    mimeType: 'image/webp',
    buffer: await readFile('public/demos/ascii-live/aristotle-bust.webp'),
  })
  await page.locator('.error').filter({ hasText: 'Intentional bank read failure' }).waitFor()
  await page.evaluate(() => {
    indexedDB.open = window.__idbOpen
  })
  assert.deepEqual(await layout(page, 'after-bank-failure'), original)
  assert.deepEqual(await native(page), originalNative)
  assert((await page.locator('.paint-strip').textContent()).includes('示例 · 亚里士多德胸像'))
  report.bankReadFailurePreservesWork = true

  const fresh = await restoreBrowser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  const restored = await fresh.newPage()
  restorePage = restored
  restored.on('pageerror', (e) => report.errors.push(e.message))
  const blocked = []
  await restored.route(
    /MaShanZheng-Regular\.ttf|LongCang-Regular\.ttf|aristotle-bust\.webp/,
    (route) => {
      blocked.push(route.request().url())
      return route.abort()
    },
  )
  await restored.addInitScript(() => {
    const create = URL.createObjectURL,
      revoke = URL.revokeObjectURL
    window.__liveUrls = new Set()
    URL.createObjectURL = function (blob) {
      const url = create.call(this, blob)
      window.__liveUrls.add(url)
      return url
    }
    URL.revokeObjectURL = function (url) {
      window.__liveUrls.delete(url)
      return revoke.call(this, url)
    }
  })
  await restored.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  const input = restored.locator('input[type=file][accept=".astra-signature"]')
  await input.setInputFiles(path.join(out, 'original.astra-signature'))
  await restored.getByRole('status').filter({ hasText: '作品已恢复' }).waitFor({ timeout: 180000 })
  assert.equal(await restored.locator('.error').count(), 0)
  assert.equal(
    await restored.locator('.result-settings-changed').count(),
    0,
    'Restored controls match the fixed scene',
  )
  const firstFit = await fit(restored)
  assert(firstFit.darkPixels > 0, 'The restored fit overview must contain actual ink')
  assert.deepEqual(await layout(restored, 'restored'), original)
  assert.deepEqual(await native(restored), originalNative)
  const restoredPng = await download(restored, '下载 PNG', 'restored.png')
  const restoredSvg = await download(restored, '下载 Path SVG', 'restored.svg')
  assert.equal(sha(restoredPng), sha(originalPng))
  assert.equal(sha(restoredSvg), sha(originalSvg))
  assert.deepEqual(blocked, [], 'Opening the project must not request fonts or the original URL')
  report.freshRestore = {
    sameLayout: true,
    sameNative: true,
    samePng: true,
    sameSvg: true,
    remoteSourceRequests: blocked.length,
    fit: firstFit,
  }

  // Mutate the real saved artifact; malicious directories are rehashed to reach semantic checks.
  const bytes = originalPackage,
    magicLength = 7,
    headerLength = 43
  const length = bytes.readUInt32LE(magicLength),
    directory = JSON.parse(bytes.subarray(headerLength, headerLength + length).toString('utf8'))
  report.fontLicenses = Object.keys(directory.fontLicenses)
  for (const id of report.fontLicenses) {
    const license = await readFile(`public/fonts/signature/${id}-OFL.txt`, 'utf8')
    assert.equal(directory.fontLicenses[id].licenseText, license.replaceAll('\r\n', '\n'))
    const filename = id === 'mashanzheng' ? 'MaShanZheng-Regular.ttf' : 'LongCang-Regular.ttf'
    assert.equal(
      directory.fontLicenses[id].fontSha256,
      sha(await readFile(`public/fonts/signature/${filename}`)),
    )
  }
  function mutate(change) {
    const value = structuredClone(directory)
    change(value)
    const json = Buffer.from(JSON.stringify(value)),
      header = Buffer.from(bytes.subarray(0, headerLength))
    header.writeUInt32LE(json.length, magicLength)
    createHash('sha256')
      .update(json)
      .digest()
      .copy(header, magicLength + 4)
    return Buffer.concat([header, json, bytes.subarray(headerLength + length)])
  }
  const corrupt = Buffer.from(bytes)
  corrupt[corrupt.length - 1] ^= 1
  const cases = [
    ['bad-template-checksum', corrupt],
    ['truncated', bytes.subarray(0, bytes.length - 1)],
    ['trailing', Buffer.concat([bytes, Buffer.of(1)])],
    ['engine-version', mutate((d) => (d.engine = 'future-99'))],
    ['missing-font-license', mutate((d) => (d.fontLicenses = {}))],
    [
      'wrong-font-provenance',
      mutate((d) => (d.fontLicenses.mashanzheng.fontSha256 = '0'.repeat(64))),
    ],
    ['bad-stamp-index', mutate((d) => (d.placements[0].stampIndex = d.stamps.length))],
    ['huge-template', mutate((d) => (d.stamps[0].width = 65536))],
    ['image-dimensions', mutate((d) => d.portrait.width++)],
    ['photo-underlay', mutate((d) => (d.options.underlay = 0.5))],
    [
      'path-injection',
      mutate(
        (d) =>
          (d.stamps[0].vector = { width: 10, height: 10, paths: ['<script>alert(1)</script>'] }),
      ),
    ],
  ]
  for (const [label, buffer] of cases) {
    const urls = await restored.evaluate(() => window.__liveUrls.size)
    await input.setInputFiles({
      name: label + '.astra-signature',
      mimeType: 'application/octet-stream',
      buffer,
    })
    await restored.locator('.error').waitFor({ state: 'visible' })
    assert.deepEqual(await layout(restored, label), original, label)
    assert.deepEqual(await native(restored), originalNative, label)
    assert.deepEqual(await fit(restored), firstFit, `${label}: fit overview preserved`)
    assert.equal(
      await restored.evaluate(() => window.__liveUrls.size),
      urls,
      'Failed import must release candidate URLs',
    )
    report.rejections.push(label)
  }
  // A native preview failure after all byte validation still cannot replace the current work.
  await restored.evaluate(() => {
    window.__getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (...args) {
      if (!this.isConnected && this.width === 1280 && this.height === 1173)
        throw new Error('Intentional import preview failure')
      return window.__getContext.apply(this, args)
    }
  })
  await input.setInputFiles(path.join(out, 'original.astra-signature'))
  await restored
    .locator('.error')
    .filter({ hasText: 'Intentional import preview failure' })
    .waitFor()
  await restored.evaluate(() => {
    HTMLCanvasElement.prototype.getContext = window.__getContext
  })
  assert.deepEqual(await layout(restored, 'failed-preview'), original)
  assert.deepEqual(await native(restored), originalNative)
  assert.deepEqual(await fit(restored), firstFit, 'Native preview failure preserves fit pixels')
  assert.equal(await restored.evaluate(() => window.__liveUrls.size), 1)
  report.previewFailurePreservesWork = true
  report.displayFailuresPreserveWork = []
  for (const fault of ['context', 'empty-surface']) {
    await restored.evaluate(
      ({ fault, width, height }) => {
        window.__displayContext = HTMLCanvasElement.prototype.getContext
        window.__displayDraw = CanvasRenderingContext2D.prototype.drawImage
        const matches = (canvas) =>
          !canvas.isConnected && canvas.width === width && canvas.height === height
        if (fault === 'context') {
          HTMLCanvasElement.prototype.getContext = function (...args) {
            if (matches(this)) throw new Error('Intentional fit display failure')
            return window.__displayContext.apply(this, args)
          }
        } else {
          CanvasRenderingContext2D.prototype.drawImage = function (...args) {
            if (matches(this.canvas)) return
            return window.__displayDraw.apply(this, args)
          }
        }
      },
      { fault, width: firstFit.width, height: firstFit.height },
    )
    await input.setInputFiles(path.join(out, 'original.astra-signature'))
    await restored
      .locator('.error')
      .filter({
        hasText: fault === 'context' ? 'Intentional fit display failure' : '无法恢复作品预览',
      })
      .waitFor()
    await restored.evaluate(() => {
      HTMLCanvasElement.prototype.getContext = window.__displayContext
      CanvasRenderingContext2D.prototype.drawImage = window.__displayDraw
    })
    assert.deepEqual(await layout(restored, `display-${fault}`), original)
    assert.deepEqual(await native(restored), originalNative)
    assert.deepEqual(await fit(restored), firstFit, `${fault}: live display must survive`)
    assert.equal(await restored.evaluate(() => window.__liveUrls.size), 1)
    report.displayFailuresPreserveWork.push(fault)
  }
  // Cancel during actual byte validation; no inputs, banks or artwork are committed.
  await input.setInputFiles(path.join(out, 'original.astra-signature'))
  await restored.getByRole('button', { name: '取消文件操作', exact: true }).click()
  await restored.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some(
      (b) => b.textContent.trim() === '生成预览' && !b.disabled,
    ),
  )
  assert.deepEqual(await layout(restored, 'cancelled'), original)
  assert.deepEqual(await native(restored), originalNative)
  assert.deepEqual(await fit(restored), firstFit, 'Cancelled import preserves fit pixels')
  assert.equal(await restored.evaluate(() => window.__liveUrls.size), 1)
  report.cancelPreservesWork = true
  // Retry the valid artifact, then navigate away: retained imported templates and source are released.
  await input.setInputFiles(path.join(out, 'original.astra-signature'))
  await restored.getByRole('status').filter({ hasText: '作品已恢复' }).waitFor({ timeout: 180000 })
  const retryFit = await fit(restored)
  report.retryFit = retryFit
  await restored
    .locator('.preview')
    .screenshot({ path: path.join(out, 'retry-before-assertion.png') })
  const retryNative = await native(restored)
  const afterNativeFit = await fit(restored)
  report.retryNative = retryNative
  report.afterNativeFit = afterNativeFit
  assert.deepEqual(retryFit, firstFit, 'Valid retry preserves the entire fit overview')
  assert.deepEqual(retryNative, originalNative, 'Valid retry preserves native pixels')
  assert.deepEqual(afterNativeFit, firstFit, 'Native-to-fit after valid retry preserves overview')
  assert.equal(await restored.evaluate(() => window.__liveUrls.size), 1)
  report.retryPreservesFitAndNative = true
  await restored.locator('.preview').screenshot({ path: path.join(out, 'restored-preview.png') })
  await restored
    .locator('footer a[href="/tools"]')
    .first()
    .evaluate((el) => el.click())
  await restored.waitForURL('**/tools')
  assert.equal(await restored.evaluate(() => window.__liveUrls.size), 0)
  report.unmountReleasedUrls = true
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (e) {
  report.passed = false
  report.failure = e.stack
  if (restorePage)
    report.visibleFailure = await restorePage
      .evaluate(() => {
        const view = document.querySelector('.page')?.__vueParentComponent?.setupState
        const canvas = (value) =>
          value
            ? {
                width: value.width,
                height: value.height,
                pixel: Array.from(value.getContext('2d').getImageData(0, 0, 1, 1).data),
              }
            : null
        const stage = document.querySelector('.stage'),
          root = document.querySelector('.compare')
        return {
          meta: document.querySelector('.preview .meta')?.textContent,
          errors: Array.from(document.querySelectorAll('.error'), (e) => e.textContent),
          overview: canvas(view?.lastOverview),
          display: canvas(document.querySelector('.result-canvas')),
          stage: stage?.getBoundingClientRect().toJSON(),
          root: root?.getBoundingClientRect().toJSON(),
          scroll: [stage?.scrollLeft, stage?.scrollTop],
        }
      })
      .catch(() => null)
  throw e
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }, null, 2))
  await Promise.allSettled([browser.close(), restoreBrowser.close()])
}
