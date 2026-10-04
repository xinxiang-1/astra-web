import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { openSignatureSection } from './signature-ui-helpers.mjs'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_DIRECTION_OUTPUT || `test-results/signature-direction-${Date.now()}`,
)
await mkdir(out, { recursive: true })
await writeFile(
  path.join(out, 'baseline-woven.ts'),
  execFileSync('git', ['show', '6d140c2:src/lib/signature-portrait/woven.ts'], {
    encoding: 'utf8',
  }),
)
const baselineUrl =
  '/' + path.relative(process.cwd(), path.join(out, 'baseline-woven.ts')).split(path.sep).join('/')
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = { browser: browser.version(), errors: [], cases: [] }
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/signature-portrait')
  report.cases = await page.evaluate(async (baselineUrl) => {
    const old = await import(baselineUrl),
      { computeWovenPlacements } = await import('/src/lib/signature-portrait/woven.ts')
    const results = []
    for (const sign of [-1, 1])
      for (const vertical of [false, true]) {
        const w = 512,
          h = 400,
          pixels = new Uint8ClampedArray(w * h * 4)
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const n = Math.round(128 + 110 * Math.sin((x + sign * y) * 0.12))
            pixels.set([n, n, n, 255], (y * w + x) * 4)
          }
        const input = {
          aPixels: pixels,
          fullPixels: pixels,
          aW: w,
          aH: h,
          aScale: 1,
          outW: w,
          outH: h,
          sizeMin: 16,
          sizeMax: 56,
          longSide: 512,
          stampMetrics: [
            { width: 220, height: 100, aspect: 2.2, inkRatio: 0.2 },
            { width: 440, height: 100, aspect: 4.4, inkRatio: 0.24 },
          ],
          options: { seed: 42, density: 30, angleRange: 20, allowVertical: vertical },
        }
        const baseline = old.computeWovenPlacements(input, () => {}),
          classic = computeWovenPlacements(input, () => {})
        const zero = computeWovenPlacements(
          {
            ...input,
            options: { ...input.options, orientationMode: 'flow', orientationStrength: 0 },
          },
          () => {},
        )
        const flow = computeWovenPlacements(
          {
            ...input,
            options: { ...input.options, orientationMode: 'flow', orientationStrength: 1 },
          },
          () => {},
        )
        const repeat = computeWovenPlacements(
          {
            ...input,
            options: { ...input.options, orientationMode: 'flow', orientationStrength: 1 },
          },
          () => {},
        )
        let adjusted = 0,
          minArea = Infinity,
          mean = 0,
          centres = true,
          upright = true
        for (let i = 0; i < flow.length; i++) {
          const a = baseline[i],
            b = flow[i]
          if (Math.abs(a.angle - b.angle) > 0.001) adjusted++
          minArea = Math.min(minArea, (b.targetSize / a.targetSize) ** 2)
          mean += b.angle - a.angle
          centres &&= a.x === b.x && a.y === b.y && a.stampIndex === b.stampIndex
          upright &&= Math.cos(b.angle - (vertical ? Math.PI / 2 : 0)) > 0
        }
        results.push({
          sign,
          vertical,
          count: flow.length,
          adjusted,
          minArea,
          meanAngleDelta: mean / flow.length,
          centres,
          upright,
          classicExact: JSON.stringify(baseline) === JSON.stringify(classic),
          zeroExact: JSON.stringify(baseline) === JSON.stringify(zero),
          deterministic: JSON.stringify(flow) === JSON.stringify(repeat),
        })
      }
    return results
  }, baselineUrl)
  for (const c of report.cases) {
    assert(c.classicExact && c.zeroExact && c.deterministic && c.centres && c.upright)
    assert(c.adjusted > 100)
    assert(c.minArea >= 0.85 - 1e-8)
  }
  const horizontal = report.cases.filter((c) => !c.vertical)
  assert(
    horizontal[0].meanAngleDelta * horizontal[1].meanAngleDelta < 0,
    'Opposite contours must guide names in opposite directions',
  )
  await page.getByRole('button', { name: '2K', exact: true }).click()
  await page.getByRole('button', { name: '一键试用示例', exact: true }).click()
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === '生成预览',
      )
      return (
        b &&
        !b.disabled &&
        document.querySelector('.page').__vueParentComponent.setupState.generatedResult
      )
    },
    undefined,
    { timeout: 180000 },
  )
  await page.locator('.preview').screenshot({ path: path.join(out, 'classic.png') })
  const before = await page.evaluate(() => {
    const s = document.querySelector('.page').__vueParentComponent.setupState
    return s.generatedResult.placements.map((p) => [p.x, p.y, p.stampIndex, p.angle, p.targetSize])
  })
  await page.getByLabel('签名走向', { exact: true }).selectOption('flow')
  assert(await page.locator('.result-settings-changed').isVisible())
  await page.getByRole('button', { name: '生成预览', exact: true }).click()
  await page.waitForFunction(
    () => {
      const b = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === '生成预览',
      )
      return b && !b.disabled
    },
    undefined,
    { timeout: 180000 },
  )
  const after = await page.evaluate(() => {
    const s = document.querySelector('.page').__vueParentComponent.setupState
    return {
      options: s.generatedResult.options,
      placements: s.generatedResult.placements.map((p) => [
        p.x,
        p.y,
        p.stampIndex,
        p.angle,
        p.targetSize,
      ]),
    }
  })
  assert.equal(after.options.orientationMode, 'flow')
  assert(after.placements.every(p=>p.every(Number.isFinite)), 'Real portrait placements must contain finite geometry')
  assert.equal(before.length, after.placements.length)
  assert(after.placements.some((p, i) => Math.abs(p[3] - before[i][3]) > 0.001))
  for (let i = 0; i < before.length; i++)
    assert.deepEqual(after.placements[i].slice(0, 3), before[i].slice(0, 3))
  await page.locator('.preview').screenshot({ path: path.join(out, 'flow.png') })
  const download = async (button, file) => {
    const event = page.waitForEvent('download', { timeout: 180000 })
    await page.getByRole('button', { name: button, exact: true }).click()
    await (await event).saveAs(path.join(out, file))
    await page.waitForFunction(
      () => {
        const b = [...document.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === '生成预览',
        )
        return b && !b.disabled
      },
      undefined,
      { timeout: 180000 },
    )
    return readFile(path.join(out, file))
  }
  const png = await download('下载 PNG', 'flow.png'),
    project = await download('保存作品文件', 'flow.astra-signature')
  await page
    .locator('input[accept=".astra-signature"]')
    .setInputFiles(path.join(out, 'flow.astra-signature'))
  await page.getByRole('status').filter({ hasText: '作品已恢复' }).waitFor({ timeout: 180000 })
  assert.equal(await page.getByLabel('签名走向', { exact: true }).inputValue(), 'flow')
  assert.equal(await page.locator('.result-settings-changed').count(), 0)
  const restored = await download('下载 PNG', 'restored.png')
  assert.equal(
    createHash('sha256').update(restored).digest('hex'),
    createHash('sha256').update(png).digest('hex'),
  )
  report.project = {
    samePng: true,
    optionsRestored: true,
    placements: before.length,
    bytes: project.length,
  }
  await openSignatureSection(page, '排布与尺寸')
  assert(await page.getByLabel('方向引导', { exact: true }).isVisible())
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (e) {
  report.passed = false
  report.failure = e.stack
  throw e
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }, null, 2))
  await browser.close()
}
