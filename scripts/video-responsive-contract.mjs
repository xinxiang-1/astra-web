import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_VIDEO_OUTPUT || `test-results/video-responsive-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const frozen = execFileSync('git', ['show', '6d140c2:src/lib/art-engine/core.ts'], {
  encoding: 'utf8',
})
await writeFile(path.join(out, 'baseline-core.ts'), frozen)
await writeFile(
  path.join(out, 'baseline-canvas.ts'),
  execFileSync('git', ['show', '6d140c2:src/lib/art-engine/canvas.ts'], { encoding: 'utf8' }),
)
const frozenUrl =
  '/' + path.relative(process.cwd(), path.join(out, 'baseline-core.ts')).split(path.sep).join('/')
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = { browser: browser.version(), errors: [], parity: [], playback: [] }
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'no-preference',
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.on('dialog', (d) => d.accept())
  await page.goto(base + '/ascii-art')
  report.parity = await page.evaluate(async (frozenUrl) => {
    const old = await import(frozenUrl),
      { createArtCore, ART_DEFAULTS, ART_ENGINE_VERSION } =
        await import('/src/lib/art-engine/index.ts')
    const source = document.createElement('canvas')
    source.width = 400
    source.height = 280
    const ctx = source.getContext('2d'),
      pixels = ctx.createImageData(source.width, source.height)
    for (let y = 0; y < source.height; y++)
      for (let x = 0; x < source.width; x++) {
        const i = (y * source.width + x) * 4
        pixels.data.set([x % 256, y % 256, (x * 3 + y * 2) % 256, x < 20 ? 0 : 255], i)
      }
    ctx.putImageData(pixels, 0, 0)
    const hash = async (bytes) =>
      Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
        n.toString(16).padStart(2, '0'),
      ).join('')
    const snapshot = async (frame) => ({
      text: frame.text,
      indices: await hash(frame.indices),
      alpha: await hash(frame.alpha),
      colors: await hash(frame.colors),
      geometry: [frame.columns, frame.rows, frame.cellWidth, frame.cellHeight],
      glyphs: await Promise.all(
        frame.glyphs.map(async (g) => ({
          char: g.char,
          coverage: g.coverage,
          pixels: await hash(
            g.tile.getContext('2d').getImageData(0, 0, g.tile.width, g.tile.height).data,
          ),
        })),
      ),
    })
    const baseline = old.createArtCore(ART_DEFAULTS, ART_ENGINE_VERSION),
      updated = createArtCore(ART_DEFAULTS, ART_ENGINE_VERSION),
      cases = []
    for (const mode of ['density', 'color', 'phrase', 'contour', 'braille', 'halftone'])
      for (const columns of [80, 360])
        for (const fontFamily of ['Consolas', 'Microsoft YaHei']) {
          const settings = {
            mode,
            columns,
            fontFamily,
            phrase: '山川与星河',
            charset: ' .,:iLCG08@',
            charAspect: 0.65,
            colored: mode === 'color' || mode === 'phrase',
            invert: true,
            ditherStrength: 0.4,
          }
          const expected = await snapshot(baseline.prepareArtFrame(source, 400, 280, settings))
          const sync = await snapshot(updated.prepareArtFrame(source, 400, 280, settings))
          const responsive = await snapshot(
            await updated.prepareArtFrameResponsive(source, 400, 280, settings),
          )
          cases.push({
            mode,
            columns,
            fontFamily,
            sync: JSON.stringify(expected) === JSON.stringify(sync),
            responsive: JSON.stringify(expected) === JSON.stringify(responsive),
          })
        }
    let abort = false,
      timerFired = false,
      cancelled = false
    setTimeout(() => {
      abort = true
      timerFired = true
    }, 0)
    try {
      await createArtCore(ART_DEFAULTS, ART_ENGINE_VERSION).prepareArtFrameResponsive(
        source,
        400,
        280,
        { mode: 'braille', columns: 360 },
        { shouldAbort: () => abort },
      )
    } catch (e) {
      cancelled = e.name === 'AbortError'
    }
    cases.push({ cancelled, timerFired })
    return cases
  }, frozenUrl)
  for (const c of report.parity.slice(0, -1)) assert(c.sync && c.responsive, JSON.stringify(c))
  assert(report.parity.at(-1).cancelled && report.parity.at(-1).timerFired)
  report.scheduler = await page.evaluate(async () => {
    const { createLiveFrameLoop } = await import('/src/lib/ascii/playback.ts')
    let callback = null,
      hidden = false,
      active = true,
      resolveBusy,
      conversions = [],
      cancelled = 0
    const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden')
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    const video = {
      currentTime: 0,
      paused: false,
      ended: false,
      seeking: false,
      readyState: 2,
      requestVideoFrameCallback(cb) {
        callback = cb
        return 1
      },
      cancelVideoFrameCallback() {
        callback = null
        cancelled++
      },
    }
    const handle = createLiveFrameLoop({
      fps: 15,
      getVideo: () => video,
      isActive: () => active,
      onFrame: (t) => {
        conversions.push(t)
        return new Promise((r) => (resolveBusy = r))
      },
    })
    const emit = async (now, time) => {
      video.currentTime = time
      const cb = callback
      callback = null
      cb?.(now, { mediaTime: time })
      await Promise.resolve()
      await Promise.resolve()
    }
    try {
      await emit(100, 0)
      await emit(200, 0.1)
      const busyCount = conversions.length
      resolveBusy()
      await new Promise((r) => setTimeout(r, 0))
      await emit(400, 0)
      const duplicateCount = conversions.length
      video.seeking = true
      await emit(500, 0.2)
      video.seeking = false
      video.readyState = 1
      await emit(600, 0.3)
      video.readyState = 2
      hidden = true
      await emit(700, 0.4)
      hidden = false
      active = false
      await emit(800, 0.5)
      active = true
      const gatedCount = conversions.length
      await emit(1000, 0.6)
      resolveBusy()
      await new Promise((r) => setTimeout(r, 0))
      const pending = callback
      handle.stop()
      pending?.(1200, { mediaTime: 0.8 })
      await Promise.resolve()
      return { busyCount, duplicateCount, gatedCount, conversions, cancelled }
    } finally {
      handle.stop()
      if (descriptor) Object.defineProperty(document, 'hidden', descriptor)
      else delete document.hidden
    }
  })
  assert.deepEqual(report.scheduler.conversions, [0, 0.6])
  assert.equal(report.scheduler.busyCount, 1)
  assert.equal(report.scheduler.duplicateCount, 1)
  assert.equal(report.scheduler.gatedCount, 1)
  assert(report.scheduler.cancelled >= 1)
  report.workerParity = await page.evaluate(async (frozenUrl) => {
    const { createCanvasArtRenderer } = await import(
      frozenUrl.replace('baseline-core', 'baseline-canvas')
    )
    const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
    const { createFrameRenderWorker } = await import('/src/lib/art-engine/frame-render-client.ts')
    const source = document.createElement('canvas')
    source.width = 320
    source.height = 200
    const ctx = source.getContext('2d'),
      g = ctx.createLinearGradient(0, 0, 320, 200)
    g.addColorStop(0, '#114488')
    g.addColorStop(1, '#ef8833')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 320, 200)
    const cases = []
    for (const mode of ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']) {
      const frame = prepareArtFrame(source, 320, 200, {
        mode,
        columns: 120,
        colored: mode === 'color' || mode === 'phrase',
        phrase: '山川与星河',
      })
      const reference = document.createElement('canvas')
      reference.getContext('2d', { willReadFrequently: false })
      const renderer = createCanvasArtRenderer(reference)
      let resolve, reject
      const worker = createFrameRenderWorker(
        (response) => {
          const output = document.createElement('canvas')
          output.width = response.bitmap.width
          output.height = response.bitmap.height
          output.getContext('2d', { willReadFrequently: false }).drawImage(response.bitmap, 0, 0)
          resolve(output)
        },
        () => reject(new Error('Worker failed')),
      )
      try {
        for (const style of ['static', 'breathe', 'rift']) {
          const options = {
            longEdge: 900,
            time: 1.2,
            hoverTime: 1.2,
            motion: style === 'breathe' ? 'breathe' : 'none',
            hover: style === 'rift' ? 'rift' : 'light',
            effectProfile: style === 'rift' ? 'expressive' : 'classic',
            pointer: style === 'rift' ? { x: 0.5, y: 0.5, strength: 0.8, active: true } : undefined,
            pointerSamples:
              style === 'rift'
                ? [
                    { x: 0.4, y: 0.4, time: 1100, active: true },
                    { x: 0.5, y: 0.5, time: 1200, active: true },
                  ]
                : [],
          }
          renderer.render(frame, options)
          const received = await new Promise((r, j) => {
            resolve = r
            reject = j
            worker.render(frame, options)
          })
          const a = reference
              .getContext('2d')
              .getImageData(0, 0, reference.width, reference.height).data,
            b = received.getContext('2d').getImageData(0, 0, received.width, received.height).data
          let changed = 0,
            maxDelta = 0
          for (let n = 0; n < a.length; n++)
            if (a[n] !== b[n]) {
              changed++
              maxDelta = Math.max(maxDelta, Math.abs(a[n] - b[n]))
            }
          cases.push({ mode, style, changed, maxDelta })
        }
      } finally {
        worker.dispose()
        renderer.destroy()
      }
    }
    return cases
  }, frozenUrl)
  for (const c of report.workerParity) assert.equal(c.changed, 0, JSON.stringify(c))
  report.workerFailureRecovery = await page.evaluate(async () => {
    const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts'),
      { createFrameRenderWorker } = await import('/src/lib/art-engine/frame-render-client.ts')
    const source = document.createElement('canvas')
    source.width = 64
    source.height = 64
    source.getContext('2d').fillRect(0, 0, 64, 64)
    const frame = prepareArtFrame(source, 64, 64, { columns: 24 })
    const callbackFailure = await new Promise((resolve) => {
      const worker = createFrameRenderWorker(
        () => {
          throw new Error('Intentional presenter failure')
        },
        () => resolve(true),
      )
      worker.render(frame, { longEdge: 128 })
    })
    const Native = Worker
    try {
      window.Worker = class extends Native {
        constructor(url, options) {
          super(url, options)
          queueMicrotask(() =>
            this.dispatchEvent(
              new ErrorEvent('error', { cancelable: true, message: 'Intentional runtime failure' }),
            ),
          )
        }
      }
      const runtimeFailure = await new Promise((resolve) => {
        const worker = createFrameRenderWorker(
          () => resolve(false),
          () => resolve(true),
        )
        worker.render(frame, { longEdge: 128 })
      })
      return { callbackFailure, runtimeFailure }
    } finally {
      window.Worker = Native
    }
  })
  assert(
    report.workerFailureRecovery.callbackFailure && report.workerFailureRecovery.runtimeFailure,
  )

  // A real, deterministic, locally generated WebM. No external fixture/download required.
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 1280
    c.height = 720
    const ctx = c.getContext('2d'),
      stream = c.captureStream(30),
      chunks = []
    const recorder = new MediaRecorder(stream, {
      mimeType: 'video/webm;codecs=vp8',
      videoBitsPerSecond: 1600000,
    })
    const done = new Promise(
      (resolve) =>
        (recorder.onstop = async () =>
          resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())))),
    )
    recorder.ondataavailable = (e) => chunks.push(e.data)
    recorder.start()
    for (let i = 0; i < 180; i++) {
      const g = ctx.createLinearGradient(0, 0, 1280, 720)
      g.addColorStop(0, '#112b53')
      g.addColorStop(1, '#fdb068')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 1280, 720)
      ctx.fillStyle = '#effffe'
      ctx.beginPath()
      ctx.arc(640 + Math.sin(i / 18) * 400, 360 + Math.cos(i / 13) * 210, 100, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#112b53'
      ctx.font = 'bold 100px Microsoft YaHei'
      ctx.fillText('光与影 ASTRA', 90, 160)
      await new Promise((r) => setTimeout(r, 1000 / 30))
    }
    recorder.stop()
    const result = await done
    stream.getTracks().forEach((t) => t.stop())
    return result
  })
  const fixture = path.join(out, 'source.webm')
  await writeFile(fixture, Buffer.from(bytes))
  await page.locator('input[type=file]').first().setInputFiles(fixture)
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor({ timeout: 60000 })
  const names = ['光影字符', '原色字符', '中文铺字', '轮廓线稿', '点阵细节', '印刷网点']
  const modes = ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']
  for (let i = 0; i < names.length; i++) {
    if (await page.getByRole('button', { name: '暂停', exact: true }).count())
      await page.getByRole('button', { name: '暂停', exact: true }).click()
    if (i === 2) await page.getByRole('button', { name: /^低清/ }).click()
    await page.locator('.inspector-modes button').filter({ hasText: names[i] }).click()
    await page.waitForFunction(
      (mode) => document.querySelector('.ascii-canvas')?.dataset.mode === mode,
      modes[i],
    )
    await page.locator('.video-thumb.show').evaluate((v) => (v.currentTime = 0))
    await page.waitForFunction(() => !document.querySelector('.video-thumb.show').seeking)
    await page.getByRole('button', { name: '播放', exact: true }).click()
    await page.evaluate(() => {
      const m = (window.__videoMeasure = { active: true, raf: [], timers: [] })
      let last = performance.now(),
        t = last
      function frame(now) {
        m.raf.push(now - last)
        last = now
        if (m.active) requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
      m.timer = setInterval(() => {
        const now = performance.now()
        m.timers.push(now - t)
        t = now
      }, 20)
    })
    await page.waitForTimeout(2500)
    const sample = await page.evaluate(() => {
      const m = window.__videoMeasure
      m.active = false
      clearInterval(m.timer)
      const gaps = [...m.raf].sort((a, b) => a - b),
        v = document.querySelector('.video-thumb.show')
      return {
        frames: gaps.length,
        p95: gaps[Math.floor(gaps.length * 0.95)],
        max: Math.max(...gaps),
        timerMax: Math.max(...m.timers),
        time: v.currentTime,
        ready: v.readyState,
        columns: document.querySelector('.ascii-canvas').dataset.columns,
        backend: document.querySelector('.ascii-canvas').dataset.renderBackend,
      }
    })
    report.playback.push({ mode: modes[i], ...sample })
    assert.equal(sample.backend, 'worker')
    assert(sample.timerMax < 150, 'Video conversion must not block the main-thread heartbeat')
    assert(sample.frames > 25, 'Real video must leave the page responsive')
  }
  if (await page.getByRole('button', { name: '暂停', exact: true }).count())
    await page.getByRole('button', { name: '暂停', exact: true }).click()
  await page.locator('.video-thumb.show').evaluate((v) => v.dispatchEvent(new Event('waiting')))
  await page.getByRole('status').filter({ hasText: '正在等待视频画面' }).waitFor()
  await page.locator('.video-thumb.show').evaluate((v) => v.dispatchEvent(new Event('canplay')))
  await page
    .getByRole('status')
    .filter({ hasText: '正在等待视频画面' })
    .waitFor({ state: 'hidden' })
  report.bufferingFeedback = { eventContract: true, networkStallReproduced: false }
  await page.locator('.video-thumb.show').evaluate((v) => (v.currentTime = 1))
  await page.waitForFunction(() => !document.querySelector('.video-thumb.show').seeking)
  await page.waitForTimeout(300)
  await page.waitForFunction(
    () => {
      const s = document.querySelector('.art-editor').__vueParentComponent.setupState
      return !s.converting && [...s.videoRenderers.values()].every((r) => !r.pending)
    },
    {},
    { timeout: 60000 },
  )
  const canvasHash = () =>
    page.locator('.ascii-canvas').evaluate(async (c) => {
      const bytes = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (n) =>
        n.toString(16).padStart(2, '0'),
      ).join('')
    })
  const stable = await canvasHash()
  await page.waitForTimeout(300)
  assert.equal(await canvasHash(), stable, 'Paused preview must remain stable')
  report.pausedStable = true
  await page.getByRole('button', { name: /切换到/ }).click()
  await page.screenshot({ path: path.join(out, 'video-dark.png') })
  await page.getByRole('button', { name: /^超清/ }).click()
  await page.locator('.clip-panel').getByRole('button', { name: '自定义', exact: true }).click()
  await page.locator('.clip-custom-field input').first().fill('0.5')
  await page.locator('.clip-custom-field input').first().dispatchEvent('change')
  await page.getByRole('button', { name: /解析并播放/ }).click()
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  report.prerender = await page.evaluate(() => {
    const s = document.querySelector('.art-editor').__vueParentComponent.setupState
    return { ready: s.videoPrerenderReady, total: s.videoPrerenderTotal, columns: s.columnsOut }
  })
  assert(report.prerender.ready && report.prerender.total >= 2 && report.prerender.columns === 240)
  await page.locator('.inspector-modes button').filter({ hasText: '光影字符' }).click()
  await page.getByRole('button', { name: /解析并播放/ }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'hidden' })
  report.prerenderCancel = true
  await page.getByRole('button', { name: /^低清/ }).click()
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await page.getByRole('button', { name: '全屏 ↗', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.fs-overlay .ascii-canvas')?.dataset.renderBackend === 'worker',
  )
  report.fullscreen = await page.evaluate(() => ({
    backend: document.querySelector('.fs-overlay .ascii-canvas').dataset.renderBackend,
    workers:
      document.querySelector('.art-editor').__vueParentComponent.setupState.videoRenderers.size,
  }))
  await page.keyboard.press('Escape')
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector('.art-editor').__vueParentComponent.setupState.videoRenderers.size,
    ),
    1,
    'Closing fullscreen must release its worker',
  )
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  report.fullscreen.released = true
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '调整效果', exact: true }).click()
  await page.getByRole('button', { name: /^低清/ }).click()
  await page.getByRole('button', { name: '素材与预设', exact: true }).click()
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await page.locator('.ascii-canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(1000)
  report.mobile = await page.locator('.ascii-canvas').evaluate((c) => ({
    backend: c.dataset.renderBackend,
    width: c.width,
    height: c.height,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
  }))
  assert.equal(report.mobile.backend, 'worker')
  assert(!report.mobile.overflow)
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const fallback = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await fallback.addInitScript(() => {
    const Native = Worker
    window.Worker = class extends Native {
      constructor(url, opts) {
        if (String(url).includes('frame-render.worker'))
          throw new Error('Intentional worker unavailable')
        super(url, opts)
      }
    }
  })
  await fallback.goto(base + '/ascii-art')
  await fallback.getByRole('button', { name: /^低清/ }).click()
  await fallback.locator('input[type=file]').first().setInputFiles(fixture)
  await fallback
    .getByRole('status')
    .filter({ hasText: '已切换到兼容预览' })
    .waitFor({ timeout: 60000 })
  await fallback.waitForFunction(
    () => document.querySelector('.ascii-canvas')?.dataset.renderBackend === 'canvas',
  )
  report.workerFallback = true
  await fallback.close()
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
