import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { openSignatureSection } from './signature-ui-helpers.mjs'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_FUSION_OUTPUT || `test-results/signature-fusion-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = { browser: browser.version(), cases: [], errors: [] }
const sha = (data) => createHash('sha256').update(data).digest('hex')
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/signature-portrait')
  if (!process.argv.includes('--ui-only'))
    report.cases = await page.evaluate(async () => {
      const { signatureColorWash } = await import('/src/lib/signature-portrait/color-wash.ts')
      const { createTextStamp, loadImageElement } =
        await import('/src/lib/signature-portrait/extract.ts')
      const { paintPlacementsTiled, paintPlacementsRegionResponsive } =
        await import('/src/lib/signature-portrait/layout.ts')
      const { createSignatureRasterWorker } =
        await import('/src/lib/signature-portrait/raster-worker-client.ts')
      const { traceStamps, buildPathSvgDocument } =
        await import('/src/lib/signature-portrait/trace.ts')
      const { createSignatureProject, readSignatureProject } =
        await import('/src/lib/signature-portrait/project.ts')
      const check = (value, label) => {
        if (!value) throw new Error(label)
      }
      const source = document.createElement('canvas')
      source.width = 640
      source.height = 800
      const ctx = source.getContext('2d'),
        gradient = ctx.createLinearGradient(0, 0, 640, 800)
      gradient.addColorStop(0, '#ed335e')
      gradient.addColorStop(0.5, '#143a73')
      gradient.addColorStop(1, '#ffbf61')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 640, 800)
      ctx.clearRect(0, 0, 75, 200)
      const file = new File(
        [await new Promise((resolve) => source.toBlob(resolve))],
        'controlled-colours.png',
        { type: 'image/png' },
      )
      const { image, objectUrl } = await loadImageElement(file)
      const wash = signatureColorWash(image)
      check(
        Math.max(wash.width, wash.height) === 384 && wash.width * wash.height * 4 <= 384 * 384 * 4,
        'Bounded background',
      )
      check(signatureColorWash(image) === wash, 'Immutable source background reuse')
      const stamps = await traceStamps(['李云舟', 'Astra'].map((text) => createTextStamp(text)))
      const ps = Array.from({ length: 48 }, (_, i) => ({
        x: 20 + (i % 8) * 40,
        y: 22 + Math.floor(i / 8) * 43,
        angle: ((i % 3) - 1) * 0.06,
        targetSize: 32,
        stampIndex: i % 2,
        strength: 0.2 + (i % 4) * 0.2,
        tint: { r: 20 + i * 3, g: 15 + i, b: 30 + i * 2 },
        blend: i % 3 ? 'soft' : 'ink',
        depth: (i % 7) / 7,
      }))
      const pixels = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const delta = (a, b) => {
        const aa = pixels(a),
          bb = pixels(b)
        check(aa.length === bb.length, 'Dimensions')
        let changed = 0,
          maxDelta = 0
        for (let i = 0; i < aa.length; i++) {
          const d = Math.abs(aa[i] - bb[i])
          if (d) changed++
          maxDelta = Math.max(maxDelta, d)
        }
        return { changed, maxDelta, channels: aa.length }
      }
      const cases = []
      for (const background of ['#f5f3ef', '#111615'])
        for (const inkStyle of ['ink', 'cutout'])
          for (const underlay of [0, 0.75, 0.85]) {
            const options = { background, inkStyle, colorize: true, coverFill: false, underlay }
            const paintOptions = {
              ...options,
              portrait: underlay ? wash : undefined,
              tileSize: 128,
              stampMaxLong: 512,
            }
            const painted = await paintPlacementsTiled(ps, stamps, 320, 256, 320, 256, paintOptions)
            const scene = {
              portrait: image,
              portraitFile: file,
              portraitName: file.name,
              options,
              placements: ps,
              stamps,
              width: 320,
              height: 256,
            }
            const packed = await createSignatureProject(scene)
            const loaded = await readSignatureProject(packed)
            try {
              check(loaded.project.options.underlay === underlay, 'Project background strength')
              const restored = await paintPlacementsTiled(
                loaded.project.placements,
                loaded.project.stamps,
                320,
                256,
                320,
                256,
                {
                  ...paintOptions,
                  portrait: underlay ? signatureColorWash(loaded.project.portrait) : undefined,
                },
              )
              const project = delta(painted, restored)
              check(project.changed === 0, 'Project exact RGBA')
              const svg = new DOMParser().parseFromString(
                buildPathSvgDocument(ps, stamps, 320, 256, {
                  ...options,
                  portraitHref: underlay ? wash.toDataURL('image/png') : undefined,
                }),
                'image/svg+xml',
              )
              check(!svg.querySelector('parsererror'), 'Valid mixed SVG')
              check(
                svg.querySelectorAll('image').length === (underlay ? 1 : 0),
                'Explicit background image only for mixed style',
              )
              check(
                svg.querySelectorAll('g[opacity]').length === ps.length,
                'Complete signature paths retained',
              )
              let full = null,
                crop = null
              const worker = await createSignatureRasterWorker(
                ps,
                stamps,
                320,
                256,
                options,
                undefined,
                underlay ? wash : undefined,
              )
              if (inkStyle === 'ink') check(worker, 'Ordinary ink remains in Worker')
              if (worker) {
                try {
                  const paintedWorker = await worker.paint(320, 256, 512, { tileSize: 128 })
                  full = delta(painted, paintedWorker)
                  check(full.changed === 0, 'Worker full RGBA equals tiled painter')
                  const region = { x: 70, y: 50, w: 120, h: 150 }
                  const nativeRegion = await paintPlacementsRegionResponsive(
                    ps,
                    stamps,
                    region,
                    240,
                    300,
                    { ...paintOptions, layoutW: 320, layoutH: 256 },
                  )
                  const workerRegion = await worker.paint(240, 300, 512, { region })
                  crop = delta(nativeRegion, workerRegion)
                  check(crop.changed === 0, 'Worker zoom RGBA equals region painter')
                  for (const c of [paintedWorker, nativeRegion, workerRegion])
                    c.width = c.height = 1
                } finally {
                  worker.dispose()
                }
              }
              cases.push({
                background,
                inkStyle,
                underlay,
                project,
                full,
                crop,
                svgImages: underlay ? 1 : 0,
              })
              painted.width = painted.height = restored.width = restored.height = 1
            } finally {
              loaded.dispose()
            }
          }
      for (const underlay of [-0.1, 0.851, NaN, Infinity]) {
        let rejected = false
        try {
          await createSignatureProject({
            portrait: image,
            portraitFile: file,
            portraitName: file.name,
            options: { underlay },
            placements: ps,
            stamps,
            width: 320,
            height: 256,
          })
        } catch {
          rejected = true
        }
        check(rejected, 'Invalid background strength rejected')
      }
      URL.revokeObjectURL(objectUrl)
      return cases
    })
  async function ready() {
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('button')).some(
          (b) => b.textContent.trim() === '生成预览' && !b.disabled,
        ),
      undefined,
      { timeout: 180000 },
    )
    assert.equal(await page.locator('.error').count(), 0)
  }
  async function download(label, name) {
    if (label === '下载矢量 JSON' || label === '下载 Path SVG')
      await openSignatureSection(page, '矢量导出')
    const waiting = page.waitForEvent('download', { timeout: 180000 })
    await page.getByRole('button', { name: label, exact: true }).click()
    await (await waiting).saveAs(path.join(out, name))
    await ready()
    return readFile(path.join(out, name))
  }
  assert.equal(await page.getByLabel('画面风格', { exact: true }).inputValue(), 'pure')
  await page.getByLabel('名字', { exact: true }).fill('林晓晚')
  await page.getByLabel('目标遍数', { exact: true }).fill('10')
  await page.getByRole('button', { name: '一键生成 10 种写法', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.bank-grid li').length === 10)
  await page.getByRole('button', { name: '2K', exact: true }).click()
  await page.getByLabel('笔迹浓度', { exact: true }).fill('3')
  await page
    .locator('.creation-bar input[accept="image/*"]')
    .setInputFiles(process.env.ASTRA_FUSION_SOURCE || 'public/artwork/portrait.jpg')
  await ready()
  const before = JSON.parse(await download('下载矢量 JSON', 'pure.json'))
  const pure = await download('下载 PNG', 'pure.png')
  await page.evaluate(() => {
    window.__fusionResponse = { frames: [], timer: [], start: performance.now() }
    let lastFrame = performance.now(),
      lastTimer = lastFrame
    window.__fusionTick = setInterval(() => {
      const now = performance.now()
      window.__fusionResponse.timer.push(now - lastTimer)
      lastTimer = now
    }, 20)
    const tick = (now) => {
      window.__fusionResponse.frames.push(now - lastFrame)
      lastFrame = now
      window.__fusionRaf = requestAnimationFrame(tick)
    }
    window.__fusionRaf = requestAnimationFrame(tick)
  })
  await page.getByRole('button', { name: '浓彩融合', exact: true }).click()
  await ready()
  report.response = await page.evaluate(() => {
    clearInterval(window.__fusionTick)
    cancelAnimationFrame(window.__fusionRaf)
    const quantile = (values) =>
      [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * 0.95)]
    return {
      duration: performance.now() - window.__fusionResponse.start,
      frames: window.__fusionResponse.frames.length,
      frameP95: quantile(window.__fusionResponse.frames),
      maxFrame: Math.max(...window.__fusionResponse.frames),
      maxTimer: Math.max(...window.__fusionResponse.timer),
    }
  })
  assert(await page.locator('.fusion-notice').isVisible())
  const fusion = JSON.parse(await download('下载矢量 JSON', 'fusion.json'))
  assert.equal(fusion.renderOptions.underlay, 0.75)
  assert.deepEqual(
    fusion.placements,
    before.placements,
    'Background does not change handwriting layout',
  )
  const fused = await download('下载 PNG', 'fusion.png')
  assert.notEqual(sha(fused), sha(pure))
  await download('下载 Path SVG', 'fusion.svg')
  const svg = await readFile(path.join(out, 'fusion.svg'), 'utf8')
  assert.equal((svg.match(/<image /g) || []).length, 1)
  assert(svg.includes('data:image/png;base64,') && svg.includes('opacity="0.75"'))
  await download('保存作品文件', 'fusion.astra-signature')
  const pngBefore = sha(fused)
  await page.getByLabel('底色浓度', { exact: true }).fill('0.85')
  assert.equal(
    sha(await download('下载 PNG', 'unapplied.png')),
    pngBefore,
    'Unapplied slider preserves snapshot',
  )
  await page.getByLabel('画面风格', { exact: true }).selectOption('pure')
  assert.equal(sha(await download('下载 PNG', 'unapplied-pure.png')), pngBefore)
  const reopening = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  reopening.on('pageerror', (e) => report.errors.push(e.message))
  await reopening.goto(base + '/signature-portrait')
  await reopening
    .locator('input[accept=".astra-signature"]')
    .setInputFiles(path.join(out, 'fusion.astra-signature'))
  await reopening.waitForFunction(
    () =>
      !!document.querySelector('.result-canvas') &&
      !document.querySelector('.creation-bar button')?.disabled,
    undefined,
    { timeout: 180000 },
  )
  assert.equal(await reopening.getByLabel('画面风格', { exact: true }).inputValue(), 'fusion')
  assert.equal(await reopening.getByLabel('底色浓度', { exact: true }).inputValue(), '0.75')
  const dl = reopening.waitForEvent('download', { timeout: 180000 })
  await reopening.getByRole('button', { name: '下载 PNG', exact: true }).click()
  await (await dl).saveAs(path.join(out, 'restored.png'))
  assert.equal(sha(await readFile(path.join(out, 'restored.png'))), pngBefore, 'Reopened exact PNG')
  report.zoom = []
  for (const quality of ['clear', 'fast', 'detail']) {
    await reopening.getByLabel('缩放清晰度', { exact: true }).selectOption(quality)
    await reopening.getByRole('button', { name: '原大', exact: true }).click()
    await reopening.waitForFunction(
      () =>
        !!document.querySelector('.sharp-viewport-canvas') &&
        !document.querySelector('.render-feedback'),
      undefined,
      { timeout: 90000 },
    )
    const state = await reopening
      .locator('.sharp-viewport-canvas')
      .evaluate((c) => ({ width: c.width, height: c.height, region: JSON.parse(c.dataset.region) }))
    assert(
      Math.max(state.width, state.height) <=
        (quality === 'detail' ? 3200 : quality === 'fast' ? 1280 : 2400),
    )
    report.zoom.push({ quality, ...state })
  }
  await reopening.getByRole('button', { name: '适应', exact: true }).click()
  for (const width of [1440, 390])
    for (const theme of ['dark', 'light']) {
      await reopening.setViewportSize({ width, height: 960 })
      await reopening.evaluate((mode) => {
        document.documentElement.dataset.theme = mode
        document.documentElement.style.colorScheme = mode
      }, theme)
      await reopening.waitForTimeout(150)
      assert(
        await reopening.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'No horizontal page overflow',
      )
      await reopening
        .locator('.preview')
        .screenshot({ path: path.join(out, `preview-${theme}-${width}.png`) })
    }
  report.ui = {
    count: fusion.placements.length,
    size: [fusion.width, fusion.height],
    pureHash: sha(pure),
    fusedHash: sha(fused),
    geometryEqual: true,
    explicitMixedLabel: true,
    unappliedSnapshot: true,
    projectExactPng: true,
    privateSource: Boolean(process.env.ASTRA_FUSION_SOURCE),
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({
      out,
      passed: report.passed,
      cases: report.cases.length,
      ui: report.ui,
      response: report.response,
      failure: report.failure,
    }),
  )
}
