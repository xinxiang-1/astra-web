import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { openSignatureSection } from './signature-ui-helpers.mjs'

const out = path.resolve(process.env.ASTRA_WASH_OUTPUT || `test-results/signature-wash-${Date.now()}`)
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const report = { browser: browser.version(), cases: [], errors: [], privateSource: Boolean(process.env.ASTRA_WASH_SOURCE) }
const sha = data => createHash('sha256').update(data).digest('hex')
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true, reducedMotion: 'reduce' })
  page.on('pageerror', e => report.errors.push(e.message))
  await page.goto(base + '/signature-portrait')
  if (process.argv.includes('--labels-only')) {
    report.labelCases = []
    for (const [style, name, palette] of [['duotone-v1', '双色绘影', '深蓝＋珊瑚红'], ['pop-v1', '波普彩绘', '紫罗兰＋金黄']]) {
      await page.locator('input[accept=".astra-signature"]').setInputFiles(path.join(process.env.ASTRA_WASH_PROJECT_ROOT || 'test-results/signature-wash-ui-production-edge-final', `${style}.astra-signature`))
      await page.waitForFunction(() => document.body.textContent.includes('作品已恢复') && !document.querySelector('.render-feedback'), undefined, { timeout: 180000 })
      const text = await page.locator('.fusion-notice').textContent()
      assert(text.includes(name) && text.includes(palette))
      assert.equal(await page.locator('.result-settings-changed').count(), 0)
      await page.getByLabel('彩绘色板', { exact: true }).selectOption('forest-rose')
      assert.equal(await page.locator('.fusion-notice').textContent(), text, 'Displayed label follows the generated snapshot')
      assert(await page.locator('.result-settings-changed').isVisible())
      await page.locator('.preview').screenshot({ path: path.join(out, `${style}-preview.png`) })
      report.labelCases.push({ style, snapshotLabel: true, dirtyState: true })
    }
  }
  if (!process.argv.includes('--ui-only') && !process.argv.includes('--labels-only')) report.cases = await page.evaluate(async () => {
    const { prepareSignatureWash, preparedSignatureWash } = await import('/src/lib/signature-portrait/styled-wash.ts')
    const { signatureColorWash } = await import('/src/lib/signature-portrait/color-wash.ts')
    const { washRecipe, processSignatureWash, createWashTaskQueue } = await import('/src/lib/signature-portrait/wash-style.ts')
    const { createTextStamp, loadImageElement } = await import('/src/lib/signature-portrait/extract.ts')
    const { paintPlacementsTiled, paintPlacementsRegionResponsive } = await import('/src/lib/signature-portrait/layout.ts')
    const { createSignatureRasterWorker } = await import('/src/lib/signature-portrait/raster-worker-client.ts')
    const { traceStamps, buildPathSvgDocument } = await import('/src/lib/signature-portrait/trace.ts')
    const { createSignatureProject, readSignatureProject } = await import('/src/lib/signature-portrait/project.ts')
    const check = (v, label) => { if (!v) throw new Error(label) }
    const source = document.createElement('canvas'); source.width = 640; source.height = 800
    const c = source.getContext('2d'), gradient = c.createLinearGradient(0, 0, 640, 800)
    gradient.addColorStop(0, '#ed335e'); gradient.addColorStop(.5, '#143a73'); gradient.addColorStop(1, '#ffbf61')
    c.fillStyle = gradient; c.fillRect(0, 0, 640, 800); c.clearRect(0, 0, 75, 200)
    c.globalCompositeOperation = 'destination-out'; c.fillStyle = '#0008'; c.fillRect(100, 40, 60, 50)
    const file = new File([await new Promise(r => source.toBlob(r))], 'controlled.png', { type: 'image/png' })
    const { image, objectUrl } = await loadImageElement(file)
    const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const delta = (a, b) => { const aa = pixels(a), bb = pixels(b); check(aa.length === bb.length, 'dimensions'); let changed = 0, max = 0
      for (let i = 0; i < aa.length; i++) { const d = Math.abs(aa[i] - bb[i]); if (d) changed++; max = Math.max(d, max) } return { changed, max, channels: aa.length } }
    const stamps = await traceStamps(['李云舟', 'Astra'].map(text => createTextStamp(text)))
    const ps = Array.from({ length: 48 }, (_, i) => ({ x: 20 + i % 8 * 40, y: 22 + Math.floor(i / 8) * 43, angle: (i % 3 - 1) * .06,
      targetSize: 32, stampIndex: i % 2, strength: .2 + i % 4 * .2, tint: { r: 20 + i * 3, g: 15 + i, b: 30 + i * 2 }, blend: i % 3 ? 'soft' : 'ink', depth: i % 7 / 7 }))
    const geometry = JSON.stringify(ps), raw = signatureColorWash(image), rawBytes = pixels(raw).slice(), cases = []
    check(await prepareSignatureWash(image) === raw && preparedSignatureWash(image) === raw, 'Default raw path stays identical')
    for (const washStyle of ['duotone-v1', 'pop-v1']) for (const washPalette of ['blue-coral', 'forest-rose', 'violet-gold']) {
      const recipe = { washStyle, washPalette }, start = performance.now(), wash = await prepareSignatureWash(image, recipe), bytes = pixels(wash)
      check(Math.max(wash.width, wash.height) === 384, '384px bounded source')
      check(await prepareSignatureWash(image, recipe) === wash && preparedSignatureWash(image, recipe) === wash, 'Cache reuse')
      for (let i = 3; i < bytes.length; i += 4) check(bytes[i] === rawBytes[i], 'Preserve every alpha byte')
      const tasks = createWashTaskQueue()
      let direct
      try { direct = await processSignatureWash(new ImageData(rawBytes.slice(), raw.width, raw.height), recipe, { checkpoint: tasks.yield }) }
      finally { tasks.close() }
      const directCanvas = document.createElement('canvas'); directCanvas.width = direct.width; directCanvas.height = direct.height
      directCanvas.getContext('2d', { willReadFrequently: true }).putImageData(direct, 0, 0)
      check(delta(wash, directCanvas).changed === 0, 'Worker and compatibility displayed RGBA agree including alpha premultiplication')
      directCanvas.width = directCanvas.height = 1
      cases.push({ kind: 'profile', ...recipe, processingMs: performance.now() - start, alphaEqual: true, algorithmEqual: true })
      for (const background of ['#f5f3ef', '#111615']) for (const inkStyle of ['ink', 'cutout']) {
        const options = { ...recipe, background, inkStyle, underlay: .75, colorize: true, coverFill: false }, painting = { ...options, portrait: wash, tileSize: 128, stampMaxLong: 512 }
        const painted = await paintPlacementsTiled(ps, stamps, 320, 256, 320, 256, painting)
        const saved = await createSignatureProject({ portrait: image, portraitFile: file, portraitName: file.name, options, stamps, placements: ps, width: 320, height: 256 })
        const loaded = await readSignatureProject(saved)
        let full = null, crop = null
        try {
          const restoredWash = await prepareSignatureWash(loaded.project.portrait, loaded.project.options)
          const restored = await paintPlacementsTiled(loaded.project.placements, loaded.project.stamps, 320, 256, 320, 256, { ...painting, portrait: restoredWash })
          const project = delta(painted, restored); check(project.changed === 0, 'Project exact RGBA')
          check(loaded.project.options.washStyle === washStyle && loaded.project.options.washPalette === washPalette, 'Versioned saved profile')
          const svg = new DOMParser().parseFromString(buildPathSvgDocument(ps, stamps, 320, 256, { ...options, portraitHref: wash.toDataURL() }), 'image/svg+xml')
          check(!svg.querySelector('parsererror') && svg.querySelectorAll('image').length === 1 && svg.querySelectorAll('g[opacity]').length === ps.length, 'Mixed SVG retains background and complete signature paths')
          const worker = await createSignatureRasterWorker(ps, stamps, 320, 256, options, undefined, wash)
          if (inkStyle === 'ink') check(worker, 'Ordinary ink Worker available')
          if (worker) try {
            const w = await worker.paint(320, 256, 512, { tileSize: 128 }); full = delta(painted, w); check(full.changed === 0, 'Worker full exact RGBA')
            const region = { x: 70, y: 50, w: 120, h: 150 }
            const roi = await paintPlacementsRegionResponsive(ps, stamps, region, 240, 300, { ...painting, layoutW: 320, layoutH: 256 })
            const wr = await worker.paint(240, 300, 512, { region }); crop = delta(roi, wr); check(crop.changed === 0, 'Worker ROI exact RGBA')
            for (const canvas of [w, roi, wr]) canvas.width = canvas.height = 1
          } finally { worker.dispose() }
          cases.push({ kind: 'output', ...recipe, background, inkStyle, project, full, crop, svgImages: 1 })
          painted.width = painted.height = restored.width = restored.height = 1
        } finally { loaded.dispose() }
      }
    }
    check(JSON.stringify(ps) === geometry, 'Output does not modify placements')
    const finalRaw = pixels(raw); for (let i = 0; i < finalRaw.length; i++) check(finalRaw[i] === rawBytes[i], 'Styled processing preserves raw wash')
    const NativeWorker = window.Worker
    const clone = await loadImageElement(file)
    try {
      window.Worker = class extends NativeWorker { constructor(url, options) { if (String(url).includes('wash-style.worker')) throw new Error('QA worker unavailable'); super(url, options) } }
      const fallback = await prepareSignatureWash(clone.image, { washStyle: 'pop-v1', washPalette: 'violet-gold' })
      check(delta(fallback, preparedSignatureWash(image, { washStyle: 'pop-v1', washPalette: 'violet-gold' })).changed === 0, 'Actual Worker failure takes identical segmented path')
      const cancelled = await loadImageElement(file), signal = { cancelled: false }
      let rejected = false
      try { await prepareSignatureWash(cancelled.image, { washStyle: 'pop-v1' }, { signal, onProgress: () => { signal.cancelled = true } }) }
      catch { rejected = true }
      check(rejected, 'Mid-compute fallback cancellation')
      rejected = false
      try { preparedSignatureWash(cancelled.image, { washStyle: 'pop-v1' }) } catch { rejected = true }
      check(rejected, 'Cancelled profile never commits cache'); URL.revokeObjectURL(cancelled.objectUrl)
      cases.push({ kind: 'forced-worker-failure-and-mid-compute-cancel', exact: true })
    } finally { window.Worker = NativeWorker; URL.revokeObjectURL(clone.objectUrl) }
    let rejected = false
    try { await prepareSignatureWash(image, {}, { signal: { cancelled: true } }) } catch { rejected = true }
    check(rejected, 'Immediate cancellation including cache/raw paths')
    for (const options of [{ washStyle: 'bad', underlay: .75 }, { washStyle: 'duotone-v1', washPalette: 'bad', underlay: .75 },
      { washPalette: 'blue-coral', underlay: .75 }, { washStyle: 'pop-v1', underlay: 0 }, { washStyle: 'duotone-v1' }]) {
      let rejected = false
      try { await createSignatureProject({ portrait: image, portraitFile: file, portraitName: file.name, options, stamps, placements: ps, width: 320, height: 256 }) } catch { rejected = true }
      check(rejected, 'Invalid style contract rejected')
    }
    check(washRecipe({ washStyle: 'pop-v1' }).palette === 'blue-coral', 'Canonical default palette')
    const canonical = await readSignatureProject(await createSignatureProject({ portrait: image, portraitFile: file, portraitName: file.name,
      options: { washStyle: 'pop-v1', underlay: .75 }, stamps, placements: ps, width: 320, height: 256 }))
    check(canonical.project.options.washPalette === 'blue-coral', 'Project normalizes default palette'); canonical.dispose()
    URL.revokeObjectURL(objectUrl)
    cases.push({ kind: 'pure-preserved-geometry-immutable-rejections-default' })
    return cases
  })
  if (!process.argv.includes('--engine-only') && !process.argv.includes('--labels-only')) {
    const ready = async () => {
      await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === '生成预览' && !b.disabled), undefined, { timeout: 180000 })
      assert.equal(await page.locator('.error').count(), 0)
    }
    const download = async (label, name) => {
      if (label.includes('JSON') || label.includes('SVG')) await openSignatureSection(page, '矢量导出')
      const pending = page.waitForEvent('download', { timeout: 180000 }); await page.getByRole('button', { name: label, exact: true }).click()
      await (await pending).saveAs(path.join(out, name)); await ready(); return readFile(path.join(out, name))
    }
    await page.getByLabel('名字', { exact: true }).fill('林晓晚')
    await page.getByLabel('目标遍数', { exact: true }).fill('10')
    await page.getByRole('button', { name: '一键生成 10 种写法', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.bank-grid li').length === 10)
    await page.getByRole('button', { name: '2K', exact: true }).click()
    await page.getByLabel('笔迹浓度', { exact: true }).fill('3')
    await page.locator('.creation-bar input[accept="image/*"]').setInputFiles(process.env.ASTRA_WASH_SOURCE || 'public/artwork/portrait-reference.png')
    await ready()
    const pure = JSON.parse(await download('下载矢量 JSON', 'pure.json'))
    await page.getByLabel('画面风格', { exact: true }).selectOption('fusion')
    const outputs = []
    for (const [style, palette] of [['duotone-v1', 'blue-coral'], ['pop-v1', 'violet-gold']]) {
      await page.getByLabel('底色配色', { exact: true }).selectOption(style)
      await page.getByLabel('彩绘色板', { exact: true }).selectOption(palette)
      await page.evaluate(() => {
        const m = { frames: [], longTasks: [], active: true, previous: performance.now(), start: performance.now(), observer: null }
        const tick = now => { if (!m.active) return; m.frames.push(now - m.previous); m.previous = now; requestAnimationFrame(tick) }
        try { m.observer = new PerformanceObserver(list => m.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime - m.start, duration: e.duration })))); m.observer.observe({ type: 'longtask', buffered: false }) } catch {}
        window.__washMeter = m; requestAnimationFrame(tick)
      })
      await page.getByRole('button', { name: '生成预览', exact: true }).click(); await ready()
      const response = await page.evaluate(() => { const m = window.__washMeter; m.active = false; m.observer?.disconnect(); const sorted = m.frames.slice().sort((a, b) => a - b)
        return { durationMs: performance.now() - m.start, frames: m.frames.length, rafP95: sorted[Math.floor((sorted.length - 1) * .95)], rafMax: Math.max(...m.frames), longTasks: m.longTasks } })
      const json = JSON.parse(await download('下载矢量 JSON', `${style}.json`))
      assert.deepEqual(json.placements, pure.placements, 'Actual generated geometry/ink unchanged')
      assert.equal(json.renderOptions.washStyle, style); assert.equal(json.renderOptions.washPalette, palette)
      const png = await download('下载 PNG', `${style}.png`), hash = sha(png)
      await download('下载 Path SVG', `${style}.svg`)
      const svg = await readFile(path.join(out, `${style}.svg`), 'utf8')
      assert.equal((svg.match(/<image /g) || []).length, 1)
      await download('保存作品文件', `${style}.astra-signature`)
      outputs.push({ style, palette, hash, geometryEqual: true, response })
    }
    assert.notEqual(outputs[0].hash, outputs[1].hash)
    const latest = outputs.at(-1)
    // New controls remain unapplied until requested; downloads use the generated scene.
    await page.getByLabel('彩绘色板', { exact: true }).selectOption('forest-rose')
    assert.equal(sha(await download('下载 PNG', 'unapplied.png')), latest.hash)
    await page.getByRole('button', { name: '生成预览', exact: true }).click()
    await page.getByRole('button', { name: '取消生成', exact: true }).click(); await ready()
    assert.equal(sha(await download('下载 PNG', 'cancelled.png')), latest.hash)
    // Cancel after layout and background preparation while the new overview is painting.
    await page.getByRole('button', { name: '生成预览', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '精绘笔迹与色彩' }).first().waitFor({ timeout: 180000 }).catch(async () => {
      await page.waitForFunction(() => document.body.textContent.includes('精绘笔迹与色彩'), undefined, { timeout: 180000 })
    })
    await page.getByRole('button', { name: '取消生成', exact: true }).click(); await ready()
    assert.equal(sha(await download('下载 PNG', 'late-cancel.png')), latest.hash)
    // Inject a real background-preparation failure before the scene commits.
    await page.getByLabel('彩绘色板', { exact: true }).selectOption('blue-coral')
    await page.evaluate(() => {
      const native = CanvasRenderingContext2D.prototype.getImageData
      window.__washGetImageData = native
      CanvasRenderingContext2D.prototype.getImageData = function(...args) {
        if (Math.max(this.canvas.width, this.canvas.height) === 384) throw new Error('QA 彩绘准备失败')
        return native.apply(this, args)
      }
    })
    await page.getByRole('button', { name: '生成预览', exact: true }).click()
    await page.locator('.error').waitFor({ timeout: 180000 })
    assert.match(await page.locator('.error').textContent(), /QA 彩绘准备失败/)
    await page.evaluate(() => CanvasRenderingContext2D.prototype.getImageData = window.__washGetImageData)
    assert.equal(sha(await download('下载 PNG', 'failed-keeps-scene.png')), latest.hash)
    await page.getByRole('button', { name: '对比原图', exact: true }).click()
    const comparisonSource = await page.locator('.compare-base').getAttribute('src')
    await page.locator('.compare-base').evaluate(image => image.decode())
    await page.locator('.creation-bar input[accept="image/*"]').setInputFiles('public/artwork/porcelain-study-v1.png')
    await page.getByRole('button', { name: '取消生成', exact: true }).click()
    await ready()
    assert.equal(await page.locator('.compare-base').getAttribute('src'), comparisonSource, 'Cancelled new-photo generation keeps the displayed original from the old scene')
    await page.locator('.compare-base').evaluate(image => image.decode())
    assert.equal(sha(await download('下载 PNG', 'new-photo-cancelled.png')), latest.hash)
    const loaded = await browser.newPage({ viewport: { width: 1440, height: 960 }, acceptDownloads: true, reducedMotion: 'reduce' })
    loaded.on('pageerror', e => report.errors.push(e.message))
    await loaded.goto(base + '/signature-portrait')
    await loaded.locator('input[accept=".astra-signature"]').setInputFiles(path.join(out, `${latest.style}.astra-signature`))
    await loaded.waitForFunction(() => !!document.querySelector('.result-canvas') && !document.querySelector('.creation-bar button')?.disabled && document.body.textContent.includes('作品已恢复'), undefined, { timeout: 180000 })
    assert.equal(await loaded.getByLabel('底色配色', { exact: true }).inputValue(), latest.style)
    assert.equal(await loaded.getByLabel('彩绘色板', { exact: true }).inputValue(), latest.palette)
    assert.equal(await loaded.getByText('参数已调整', { exact: false }).count(), 0)
    const dl = loaded.waitForEvent('download', { timeout: 180000 }); await loaded.getByRole('button', { name: '下载 PNG', exact: true }).click()
    await (await dl).saveAs(path.join(out, 'restored.png')); assert.equal(sha(await readFile(path.join(out, 'restored.png'))), latest.hash)
    report.zoom = []
    for (const quality of ['clear', 'fast', 'detail']) {
      await loaded.getByLabel('缩放清晰度', { exact: true }).selectOption(quality)
      await loaded.getByRole('button', { name: '原大', exact: true }).click()
      await loaded.waitForFunction(() => !!document.querySelector('.sharp-viewport-canvas') && !document.querySelector('.render-feedback'), undefined, { timeout: 90000 })
      report.zoom.push({ quality, ...await loaded.locator('.sharp-viewport-canvas').evaluate(c => ({ width: c.width, height: c.height })) })
    }
    await loaded.getByRole('button', { name: '适应', exact: true }).click()
    for (const width of [1440, 390]) for (const theme of ['light', 'dark']) {
      await loaded.setViewportSize({ width, height: 960 })
      await loaded.evaluate(mode => { document.documentElement.dataset.theme = mode; document.documentElement.style.colorScheme = mode }, theme)
      assert(await loaded.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await loaded.locator('.preview').screenshot({ path: path.join(out, `preview-${theme}-${width}.png`) })
    }
    report.ui = { outputs, projectExact: true, unappliedSnapshot: true, immediateCancel: true, lateCancel: true, failedPreparationKeepsScene: true, cancelledPhotoKeepsOriginalComparison: true }
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await browser.close(); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ out, passed: report.passed, cases: report.cases.length, ui: report.ui, failure: report.failure })) }
