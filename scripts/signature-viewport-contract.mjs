import { openSignatureSection } from './signature-ui-helpers.mjs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const mobile = process.argv.includes('--mobile')
const cutout = process.argv.includes('--cutout')
const reducedMotion = !process.argv.includes('--motion')
const out = path.resolve(
  process.env.ASTRA_VIEWPORT_OUTPUT || `test-results/signature-viewport-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const page = await browser.newPage({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
  deviceScaleFactor: mobile ? 3 : 1,
  isMobile: mobile,
  hasTouch: mobile,
  reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  acceptDownloads: true,
})
const report = { browser: browser.version(), mobile, cutout, reducedMotion, errors: [], cases: [] }
page.on('pageerror', (e) => report.errors.push(e.message))
// Reject oversized canvas setters before allocation. This scenario never exports a full PNG.
await page.addInitScript(() => {
  window.__canvasAudit = { setters: 0, rejected: [], peakPixels: 0 }
  const restore = []
  for (const axis of ['width', 'height']) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, axis)
    restore.push(() => Object.defineProperty(HTMLCanvasElement.prototype, axis, descriptor))
    Object.defineProperty(HTMLCanvasElement.prototype, axis, {
      ...descriptor,
      set(value) {
        const opposite = axis === 'width' ? this.height : this.width
        if (Number(value) > 2400) {
          window.__canvasAudit.rejected.push({ axis, value, opposite })
          throw new Error('Contract guard: oversized preview allocation')
        }
        window.__canvasAudit.setters++
        descriptor.set.call(this, value)
        window.__canvasAudit.peakPixels = Math.max(
          window.__canvasAudit.peakPixels,
          this.width * this.height,
        )
      },
    })
  }
  window.__restoreCanvasAudit = () => restore.forEach((fn) => fn())
})
async function snapshot(label) {
  await page.waitForFunction(() => !!document.querySelector('.sharp-viewport-canvas'), undefined, {
    timeout: 90000,
  })
  const data = await page.evaluate(() => {
    const stage = document.querySelector('.stage'),
      root = document.querySelector('.compare')
    const rect = (el) => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }
    return {
      stage: {
        ...rect(stage),
        clientWidth: stage.clientWidth,
        clientHeight: stage.clientHeight,
        clientLeft: stage.clientLeft,
        clientTop: stage.clientTop,
        scrollLeft: stage.scrollLeft,
        scrollTop: stage.scrollTop,
        maxX: stage.scrollWidth - stage.clientWidth,
        maxY: stage.scrollHeight - stage.clientHeight,
      },
      root: rect(root),
      canvases: Array.from(document.querySelectorAll('.result-host canvas'), (c) => ({
        className: c.className,
        width: c.width,
        height: c.height,
      })),
      region: JSON.parse(document.querySelector('.sharp-viewport-canvas').dataset.region),
      horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    }
  })
  for (const canvas of data.canvases)
    assert(
      Math.max(canvas.width, canvas.height) <= (canvas.className === 'result-canvas' ? 1280 : 2400),
      JSON.stringify(data),
    )
  assert(data.horizontalOverflow <= 1)
  report.cases.push({ label, ...data })
  return data
}
async function scroll(x, y) {
  await page.locator('.stage').evaluate(
    (stage, { x, y }) => {
      stage.scrollLeft = x === 'end' ? stage.scrollWidth : x
      stage.scrollTop = y === 'end' ? stage.scrollHeight : y
      stage.dispatchEvent(new Event('scroll'))
    },
    { x, y },
  )
  await page.waitForTimeout(180)
}
async function range(locator, value) {
  await locator.evaluate((el, v) => {
    el.value = String(v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}
try {
  await page.goto(base + '/signature-portrait')
  // Real allowed controls. This certifies geometry/memory, not default 8K throughput.
  await page.getByRole('button', { name: '8K', exact: true }).click()
  if (cutout) await page.getByLabel('签名风格', { exact: true }).selectOption('cutout')
  await range(
    page.locator('label.ink-control').filter({ hasText: '墨量' }).locator('input[type=range]'),
    12,
  )
  await openSignatureSection(page, '排布与尺寸')
  await range(page.locator('.sliders label').filter({ hasText: '最小印章' }).locator('input'), 3)
  await range(page.locator('.sliders label').filter({ hasText: '最大印章' }).locator('input'), 6)
  await page.getByRole('button', { name: '一键试用示例', exact: true }).click()
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('button')).some(
        (b) => b.textContent.trim() === '生成预览' && !b.disabled,
      ),
    undefined,
    { timeout: 180000 },
  )
  assert.equal(
    await page.locator('.error').count(),
    0,
    await page
      .locator('.error')
      .allTextContents()
      .then((x) => x.join(';')),
  )
  assert.equal(await page.locator('.compare-base').count(), 0, 'Artwork alone is the default')
  const downloading = page.waitForEvent('download')
  await openSignatureSection(page, '矢量导出')
  await page.getByRole('button', { name: '下载矢量 JSON', exact: true }).click()
  await (await downloading).saveAs(path.join(out, 'layout.json'))
  const layout = JSON.parse(await readFile(path.join(out, 'layout.json'), 'utf8'))
  assert.equal(Math.max(layout.width, layout.height), 8192)
  report.layout = {
    width: layout.width,
    height: layout.height,
    stamps: layout.stampCount,
    placements: layout.placements.length,
    parameters: layout.renderOptions,
  }
  await page.getByRole('button', { name: '最大', exact: true }).click()
  await scroll(0, 0)
  const corner = await snapshot('maximum-left-top')
  assert.equal(corner.root.width, layout.width * 8)
  assert(corner.root.x >= corner.stage.x - 1, 'Left artwork edge must be reachable')
  assert(corner.region.x < 1 && corner.region.y < 1)
  // Independently map client/root geometry and compare actual HD pixels with the fixed result.
  const parity = await page.evaluate(
    async ({ layout }) => {
      const engine = await import('/src/lib/signature-portrait/index.ts')
      const stamps = await engine.generateHandwritingVariants('心上人', { count: 100, seed: 42 })
      const stage = document.querySelector('.stage'),
        root = document.querySelector('.compare'),
        actual = document.querySelector('.sharp-viewport-canvas')
      const a = stage.getBoundingClientRect(),
        b = root.getBoundingClientRect()
      const left = Math.max(b.left, a.left + stage.clientLeft),
        top = Math.max(b.top, a.top + stage.clientTop)
      const right = Math.min(b.right, a.left + stage.clientLeft + stage.clientWidth),
        bottom = Math.min(b.bottom, a.top + stage.clientTop + stage.clientHeight)
      const expectedRegion = {
        x: ((left - b.left) / b.width) * layout.width,
        y: ((top - b.top) / b.height) * layout.height,
        w: ((right - left) / b.width) * layout.width,
        h: ((bottom - top) / b.height) * layout.height,
      }
      const reference = engine.paintPlacementsRegion(
        layout.placements,
        stamps,
        expectedRegion,
        actual.width,
        actual.height,
        {
          ...layout.renderOptions,
          layoutW: layout.width,
          layoutH: layout.height,
          stampMaxLong: Math.min(
            1600,
            Math.max(800, Math.round(Math.max(actual.width, actual.height) * 0.65)),
          ),
        },
      )
      const x = reference
          .getContext('2d')
          .getImageData(0, 0, reference.width, reference.height).data,
        y = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data
      let changedChannels = 0,
        maxDelta = 0
      for (let i = 0; i < x.length; i++)
        if (x[i] !== y[i]) {
          changedChannels++
          maxDelta = Math.max(maxDelta, Math.abs(x[i] - y[i]))
        }
      return {
        expectedRegion,
        actualRegion: JSON.parse(actual.dataset.region),
        dimensions: [actual.width, actual.height],
        changedChannels,
        maxDelta,
        channels: x.length,
      }
    },
    { layout },
  )
  report.parity = parity
  assert.deepEqual(parity.actualRegion, parity.expectedRegion)
  assert.equal(parity.changedChannels, 0, JSON.stringify(parity))
  await page.locator('.preview').screenshot({ path: path.join(out, 'maximum-left-top.png') })
  await scroll('end', 'end')
  const end = await snapshot('maximum-right-bottom')
  assert(
    Math.abs(end.stage.scrollLeft - end.stage.maxX) < 1 &&
      Math.abs(end.stage.scrollTop - end.stage.maxY) < 1,
  )
  assert(
    end.region.x + end.region.w > layout.width - 2 &&
      end.region.y + end.region.h > layout.height - 2,
  )
  await page.locator('.preview').screenshot({ path: path.join(out, 'maximum-right-bottom.png') })
  await scroll(1000, 1000)
  const beforeDrag = await snapshot('before-drag')
  await page.locator('.stage').scrollIntoViewIfNeeded()
  const box = await page.locator('.stage').boundingBox(),
    x = box.x + box.width * 0.7,
    y = box.y + Math.min(220, box.height * 0.6)
  if (mobile) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x - 80, y: y - 70 }],
    })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] })
    await cdp.detach()
  } else {
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x - 80, y - 70, { steps: 6 })
    await page.mouse.up()
  }
  await page.waitForTimeout(200)
  const afterDrag = await snapshot(mobile ? 'touch-pan-cancel' : 'mouse-pan-release')
  assert(
    afterDrag.stage.scrollLeft > beforeDrag.stage.scrollLeft + 50 &&
      afterDrag.stage.scrollTop > beforeDrag.stage.scrollTop + 40,
  )
  if (!mobile) {
    await page.mouse.move(x - 120, y - 110)
    await page.waitForTimeout(150)
    assert.equal((await snapshot('released-pointer')).stage.scrollLeft, afterDrag.stage.scrollLeft)
  }
  await page.locator('.stage').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(350)
  const keyboard = await snapshot('keyboard-pan')
  assert(
    keyboard.stage.scrollLeft > afterDrag.stage.scrollLeft &&
      keyboard.stage.scrollTop > afterDrag.stage.scrollTop,
  )
  if (!mobile) {
    const box = await page.locator('.stage').boundingBox(),
      px = box.x + box.width * 0.6,
      py = box.y + 200
    const point = () =>
      page.locator('.compare').evaluate(
        (root, { px, py }) => {
          const r = root.getBoundingClientRect()
          return {
            x: (px - r.left) / r.width,
            y: (py - r.top) / r.height,
            width: r.width,
            height: r.height,
            scrollLeft: root.parentElement.scrollLeft,
            scrollTop: root.parentElement.scrollTop,
          }
        },
        { px, py },
      )
    const before = await point()
    await page.locator('.stage').evaluate((stage) => {
      stage.addEventListener(
        'wheel',
        (event) => {
          const r = stage.querySelector('.compare').getBoundingClientRect()
          window.__wheelDelivery = {
            clientX: event.clientX,
            clientY: event.clientY,
            rootWidth: r.width,
            rootHeight: r.height,
            scrollLeft: stage.scrollLeft,
            scrollTop: stage.scrollTop,
          }
        },
        { capture: true, once: true },
      )
    })
    await page.mouse.move(px, py)
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(300)
    const after = await point()
    report.wheelAnchor = {
      before,
      after,
      delivery: await page.evaluate(() => window.__wheelDelivery),
      pixelErrorX: Math.abs(before.x - after.x) * after.width,
      pixelErrorY: Math.abs(before.y - after.y) * after.height,
    }
    assert(
      report.wheelAnchor.pixelErrorX < 1 && report.wheelAnchor.pixelErrorY < 1,
      JSON.stringify(report.wheelAnchor),
    )
    await snapshot('wheel-anchored')
  }
  // Native drawing failure is caught, the generated work survives, and retry restores HD.
  await page.evaluate(() => {
    const canvas = document.querySelector('.sharp-viewport-canvas'),
      width = canvas.width,
      height = canvas.height
    window.__restoreContext = HTMLCanvasElement.prototype.getContext
    window.__previewFailed = false
    HTMLCanvasElement.prototype.getContext = function (...args) {
      if (
        !document.contains(this) &&
        this.width === width &&
        this.height === height &&
        args[0] === '2d'
      ) {
        window.__previewFailed = true
        throw new Error('Intentional viewport context failure')
      }
      return window.__restoreContext.apply(this, args)
    }
    document.querySelector('.stage').dispatchEvent(new Event('scroll'))
  })
  await page
    .getByRole('status')
    .filter({ hasText: '高清预览暂时无法绘制' })
    .waitFor({ state: 'visible' })
  assert.equal(
    await page.getByRole('button', { name: '下载矢量 JSON', exact: true }).isEnabled(),
    true,
  )
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.getContext = window.__restoreContext
    document.querySelector('.stage').dispatchEvent(new Event('scroll'))
  })
  await snapshot('native-failure-recovered')
  assert.equal(
    await page.getByRole('status').filter({ hasText: '高清预览暂时无法绘制' }).count(),
    0,
  )
  report.nativeFailureRecovery = true
  await page.getByRole('button', { name: '对比原图', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: '对比原图', exact: true }).getAttribute('aria-pressed'),
    'true',
  )
  await page.getByRole('slider', { name: '作品与原图对比比例' }).focus()
  await page.keyboard.press('End')
  assert.equal(await page.getByRole('slider', { name: '作品与原图对比比例' }).inputValue(), '100')
  await page.getByRole('button', { name: '对比原图', exact: true }).click()
  assert.equal(await page.locator('.compare-base').count(), 0)
  await page.evaluate(() => {
    window.__retiredSharp = document.querySelector('.sharp-viewport-canvas')
  })
  await page.getByRole('button', { name: '适应', exact: true }).click()
  await page.waitForTimeout(180)
  assert.equal(await page.locator('.sharp-viewport-canvas').count(), 0)
  assert.deepEqual(
    await page.evaluate(() => [window.__retiredSharp.width, window.__retiredSharp.height]),
    [1, 1],
  )
  report.audit = await page.evaluate(() => window.__canvasAudit)
  assert.deepEqual(report.audit.rejected, [])
  assert(report.audit.peakPixels <= 2400 * 2400)
  const buttons = await page.locator('.zoom-btn').evaluateAll((items) =>
    items.map((el) => ({
      label: el.textContent.trim(),
      width: el.getBoundingClientRect().width,
      height: el.getBoundingClientRect().height,
    })),
  )
  assert(
    buttons.every((b) => b.width >= 44 && b.height >= 44),
    JSON.stringify(buttons),
  )
  report.buttons = buttons
  await page.locator('.preview').screenshot({ path: path.join(out, 'fit.png') })
  await page.getByRole('button', { name: '原大', exact: true }).click()
  await snapshot('before-unmount')
  await page.evaluate(() => {
    window.__oldPreviewCanvases = Array.from(document.querySelectorAll('.result-host canvas'))
    window.__restoreCanvasAudit()
  })
  await page
    .locator('a[href="/tools"]')
    .first()
    .evaluate((link) => link.click())
  await page.waitForURL('**/tools')
  report.unmount = await page.evaluate(() =>
    window.__oldPreviewCanvases.map((canvas) => ({
      width: canvas.width,
      height: canvas.height,
      connected: canvas.isConnected,
    })),
  )
  assert(
    report.unmount.every((c) => c.width === 1 && c.height === 1 && !c.connected),
    JSON.stringify(report.unmount),
  )
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (e) {
  report.passed = false
  report.failure = e.stack
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
  throw e
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify(
      {
        out,
        passed: report.passed,
        failure: report.failure,
        parity: report.parity,
        audit: report.audit,
        errors: report.errors,
      },
      null,
      2,
    ),
  )
  await browser.close()
}
