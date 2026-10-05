import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(process.env.ASTRA_IMAGE_OUTPUT || `test-results/image-preview-${Date.now()}`)
await mkdir(out, { recursive: true })
const baseline = execFileSync('git', ['show', '5adb64a:src/lib/art-engine/canvas.ts'], { encoding: 'utf8' })
await writeFile(path.join(out, 'baseline-canvas.ts'), baseline)
const baselineUrl = '/' + path.relative(process.cwd(), path.join(out, 'baseline-canvas.ts')).split(path.sep).join('/')
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'chrome', headless: true })
const report = { browser: browser.version(), passed: false, errors: [], parity: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(base + '/ascii-art')
  report.parity = await page.evaluate(async baselineUrl => {
    const { createCanvasArtRenderer: frozen } = await import(baselineUrl)
    const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
    const { createPreviewRenderClient } = await import('/src/lib/art-engine/preview-render-client.ts')
    const require = (value, message) => { if (!value) throw new Error(message) }
    const source = new Image(); source.src = '/artwork/porcelain-study-v1.png'; await source.decode()
    const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    const cases = []
    const profiles = ['density', 'color', 'phrase', 'contour', 'braille', 'halftone'].map(mode => ({ mode }))
    profiles.push({ mode: 'density', rasterQuality: 'high', fontWeight: 600 },
      { mode: 'density', rasterQuality: 'supersampled', fontWeight: 600 },
      { mode: 'density', softwareRaster: true, fontWeight: 600, colorFidelity: true },
      { mode: 'color', softwareRaster: true, fontWeight: 600, colorFidelity: true })
    for (const profile of profiles) for (const compatibilityOnly of [false, true]) {
      const frame = prepareArtFrame(source, source.width, source.height, {
        ...profile, columns: 48, phrase: '把名字写成光，ASTRA。', colored: ['phrase', 'color'].includes(profile.mode),
        fontFamily: profile.mode === 'phrase' ? 'Microsoft YaHei, monospace' : 'Consolas, monospace',
      })
      const reference = document.createElement('canvas'), output = document.createElement('canvas')
      reference.getContext('2d', { willReadFrequently: false }); output.getContext('2d', { willReadFrequently: false })
      const renderer = frozen(reference)
      let resolve, reject
      const client = createPreviewRenderClient(output, {
        compatibilityOnly, isCurrent: () => true, onFallback() {}, onProgress() {},
        onError: e => reject(e), onResult: (actual, options, active, backend) => resolve({ actual, options, active, backend }),
      })
      try {
        for (const transparent of [false, true]) for (const hover of ['light', 'particles']) {
          const options = { longEdge: 400, transparent, motion: 'none', hover, time: .5, hoverTime: .5,
            hoverStrength: .65, hoverRadius: .38, pointer: { x: .4, y: .5, strength: .65, active: true },
            pointerSamples: [{ x: .4, y: .5, time: 500, active: true }] }
          renderer.render(frame, options)
          const result = await new Promise((r, j) => { resolve = r; reject = j; client.render(frame, options) })
          const expected = pixels(reference), actual = pixels(output)
          let changed = 0, maxDelta = 0
          for (let i = 0; i < expected.length; i++) { const delta = Math.abs(expected[i] - actual[i]); if (delta) changed++; maxDelta = Math.max(delta, maxDelta) }
          require(!changed, JSON.stringify({ profile, compatibilityOnly, transparent, hover, changed, maxDelta }))
          require(result.actual === frame && result.options.time === options.time, 'Completed metadata matches the rendered frame')
          require(result.active === renderer.interactionActive, 'Completed interaction state matches the native factory')
          require(result.backend === (compatibilityOnly ? 'responsive' : 'worker'), 'Expected drawing backend')
          require(client.cacheStats?.particles.bytes === renderer.cacheStats.particles.bytes, 'Actual completed capacity stats')
          cases.push({ profile, compatibilityOnly, transparent, hover, changed, maxDelta, renderMs: client.renderMs })
        }
      } finally { client.destroy(); renderer.destroy() }
    }
    return cases
  }, baselineUrl)
  assert.equal(report.parity.length, 80)
  console.log('image-preview: 80 native pixel and metadata cases passed')

  report.transactions = await page.evaluate(async () => {
    const { createPreviewRenderClient } = await import('/src/lib/art-engine/preview-render-client.ts')
    const { prepareArtFrame, createCanvasArtRenderer } = await import('/src/lib/art-engine/index.ts')
    const require = (value, message) => { if (!value) throw new Error(message) }
    const source = document.createElement('canvas'); source.width = source.height = 32
    source.getContext('2d').fillRect(0, 0, 32, 32)
    const frame = prepareArtFrame(source, 32, 32, { columns: 10 })
    const statsRenderer = createCanvasArtRenderer(document.createElement('canvas')), stats = statsRenderer.cacheStats
    const NativeWorker = Worker, workers = [], results = [], errors = [], progress = []
    window.Worker = class {
      requests = []; terminated = false
      constructor() { workers.push(this) }
      postMessage(request) { this.requests.push(request) }
      terminate() { this.terminated = true }
      emit(data) { this.onmessage({ data }) }
    }
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8
    canvas.getContext('2d').fillStyle = '#193947'; canvas.getContext('2d').fillRect(0, 0, 8, 8)
    const before = canvas.toDataURL()
    const client = createPreviewRenderClient(canvas, { isCurrent: () => true,
      onResult: (frame, options) => results.push(options), onProgress: v => progress.push(v),
      onError: e => errors.push(String(e)), onFallback() {},
    })
    const emit = async (worker, color) => {
      const tile = document.createElement('canvas'); tile.width = tile.height = 8
      tile.getContext('2d').fillStyle = color; tile.getContext('2d').fillRect(0, 0, 8, 8)
      const bitmap = await createImageBitmap(tile)
      worker.emit({ id: worker.requests.at(-1).id, bitmap, renderMs: 500, interactionActive: false, cacheStats: stats })
      require(bitmap.width === 0, 'Every completed or stale bitmap is closed')
    }
    try {
      client.render(frame, { longEdge: 400, time: 0 })
      client.render(frame, { longEdge: 500, time: 1 })
      require(workers.length === 2 && workers[0].terminated, 'Obsolete scale work is terminated')
      await emit(workers[0], '#ff0000')
      require(canvas.toDataURL() === before && !results.length, 'Stale work preserves the last complete frame')
      client.render(frame, { longEdge: 500, time: 2, pointerSamples: [{ x: .1, y: .2, time: 20, active: true }] })
      client.render(frame, { longEdge: 500, time: 3, pointerSamples: Array.from({ length: 140 }, (_, i) => ({ x: .3, y: .4, time: 30 + i, active: true })) })
      require(workers.length === 2 && workers[1].requests.length === 1, 'Animation does not cancel the in-flight frame')
      await emit(workers[1], '#00ff00')
      require(results.length === 1 && results[0].time === 1, 'Actual frame time is presented without starvation')
      const latest = workers[1].requests.at(-1)
      require(workers[1].requests.length === 2 && latest.options.time === 3, 'Only the latest candidate is sent')
      require(latest.options.pointerSamples.length === 128 && latest.options.pointerSamples[0].time === 42, 'Real samples retain order within the input bound')
      await emit(workers[1], '#0000ff')
      require(!client.pending && results.length === 2 && results[1].time === 3, 'Latest complete frame settles')
      client.destroy()
      const final = canvas.toDataURL(); await emit(workers[1], '#ff0000')
      require(final === canvas.toDataURL() && workers.every(w => w.terminated), 'Destroy ignores late results and releases workers')
      require(errors.length === 0, 'No unexpected transaction failures')
      return { obsoleteScaleTerminated: true, stalePixelsIgnored: true, actualTime: results.map(o => o.time), boundedSamples: 128, bitmapReleased: true, destroyed: true }
    } finally { client.destroy(); window.Worker = NativeWorker; statsRenderer.destroy() }
  })

  report.cancellation = await page.evaluate(async () => {
    const { createPreviewRenderClient } = await import('/src/lib/art-engine/preview-render-client.ts')
    const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
    const source = new Image(); source.src = '/artwork/porcelain-study-v1.png'; await source.decode()
    const frame = prepareArtFrame(source, source.width, source.height, { columns: 180, colored: true, phrase: '我爱你中国', mode: 'phrase', charAspect: .85, fontFamily: 'Microsoft YaHei' })
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8
    canvas.getContext('2d').fillRect(0, 0, 8, 8); const before = canvas.toDataURL()
    let completed = 0, fired = false, errors = []
    const client = createPreviewRenderClient(canvas, { compatibilityOnly: true, isCurrent: () => true,
      onResult() { completed++ }, onProgress() {}, onFallback() {}, onError(e) { errors.push(String(e)) },
    })
    client.render(frame, { longEdge: 713 })
    await new Promise(resolve => setTimeout(() => { fired = true; client.destroy(); resolve() }, 0))
    await new Promise(resolve => setTimeout(resolve, 100))
    if (!fired || completed || client.pending || before !== canvas.toDataURL() || errors.length) throw new Error('Cancelled compatibility draw must leave complete pixels and release state')
    return { timerDuringDraw: fired, completed, noPartialPixels: true, released: true }
  })

  report.replacement = await page.evaluate(async () => {
    const { createPreviewRenderClient } = await import('/src/lib/art-engine/preview-render-client.ts')
    const { prepareArtFrame, createCanvasArtRenderer } = await import('/src/lib/art-engine/index.ts')
    const source = new Image(); source.src = '/artwork/porcelain-study-v1.png'; await source.decode()
    const old = prepareArtFrame(source, source.width, source.height, { columns: 180, mode: 'phrase', colored: true, phrase: '我爱你中国', fontFamily: 'Microsoft YaHei' })
    const next = prepareArtFrame(source, source.width, source.height, { columns: 24, mode: 'density' })
    const output = document.createElement('canvas'), reference = document.createElement('canvas')
    output.getContext('2d', { willReadFrequently: false }); reference.getContext('2d', { willReadFrequently: false })
    const renderer = createCanvasArtRenderer(reference); renderer.render(next, { longEdge: 320 })
    let completed = [], errors = [], resolve
    const done = new Promise(r => { resolve = r })
    const client = createPreviewRenderClient(output, { compatibilityOnly: true, isCurrent: () => true,
      onProgress() {}, onFallback() {}, onError(e) { errors.push(String(e)) },
      onResult(frame) { completed.push(frame.settings.mode); resolve() },
    })
    try {
      client.render(old, { longEdge: 713 })
      setTimeout(() => client.render(next, { longEdge: 320 }), 0)
      await done; await new Promise(r => setTimeout(r, 0))
      const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      const expected = pixels(reference), actual = pixels(output)
      if (completed.length !== 1 || completed[0] !== 'density' || errors.length || client.pending || expected.length !== actual.length || !expected.every((v, i) => v === actual[i])) throw new Error('Replacement must cancel the old compatibility frame and exactly present the latest')
      return { completed, exactLatestPixels: true, errors }
    } finally { client.destroy(); renderer.destroy() }
  })

  report.runtimeFallback = await page.evaluate(async () => {
    const { createPreviewRenderClient } = await import('/src/lib/art-engine/preview-render-client.ts')
    const { prepareArtFrame, createCanvasArtRenderer } = await import('/src/lib/art-engine/index.ts')
    const source = document.createElement('canvas'); source.width = source.height = 64
    source.getContext('2d').fillRect(0, 0, 64, 64)
    const frame = prepareArtFrame(source, 64, 64, { columns: 24 })
    const reference = document.createElement('canvas'), output = document.createElement('canvas')
    reference.getContext('2d', { willReadFrequently: false }); output.getContext('2d', { willReadFrequently: false })
    const renderer = createCanvasArtRenderer(reference); renderer.render(frame, { longEdge: 320 })
    const NativeWorker = Worker; let terminated = false, fallback = 0, resolve, reject
    window.Worker = class {
      postMessage() { setTimeout(() => this.onerror({ preventDefault() {} }), 0) }
      terminate() { terminated = true }
    }
    const done = new Promise((r, j) => { resolve = r; reject = j })
    const client = createPreviewRenderClient(output, { isCurrent: () => true, onProgress() {},
      onFallback() { fallback++ }, onError: reject, onResult: (frame, options, active, backend) => resolve(backend),
    })
    try {
      client.render(frame, { longEdge: 320 }); const backend = await done
      const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      const expected = pixels(reference), actual = pixels(output)
      if (!terminated || fallback !== 1 || backend !== 'responsive' || expected.length !== actual.length || !expected.every((v, i) => v === actual[i])) throw new Error('Runtime failure must terminate the Worker and complete the native compatibility frame')
      return { terminated, fallback, backend, exactPixels: true }
    } finally { client.destroy(); window.Worker = NativeWorker; renderer.destroy() }
  })

  const fixture = path.resolve('public/artwork/porcelain-study-v1.png')
  const canvas = page.locator('.ascii-scroll .ascii-canvas').first()
  const idle = () => page.waitForFunction(() => {
    const c = document.querySelector('.ascii-scroll .ascii-canvas'), s = document.querySelector('.art-editor')?.__vueParentComponent.setupState
    return c?.dataset.renderPending === 'false' && !s.converting && c.dataset.renderBackend === 'worker'
  }, {}, { timeout: 120000 })
  await page.locator('input[type=file]').first().setInputFiles(fixture)
  await idle()
  await page.locator('details.calibrated-effects').evaluate(d => { d.open = true })
  await page.getByRole('group', { name: '六模式悬停', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
  await idle()
  await page.getByRole('button', { name: /^低清/ }).click(); await idle()
  await page.getByRole('button', { name: '全屏 ↗', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.fs-overlay .ascii-canvas')?.dataset.renderPending === 'false')
  report.fullscreen = await page.evaluate(() => ({ controllers: document.querySelector('.art-editor').__vueParentComponent.setupState.artRenderers.size, backend: document.querySelector('.fs-overlay .ascii-canvas').dataset.renderBackend }))
  assert.equal(report.fullscreen.controllers, 2); assert.equal(report.fullscreen.backend, 'worker')
  await page.keyboard.press('Escape'); await idle()
  assert.equal(await page.evaluate(() => document.querySelector('.art-editor').__vueParentComponent.setupState.artRenderers.size), 1)
  report.fullscreen.released = true
  await page.getByRole('button', { name: '放大', exact: true }).first().click(); await idle()
  report.zoom = { backend: await canvas.getAttribute('data-render-backend'), width: await canvas.evaluate(c => c.width) }
  await canvas.screenshot({ path: path.join(out, 'image-worker.png') })

  // A native Worker that fails to construct exercises the same compatibility path used by video.
  const fallback = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await fallback.addInitScript(() => { const Native = Worker; window.Worker = class extends Native { constructor(url, options) { if (String(url).includes('frame-render.worker')) throw new Error('Intentional unavailable Worker'); super(url, options) } } })
  await fallback.goto(base + '/ascii-art'); await fallback.locator('input[type=file]').first().setInputFiles(fixture)
  await fallback.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.renderBackend === 'responsive', {}, { timeout: 120000 })
  await fallback.getByRole('status').filter({ hasText: '已切换到分段兼容预览' }).waitFor()
  const fallbackGeometry = await fallback.locator('.ascii-scroll').first().evaluate(el => [el.clientWidth, el.clientHeight])
  await fallback.evaluate(() => { document.querySelector('.art-editor').__vueParentComponent.setupState.frameRenderFallback = false })
  await fallback.getByRole('status').filter({ hasText: '已切换到分段兼容预览' }).waitFor({ state: 'hidden' })
  assert.deepEqual(await fallback.locator('.ascii-scroll').first().evaluate(el => [el.clientWidth, el.clientHeight]), fallbackGeometry, 'Compatibility status must not resize the artwork')
  assert(!(await fallback.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)))
  report.compatibilityUi = { nativeConstructorFailure: true, backend: 'responsive', mobileOverflow: false }
  await fallback.close()
  assert.deepEqual(report.errors, []); report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally {
  report.sourceHashes = Object.fromEntries(await Promise.all(['src/lib/art-engine/canvas.ts', 'src/lib/art-engine/preview-render-client.ts', 'src/views/AsciiArtView.vue'].map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close()
}
console.log(JSON.stringify({ out, passed: report.passed, parity: report.parity.length, failure: report.failure }))
