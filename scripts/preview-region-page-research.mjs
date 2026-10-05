import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { build } from 'vite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

// Replace only the production frame Worker in an isolated browser context.
// Neither the source renderer nor dist is edited. Actual UI requests are replayed
// through the original production Worker to check the candidate's exact pixels.
const out = path.resolve(process.env.ASTRA_REGION_PAGE_OUTPUT || `test-results/preview-region-page-${Date.now()}`)
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5184'
const candidateKind = process.env.ASTRA_PREVIEW_CANDIDATE_KIND || 'region'
const metadataWait = process.env.ASTRA_PREVIEW_METADATA_WAIT === '1'
assert(['region', 'light-material'].includes(candidateKind))
assert(candidateKind === 'region' || process.env.ASTRA_REGION_PAGE_BOUNDARIES !== '1', 'Region-specific raster rejection checks do not describe a light material cache')
await mkdir(out, { recursive: true })
execFileSync(process.execPath, [candidateKind === 'region' ? 'scripts/preview-region-cache-research.mjs' : 'scripts/preview-light-material-research.mjs'], {
  env: { ...process.env, ASTRA_REGION_OUTPUT: out, ASTRA_REGION_BUILD_ONLY: '1', ASTRA_REGION_REVISION: 'r2', ASTRA_LIGHT_MATERIAL_OUTPUT: out, ASTRA_LIGHT_MATERIAL_BUILD_ONLY: '1' },
  stdio: 'pipe',
})
await build({
  configFile: false, publicDir: false, logLevel: 'warn',
  build: {
    outDir: path.join(out, 'bundle'), emptyOutDir: false, minify: false,
    lib: { entry: path.join(out, candidateKind === 'region' ? 'region-frame.worker.ts' : 'material-frame.worker.ts'), formats: ['es'], fileName: () => 'region-preview.worker.js' },
  },
})
const workerCode = await readFile(path.join(out, 'bundle/region-preview.worker.js'), 'utf8')
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const modes = { density: '光影字符', color: '原色字符', phrase: '中文铺字', contour: '轮廓线稿', braille: '点阵细节', halftone: '印刷网点' }
const selectedModes = process.env.ASTRA_REGION_PAGE_ONLY_BOUNDARIES === '1' ? [] : (process.env.ASTRA_REGION_PAGE_MODES || Object.keys(modes).join(',')).split(',')
const sides = (process.env.ASTRA_REGION_PAGE_SIDES || 'baseline,candidate').split(',')
const hovers = (process.env.ASTRA_REGION_PAGE_HOVERS || (candidateKind === 'region' ? 'particles' : 'light')).split(',')
assert(selectedModes.every(m => m in modes) && sides.every(s => ['baseline', 'candidate'].includes(s)) && hovers.every(h => ['particles', 'light'].includes(h)))
const report = {
  browser: browser.version(), base, candidateKind, productionSource: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scope: 'Production editor, real uploads/buttons/mouse. Isolated replacement Worker only. Original .65/.38, density 180 and full RGB/alpha. No delivery delays, synthetic request clocks or reduced columns. Capturing requests and selected bitmap readbacks adds QA overhead; wall timings are observational, not an isolated speedup or FPS benchmark.',
  hashes: {}, cases: [], errors: [], passed: false,
}
for (const file of ['candidate.ts', 'bundle/region-preview.worker.js']) report.hashes[file] = createHash('sha256').update(await readFile(path.join(out, file))).digest('hex')
for (const file of ['src/views/AsciiArtView.vue', 'src/lib/art-engine/canvas.ts', 'scripts/preview-region-page-research.mjs', 'public/artwork/porcelain-study-v1.png']) report.hashes[file] = createHash('sha256').update(await readFile(file)).digest('hex')
const save = () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))

async function open(side, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference', ...options })
  await context.route('**/assets/region-preview.worker.js', route => route.fulfill({ contentType: 'text/javascript', body: workerCode }))
  await context.addInitScript(({ side }) => {
    localStorage.setItem('astra-theme', 'dark')
    const Native = window.Worker
    const qa = window.__regionPage = { Native, records: [], active: new Set(), capture: false, bytes: 0, peakBytes: 0, feedback: [], started: 0 }
    const limit = 64 * 1024 * 1024
    window.Worker = class extends Native {
      constructor(url, options) {
        const tracked = String(url).includes('frame-render.worker')
        super(tracked && side === 'candidate' ? '/assets/region-preview.worker.js' : url, options)
        if (!tracked) return
        const record = { id: qa.records.length, url: String(url), requests: [], results: [], pixels: new Map(), terminated: false }
        this.qaRecord = record
        qa.records.push(record); qa.active.add(this)
        const send = this.postMessage.bind(this)
        this.postMessage = (data, ...rest) => {
          if (data?.frame) {
            const snapshot = structuredClone(data)
            record.requests.push({ snapshot, at: performance.now() })
          }
          return send(data, ...rest)
        }
        this.addEventListener('message', event => {
          const result = event.data
          if (!result?.bitmap) return
          const request = record.requests.find(r => r.snapshot.id === result.id)
          const entry = { id: result.id, at: performance.now(), renderMs: result.renderMs, requestAt: request?.at, interactionActive: result.interactionActive, cacheStats: result.cacheStats, regionStats: result.regionStats, lightMaterialStats: result.lightMaterialStats, width: result.bitmap.width, height: result.bitmap.height }
          record.results.push(entry)
          // Read without consuming/closing the bitmap before the real UI handler.
          // Bound retained RGBA; requests contain all initial glyphs for replay.
          const bytes = result.bitmap.width * result.bitmap.height * 4
          if (qa.capture && record.pixels.size < 12 && qa.bytes + bytes <= limit) {
            const canvas = new OffscreenCanvas(result.bitmap.width, result.bitmap.height)
            const ctx = canvas.getContext('2d', { willReadFrequently: true })
            ctx.globalCompositeOperation = 'copy'; ctx.drawImage(result.bitmap, 0, 0)
            record.pixels.set(result.id, ctx.getImageData(0, 0, canvas.width, canvas.height))
            qa.bytes += bytes; qa.peakBytes = Math.max(qa.peakBytes, qa.bytes)
            canvas.width = canvas.height = 1
          }
        })
      }
      terminate() {
        if (this.qaRecord) this.qaRecord.terminated = true
        qa.active.delete(this); super.terminate()
      }
    }
    setInterval(() => {
      if (qa.started) qa.feedback.push({ at: performance.now(), text: document.querySelector('.stage-feedback')?.textContent?.trim() || '' })
    }, 40)
  }, { side })
  const page = await context.newPage()
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('dialog', dialog => dialog.accept())
  page.setDefaultTimeout(60000)
  await page.goto(base + '/ascii-art')
  return { context, page }
}
const canvas = page => page.locator('.ascii-scroll .ascii-canvas').first()
const ready = (page, mode, selector = '.ascii-scroll .ascii-canvas') => page.waitForFunction(({ mode, selector }) => {
  const c = document.querySelector(selector)
  return c?.width > 100 && c.dataset.renderPending === 'false' && (!mode || c.dataset.mode === mode)
}, { mode, selector }, { timeout: 120000 })
const settled = (page, selector = '.ascii-scroll .ascii-canvas') => page.waitForFunction(selector => {
  const c = document.querySelector(selector)
  return c?.dataset.renderPending === 'false' && c.dataset.pointerStrength === '0' && c.dataset.interactionActive === 'false'
}, selector, { timeout: 60000 })
async function setColored(page, colored) {
  const toggle = page.getByRole('button', { name: '彩色', exact: true })
  if (await toggle.evaluate(el => el.classList.contains('on')) !== colored) await toggle.click()
  await page.waitForFunction(colored => {
    const q = window.__regionPage, last = [...q.active].at(-1)?.qaRecord.requests.at(-1)?.snapshot
    return last?.frame.settings.colored === colored && document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.renderPending === 'false'
  }, colored)
}
async function prepare(page, mode, hover = 'particles') {
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('public/artwork/porcelain-study-v1.png'))
  await ready(page, 'density')
  await page.locator('.six-modes button').filter({ hasText: modes[mode] }).click()
  await ready(page, mode)
  if (mode === 'phrase' || mode === 'density') await setColored(page, mode === 'phrase')
  await page.locator('details.calibrated-effects').evaluate(d => d.open = true)
  await page.getByRole('group', { name: '六模式悬停', exact: true }).getByRole('button', { name: hover === 'particles' ? '字符聚散试用' : '光晕', exact: true }).click()
  await page.waitForFunction(hover => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.hover === hover, hover)
  await ready(page, mode); await page.mouse.move(0, 0); await settled(page)
  const metadata = await canvas(page).evaluate(c => ({ width: c.width, height: c.height, ...c.dataset,
    settings: [...window.__regionPage.active].at(-1)?.qaRecord.requests.at(-1)?.snapshot.frame.settings,
  }))
  assert.equal(metadata.columns, '180')
  assert.equal(metadata.hoverStrength, '0.65')
  assert.equal(metadata.quality, 'classic')
  assert.equal(await page.evaluate(() => [...window.__regionPage.active].at(-1)?.qaRecord.requests.at(-1)?.snapshot.options.hoverRadius), .38)
  return metadata
}

async function replay(page) {
  return page.evaluate(async () => {
    const qa = window.__regionPage, comparisons = []
    for (const record of qa.records) {
      if (!record.pixels.size) continue
      const worker = new qa.Native(record.url, { type: 'module' })
      let resolve, reject
      worker.onmessage = event => {
        if (event.data.bitmap) resolve(event.data)
        else if (event.data.error) reject(new Error(event.data.error))
      }
      const last = Math.max(...record.pixels.keys())
      try {
        for (const { snapshot } of record.requests) {
          if (snapshot.id > last) break
          const result = await new Promise((r, j) => {
            const timeout = setTimeout(() => j(new Error('Original Worker replay timeout')), 120000)
            resolve = value => { clearTimeout(timeout); r(value) }
            reject = error => { clearTimeout(timeout); j(error) }
            worker.postMessage(snapshot)
          })
          const expected = record.pixels.get(result.id)
          if (expected) {
            const c = new OffscreenCanvas(result.bitmap.width, result.bitmap.height)
            const ctx = c.getContext('2d', { willReadFrequently: true })
            ctx.globalCompositeOperation = 'copy'; ctx.drawImage(result.bitmap, 0, 0)
            const actual = ctx.getImageData(0, 0, c.width, c.height)
            let changed = 0, maxDelta = 0
            if (actual.width !== expected.width || actual.height !== expected.height) throw new Error('Replay dimensions differ')
            for (let i = 0; i < actual.data.length; i++) {
              const delta = Math.abs(actual.data[i] - expected.data[i])
              if (delta) changed++
              maxDelta = Math.max(maxDelta, delta)
            }
            comparisons.push({ worker: record.id, request: result.id, width: actual.width, height: actual.height, changed, maxDelta })
            c.width = c.height = 1
          }
          result.bitmap.close()
        }
      } finally { worker.terminate() }
    }
    return comparisons
  })
}

async function mouseCase(side, mode, hover) {
  const { context, page } = await open(side)
  const entry = { side, mode, hover, passed: false }
  report.cases.push(entry)
  try {
    entry.initial = await prepare(page, mode, hover)
    const locator = canvas(page), baseline = await locator.evaluate(c => c.toDataURL())
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    if (process.env.ASTRA_REGION_PAGE_RECORD === '1' && side === 'candidate' && mode === 'density') {
      await locator.evaluate(c => {
        const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8'].find(v => MediaRecorder.isTypeSupported(v))
        if (!mime) throw new Error('Native recording codec required')
        const stream = c.captureStream(30), chunks = [], recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2000000 })
        recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
        recorder.start(200); window.__regionRecording = { recorder, chunks, stream, mime, started: performance.now() }
      })
    }
    await page.evaluate(() => { const q = window.__regionPage; q.capture = true; q.started = performance.now(); q.feedback = [] })
    const start = await page.evaluate(() => performance.now())
    entry.gestureStarted = start
    for (let i = 0; i < 18; i++) {
      await page.mouse.move(box.x + box.width * (.15 + .7 * i / 17), box.y + box.height * (.5 + Math.sin(i / 17 * Math.PI * 2) * .14))
      await page.waitForTimeout(25)
    }
    await page.waitForFunction(({ hover, baseline, metadataWait }) => {
      const c = document.querySelector('.ascii-scroll .ascii-canvas')
      return c && (metadataWait ? Number(c.dataset.pointerStrength) > .05 : c.toDataURL() !== baseline) && (hover !== 'particles' || Number(c.dataset.particlePeak) > .005)
    }, { hover, baseline, metadataWait }, { timeout: 60000, polling: 100 })
    assert.notEqual(await locator.evaluate(c => c.toDataURL()), baseline, 'Completed strong feedback must actually change the visible PNG')
    entry.firstVisibleCriterion = metadataWait ? 'Completed frame pointer strength >.05, then one visible PNG comparison; particle peak >.005 where applicable. No repeated PNG readback while waiting.' : 'Visible PNG difference polling, particle peak >.005 where applicable'
    entry.firstVisibleMs = await page.evaluate(start => performance.now() - start, start)
    entry.peak = await locator.evaluate(c => Number(c.dataset.particlePeak))
    await locator.screenshot({ path: path.join(out, `${side}-${mode}-${hover}-active.png`) })
    await page.mouse.move(0, 0)
    const released = await page.evaluate(() => performance.now())
    await settled(page)
    assert.equal(await locator.evaluate(c => c.toDataURL()), baseline, 'Exact PNG after real gesture')
    entry.recoveryMs = await page.evaluate(start => performance.now() - start, released)
    entry.exactRecovery = true
    if (process.env.ASTRA_REGION_PAGE_RECORD === '1' && side === 'candidate' && mode === 'density') {
      const recording = await page.evaluate(async () => {
        const r = window.__regionRecording
        await new Promise(resolve => { r.recorder.onstop = resolve; r.recorder.stop() })
        r.stream.getTracks().forEach(track => track.stop())
        const blob = new Blob(r.chunks, { type: r.mime })
        const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob) })
        return { mime: r.mime, elapsedMs: performance.now() - r.started, data: data.split(',')[1] }
      })
      const bytes = Buffer.from(recording.data, 'base64'), file = `${side}-${mode}-${hover}.webm`
      await writeFile(path.join(out, file), bytes)
      entry.recording = { file, mime: recording.mime, elapsedMs: recording.elapsedMs, bytes: bytes.length, hash: createHash('sha256').update(bytes).digest('hex'), scope: 'Actual editor Canvas and mouse, captureStream requests 30 samples/second; this is not completed character FPS. Recording adds overhead.' }
    }
    const idleStart = await page.evaluate(() => window.__regionPage.records.reduce((n, r) => n + r.requests.length, 0))
    await page.waitForTimeout(1500)
    entry.idleRequests = await page.evaluate(n => window.__regionPage.records.reduce((sum, r) => sum + r.requests.length, 0) - n, idleStart)
    assert.equal(entry.idleRequests, 0)
    const records = await page.evaluate(() => {
      const q = window.__regionPage; q.capture = false; q.started = 0
      return {
        feedbackSamples: q.feedback.length, loadingSamples: q.feedback.filter(r => r.text).length,
        peakCaptureBytes: q.peakBytes, activeWorkers: q.active.size,
        workers: q.records.map(r => ({ id: r.id, url: r.url, terminated: r.terminated, results: r.results, capturedFrames: r.pixels.size,
          requests: r.requests.map(({ snapshot: s, at }) => ({ id: s.id, at, mode: s.frame.settings.mode, colored: s.frame.settings.colored, longEdge: s.options.longEdge, hoverTime: s.options.hoverTime, hover: s.options.hover, pointer: s.options.pointer, inputSamples: s.options.pointerSamples?.length || 0 })) })),
      }
    })
    Object.assign(entry, records)
    assert.equal(entry.loadingSamples, 0, 'Live hover/idle must not repeat generation feedback')
    assert.equal(entry.activeWorkers, 1, 'No fallback or orphan Worker')
    if (side === 'candidate') {
      entry.parity = await replay(page)
      assert(entry.parity.length > 0 && entry.parity.every(r => r.changed === 0), 'All captured actual UI requests must replay to identical RGBA')
      if (candidateKind === 'light-material') {
        const stats = entry.workers.flatMap(w => w.results.map(r => r.lightMaterialStats).filter(Boolean))
        assert(stats.length && stats.every(s => s.bytes <= s.limit && s.totalBackingBytes <= 16 * 1024 * 1024))
        if (hover === 'light') assert(stats.some(s => s.hits > 0), 'Actual immutable constant-light reuse in the real Worker')
        entry.lightMaterialOutcome = { peakBytes: Math.max(...stats.map(s => s.bytes)), peakEntries: Math.max(...stats.map(s => s.entries)), hits: Math.max(...stats.map(s => s.hits)) }
      } else {
        assert(entry.workers.some(w => w.results.some(r => r.regionStats?.hits > 0)), 'Actual static cache reuse')
        const used = entry.workers.filter(w => w.requests.some(r => r.mode === mode && r.hover === hover))
        const frames = used.flatMap(w => w.results.filter(r => r.requestAt >= start))
        entry.regionOutcome = {
          patches: used.reduce((n, w) => n + Math.max(0, ...w.results.map(r => r.regionStats?.patches || 0)), 0),
          broadDynamicFrames: frames.filter(r => r.interactionActive && r.regionStats?.area >= .8).length,
          peakBytes: Math.max(0, ...used.flatMap(w => w.results.map(r => r.regionStats?.bytes || 0))),
        }
        if (hover === 'particles' && entry.regionOutcome.patches === 0) {
          assert(entry.regionOutcome.broadDynamicFrames > 0, 'No patch requires evidence of the actual wide-area full-render branch')
          entry.regionOutcome.decision = 'Actual gesture exceeds the region threshold. Exact full-render branch verified; regional performance benefit is not demonstrated, so this case does not qualify the candidate for production.'
        }
        assert(entry.regionOutcome.peakBytes <= 16 * 1024 * 1024)
      }
    }
    entry.passed = true
  } catch (error) {
    entry.failure = error.stack
    entry.failureState = await page.evaluate(() => ({ feedback: document.querySelector('.stage-feedback')?.textContent, data: { ...document.querySelector('.ascii-scroll .ascii-canvas')?.dataset }, records: window.__regionPage.records.map(r => ({ id: r.id, terminated: r.terminated, results: r.results, requests: r.requests.map(v => ({ id: v.snapshot.id, options: v.snapshot.options })) })) })).catch(() => null)
    await page.screenshot({ path: path.join(out, `${side}-${mode}-${hover}-failure.png`) }).catch(() => {})
    throw error
  } finally { await save(); await context.close() }
  console.log(`region-page: ${side} ${mode} ${hover} passed`)
}

async function gesture(page, selector = '.ascii-scroll .ascii-canvas', touch = false) {
  const el = page.locator(selector).first()
  await el.scrollIntoViewIfNeeded(); await ready(page, undefined, selector); await settled(page, selector)
  const baseline = await el.evaluate(c => c.toDataURL()), box = await el.boundingBox()
  if (touch) {
    await el.evaluate(c => {
      window.__regionTouch = { down: 0, move: 0, up: 0, cancel: 0 }
      for (const [event, key] of [['pointerdown', 'down'], ['pointermove', 'move'], ['pointerup', 'up'], ['pointercancel', 'cancel']]) c.addEventListener(event, () => window.__regionTouch[key]++)
    })
    assert.equal(await el.evaluate(c => getComputedStyle(c).touchAction), 'none')
    const session = await page.context().newCDPSession(page)
    const point = i => ({ x: box.x + box.width * (.15 + .7 * i / 10), y: box.y + box.height * (.5 + Math.sin(i / 10 * Math.PI * 2) * .14), id: 1 })
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(0)] })
    for (let i = 1; i <= 10; i++) {
      await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(i)] })
      await page.waitForTimeout(40)
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await session.detach()
  } else {
    for (let i = 0; i < 18; i++) {
      await page.mouse.move(box.x + box.width * (.15 + .7 * i / 17), box.y + box.height * (.5 + Math.sin(i / 17 * Math.PI * 2) * .14))
      await page.waitForTimeout(25)
    }
  }
  await page.waitForFunction(({ selector, baseline }) => {
    const c = document.querySelector(selector)
    return c && Number(c.dataset.particlePeak) > .005 && c.toDataURL() !== baseline
  }, { selector, baseline }, { timeout: 60000, polling: 100 })
  const peak = await el.evaluate(c => Number(c.dataset.particlePeak))
  await page.mouse.move(0, 0); await settled(page, selector)
  assert.equal(await el.evaluate(c => c.toDataURL()), baseline)
  const result = { peak, visibleScatter: true, exactRecovery: true }
  if (touch) {
    result.trace = await page.evaluate(() => window.__regionTouch)
    assert.equal(result.trace.down, 1); assert.equal(result.trace.up, 1); assert.equal(result.trace.cancel, 0); assert(result.trace.move >= 9)
  }
  return result
}

async function boundaries() {
  const { context, page } = await open('candidate')
  const entry = { side: 'candidate', name: 'actual-controls-quality-lifecycle', checks: [], passed: false }
  report.cases.push(entry)
  try {
    await prepare(page, 'color')
    for (const theme of ['dark', 'light']) {
      if (await page.locator('html').getAttribute('data-theme') !== theme) await page.getByRole('button', { name: /切换到/ }).click()
      await ready(page, 'color')
      const before = await canvas(page).evaluate(c => c.width)
      await page.getByRole('button', { name: '放大', exact: true }).first().click()
      await page.locator('.stage-feedback').waitFor({ state: 'visible' })
      assert.equal(await page.locator('.stage-feedback').evaluate(el => getComputedStyle(el).pointerEvents), 'none')
      await ready(page, 'color'); await page.locator('.stage-feedback').waitFor({ state: 'hidden' })
      const after = await canvas(page).evaluate(c => c.width)
      assert(after > before)
      entry.checks.push({ name: 'zoom-' + theme, before, after, necessaryFeedbackClears: true })
    }
    // Cancel an in-flight size update with subsequent actual control input.
    const workerCount = await page.evaluate(() => window.__regionPage.records.length)
    await page.getByRole('button', { name: '放大', exact: true }).first().click()
    await page.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.renderPending === 'true')
    await page.getByRole('button', { name: '缩小', exact: true }).first().click()
    await ready(page, 'color')
    assert.equal(await page.evaluate(() => window.__regionPage.active.size), 1)
    assert(await page.evaluate(n => window.__regionPage.records.slice(n).some(r => r.terminated), workerCount))
    entry.checks.push({ name: 'cancel-size-update', releasedSupersededWorker: true, activeWorkers: 1 })
    await page.locator('.six-modes button').filter({ hasText: modes.density }).click(); await ready(page, 'density')
    await setColored(page, false)
    for (const quality of ['classic', 'detailed', 'smooth', 'faithful']) {
      await page.evaluate(() => window.__regionPage.capture = true)
      await page.getByRole('group', { name: '图片渲染品质', exact: true }).locator(`[data-quality="${quality}"]`).click()
      await page.waitForFunction(q => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.quality === q, quality)
      await ready(page, 'density')
      const movement = await gesture(page)
      await page.evaluate(() => window.__regionPage.capture = false)
      const parity = await replay(page)
      assert(parity.length && parity.every(r => r.changed === 0))
      const stats = await page.evaluate(() => [...window.__regionPage.active][0].qaRecord.results.at(-1).regionStats)
      if (quality === 'smooth' || quality === 'faithful') assert.equal(stats.bytes, 0, 'Unsupported raster does not retain a static region cache')
      entry.checks.push({ name: 'quality-' + quality, ...movement, parity, stats })
      await page.evaluate(() => {
        const q = window.__regionPage
        for (const r of q.records) r.pixels.clear()
        q.bytes = 0
      })
      await save()
    }
    await page.getByRole('group', { name: '图片渲染品质', exact: true }).locator('[data-quality="classic"]').click()
    await page.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.quality === 'classic'); await ready(page)
    await page.getByRole('button', { name: '全屏 ↗', exact: true }).click()
    await ready(page, 'density', '.fs-overlay .ascii-canvas'); await settled(page, '.fs-overlay .ascii-canvas')
    assert.equal(await page.evaluate(() => window.__regionPage.active.size), 2)
    entry.checks.push({ name: 'fullscreen-gesture', ...await gesture(page, '.fs-overlay .ascii-canvas') })
    await page.keyboard.press('Escape'); await settled(page)
    assert.equal(await page.evaluate(() => window.__regionPage.active.size), 1)
    entry.checks.push({ name: 'fullscreen-release', activeWorkers: 1 })
    await page.getByRole('group', { name: '六模式微动', exact: true }).getByRole('button', { name: '流动', exact: true }).click()
    await page.getByRole('button', { name: '暂停动效', exact: true }).click()
    await page.waitForFunction(() => {
      const c = document.querySelector('.ascii-scroll .ascii-canvas')
      return c?.dataset.renderPending === 'false' && c.dataset.paused === 'true'
    })
    const time = await canvas(page).getAttribute('data-time')
    entry.checks.push({ name: 'paused-ambient-hover', ...await gesture(page) })
    assert.equal(await canvas(page).getAttribute('data-time'), time)
    const motionStats = await page.evaluate(() => [...window.__regionPage.active][0].qaRecord.results.at(-1).regionStats)
    assert.equal(motionStats.bytes, 0, 'Ambient motion uses original drawing path')
    await page.getByRole('group', { name: '六模式微动', exact: true }).getByRole('button', { name: '静态', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.motion === 'none'); await settled(page)
    const reducedBase = await canvas(page).evaluate(c => c.toDataURL())
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const box = await canvas(page).boundingBox()
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5)
    await page.waitForTimeout(1000)
    assert.equal(await canvas(page).evaluate(c => c.toDataURL()), reducedBase)
    assert.equal(await canvas(page).evaluate(c => getComputedStyle(c).touchAction), 'auto')
    entry.checks.push({ name: 'reduced-motion', exactStatic: true, scrollAllowed: true })
    await page.mouse.move(0, 0); await page.emulateMedia({ reducedMotion: 'no-preference' }); await settled(page)
    const previous = await canvas(page).evaluate(c => c.toDataURL())
    await page.locator('input[type=file]').first().setInputFiles(path.resolve('public/artwork/portrait-reference.png'))
    await page.waitForFunction(previous => {
      const c = document.querySelector('.ascii-scroll .ascii-canvas')
      return c?.dataset.renderPending === 'false' && c.toDataURL() !== previous
    }, previous, { timeout: 120000, polling: 250 })
    assert.notEqual(await canvas(page).evaluate(c => c.toDataURL()), previous)
    entry.checks.push({ name: 'replace-source', newImagePresented: true })
    await page.locator('.editor-back').click()
    await page.getByRole('button', { name: '放弃更改并离开', exact: true }).click()
    await page.waitForURL(base + '/gallery')
    assert.equal(await page.evaluate(() => window.__regionPage.active.size), 0)
    entry.checks.push({ name: 'leave-editor', activeWorkers: 0 })
    entry.passed = true
  } catch (error) {
    entry.failure = error.stack
    entry.failureState = await page.evaluate(() => ({ canvas: { ...document.querySelector('.ascii-scroll .ascii-canvas')?.dataset }, workers: window.__regionPage.records.map(r => ({ id: r.id, terminated: r.terminated, lastResult: r.results.at(-1) })) })).catch(() => null)
    await page.screenshot({ path: path.join(out, 'boundaries-failure.png') }).catch(() => {})
    throw error
  } finally { await save(); await context.close() }
  console.log('region-page: controls/quality/lifecycle passed')
  const mobile = await open('candidate', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const touch = { side: 'candidate', name: 'actual-180-column-touch', passed: false }
  report.cases.push(touch)
  try {
    await mobile.page.locator('input[type=file]').first().setInputFiles(path.resolve('public/artwork/porcelain-study-v1.png')); await ready(mobile.page, 'density')
    await mobile.page.getByRole('button', { name: '调整效果', exact: true }).click()
    await mobile.page.locator('details.calibrated-effects').evaluate(d => d.open = true)
    await mobile.page.getByRole('group', { name: '六模式悬停', exact: true }).getByRole('button', { name: '字符聚散试用', exact: true }).click()
    await mobile.page.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.hover === 'particles'); await ready(mobile.page)
    assert.equal(await canvas(mobile.page).getAttribute('data-columns'), '180')
    touch.editor = await gesture(mobile.page, '.ascii-scroll .ascii-canvas', true)
    await mobile.page.getByRole('button', { name: '全屏 ↗', exact: true }).click()
    touch.fullscreen = await gesture(mobile.page, '.fs-overlay .ascii-canvas', true)
    await mobile.page.keyboard.press('Escape')
    assert.equal(await mobile.page.evaluate(() => window.__regionPage.active.size), 1)
    touch.passed = true
  } catch (error) { touch.failure = error.stack; throw error }
  finally { await save(); await mobile.context.close() }
  console.log('region-page: touch passed')
}

try {
  for (const mode of selectedModes) for (const hover of hovers) for (const side of sides) await mouseCase(side, mode, hover)
  if (process.env.ASTRA_REGION_PAGE_BOUNDARIES === '1') await boundaries()
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await save(); await browser.close() }
console.log(JSON.stringify({ out, passed: report.passed, failure: report.failure }))
