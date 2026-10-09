import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { openSignatureSection } from './signature-ui-helpers.mjs'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:4210'
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const mobile = process.env.ASTRA_INK_MOBILE === '1'
const baseline = process.env.ASTRA_INK_BASELINE === '1'
const out = `test-results/ink-session-${channel}${mobile ? '-mobile' : ''}${baseline ? '-baseline' : ''}`
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel, headless: true })
const report = { base, browser: browser.version(), mobile, baseline, cases: [], errors: [] }
try {
  const page = await browser.newPage({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  const ready = async () => {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent.trim() === '生成预览' && !b.disabled,
        ),
      null,
      { timeout: 90000 },
    )
    assert.equal(await page.locator('.error').count(), 0)
  }
  const json = async (name) => {
    await openSignatureSection(page, '矢量导出')
    const event = page.waitForEvent('download')
    await page.getByRole('button', { name: '下载矢量 JSON', exact: true }).click()
    const download = await event
    await download.saveAs(`${out}/${name}.json`)
    return JSON.parse(await readFile(`${out}/${name}.json`))
  }
  const input = async (control, value) =>
    control.evaluate((el, value) => {
      el.value = value
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
  const region = page.getByRole('region', { name: '名字画预览，方向键移动，滚轮缩放', exact: true })
  const view = async () =>
    region.evaluate((el) => ({
      width: el.querySelector('.compare').style.width,
      height: el.querySelector('.compare').style.height,
      left: el.scrollLeft,
      top: el.scrollTop,
      pageY: window.scrollY,
      screenTop: el.getBoundingClientRect().top,
      screenLeft: el.getBoundingClientRect().left,
      compare: document.querySelector('input[aria-label="作品与原图对比比例"]')?.value,
    }))
  const unchangedView = (a, b) =>
    a.width === b.width &&
    a.height === b.height &&
    Math.abs(a.left - b.left) <= 1 &&
    Math.abs(a.top - b.top) <= 1 &&
    a.compare === b.compare
  const check = (name, pass, details) => report.cases.push({ name, pass, ...details })

  await page
    .locator('input[type=file][accept*="astra-signature"]')
    .setInputFiles('docs/validation/2026-10-09/creative-workflow/source.astra-signature')
  await ready()
  const original = await json('original')
  await page.getByRole('button', { name: '最大', exact: true }).click()
  await page.getByRole('button', { name: '对比原图', exact: true }).click()
  await input(page.getByLabel('作品与原图对比比例', { exact: true }), '67')
  await region.evaluate((el) => {
    el.scrollLeft = 180
    el.scrollTop = 110
  })
  // Leave a layout draft without asking to regenerate it.
  const density = page
    .locator('label.ink-control')
    .filter({ has: page.getByText('墨量', { exact: true }) })
    .locator('input')
  await input(density, '8.5')
  await page.getByLabel('笔迹颜色', { exact: true }).selectOption('custom')
  const colour = page.getByLabel('自定义墨色', { exact: true })
  await input(colour, '#1278a8')
  const before = await view()
  await page.waitForTimeout(450)
  await ready()
  const after = await view()
  const coloured = await json('coloured')
  check(
    'ink-update-keeps-zoom-pan-and-comparison',
    unchangedView(before, after) && Math.abs(before.pageY - after.pageY) <= 1,
    { before, after },
  )
  check(
    'ink-update-keeps-other-layout-drafts',
    coloured.renderOptions.density === original.renderOptions.density &&
      (await density.inputValue()) === '8.5',
    {
      originalDensity: original.renderOptions.density,
      renderedDensity: coloured.renderOptions.density,
    },
  )
  check(
    'custom-colour-applied-to-current-work',
    coloured.placements.every((p) => p.tint.r === 18 && p.tint.g === 120 && p.tint.b === 168),
    {},
  )
  if (!baseline) {
    assert(
      report.cases.every((c) => c.pass),
      JSON.stringify(report.cases),
    )
    assert(
      await page
        .getByText('参数已调整，点击「生成预览」应用。下载文件对应当前预览的作品。', {
          exact: true,
        })
        .isVisible(),
    )
    const gain = page.getByLabel('笔迹浓度', { exact: true })
    await input(gain, '2.4')
    await input(gain, '0.3')
    const beforeGain = await view()
    await page.waitForTimeout(450)
    await ready()
    const afterGain = await view()
    const light = await json('light')
    check(
      'latest-concentration-keeps-draft-and-view',
      light.renderOptions.toneGain === 0.3 &&
        light.renderOptions.density === original.renderOptions.density &&
        unchangedView(beforeGain, afterGain),
      {},
    )
    // Hold a real layout Worker's request so camera edits and cancellation are deterministic.
    await page.evaluate(() => {
      const NativeWorker = window.Worker
      window.__inkNativeWorker = NativeWorker
      window.__inkHeld = []
      window.__inkHold = true
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options)
          this.isInkLayout = /layout\.worker/.test(String(url))
        }
        postMessage(message, ...args) {
          if (this.isInkLayout && window.__inkHold) {
            window.__inkHeld.push(() => super.postMessage(message, ...args))
          } else super.postMessage(message, ...args)
        }
      }
    })
    await input(gain, '0.8')
    await page.waitForFunction(() => window.__inkHeld.length > 0)
    await page.getByRole('button', { name: '缩小', exact: true }).click()
    await input(page.getByLabel('作品与原图对比比例', { exact: true }), '61')
    await region.evaluate((el) => {
      el.scrollLeft = 210
      el.scrollTop = 140
    })
    const during = await view()
    await page.evaluate(() => {
      window.__inkHold = false
      for (const release of window.__inkHeld.splice(0)) release()
    })
    await ready()
    const resumed = await view()
    const committed = await json('camera')
    check(
      'camera-edits-during-render-survive-commit',
      unchangedView(during, resumed) &&
        Math.abs(during.screenTop - resumed.screenTop) <= 1 &&
        committed.renderOptions.toneGain === 0.8,
      { during, resumed },
    )
    await page.evaluate(() => {
      window.__inkHold = true
    })
    await input(gain, '1.1')
    await page.waitForFunction(() => window.__inkHeld.length > 0)
    const cancelledView = await view()
    await page.getByRole('button', { name: '取消生成', exact: true }).click()
    await ready()
    await page.evaluate(() => {
      window.__inkHold = false
      for (const release of window.__inkHeld.splice(0)) {
        try {
          release()
        } catch {}
      }
      window.Worker = window.__inkNativeWorker
    })
    const afterCancel = await view()
    const cancelled = await json('cancelled')
    check(
      'cancelled-ink-keeps-complete-work-and-camera',
      JSON.stringify(cancelled.placements) === JSON.stringify(committed.placements) &&
        cancelled.renderOptions.toneGain === 0.8 &&
        unchangedView(cancelledView, afterCancel),
      {},
    )
    await page.getByLabel('笔迹颜色', { exact: true }).selectOption('source')
    await page.waitForTimeout(450)
    await ready()
    const source = await json('source')
    check(
      'source-colour-keeps-draft',
      source.renderOptions.density === original.renderOptions.density &&
        source.placements.some((p) => p.tint.r > p.tint.b) &&
        source.placements.some((p) => p.tint.b > p.tint.r),
      {},
    )
    const generated = page.getByRole('button', { name: '生成预览', exact: true })
    if (mobile) await generated.tap()
    else await generated.click()
    await ready()
    const applied = await json('applied')
    const appliedView = await view()
    check(
      'explicit-generation-applies-layout-draft',
      applied.renderOptions.density === 8.5 &&
        appliedView.left === 0 &&
        appliedView.top === 0 &&
        (await page.getByRole('button', { name: '适应', exact: true }).getAttribute('class'))
          .split(' ')
          .includes('on'),
      { density: applied.renderOptions.density, view: appliedView },
    )
    await page.getByLabel('笔迹颜色', { exact: true }).selectOption('custom')
    await input(page.getByLabel('自定义墨色', { exact: true }), '#347860')
    const cleanBefore = await view()
    await page.waitForTimeout(450)
    await ready()
    const cleanAfter = await view()
    check(
      'ink-only-change-does-not-show-layout-draft-or-scroll-page',
      Math.abs(cleanBefore.pageY - cleanAfter.pageY) <= 1 &&
        !(await page
          .getByText('参数已调整，点击「生成预览」应用。下载文件对应当前预览的作品。', {
            exact: true,
          })
          .isVisible()),
      { cleanBefore, cleanAfter },
    )
    assert(
      report.cases.every((c) => c.pass),
      JSON.stringify(report.cases),
    )
    await region.screenshot({ path: out + '/preview.png' })
  } else
    assert(
      report.cases.filter((c) => !c.pass).length >= 2,
      'Baseline did not reproduce both defects',
    )
  assert.deepEqual(report.errors, [])
  console.log(JSON.stringify(report))
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
