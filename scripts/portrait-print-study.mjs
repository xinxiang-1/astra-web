import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_PRINT_OUTPUT || `test-results/portrait-print-${Date.now()}`)
await mkdir(out, { recursive: true })
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const browser = await chromium.launch({ channel, headless: true })
const report = { browser: browser.version(), channel, privateSource: Boolean(process.env.ASTRA_PRINT_SOURCE), cases: [], errors: [], passed: false }
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: 'reduce', acceptDownloads: true,
  ...(process.env.ASTRA_PRINT_RECORD ? { recordVideo: { dir: out, size: { width: 1440, height: 1080 } } } : {}) })
try {
  const page = await context.newPage()
  page.on('pageerror', e => report.errors.push(e.message))
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/docs/prototypes/v13-portrait-styles/index.html')
  const state = async () => JSON.parse(await page.evaluate(() => JSON.stringify(window.__astraPrintStudy?.state || null)))
  const idle = async () => {
    const deadline = Date.now() + 60000
    while (Date.now() < deadline) {
      const current = await state()
      if (current?.completed > 0 && !current.busy) return
      await page.waitForTimeout(100)
    }
    throw new Error('Completion timeout: ' + await page.locator('#status').textContent())
  }
  const generateComparison = async () => {
    const before = (await state()).completed
    await page.click('#generate'); await idle()
    assert.equal((await state()).completed, before + 1, 'A requested comparison must actually complete')
  }
  await idle()
  assert.equal((await state()).stats.length, 3)
  report.cases.push({ kind: 'initial', state: await state() })
  const src = process.env.ASTRA_PRINT_SOURCE || path.resolve('public/artwork/portrait-reference.png')
  const raw = await readFile(src)
  report.sourceSha256 = createHash('sha256').update(raw).digest('hex')
  await page.selectOption('#source', 'upload')
  await page.setInputFiles('#upload', src)
  // Measure browser response separately from worker completion. Neither implies image FPS.
  await page.evaluate(() => {
    const meter = { intervals: [], timers: [], longTasks: [], active: true, previous: performance.now(), timer: 0 }
    function frame(now) { if (!meter.active) return; meter.intervals.push(now - meter.previous); meter.previous = now; requestAnimationFrame(frame) }
    requestAnimationFrame(frame)
    let previous = performance.now()
    meter.timer = setInterval(() => { const now = performance.now(); meter.timers.push(now - previous); previous = now }, 20)
    try { new PerformanceObserver(list => meter.longTasks.push(...list.getEntries().map(e => e.duration))).observe({ type: 'longtask', buffered: false }) } catch {}
    window.__printMeter = meter
  })
  await generateComparison()
  const measurement = await page.evaluate(() => {
    const m = window.__printMeter; m.active = false; clearInterval(m.timer)
    const percentile = (list, q) => list.slice().sort((a, b) => a - b)[Math.floor((list.length - 1) * q)] || 0
    return { rafP95: percentile(m.intervals, .95), rafMax: Math.max(...m.intervals), timerP95: percentile(m.timers, .95), timerMax: Math.max(...m.timers), longTasks: m.longTasks }
  })
  const hashes = async (prefix) => {
    const result = {}
    for (const style of ['duotone', 'riso', 'pop']) {
      const png = await page.locator(`[data-style="${style}"] canvas`).evaluate(c => c.toDataURL('image/png'))
      const data = Buffer.from(png.split(',')[1], 'base64')
      result[style] = createHash('sha256').update(data).digest('hex')
      if (prefix) await writeFile(path.join(out, `${prefix}-${style}.png`), data)
    }
    return result
  }
  const original = await hashes('source')
  report.cases.push({ kind: 'actual-source', state: await state(), measurement, hashes: original })
  const board = await page.evaluate(() => {
    const entries = [['duotone', '双色 · 光影海报'], ['riso', 'Riso · 叠墨纹理'], ['pop', '波普 · 鲜明色面']]
    const canvas = document.createElement('canvas'); canvas.width = 1260; canvas.height = 900
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f5f3ed'; ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#1c342b'; ctx.font = '600 26px "Microsoft YaHei",sans-serif'; ctx.fillText('同一照片，三个字符印刷候选', 24, 42)
    ctx.font = '14px "Microsoft YaHei",sans-serif'; ctx.fillStyle = '#607064'; ctx.fillText('完整构图与1:1原生字形局部 · 实际算法输出', 24, 70)
    for (let at = 0; at < entries.length; at++) {
      const [id, title] = entries[at], source = document.querySelector(`[data-style="${id}"] canvas`)
      const x = 24 + at * 414, fit = Math.min(390 / source.width, 520 / source.height)
      ctx.fillStyle = '#fffdf8'; ctx.fillRect(x, 96, 390, 520)
      ctx.drawImage(source, x + (390 - source.width * fit) / 2, 96 + (520 - source.height * fit) / 2, source.width * fit, source.height * fit)
      ctx.fillStyle = '#1c342b'; ctx.font = '600 20px "Microsoft YaHei",sans-serif'; ctx.fillText(title, x, 650)
      const sx = Math.max(0, Math.round(source.width * .5 - 160)), sy = Math.max(0, Math.round(source.height * .4 - 95))
      ctx.drawImage(source, sx, sy, 320, 190, x + 35, 676, 320, 190)
    }
    return canvas.toDataURL('image/png')
  })
  await writeFile(path.join(out, 'comparison.png'), Buffer.from(board.split(',')[1], 'base64'))
  report.navigation = await page.locator('header a').evaluateAll(as => as.map(a => a.href))
  await page.screenshot({ path: path.join(out, 'desktop-light.png'), fullPage: true })
  if (process.env.ASTRA_PRINT_VISUAL_ONLY) { report.passed = true }
  else {
    const completed = (await state()).completed
    await page.click('summary')
    await page.locator('#contrast').fill('0.3')
    await page.waitForTimeout(400)
    assert.equal((await state()).completed, completed, 'Unapplied controls must not start work')
    assert.deepEqual(await hashes(), original, 'Unapplied controls retain the existing picture')
    await page.click('[data-view="riso"]')
    for (const factor of ['0.5', '1', '2']) {
      await page.click(`[data-zoom="${factor}"]`)
      const actualWidth = await page.locator('.viewer canvas').evaluate(c => parseFloat(c.style.width))
      assert(Math.abs(actualWidth - (await state()).stats[0].width * Number(factor)) <= .5, 'CSS zoom may round an odd image width by half a pixel')
    }
    await page.click('#fit')
    await page.screenshot({ path: path.join(out, 'viewer.png') })
    await page.keyboard.press('Escape')
    assert.equal((await state()).completed, completed, 'Zoom must never regenerate')
    const downloadPromise = page.waitForEvent('download')
    await page.click('[data-save="riso"]')
    const download = await downloadPromise, downloadPath = path.join(out, 'download.png')
    await download.saveAs(downloadPath)
    assert.equal(createHash('sha256').update(await readFile(downloadPath)).digest('hex'), original.riso, 'PNG must be the displayed snapshot')
    report.cases.push({ kind: 'unapplied-zoom-export', completed, filename: download.suggestedFilename() })
    await page.click('#generate'); await page.click('#cancel')
    await page.waitForTimeout(200)
    assert.equal((await state()).busy, false)
    assert.deepEqual(await hashes(), original, 'Cancellation keeps the last complete comparison')
    report.cases.push({ kind: 'cancel-transaction', state: await state() })
    const beforePartial = (await state()).completed
    await page.click('#generate')
    await page.waitForFunction(() => window.__astraPrintStudy.state.candidateCount > 0 && window.__astraPrintStudy.state.busy, undefined, { timeout: 20000, polling: 10 })
    const partial = await state()
    assert.equal(partial.completed, beforePartial, 'Partial results must stay off the visible comparison')
    // Trigger promptly after the first candidate; export/hash work is deliberately outside this window.
    if ((await state()).busy) {
      await page.locator('#cancel').dispatchEvent('click')
      assert.deepEqual(await hashes(), original, 'Cancellation discards every uncommitted candidate')
      assert.equal((await state()).completed, beforePartial)
      report.cases.push({ kind: 'partial-cancel-transaction', pending: partial.candidateCount, completed: beforePartial })
    } else throw new Error('Partial cancellation window was missed; do not count it as passed')
    // Invalid replacement must preserve the previous complete frame.
    await page.setInputFiles('#upload', { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not a png') })
    await page.click('#generate')
    await page.waitForFunction(() => !window.__astraPrintStudy.state.busy)
    assert.deepEqual(await hashes(), original)
    assert((await page.locator('#status').textContent()).includes('保留'))
    report.cases.push({ kind: 'invalid-media-transaction', status: await page.locator('#status').textContent() })
    await page.setInputFiles('#upload', src)
    await page.locator('#contrast').fill('0.15')
    await generateComparison()
    assert.deepEqual(await hashes(), original, 'Same seed and source reproduce the entire picture')
    report.cases.push({ kind: 'deterministic-replay', hashes: original })
    for (const palette of ['forest-rose', 'violet-gold']) {
      await page.selectOption('#palette', palette); await page.selectOption('#size', '1024')
      await generateComparison()
      const current = await hashes(palette)
      assert.notEqual(current.duotone, original.duotone)
      report.cases.push({ kind: 'palette', palette, state: await state(), hashes: current })
    }
    await page.selectOption('#screen', 'phrase')
    await page.fill('#phrase', '李云舟，与光同行。')
    await generateComparison()
    assert.equal((await state()).snapshot.screen, 'phrase')
    assert.equal((await state()).snapshot.phrase, '李云舟，与光同行。')
    const phrase = await hashes('phrase')
    assert((await state()).stats.some(s => s.capacityClipped > 0), 'Do not hide the capacity limit of fine Chinese text')
    report.cases.push({ kind: 'chinese', state: await state(), hashes: phrase })
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
      await page.setViewportSize({ width: 390, height: 844 })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Mobile layout must fit')
      await page.selectOption('#palette', 'blue-coral')
      await page.screenshot({ path: path.join(out, `mobile-${theme}.png`), fullPage: true })
      report.cases.push({ kind: 'mobile-theme', theme, completed: (await state()).completed })
      assert.deepEqual(await hashes(), phrase, 'Theme changes do not recolor the work')
    }
    const before = (await state()).completed
    await page.waitForTimeout(800)
    assert.equal((await state()).completed, before, 'Idle must not submit repeated jobs')
    report.cases.push({ kind: 'idle-stop', completed: before })
    const transparent = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 16; c.height = 16; return c.toDataURL('image/png') })
    await page.setInputFiles('#upload', { name: 'transparent.png', mimeType: 'image/png', buffer: Buffer.from(transparent.split(',')[1], 'base64') })
    await generateComparison()
    const alphaCases = []
    for (const style of ['duotone', 'riso', 'pop']) {
      const item = (await state()).stats.find(s => s.style === style)
      const changed = await page.locator(`[data-style="${style}"] canvas`).evaluate((c, hex) => {
        const paper = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16)), pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
        let different = 0
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== paper[0] || pixels[i + 1] !== paper[1] || pixels[i + 2] !== paper[2] || pixels[i + 3] !== 255) different++
        return different
      }, item.paper)
      assert.equal(changed, 0, 'Transparent source must add no ink')
      alphaCases.push({ style, changed })
    }
    report.cases.push({ kind: 'transparent-source', result: alphaCases })
    await page.setViewportSize({ width: 1440, height: 1080 })
    // Independent mask audit: removing actual glyph alpha removes ALL photo-dependent content.
    const auditPage = await context.newPage()
    await auditPage.goto((process.env.ASTRA_PRINT_MODULE_URL || 'http://127.0.0.1:5180') + '/docs/prototypes/v13-portrait-styles/audit.html')
    const masks = await auditPage.evaluate(async () => {
      const { renderPrint } = await import('/docs/prototypes/v13-portrait-styles/engine.ts')
      const { makeAtlas } = await import('/docs/prototypes/v13-portrait-styles/atlas.ts')
      const { defaultRecipe, validateRecipe } = await import('/docs/prototypes/v13-portrait-styles/model.ts')
      const recipe = { ...defaultRecipe, columns: 64, longEdge: 1024 }
      const atlas = await makeAtlas(recipe)
      const c = document.createElement('canvas'); c.width = 64; c.height = 80
      const ctx = c.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 64, 80)
      const sample = { width: 64, height: 80, sourceWidth: 64, sourceHeight: 80, pixels: ctx.getImageData(0, 0, 64, 80).data }
      const zeroAtlas = { ...atlas, glyphs: atlas.glyphs.map(g => ({ ...g, alpha: g.alpha.map(() => 0), coverage: 0 })) }
      const result = []
      for (const style of ['duotone', 'riso', 'pop']) {
        const r = await renderPrint(sample, zeroAtlas, recipe, style, { progress() {}, checkpoint: async () => {} })
        c.width = r.bitmap.width; c.height = r.bitmap.height; ctx.drawImage(r.bitmap, 0, 0); r.bitmap.close()
        const pixels = ctx.getImageData(0, 0, c.width, c.height).data, paper = [1, 3, 5].map(at => parseInt(r.stats.paper.slice(at, at + 2), 16))
        let changed = 0
        for (let i = 0; i < pixels.length; i += 4) if (pixels[i] !== paper[0] || pixels[i + 1] !== paper[1] || pixels[i + 2] !== paper[2] || pixels[i + 3] !== 255) changed++
        result.push({ style, changed })
      }
      const invalids = [{ ...recipe, seed: Infinity }, { ...recipe, columns: 900 }, { ...recipe, phrase: '\u202e名字' }, { ...recipe, phrase: '云'.repeat(65) }]
      let rejected = 0
      for (const value of invalids) try { validateRecipe(value) } catch { rejected++ }
      return { result, rejected, maxCoverage: Math.max(...atlas.glyphs.map(g => g.coverage)) }
    })
    assert(masks.result.every(r => r.changed === 0), 'No image may remain after glyph removal')
    assert.equal(masks.rejected, 4)
    report.cases.push({ kind: 'glyph-only-and-validation', ...masks })
    await auditPage.close()
    assert.equal(report.errors.length, 0, 'No uncaught UI error')
    report.passed = true
  }
} finally {
  await context.close(); await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, passed: report.passed, cases: report.cases.length, errors: report.errors }))
}
