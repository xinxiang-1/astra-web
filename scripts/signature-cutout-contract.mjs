import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const directory = path.resolve(process.env.ASTRA_CUTOUT_OUTPUT || 'test-results/signature-cutout')
const uiOnly = process.argv.includes('--ui-only')
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.ASTRA_BROWSER_CHANNEL ? { channel: process.env.ASTRA_BROWSER_CHANNEL } : {}) })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'reduce', acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.exposeFunction('cutoutProgress', async value => {
    console.log(JSON.stringify(value))
    await writeFile(path.join(directory, 'progress.json'), JSON.stringify(value, null, 2))
  })
  await page.goto(`${base}/signature-portrait`)
  const result = uiOnly ? { scope: 'Production UI contract only; engine/export matrix is checked separately in development.' } : await page.evaluate(async () => {
    const engine = await import('/src/lib/signature-portrait/index.ts')
    const image = new Image(); image.src = '/artwork/portrait.jpg'; await image.decode()
    const bank = await engine.generateHandwritingVariants('心上人', { count: 100, seed: 42 })
    await window.cutoutProgress({ stage: 'generated', count: bank.length })
    const traced = await engine.traceStamps(bank)
    await window.cutoutProgress({ stage: 'traced' })
    const again = await engine.traceStamps(bank)
    await window.cutoutProgress({ stage: 'repeated-trace' })
    const deterministicTrace = JSON.stringify(traced.map(s => s.vector)) === JSON.stringify(again.map(s => s.vector))
    const records = []
    let proof, crop
    function compare(a, b) {
      const pa = a.getContext('2d').getImageData(0, 0, a.width, a.height).data
      const pb = b.getContext('2d').getImageData(0, 0, b.width, b.height).data
      let sum = 0
      for (let i = 0; i < pa.length; i += 4) for (let j = 0; j < 3; j++) sum += Math.abs(pa[i + j] - pb[i + j]) / 255
      return sum / (pa.length / 4 * 3)
    }
    for (const surface of ['paper', 'night']) for (const colorize of [false, true]) for (const coverFill of [false, true]) {
      const options = { inkStyle: 'cutout', maxSide: 768, skipPaint: true, seed: 42, density: 30, minSizeRatio: .014, maxSizeRatio: .04, angleRange: 12, colorize, coverFill, invertDensity: surface === 'night', background: surface === 'night' ? '#111615' : '#f5f3ef', ink: surface === 'night' ? { r: 238, g: 234, b: 226 } : undefined, underlay: 0 }
      const layout = await engine.renderSignaturePortrait(image, image.width, image.height, bank, options)
      await window.cutoutProgress({ stage: 'layout', surface, colorize, coverFill, count: layout.placements.length })
      const start = performance.now()
      const canvas = engine.paintPlacementsScaled(layout.placements, traced, layout.width, layout.height, layout.width, layout.height, options)
      const canvasMs = performance.now() - start
      const tiled = await engine.paintPlacementsTiled(layout.placements, traced, layout.width, layout.height, layout.width, layout.height, { ...options, tileSize: 128 })
      const region = engine.paintPlacementsRegion(layout.placements, traced, { x: 0, y: 0, w: layout.width, h: layout.height }, layout.width, layout.height, options)
      const svg = engine.buildPathSvgDocument(layout.placements, traced, layout.width, layout.height, options)
      await window.cutoutProgress({ stage: 'svg-decode-start', surface, colorize, coverFill, bytes: svg.length })
      const svgDecodeStarted = performance.now()
      const img = new Image(), url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); img.src = url; await img.decode()
      const svgDecodeMs = performance.now() - svgDecodeStarted
      const raster = document.createElement('canvas'); raster.width = layout.width; raster.height = layout.height; raster.getContext('2d').drawImage(img, 0, 0); URL.revokeObjectURL(url)
      records.push({ surface, colorize, coverFill, placements: layout.placements.length, canvasMs, svgDecodeMs, canvasTiledMae: compare(canvas, tiled), canvasRegionMae: compare(canvas, region), canvasSvgMae: compare(canvas, raster), masks: (svg.match(/<mask\b/g) || []).length, compoundPaths: (svg.match(/fill-rule="evenodd"/g) || []).length, hasImage: /<image\b/.test(svg), hasEllipse: /<ellipse\b/.test(svg) })
      await window.cutoutProgress({ stage: 'case-complete', ...records.at(-1) })
      if (surface === 'paper' && !colorize && !coverFill) {
        proof = canvas.toDataURL().split(',')[1]
        crop = engine.paintPlacementsRegion(layout.placements, traced, { x: layout.width * .3, y: layout.height * .3, w: 200, h: 200 }, 800, 800, options).toDataURL().split(',')[1]
      }
    }
    return { bankSize: bank.length, tracedSize: traced.length, allHavePaths: traced.every(s => s.vector.paths.length > 0), deterministicTrace, records, proof, crop }
  })
  for (const field of uiOnly ? [] : ['proof', 'crop']) {
    await writeFile(path.join(directory, `${field}.png`), Buffer.from(result[field], 'base64'))
    delete result[field]
  }
  // Preserve measured failures before asserting a gate.
  await writeFile(path.join(directory, 'engine-results.json'), JSON.stringify(result, null, 2))
  if (!uiOnly) assert(result.allHavePaths && result.deterministicTrace)
  for (const record of result.records || []) {
    assert(record.canvasTiledMae < .004, JSON.stringify(record))
    assert(record.canvasRegionMae < .004, JSON.stringify(record))
    assert(record.canvasSvgMae < .01, JSON.stringify(record))
    assert.equal(record.masks, 0)
    assert.equal(record.compoundPaths, 100)
    assert.equal(record.hasImage, false)
    assert.equal(record.hasEllipse, record.coverFill)
  }
  const style = page.getByLabel('签名风格', { exact: true })
  assert.equal(await style.inputValue(), 'ink', 'Existing ink style must remain the default')
  await style.selectOption('cutout')
  await page.getByRole('button', { name: '2K', exact: true }).click()
  await page.getByRole('button', { name: '一键试用示例', exact: true }).click()
  await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === '生成预览' && !button.disabled))
  assert.equal(await style.inputValue(), 'cutout')
  const backend = await page.locator('.result-canvas').evaluate(canvas => canvas.getContext('2d') ? 'canvas2d' : 'webgl')
  assert.equal(backend, 'canvas2d')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载矢量 JSON', exact: true }).click()
  const file = await downloaded; await file.saveAs(path.join(directory, 'ui-cutout.json'))
  const json = JSON.parse(await readFile(path.join(directory, 'ui-cutout.json'), 'utf8'))
  assert.equal(json.renderOptions.inkStyle, 'cutout')
  await page.locator('.preview').screenshot({ path: path.join(directory, 'desktop-preview.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth + 1)
  await page.locator('.preview').screenshot({ path: path.join(directory, 'mobile-preview.png') })
  assert.deepEqual(errors, [])
  const files = ['src/lib/signature-portrait/ink-style.ts', 'src/lib/signature-portrait/vector-ink.ts', 'src/lib/signature-portrait/layout.ts', 'src/lib/signature-portrait/trace.ts', 'src/views/SignaturePortraitView.vue', 'src/lib/signature-portrait/variants.ts', 'src/lib/signature-portrait/fonts.ts', 'public/fonts/signature/MaShanZheng-Regular.ttf', 'public/artwork/portrait.jpg']
  result.sourceHashes = Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
  result.ui = { default: 'ink', selected: 'cutout', backend, mobileWidth: 390, errors }
  result.browser = await browser.version()
  if (!uiOnly) result.scope = 'Contract validation on development image and generated fonts, not a holdout aesthetic score or a device performance certificate. 4K/8K PNG evidence is in signature-cutout-print.'
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally { await browser.close() }
