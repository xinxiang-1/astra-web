import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

// UI fault injection only: all media is generated locally, and each modified
// video instance is restored in the page's finally block. No production hooks.
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5213'
const outputRoot = path.resolve(process.env.ASTRA_VIDEO_CANCEL_OUTPUT || 'test-results/video-prerender-cancellation-ui')
await mkdir(outputRoot, { recursive: true })
const out = await mkdtemp(path.join(outputRoot, 'run-'))
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const domOnly = process.env.ASTRA_VIDEO_CANCEL_DOM_ONLY === '1'
const report = {
  base,
  channel,
  scriptSha256: createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex'),
  stateEvidence: domOnly ? 'Production DOM only; no Vue internals or reactive-model mutations' : 'Development Vue setupState plus real DOM interactions',
  scope: 'Owned locally generated video and PNG; real editor interactions with an intentionally stalled seek. Not a decoder/network stall or real-device performance certification.',
  cancelCases: [],
  invalidationCases: [],
  errors: [],
}
let browser
let activePage

const editorState = async (page) => page.evaluate((domOnly) => {
  if (domOnly) {
    const video = document.querySelector('.video-thumb.show')
    const image = document.querySelector('.source-panel img.thumb')
    const controls = document.querySelector('.video-controls')
    const progress = document.querySelector('.prerender-label')?.textContent.match(/(\d+)\/(\d+)/)
    const status = document.querySelector('.stage-head .status')?.textContent || ''
    const ready = !!controls && controls.querySelector('button')?.textContent.trim() === '播放' &&
      controls.querySelector('[aria-label="视频预览方式"]')?.value === 'quality'
    return {
      mediaKind: video ? 'video' : image ? 'image' : null,
      // The source token is read from DOM; production has no internal revision.
      sourceRevision: video?.getAttribute('src') || image?.getAttribute('src') || null,
      error: document.querySelector('.stage-head [role="alert"]')?.textContent.trim() || '',
      sourceError: '', // Combined visible error is recorded above, not separated.
      parsing: !!document.querySelector('.prerender-bar'),
      ready,
      done: Number(progress?.[1] || 0),
      total: Number(progress?.[2] || (ready ? status.match(/预渲染就绪\s*·\s*(\d+)\s*帧/)?.[1] : 0) || 0),
      playing: controls?.querySelector('button')?.textContent.trim() === '暂停',
      loading: !!document.querySelector('.stage-head [role="status"]')?.textContent.includes('正在读取新素材'),
      columns: Number(document.querySelector('.ascii-canvas')?.dataset.columns || 0),
    }
  }
  const s = document.querySelector('.art-editor')?.__vueParentComponent?.setupState
  if (!s) return null
  return {
    mediaKind: s.mediaKind,
    sourceRevision: s.sourceRevision,
    error: s.error,
    sourceError: s.sourceError,
    parsing: s.videoPrerendering,
    ready: s.videoPrerenderReady,
    done: s.videoPrerenderDone,
    total: s.videoPrerenderTotal,
    playing: s.videoPlaying,
    loading: s.loadingSource,
    columns: s.columnsOut,
  }
}, domOnly)

async function waitForSettled(page) {
  if (domOnly) await page.evaluate(() => { window.__domSettleSample = null })
  await page.waitForFunction((domOnly) => {
    if (domOnly) {
      const canvas = document.querySelector('.ascii-canvas')
      return !document.querySelector('.stage-feedback') && canvas?.dataset.renderPending === 'false'
    }
    const s = document.querySelector('.art-editor')?.__vueParentComponent?.setupState
    return s && !s.loadingSource && !s.converting && !s.frameRendering &&
      [...s.videoRenderers.values(), ...s.artRenderers.values()].every((r) => !r.pending)
  }, domOnly, { timeout: 60000 })
  if (domOnly) {
    // A stable paused canvas is observable in the published application.
    await page.waitForFunction(() => {
      const canvas = document.querySelector('.ascii-canvas')
      if (!canvas || canvas.dataset.renderPending !== 'false' || document.querySelector('.stage-feedback')) {
        window.__domSettleSample = null
        return false
      }
      const pixels = canvas.toDataURL()
      const now = performance.now()
      const previous = window.__domSettleSample
      if (!previous || previous.canvas !== canvas || previous.pixels !== pixels) {
        window.__domSettleSample = { canvas, pixels, at: now }
        return false
      }
      return now - previous.at >= 100
    }, null, { timeout: 60000 })
  }
}

async function waitForParsingEnd(page) {
  await page.waitForFunction((domOnly) => domOnly
    ? !document.querySelector('.prerender-bar')
    : !document.querySelector('.art-editor').__vueParentComponent.setupState.videoPrerendering,
  domOnly, { timeout: 1500 })
}

async function invalidateCache(page) {
  const input = page.locator('.inspector-panel input[type="range"][min="-2"]').first()
  await input.evaluate((element) => {
    element.value = String(Math.min(1.9, Number(element.value) + 0.1))
    element.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await waitForSettled(page)
}

async function restoreFault(page, label, emitLate = false) {
  return page.evaluate(({ label, emitLate }) => {
    const fault = window.__prerenderUiFaults?.get(label)
    if (!fault) return null
    if (!fault.restored) {
      if (fault.original) Object.defineProperty(fault.video, 'currentTime', fault.original)
      else delete fault.video.currentTime
      fault.restored = true
    }
    const own = Object.getOwnPropertyDescriptor(fault.video, 'currentTime')
    const descriptorRestored = fault.original
      ? own?.get === fault.original.get && own?.set === fault.original.set && own?.value === fault.original.value
      : own === undefined
    if (emitLate) {
      // Deliberately target the retained old element, never the new active slot.
      fault.video.dispatchEvent(new Event('seeked'))
      fault.lateEvents++
    }
    return {
      requests: [...fault.requests],
      restored: descriptorRestored,
      lateEvents: fault.lateEvents,
      connected: fault.video.isConnected,
      source: fault.video.getAttribute('src'),
    }
  }, { label, emitLate })
}

async function installSeekFault(page, label) {
  await page.evaluate((label) => {
    const video = document.querySelector('.video-thumb.show')
    if (!(video instanceof HTMLVideoElement)) throw new Error('Active source video missing')
    const original = Object.getOwnPropertyDescriptor(video, 'currentTime')
    const native = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
    if (!native?.get || !native?.set) throw new Error('Native video currentTime accessor missing')
    const fault = { video, original, native, requests: [], restored: false, lateEvents: 0 }
    window.__prerenderUiFaults ??= new Map()
    window.__prerenderUiFaults.set(label, fault)
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => native.get.call(video),
      // Keep the decoded frame/time unchanged and emit no seeked event. This
      // reproduces the promise boundary without breaking other media methods.
      set: (target) => fault.requests.push({ target, at: performance.now() }),
    })
  }, label)
}

async function beginStalledPrerender(page, label) {
  const pause = page.getByRole('button', { name: '暂停', exact: true })
  if (await pause.isVisible()) await pause.click()
  await waitForSettled(page)
  await page.locator('.video-thumb.show').evaluate((video) => { video.currentTime = 0 })
  await page.waitForFunction(() => !document.querySelector('.video-thumb.show')?.seeking)
  await waitForSettled(page)
  await installSeekFault(page, label)
  await page.getByRole('button', { name: '解析并播放', exact: true }).click()
  await page.waitForFunction((label) => window.__prerenderUiFaults?.get(label)?.requests.length > 0,
    label, { timeout: 30000 })
  const state = await editorState(page)
  assert(state.parsing, 'The injected seek must actually suspend an active prerender')
  assert(await page.getByRole('button', { name: '取消', exact: true }).isVisible())
  await page.getByRole('status').filter({ hasText: '正在解析高清片段' }).waitFor()
  return state
}

async function setShortClip(page) {
  await page.getByRole('combobox', { name: '视频预览方式', exact: true }).selectOption('quality')
  await page.getByRole('combobox', { name: '视频帧率', exact: true }).selectOption('12')
  await page.locator('.clip-panel').getByRole('button', { name: '自定义', exact: true }).click()
  const seconds = page.locator('.clip-custom-field input').first()
  await seconds.fill('0.5')
  await seconds.dispatchEvent('change')
  await waitForSettled(page)
}

async function loadVideo(page, fixture) {
  await page.locator('input[type=file]').first().setInputFiles(fixture)
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await setShortClip(page)
}

async function retryPrerender(page) {
  await page.getByRole('button', { name: '解析并播放', exact: true }).click()
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  await waitForSettled(page)
  const state = await editorState(page)
  assert(state.ready && !state.parsing && state.total >= 2, 'Retry must produce a complete usable cache')
  assert.equal(state.error, '')
  assert.equal(state.sourceError, '')
  return state
}

async function capture(page, filename, locator) {
  if (locator) await locator.scrollIntoViewIfNeeded()
  const file = path.join(out, filename)
  await page.screenshot({ path: file })
  return file
}

async function newEditor(theme, viewport, label) {
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' })
  activePage = page
  await page.addInitScript((theme) => localStorage.setItem('astra-theme', theme), theme)
  page.on('pageerror', (e) => report.errors.push({ label, message: e.message }))
  await page.goto(base + '/ascii-art')
  await page.locator('.art-editor').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme)
  return page
}

try {
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true })
  report.browser = browser.version()
  const seed = await newEditor('light', { width: 1440, height: 1000 }, 'fixture')
  const inputSource = process.env.ASTRA_VIDEO_CANCEL_INPUT
    ? path.resolve(process.env.ASTRA_VIDEO_CANCEL_INPUT)
    : null
  let fixture
  let generated
  let sourceHash
  let format = { extension: '.webm', mimeType: 'video/webm' }
  if (inputSource) {
    const extension = path.extname(inputSource).toLowerCase()
    assert(['.mp4', '.webm'].includes(extension), 'ASTRA_VIDEO_CANCEL_INPUT must be an owned MP4 or WebM test fixture')
    format = { extension, mimeType: extension === '.mp4' ? 'video/mp4' : 'video/webm' }
    const originalBytes = await readFile(inputSource)
    sourceHash = createHash('sha256').update(originalBytes).digest('hex')
    fixture = path.join(out, `synthetic-source${extension}`)
    await copyFile(inputSource, fixture)
    const copiedBytes = await readFile(fixture)
    assert.equal(createHash('sha256').update(copiedBytes).digest('hex'), sourceHash,
      'The per-run fixture copy must retain the exact input bytes')
    generated = await seed.evaluate(async ({ video, mimeType }) => {
      const nativeVideo = document.createElement('video')
      nativeVideo.muted = true
      nativeVideo.playsInline = true
      nativeVideo.preload = 'auto'
      const url = URL.createObjectURL(new Blob([new Uint8Array(video)], { type: mimeType }))
      let decoded
      try {
        decoded = await new Promise((resolve) => {
          const finish = (ok, error = '') => {
            clearTimeout(timer)
            nativeVideo.removeEventListener('loadeddata', loaded)
            nativeVideo.removeEventListener('error', failed)
            resolve({ ok, error, width: nativeVideo.videoWidth, height: nativeVideo.videoHeight,
              readyState: nativeVideo.readyState,
              duration: Number.isFinite(nativeVideo.duration) ? nativeVideo.duration : String(nativeVideo.duration),
              finiteDuration: Number.isFinite(nativeVideo.duration) && nativeVideo.duration > 0 })
          }
          const loaded = () => {
            const valid = nativeVideo.videoWidth > 0 && nativeVideo.videoHeight > 0 && nativeVideo.readyState >= 2
            finish(valid, valid ? '' : 'Input fixture loadeddata did not provide a decoded video frame')
          }
          const failed = () => finish(false, `Input fixture native decode failed (media error ${nativeVideo.error?.code ?? 'unknown'})`)
          const timer = setTimeout(() => finish(false, 'Input fixture native decode timed out after 5000ms'), 5000)
          nativeVideo.addEventListener('loadeddata', loaded, { once: true })
          nativeVideo.addEventListener('error', failed, { once: true })
          nativeVideo.src = url
          nativeVideo.load()
        })
      } finally {
        nativeVideo.pause()
        nativeVideo.removeAttribute('src')
        nativeVideo.load()
        URL.revokeObjectURL(url)
      }
      const canvas = document.createElement('canvas')
      canvas.width = 480
      canvas.height = 320
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Replacement fixture canvas 2D context unavailable')
      ctx.fillStyle = '#082f49'
      ctx.fillRect(0, 0, 480, 320)
      ctx.fillStyle = '#5eead4'
      ctx.fillRect(40, 50, 180, 220)
      ctx.fillStyle = '#f97316'
      ctx.beginPath()
      ctx.arc(350, 160, 95, 0, Math.PI * 2)
      ctx.fill()
      return { video, image: canvas.toDataURL('image/png').split(',')[1], decoded,
        capture: { mode: 'Explicit owned synthetic input; no browser MediaRecorder generation', requestFrames: null },
        cleanup: { decoderUrlRevoked: true } }
    }, { video: Array.from(copiedBytes), mimeType: format.mimeType })
  } else {
    generated = await seed.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 480
    canvas.height = 320
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Fixture canvas 2D context unavailable')
    canvas.style.cssText = 'position:fixed;left:20px;top:20px;width:480px;height:320px;z-index:2147483647;pointer-events:none'
    document.body.appendChild(canvas)
    let stream
    let recorder
    let fixture
    try {
      // Detached auto-capture canvases can produce an empty 110-byte WebM in
      // headless Chrome. Keep this owned canvas visible and explicitly request
      // every drawn frame; no application timers or media methods are changed.
      stream = canvas.captureStream(0)
      const track = stream.getVideoTracks()[0]
      if (typeof track?.requestFrame !== 'function') throw new Error('Fixture manual frame capture unavailable')
      const chunks = []
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 500000 })
      const finished = new Promise((resolve, reject) => {
        recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())))
        recorder.onerror = (event) => reject(new Error(event.error?.message || 'Fixture recorder failed'))
      })
      // Consume a possible early encoder rejection without hiding it from the
      // awaited result after recording has stopped.
      finished.catch(() => {})
      recorder.ondataavailable = (event) => chunks.push(event.data)
      const startedAt = performance.now()
      let requestFrames = 0
      recorder.start()
      for (let frame = 0; frame < 40; frame++) {
        const gradient = ctx.createLinearGradient(0, 0, 480, 320)
        gradient.addColorStop(0, '#102742')
        gradient.addColorStop(1, '#f6a54c')
        ctx.fillStyle = gradient
        ctx.fillRect(0, 0, 480, 320)
        ctx.fillStyle = '#fff2da'
        ctx.beginPath()
        ctx.arc(150 + frame * 4, 155 + Math.sin(frame / 5) * 55, 55, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#102742'
        ctx.font = 'bold 32px sans-serif'
        ctx.fillText('ASTRA · LOCAL', 20, 55)
        track.requestFrame()
        requestFrames++
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      recorder.stop()
      let stopTimer
      const video = await Promise.race([
        finished,
        new Promise((_, reject) => { stopTimer = setTimeout(() => reject(new Error('Fixture encoder stop timed out')), 5000) }),
      ]).finally(() => clearTimeout(stopTimer))
      const recordingMs = performance.now() - startedAt

      // Validate the recorded bytes through an independent native decoder
      // before any editor upload. A broken fixture fails here with its bytes
      // and diagnosis retained, rather than waiting for a playback button.
      const nativeVideo = document.createElement('video')
      nativeVideo.muted = true
      nativeVideo.playsInline = true
      nativeVideo.preload = 'auto'
      const url = URL.createObjectURL(new Blob([new Uint8Array(video)], { type: 'video/webm' }))
      let decoded
      try {
        decoded = await new Promise((resolve) => {
          const finish = (ok, error = '') => {
            clearTimeout(timer)
            nativeVideo.removeEventListener('loadeddata', loaded)
            nativeVideo.removeEventListener('error', failed)
            resolve({
              ok,
              error,
              width: nativeVideo.videoWidth,
              height: nativeVideo.videoHeight,
              readyState: nativeVideo.readyState,
              duration: Number.isFinite(nativeVideo.duration) ? nativeVideo.duration : String(nativeVideo.duration),
              finiteDuration: Number.isFinite(nativeVideo.duration) && nativeVideo.duration > 0,
            })
          }
          const loaded = () => {
            const valid = nativeVideo.videoWidth === 480 && nativeVideo.videoHeight === 320 && nativeVideo.readyState >= 2
            finish(valid, valid ? '' : 'Fixture loadeddata did not provide the expected decoded dimensions/frame')
          }
          const failed = () => finish(false, `Fixture native decode failed (media error ${nativeVideo.error?.code ?? 'unknown'})`)
          const timer = setTimeout(() => finish(false, 'Fixture native decode timed out after 5000ms'), 5000)
          nativeVideo.addEventListener('loadeddata', loaded, { once: true })
          nativeVideo.addEventListener('error', failed, { once: true })
          nativeVideo.src = url
          nativeVideo.load()
        })
      } finally {
        nativeVideo.pause()
        nativeVideo.removeAttribute('src')
        nativeVideo.load()
        URL.revokeObjectURL(url)
      }
      ctx.fillStyle = '#082f49'
      ctx.fillRect(0, 0, 480, 320)
      ctx.fillStyle = '#5eead4'
      ctx.fillRect(40, 50, 180, 220)
      ctx.fillStyle = '#f97316'
      ctx.beginPath()
      ctx.arc(350, 160, 95, 0, Math.PI * 2)
      ctx.fill()
      fixture = { video, image: canvas.toDataURL('image/png').split(',')[1], decoded,
        capture: { mode: 'visible canvas, captureStream(0), explicit track.requestFrame', requestFrames, recordingMs } }
      return fixture
    } finally {
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      stream?.getTracks().forEach((track) => track.stop())
      canvas.remove()
      if (fixture) fixture.cleanup = { canvasRemoved: !canvas.isConnected,
        tracksStopped: stream.getTracks().every((track) => track.readyState === 'ended'), decoderUrlRevoked: true }
    }
    })
    fixture = path.join(out, 'synthetic-source.webm')
  }
  const image = path.join(out, 'synthetic-replacement.png')
  const bytes = Buffer.from(generated.video)
  if (!inputSource) await writeFile(fixture, bytes)
  await writeFile(image, Buffer.from(generated.image, 'base64'))
  report.fixture = { filename: path.basename(fixture), sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length, format, source: inputSource ? { mode: 'Explicit owned synthetic input', path: inputSource, sha256: sourceHash }
      : { mode: 'Locally generated browser synthetic WebM' },
    decoded: generated.decoded, capture: generated.capture, cleanup: generated.cleanup }
  assert(generated.decoded.ok, generated.decoded.error || 'Fixture failed native decoding')
  await seed.close()

  for (const theme of ['light', 'dark']) {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const label = `${theme}-${viewport.width}`
      const page = await newEditor(theme, viewport, label)
      try {
        await loadVideo(page, fixture)
        const parsing = await beginStalledPrerender(page, label)
        const loadingScreenshot = await capture(page, `${label}-loading.png`, page.locator('.stage-feedback'))
        // Keep cancellation a real button interaction, including on 390px.
        await page.getByRole('button', { name: '取消', exact: true }).evaluate((button) => {
          button.addEventListener('click', () => { window.__cancelClickedAt = performance.now() }, { capture: true, once: true })
        })
        await page.getByRole('button', { name: '取消', exact: true }).click()
        await waitForParsingEnd(page)
        const elapsedMs = await page.evaluate(() => performance.now() - window.__cancelClickedAt)
        assert(elapsedMs < 1500, 'Cancellation must release the loading state promptly after the click')
        await page.getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'hidden', timeout: 1500 })
        const notice = page.getByRole('status').filter({ hasText: '已取消解析' })
        await notice.waitFor({ timeout: 1500 })
        const cancelled = await editorState(page)
        assert(!cancelled.ready && cancelled.total === 0 && cancelled.done === 0)
        assert.equal(cancelled.error, '')
        const cancelledScreenshot = await capture(page, `${label}-cancelled.png`, notice)
        const recovered = await restoreFault(page, label, true)
        assert(recovered.restored)
        await waitForSettled(page)
        const retry = await retryPrerender(page)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
        assert(!overflow, 'Editor must fit the viewport after cancellation and retry')
        report.cancelCases.push({ label, theme, viewport, parsing, cancelled, recovered, retry, overflow,
          boundMs: 1500, elapsedMs, loadingScreenshot, cancelledScreenshot })
      } catch (error) {
        report.failureState = await editorState(page).catch(() => null)
        report.failureScreenshot = await capture(page, `${label}-failure.png`).catch(() => null)
        throw error
      } finally {
        await restoreFault(page, label)
        await page.close()
      }
    }
  }

  const page = await newEditor('dark', { width: 1440, height: 1000 }, 'ownership')
  await loadVideo(page, fixture)
  const replacementLabel = 'replace-while-seek-pending'
  const old = await beginStalledPrerender(page, replacementLabel)
  await page.locator('input[type=file]').first().setInputFiles(image)
  await page.waitForFunction((domOnly) => {
    if (domOnly) return !!document.querySelector('.source-panel img.thumb') &&
      !document.querySelector('.video-thumb.show') && !document.querySelector('.prerender-bar') &&
      !document.querySelector('.stage-feedback')
    const s = document.querySelector('.art-editor').__vueParentComponent.setupState
    return s.mediaKind === 'image' && !s.loadingSource && !s.videoPrerendering
  }, domOnly, { timeout: 60000 })
  await waitForSettled(page)
  const imageState = await editorState(page)
  assert.notEqual(imageState.sourceRevision, old.sourceRevision)
  assert.equal(imageState.error, '')
  assert(!imageState.ready && !imageState.parsing)
  const baseline = await page.evaluate((domOnly) => {
    const s = domOnly ? null : document.querySelector('.art-editor').__vueParentComponent.setupState
    const canvas = document.querySelector('.ascii-canvas')
    window.__replacementBaseline = { art: s?.artFrame, ascii: s?.ascii, url: canvas.toDataURL() }
    return { renderPending: canvas.dataset.renderPending, capturedAt: performance.now(),
      stableSince: window.__domSettleSample?.at ?? null, width: canvas.width, height: canvas.height }
  }, domOnly)
  report.replacement = { old, imageState, baseline }
  const oldSlot = await restoreFault(page, replacementLabel, true)
  report.replacement.oldSlot = oldSlot
  assert(oldSlot.restored && oldSlot.source === null, 'The late event must target the released old source slot')
  await page.waitForTimeout(250)
  await waitForSettled(page)
  const late = await page.evaluate((domOnly) => {
    const s = domOnly ? null : document.querySelector('.art-editor').__vueParentComponent.setupState
    const canvas = document.querySelector('.ascii-canvas')
    return {
      sameFrame: s ? s.artFrame === window.__replacementBaseline.art : null,
      sameText: s ? s.ascii === window.__replacementBaseline.ascii : null,
      samePixels: canvas.toDataURL() === window.__replacementBaseline.url,
      renderPending: canvas.dataset.renderPending,
      capturedAt: performance.now(),
      stableSince: window.__domSettleSample?.at ?? null,
      width: canvas.width,
      height: canvas.height,
    }
  }, domOnly)
  // Preserve the failed comparison and its renderer state before asserting.
  report.replacement.late = late
  assert((domOnly || (late.sameFrame && late.sameText)) && late.samePixels,
    'Late old-slot completion must leave the new image untouched')
  assert.deepEqual(await editorState(page), imageState)
  report.replacement.screenshot = await capture(page, 'replacement-stable.png')

  await loadVideo(page, fixture)
  const firstTaskLabel = 'superseded-source-task'
  const nextTaskLabel = 'new-source-task'
  try {
    const first = await beginStalledPrerender(page, firstTaskLabel)
    // Loading a new source uses the other video slot and creates a new URL,
    // even though both owned fixtures have identical bytes.
    await loadVideo(page, fixture)
    const next = await beginStalledPrerender(page, nextTaskLabel)
    assert.notEqual(next.sourceRevision, first.sourceRevision)
    const superseded = await restoreFault(page, firstTaskLabel, true)
    assert(superseded.restored && superseded.source === null)
    await page.waitForTimeout(200)
    const afterLate = await editorState(page)
    assert.deepEqual(afterLate, next, 'An old slot event cannot clear the new task loading/progress/cache/error')
    assert(afterLate.parsing && !afterLate.ready)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await waitForParsingEnd(page)
    const restored = await restoreFault(page, nextTaskLabel, true)
    assert(restored.restored)
    await waitForSettled(page)
    report.supersededTask = { first, next, superseded, afterLate, retry: await retryPrerender(page) }
    await invalidateCache(page)
  } finally {
    await restoreFault(page, firstTaskLabel)
    await restoreFault(page, nextTaskLabel)
  }

  const timeoutLabel = 'default-seek-timeout'
  try {
    await beginStalledPrerender(page, timeoutLabel)
    const alert = page.getByRole('alert').filter({ hasText: '视频定位超时' })
    await alert.waitFor({ timeout: 15000 })
    await waitForParsingEnd(page)
    const elapsedMs = await page.evaluate((label) =>
      performance.now() - window.__prerenderUiFaults.get(label).requests[0].at, timeoutLabel)
    assert(elapsedMs >= 9000 && elapsedMs < 16000,
      'The real default decoder wait must end with a bounded timeout, not a shortened test timer')
    const timedOut = await editorState(page)
    assert(!timedOut.parsing && !timedOut.ready && timedOut.error.includes('视频定位超时'))
    const screenshot = await capture(page, 'default-seek-timeout-alert.png', alert)
    const restored = await restoreFault(page, timeoutLabel)
    assert(restored.restored)
    await waitForSettled(page)
    assert((await editorState(page)).error.includes('视频定位超时'), 'Timeout feedback must survive preview restoration')
    report.timeout = { elapsedMs, configuredDefaultMs: 10000, timedOut, restored, screenshot,
      retry: await retryPrerender(page) }
    await invalidateCache(page)
  } finally {
    await restoreFault(page, timeoutLabel)
  }

  const scrubLabel = 'cancel-then-immediate-native-scrub'
  const scrubTarget = 0.35
  try {
    await beginStalledPrerender(page, scrubLabel)
    const immediate = await page.evaluate(({ label, target }) => {
      const fault = window.__prerenderUiFaults.get(label)
      const cancel = [...document.querySelectorAll('.video-controls button')]
        .find((button) => button.textContent.trim() === '取消')
      const seek = document.querySelector('.video-seek')
      if (!cancel || !seek) throw new Error('Cancel/seek controls missing')
      // Stress the race in one turn: execute the actual DOM click handler,
      // restore native positioning, then execute the actual timeline input
      // handler before the aborted old promise can finish its microtasks.
      cancel.click()
      if (fault.original) Object.defineProperty(fault.video, 'currentTime', fault.original)
      else delete fault.video.currentTime
      fault.restored = true
      seek.value = String(target)
      seek.dispatchEvent(new Event('input', { bubbles: true }))
      return { time: fault.video.currentTime, seeking: fault.video.seeking }
    }, { label: scrubLabel, target: scrubTarget })
    assert(Math.abs(immediate.time - scrubTarget) < 0.001)
    await waitForParsingEnd(page)
    await page.waitForFunction((target) => {
      const video = document.querySelector('.video-thumb.show')
      return !video.seeking && Math.abs(video.currentTime - target) < 0.001
    }, scrubTarget, { timeout: 5000 })
    await waitForSettled(page)
    const restored = await restoreFault(page, scrubLabel, true)
    assert(restored.restored)
    await page.waitForTimeout(250)
    await waitForSettled(page)
    const position = await page.locator('.video-thumb.show').evaluate((video) => video.currentTime)
    assert(Math.abs(position - scrubTarget) < 0.001, 'Old resume restoration must not overwrite the user timeline position')
    const state = await editorState(page)
    assert(!state.parsing && !state.ready && state.error === '')
    report.scrub = { method: 'Same-turn real DOM click/input handler stress; native currentTime accessor restored before timeline seek',
      target: scrubTarget, immediate, position, restored, state }
  } finally {
    await restoreFault(page, scrubLabel)
  }

  for (const input of domOnly ? ['resolution'] : ['resolution', 'fps', 'clip']) {
    const label = `invalidate-${input}`
    try {
      await beginStalledPrerender(page, label)
      if (input === 'resolution') {
        await page.getByRole('button', { name: /^标清/ }).click()
      } else if (input === 'fps') {
        assert(await page.getByRole('combobox', { name: '视频帧率', exact: true }).isDisabled())
        // The UI correctly disables this control during parsing. Mutate its
        // reactive model to verify invalidation from other internal callers.
        await page.evaluate(() => { document.querySelector('.art-editor').__vueParentComponent.setupState.videoFps = 15 })
      } else {
        assert(await page.locator('.clip-custom-field input').first().isDisabled())
        await page.evaluate(() => { document.querySelector('.art-editor').__vueParentComponent.setupState.setClipLength(0.6, true) })
      }
      await waitForParsingEnd(page)
      const invalidated = await editorState(page)
      assert(!invalidated.ready && invalidated.done === 0 && invalidated.total === 0)
      assert.equal(invalidated.error, '')
      const recovered = await restoreFault(page, label, true)
      assert(recovered.restored)
      await waitForSettled(page)
      report.invalidationCases.push({ input, method: input === 'resolution' ? 'real UI click' : 'reactive model/handler; UI control remains disabled while parsing', invalidated, recovered,
        retry: await retryPrerender(page), boundMs: 1500 })
      // Ready caches are intentionally invalidated before the next fault case.
      await invalidateCache(page)
    } finally {
      await restoreFault(page, label)
    }
  }

  const leaveLabel = 'cancel-then-leave'
  try {
    await beginStalledPrerender(page, leaveLabel)
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await waitForParsingEnd(page)
    if (!domOnly) await page.evaluate(() => { window.__leftEditorState = document.querySelector('.art-editor').__vueParentComponent.setupState })
    await page.getByRole('link', { name: '← 返回作品', exact: true }).click()
    await page.getByRole('button', { name: '放弃更改并离开', exact: true }).click()
    await page.waitForURL('**/gallery')
    assert.equal(await page.locator('.art-editor').count(), 0)
    const detached = await restoreFault(page, leaveLabel, true)
    assert(detached.restored && !detached.connected && detached.source === null)
    await page.waitForTimeout(250)
    const disposed = domOnly ? null : await page.evaluate(() => ({
      parsing: window.__leftEditorState.videoPrerendering,
      ready: window.__leftEditorState.videoPrerenderReady,
      error: window.__leftEditorState.error,
      loading: window.__leftEditorState.loadingSource,
      total: window.__leftEditorState.videoPrerenderTotal,
    }))
    if (!domOnly) assert.deepEqual(disposed, { parsing: false, ready: false, error: '', loading: false, total: 0 })
    // Preserve the document, router and retained fault instance when returning.
    await page.evaluate(async () => {
      const fault = window.__prerenderUiFaults.get('cancel-then-leave')
      if (!fault) throw new Error('Retained fault lost during same-document navigation')
      // Use the application's router from the mounted root, not a full reload.
      const root = document.querySelector('#app').__vue_app__
      await root.config.globalProperties.$router.push('/ascii-art')
    })
    await page.locator('.art-editor').waitFor()
    const returned = await editorState(page)
    await restoreFault(page, leaveLabel, true)
    await page.waitForTimeout(200)
    assert.deepEqual(await editorState(page), returned)
    assert(!returned.parsing && !returned.ready && !returned.error && !returned.loading)
    report.unmount = { method: 'real cancel and route/discard, retained old slot seeked after unmount and after same-document return', detached, disposed, returned }
  } finally {
    await restoreFault(page, leaveLabel)
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.passed = false
  report.failure = error.stack
  if (activePage && !activePage.isClosed()) {
    report.failureState = await editorState(activePage).catch(() => null)
    report.failureScreenshot = await capture(activePage, 'failure.png').catch(() => null)
  }
  throw error
} finally {
  // Every run receives a fresh directory, including failing baseline runs.
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, report: path.join(out, 'report.json'), passed: report.passed,
    browser: report.browser, stateEvidence: report.stateEvidence,
    cancelCases: report.cancelCases.length,
    maxCancelMs: Math.max(0, ...report.cancelCases.map((test) => test.elapsedMs)),
    invalidationCases: report.invalidationCases.map((test) => test.input),
    replacement: !!report.replacement, supersededTask: !!report.supersededTask,
    timeout: report.timeout?.elapsedMs, scrub: report.scrub?.position,
    unmount: !!report.unmount, pageErrors: report.errors,
    ...(report.failure ? { failure: report.failure } : {}),
  }, null, 2))
  await browser?.close()
}
