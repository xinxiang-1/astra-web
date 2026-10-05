import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { openSignatureSection } from './signature-ui-helpers.mjs'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_TONE_OUTPUT || `test-results/signature-tone-${Date.now()}`,
)
const parent = 'abd34996e940e94d4f2271562c310314da8ab4cc'
await mkdir(out, { recursive: true })
const url = (filename) =>
  '/' + path.relative(process.cwd(), path.join(out, filename)).split(path.sep).join('/')
for (const name of ['layout-compute', 'woven', 'layout']) {
  let code = execFileSync('git', ['show', `${parent}:src/lib/signature-portrait/${name}.ts`], {
    encoding: 'utf8',
  })
  code = code.replace(
    /'\.\/([^']+)'/g,
    (_, dep) =>
      `'${dep === 'woven' ? url('frozen-woven.ts') : '/src/lib/signature-portrait/' + dep}'`,
  )
  await writeFile(path.join(out, `frozen-${name}.ts`), code)
}
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = { browser: browser.version(), parent, errors: [], cases: [] }
const sha = (data) => createHash('sha256').update(data).digest('hex')
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  report.cases = await page.evaluate(
    async ({ frozenUrl, frozenPaintUrl }) => {
      const { computePlacementsFromPixels: frozen } = await import(frozenUrl)
      const { computePlacementsFromPixels: compute } =
        await import('/src/lib/signature-portrait/layout-compute.ts')
      const { signatureInkStrength } = await import('/src/lib/signature-portrait/render-style.ts')
      const { createTextStamp, measureStampTraits } =
        await import('/src/lib/signature-portrait/extract.ts')
      const { paintPlacements, paintPlacementsTiled } =
        await import('/src/lib/signature-portrait/layout.ts')
      const frozenPaint = await import(frozenPaintUrl)
      const { createSignatureRasterWorker } =
        await import('/src/lib/signature-portrait/raster-worker-client.ts')
      const { traceStamps, buildPathSvgDocument } =
        await import('/src/lib/signature-portrait/trace.ts')
      const check = (v, label) => {
        if (!v) throw new Error(label)
      }
      const same = (a, b, label) => check(JSON.stringify(a) === JSON.stringify(b), label)
      const stamps = ['李云舟', 'Astra'].map((text) => createTextStamp(text))
      const width = 320,
        height = 256,
        pixels = new Uint8ClampedArray(width * height * 4)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const tone = Math.floor((y / height) * 160)
          pixels.set(
            x < 80
              ? [225, 35 + tone, 35, 255]
              : x < 160
                ? [30, 75 + tone, 225, 255]
                : x < 240
                  ? [30, 175, 40 + tone, 255]
                  : [180, 180, 180, x > 300 ? 0 : 255],
            (y * width + x) * 4,
          )
        }
      const metrics = stamps.map((s) => ({
        width: s.width,
        height: s.height,
        aspect: s.width / s.height,
        inkRatio: Math.max(0.04, Math.min(0.4, measureStampTraits(s.canvas).inkRatio)),
      }))
      const input = {
        fullPixels: pixels,
        outW: width,
        outH: height,
        aPixels: pixels,
        aW: width,
        aH: height,
        aScale: 1,
        sizeMin: 12,
        sizeMax: 32,
        longSide: 320,
        stampMetrics: metrics,
      }
      const rgba = (canvas) =>
        canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      const delta = (a, b) => {
        const aa = rgba(a),
          bb = rgba(b)
        check(aa.length === bb.length, 'Pixel dimensions')
        let changed = 0,
          max = 0
        for (let i = 0; i < aa.length; i++) {
          if (aa[i] !== bb[i]) changed++
          max = Math.max(max, Math.abs(aa[i] - bb[i]))
        }
        return { changed, max, channels: aa.length }
      }
      const geom = (ps) =>
        ps.map(({ strength: _strength, tint: _tint, tintLiteral: _literal, ...p }) => p)
      const results = []
      for (const layoutMethod of ['woven', 'stipple'])
        for (const orientationMode of layoutMethod === 'woven' ? ['classic', 'flow'] : ['classic'])
          for (const surface of ['paper', 'night']) {
            const options = {
              layoutMethod,
              orientationMode,
              orientationStrength: 0.8,
              density: 5,
              seed: 42,
              angleRange: 12,
              edgeOutline: true,
              edgeColorMode: 'auto',
              invertDensity: surface === 'night',
              inkColor: surface === 'night' ? { r: 238, g: 234, b: 226 } : undefined,
              lloydIters: 2,
            }
            const old = frozen({ ...input, options }),
              plain = compute({ ...input, options }),
              gain = compute({ ...input, options: { ...options, toneGain: 1.8 } }),
              source = compute({
                ...input,
                options: { ...options, toneGain: 1.8, sourceColor: true },
              })
            same(old, plain, 'Unspecified settings preserve frozen placements')
            same(
              plain,
              compute({ ...input, options: { ...options, toneGain: 1, sourceColor: false } }),
              'Explicit defaults preserve placements',
            )
            same(geom(plain), geom(gain), 'Ink enhancement keeps all geometry')
            same(geom(plain), geom(source), 'Source color keeps all geometry')
            check(
              gain.some((p, i) => p.strength > plain[i].strength),
              'Enhancement is effective',
            )
            check(
              gain.every((p, i) => p.strength >= plain[i].strength && p.strength <= 1),
              'Bounded monotonic ink',
            )
            check(
              gain.every((p, i) => plain[i].strength >= 1 || p.strength < 1),
              'No new hard clipping',
            )
            for (const edgeColorMode of ['custom', 'ink']) {
              const ps = compute({
                ...input,
                options: {
                  ...options,
                  sourceColor: true,
                  edgeColorMode,
                  edgeColor: { r: 200, g: 30, b: 60 },
                },
              })
              check(
                ps.some((p) => p.onEdge),
                'Exercise explicit edge color',
              )
              check(
                ps.filter((p) => p.onEdge).every((p) => p.tintLiteral),
                'Explicit edges stay literal',
              )
            }
            results.push({
              layoutMethod,
              orientationMode,
              surface,
              count: plain.length,
              geometryRetained: true,
              frozenDefaultEqual: true,
              meanStrength: plain.reduce((s, p) => s + p.strength, 0) / plain.length,
              enhancedMean: gain.reduce((s, p) => s + p.strength, 0) / gain.length,
            })
          }
      for (const inkStyle of ['ink', 'cutout'])
        for (const surface of ['paper', 'night'])
          for (const sourceColor of [false, true]) {
            const options = {
              inkStyle,
              background: surface === 'paper' ? '#f5f3ef' : '#111615',
              colorize: true,
              stampMaxLong: 512,
            }
            const ps = compute({
              ...input,
              options: {
                layoutMethod: 'woven',
                toneGain: 1.8,
                sourceColor,
                seed: 42,
                inkColor: surface === 'night' ? { r: 238, g: 234, b: 226 } : undefined,
                invertDensity: surface === 'night',
              },
            })
            const sync = paintPlacements(ps, stamps, width, height, options)
            const tiles = await paintPlacementsTiled(ps, stamps, width, height, width, height, {
              ...options,
              tileSize: 128,
            })
            const oldSync = frozenPaint.paintPlacements(ps, stamps, width, height, options)
            const oldTiles = await frozenPaint.paintPlacementsTiled(
              ps,
              stamps,
              width,
              height,
              width,
              height,
              { ...options, tileSize: 128 },
            )
            const synchronous = delta(oldSync, sync)
            check(synchronous.changed === 0, 'Enhanced synchronous RGBA')
            const tiled = delta(oldTiles, tiles)
            check(tiled.changed === 0, 'Enhanced tiled RGBA')
            let worker = null
            const raster = await createSignatureRasterWorker(ps, stamps, width, height, options)
            if (raster) {
              try {
                const c = await raster.paint(width, height, 512, { tileSize: 128 })
                worker = delta(oldTiles, c)
                check(worker.changed === 0, 'Enhanced Worker RGBA')
                c.width = c.height = 1
              } finally {
                raster.dispose()
              }
            }
            const traced = await traceStamps(stamps)
            const svg = buildPathSvgDocument(ps, traced, width, height, options)
            const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
            check(!doc.querySelector('parsererror'), 'Valid path SVG')
            const gs = Array.from(doc.querySelectorAll('g[opacity]'))
            const order = [...ps].sort((a, b) => b.targetSize - a.targetSize || a.depth - b.depth)
            check(gs.length === ps.length, 'SVG retains complete signatures')
            check(
              gs.every(
                (g, i) =>
                  Math.abs(Number(g.getAttribute('opacity')) - order[i].strength) <= 0.00051,
              ),
              'SVG retains enhanced opacity',
            )
            check(!doc.querySelector('image'), 'No photograph underlay')
            results.push({
              inkStyle,
              surface,
              sourceColor,
              count: ps.length,
              synchronous,
              tiled,
              worker,
              svgOpacityRetained: true,
            })
            sync.width = sync.height = tiles.width = tiles.height = 1
            oldSync.width = oldSync.height = oldTiles.width = oldTiles.height = 1
          }
      for (const gain of [1, 1.8, 3]) {
        const ramp = Array.from({ length: 101 }, (_, i) => signatureInkStrength(i / 100, gain))
        check(ramp[0] === 0 && ramp[100] === 1, 'Exact empty/dark endpoints')
        check(
          ramp.every((v, i) => i === 0 || v > ramp[i - 1]),
          'Strictly ordered tone ramp',
        )
      }
      const fixture = document.createElement('canvas')
      fixture.width = 640
      fixture.height = 800
      const ctx = fixture.getContext('2d'),
        gradient = ctx.createLinearGradient(0, 0, 640, 800)
      gradient.addColorStop(0, '#cc2233')
      gradient.addColorStop(0.5, '#1166bb')
      gradient.addColorStop(1, '#009966')
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, 640, 800)
      ctx.fillStyle = '#d7b991'
      ctx.beginPath()
      ctx.ellipse(320, 330, 170, 230, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#292534'
      ctx.fillRect(235, 270, 48, 20)
      ctx.fillRect(365, 270, 48, 20)
      ctx.fillRect(275, 420, 90, 18)
      window.__toneFixture = fixture.toDataURL().split(',')[1]
      return results
    },
    { frozenUrl: url('frozen-layout-compute.ts'), frozenPaintUrl: url('frozen-layout.ts') },
  )
  console.log(`Algorithm and renderer cases: ${report.cases.length}`)
  const fixture = Buffer.from(await page.evaluate(() => window.__toneFixture), 'base64')
  await writeFile(path.join(out, 'source.png'), fixture)
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
    const file = await waiting
    await file.saveAs(path.join(out, name))
    await ready()
    return await readFile(path.join(out, name))
  }
  await page.getByLabel('名字', { exact: true }).fill('李云舟')
  await page.getByLabel('目标遍数', { exact: true }).fill('10')
  await page.getByRole('button', { name: '一键生成 10 种写法', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.bank-grid li').length === 10)
  await page.getByRole('button', { name: '2K', exact: true }).click()
  await page
    .locator('.creation-bar input[accept="image/*"]')
    .setInputFiles({ name: 'color-portrait.png', mimeType: 'image/png', buffer: fixture })
  await ready()
  const before = JSON.parse(await download('下载矢量 JSON', 'before.json'))
  const beforePng = await download('下载 PNG', 'before.png')
  await page.getByRole('button', { name: '增强笔迹', exact: true }).click()
  await ready()
  const enhanced = JSON.parse(await download('下载矢量 JSON', 'enhanced.json'))
  const geom = (ps) =>
    ps.map(({ strength: _strength, tint: _tint, tintLiteral: _literal, ...p }) => p)
  assert.deepEqual(geom(enhanced.placements), geom(before.placements))
  assert.equal(enhanced.renderOptions.toneGain, 1.8)
  const enhancedPng = await download('下载 PNG', 'enhanced.png')
  assert.notEqual(sha(beforePng), sha(enhancedPng))
  await openSignatureSection(page, '色彩与光影')
  await page.getByLabel('彩墨风格', { exact: true }).selectOption('source')
  assert.equal(
    sha(await download('下载 PNG', 'unapplied.png')),
    sha(enhancedPng),
    'Unapplied color setting keeps generated PNG',
  )
  await page.getByRole('button', { name: '生成预览', exact: true }).click()
  await ready()
  const colored = JSON.parse(await download('下载矢量 JSON', 'colored.json'))
  assert.equal(colored.renderOptions.colorMode, 'source')
  assert(colored.placements.every((p) => p.tintLiteral))
  assert.deepEqual(geom(colored.placements), geom(before.placements))
  const coloredPng = await download('下载 PNG', 'colored.png')
  assert.notEqual(sha(coloredPng), sha(enhancedPng))
  await download('下载 Path SVG', 'colored.svg')
  await download('保存作品文件', 'colored.astra-signature')
  await page.locator('.preview').screenshot({ path: path.join(out, 'colored-preview.png') })
  for (const width of [1440, 390])
    for (const theme of ['dark', 'light']) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
      if ((await page.evaluate(() => document.documentElement.dataset.theme)) !== theme)
        await page
          .getByRole('button', {
            name: theme === 'dark' ? '切换到暗色' : '切换到亮色',
            exact: true,
          })
          .click()
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
        0,
        'No page overflow',
      )
      assert(await page.getByLabel('彩墨风格', { exact: true }).isVisible())
    }
  const restored = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  restored.on('pageerror', (e) => report.errors.push(e.message))
  await restored.goto(base + '/signature-portrait')
  await restored
    .locator('input[accept=".astra-signature"]')
    .setInputFiles(path.join(out, 'colored.astra-signature'))
  await restored.waitForFunction(
    () =>
      !!document.querySelector('.result-canvas') &&
      !document.querySelector('.creation-bar button')?.disabled,
    undefined,
    { timeout: 180000 },
  )
  assert.equal(await restored.getByLabel('笔迹浓度', { exact: true }).inputValue(), '1.8')
  await openSignatureSection(restored, '色彩与光影')
  assert.equal(await restored.getByLabel('彩墨风格', { exact: true }).inputValue(), 'source')
  const waiting = restored.waitForEvent('download', { timeout: 180000 })
  await restored.getByRole('button', { name: '下载 PNG', exact: true }).click()
  await (await waiting).saveAs(path.join(out, 'restored.png'))
  assert.equal(
    sha(await readFile(path.join(out, 'restored.png'))),
    sha(coloredPng),
    'New palette and density restore exact PNG',
  )
  report.ui = {
    beforeHash: sha(beforePng),
    enhancedHash: sha(enhancedPng),
    coloredHash: sha(coloredPng),
    count: colored.placements.length,
    geometryRetained: true,
    unappliedSnapshotRetained: true,
    projectExactPng: true,
    themes: ['dark', 'light'],
    widths: [1440, 390],
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.passed = false
  report.failure = error.stack
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({
      out,
      passed: report.passed,
      cases: report.cases.length,
      ui: report.ui,
      failure: report.failure,
    }),
  )
  await browser.close()
}
