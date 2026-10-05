import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_FEEDBACK_OUTPUT || `test-results/video-feedback-${Date.now()}`)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'chrome', headless: true })
const report = { browser: browser.version(), cases: [], passed: false, scope: 'Real local video and pixels with completed Worker delivery delayed 600ms; synthetic buffering events, not real network-stall evidence' }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => {
    const Native = window.Worker
    window.__videoCompleted = 0
    window.Worker = class extends Native {
      constructor(url, options) {
        super(url, options)
        if (!String(url).includes('frame-render.worker')) return
        this.addEventListener('message', event => {
          if (!event.data?.bitmap) return
          event.stopImmediatePropagation()
          setTimeout(() => { this.onmessage?.(event); window.__videoCompleted++ }, 600)
        })
      }
    }
  })
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/ascii-art')
  await page.getByRole('button', { name: /^低清/ }).click()
  let fixture = path.resolve(process.env.ASTRA_VIDEO_FIXTURE || 'test-results/editor-contract-source.mp4'), generated = false
  try {
    if (process.env.ASTRA_FEEDBACK_NATIVE_FIXTURE === '1') throw new Error('Exercise the portable native fixture')
    await access(fixture)
  } catch (error) {
    if (process.env.ASTRA_VIDEO_FIXTURE) throw error
    // A fresh checkout can run this contract without an untracked FFmpeg fixture.
    fixture = path.join(out, 'source.webm'); generated = true
    const bytes = await page.evaluate(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.fillStyle = '#193947'; ctx.fillRect(0, 0, 640, 360)
      const stream = canvas.captureStream(0), track = stream.getVideoTracks()[0], chunks = []
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
      const done = new Promise(resolve => recorder.onstop = async () => resolve(Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()))))
      recorder.ondataavailable = event => chunks.push(event.data)
      const started = new Promise(resolve => recorder.onstart = resolve)
      recorder.start(); await started
      for (let i = 0; i < 150; i++) {
        ctx.fillStyle = '#193947'; ctx.fillRect(0, 0, 640, 360)
        ctx.fillStyle = '#efbd87'; ctx.fillRect(80 + (i % 60) * 8, 70, 180, 180)
        track.requestFrame()
        await new Promise(resolve => setTimeout(resolve, 40))
      }
      recorder.stop(); const result = await done; stream.getTracks().forEach(track => track.stop()); return result
    })
    assert(bytes.length > 1024, 'Native fixture must contain encoded video frames')
    await writeFile(fixture, Buffer.from(bytes))
  }
  report.source = { file: path.basename(fixture), generated, sha256: createHash('sha256').update(await readFile(fixture)).digest('hex') }
  await page.locator('input[type=file]').first().setInputFiles(fixture)
  await page.waitForFunction(() => document.querySelector('.ascii-canvas')?.dataset.renderBackend === 'worker')
  if (await page.getByRole('button', { name: '暂停', exact: true }).count()) await page.getByRole('button', { name: '暂停', exact: true }).click()
  const geometry = () => page.locator('.ascii-scroll').first().evaluate(el => [el.clientWidth, el.clientHeight])
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
    for (let i = 0; i < 2; i++) {
      await page.waitForFunction(() => {
        const c = document.querySelector('.ascii-scroll .ascii-canvas')
        return c?.dataset.renderPending === 'false' && c.dataset.renderBackend === 'worker'
      })
      const before = await geometry(), theme = await page.locator('html').getAttribute('data-theme')
      await page.locator('.video-thumb.show').evaluate(v => v.dispatchEvent(new Event('waiting')))
      const feedback = page.getByRole('status').filter({ hasText: '正在等待视频画面' })
      await feedback.waitFor()
      assert.deepEqual(await geometry(), before, 'Visible feedback must not resize the artwork')
      assert.equal(await feedback.evaluate(el => getComputedStyle(el).pointerEvents), 'none', 'Feedback must leave canvas input available')
      assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)), 'No horizontal overflow')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(await feedback.locator('.render-spinner').evaluate(el => getComputedStyle(el).animationName), 'none')
      await page.screenshot({ path: path.join(out, `feedback-${width}-${theme}.png`) })
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.locator('.video-thumb.show').evaluate(v => v.dispatchEvent(new Event('canplay')))
      await feedback.waitFor({ state: 'hidden' })
      assert.deepEqual(await geometry(), before, 'Hiding feedback must not resize the artwork')
      report.cases.push({ width, theme, geometry: before, visibleAndHiddenStable: true, inputAvailable: true, reducedMotion: true })
      await page.getByRole('button', { name: /切换到/ }).click()
    }
  }
  assert.equal(report.cases.length, 4)
  await page.locator('input.video-seek').evaluate(input => { input.value = '0'; input.dispatchEvent(new Event('input', { bubbles: true })) })
  await page.waitForFunction(() => {
    const video = document.querySelector('.video-thumb.show'), c = document.querySelector('.ascii-scroll .ascii-canvas')
    return video?.currentTime < .01 && !video.seeking && c?.dataset.renderPending === 'false' && !document.querySelector('.stage-feedback')
  })
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await page.waitForFunction(() => {
    const video = document.querySelector('.video-thumb.show')
    return !document.querySelector('.stage-feedback') && !video?.paused && video.currentTime > .15
  })
  const playback = await page.evaluate(async () => {
    const video = document.querySelector('.video-thumb.show'), start = video.currentTime, before = window.__videoCompleted
    let loadingSamples = 0, generationSamples = 0, bufferingSamples = 0, mediaSamples = 0
    const loading = []
    const timer = setInterval(() => {
      const feedback = document.querySelector('.stage-feedback')
      if (feedback) {
        loadingSamples++
        if (feedback.textContent.includes('正在等待视频画面')) bufferingSamples++
        else generationSamples++
        loading.push({ message: feedback.textContent, time: video.currentTime, paused: video.paused, ended: video.ended })
      }
      if (video.currentTime !== start && !video.paused) mediaSamples++
    }, 20)
    await new Promise(resolve => setTimeout(resolve, 4000)); clearInterval(timer)
    return { start, duration: video.duration, ended: video.ended, paused: video.paused, completedFrames: window.__videoCompleted - before, loadingSamples, generationSamples, bufferingSamples, mediaSamples, loading }
  })
  report.playback = playback
  assert(!playback.ended && !playback.paused, 'Continuous-frame monitoring must stay inside playback, before the end of the fixture')
  assert(playback.completedFrames > 0 && playback.mediaSamples > 0, 'Real local video and background frames continue')
  assert.equal(playback.generationSamples, 0, 'Continuous video frames must not repeat generation feedback; real media buffering remains visible')
  report.cases.push({ name: 'continuous-video-no-repeated-generation', ...playback, completedDeliveryDelayMs: 600 })
  report.passed = true
} catch (error) {
  report.failure = error.stack; process.exitCode = 1
  const failedPage = browser.contexts()[0]?.pages()[0]
  report.failureState = await failedPage?.evaluate(() => ({
    messages: [...document.querySelectorAll('.status,.error')].map(el => el.textContent),
    canvas: { ...document.querySelector('.ascii-canvas')?.dataset },
    video: [...document.querySelectorAll('video')].map(v => ({ duration: v.duration, readyState: v.readyState, width: v.videoWidth, error: v.error?.message })),
  })).catch(() => null)
}
finally { await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify(report))
