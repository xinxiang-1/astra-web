import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(process.env.ASTRA_PARTICLES_OUTPUT || `test-results/particles-boundaries-${Date.now()}`)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const report = { browser: browser.version(), errors: [], passed: false }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' })
  page.on('pageerror', e => report.errors.push(e.message))
  page.on('console', m => { if (m.text().startsWith('particles-boundaries:')) console.log(m.text()) })
  await page.goto(base + '/ascii-art')
  if (process.env.ASTRA_PARTICLES_CAPACITY_ONLY !== '1') report.worker = await page.evaluate(async () => {
    const { createCanvasArtRenderer, prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
    const { createFrameRenderWorker } = await import('/src/lib/art-engine/frame-render-client.ts')
    const require = (value, message) => { if (!value) throw new Error(message) }
    const pixels = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
    const source = new Image(); source.src = '/artwork/porcelain-study-v1.png'; await source.decode()
    const cases = []
    for (const mode of ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']) {
      for (const transparent of [false, true]) {
        const frame = prepareArtFrame(source, source.width, source.height, {
          mode, columns: 48, phrase: '把名字写成光，ASTRA。', colored: mode === 'color' || mode === 'phrase',
          fontFamily: mode === 'phrase' ? 'Microsoft YaHei, monospace' : 'Consolas, monospace',
        })
        const reference = document.createElement('canvas'), output = document.createElement('canvas')
        reference.getContext('2d', { willReadFrequently: false })
        output.getContext('2d', { willReadFrequently: false })
        const renderer = createCanvasArtRenderer(reference)
        let resolve, reject
        const worker = createFrameRenderWorker(result => {
          output.width = result.bitmap.width; output.height = result.bitmap.height
          output.getContext('2d').drawImage(result.bitmap, 0, 0)
          resolve(result.interactionActive)
        }, () => reject(new Error('Particle Worker failed')))
        require(worker, 'Worker unavailable')
        const common = { longEdge: 400, transparent, motion: 'none', hover: 'particles', hoverStrength: .65, hoverRadius: .38 }
        let time = 0, matched = 0, peak = 0
        const render = async options => {
          // The Worker receives new frame objects on every message, including during the residual wake.
          renderer.render({ ...frame }, options)
          const active = await new Promise((r, j) => { resolve = r; reject = j; worker.render({ ...frame }, options) })
          require(same(pixels(reference), pixels(output)), `${mode}/${transparent} Worker RGBA frame ${matched}`)
          require(active === renderer.interactionActive, `${mode} Worker residual activity`)
          matched++
        }
        try {
          await render({ ...common, hoverTime: 0 })
          const baseline = pixels(reference)
          let pointer
          for (let i = 0; i < 24; i++) {
            time = (i + 1) / 60
            pointer = { x: .15 + .7 * i / 23, y: .5 + Math.sin(i / 23 * Math.PI * 2) * .16, strength: .65, active: true }
            await render({ ...common, hoverTime: time, pointer, pointerSamples: [{ ...pointer, time: time * 1000 }] })
            peak = Math.max(peak, renderer.cacheStats.particles.peak)
          }
          require(peak > .005, mode + ' visible scatter')
          pointer = { ...pointer, active: false }
          time += .1
          await render({ ...common, hoverTime: time, pointer, pointerSamples: [{ ...pointer, time: time * 1000 }] })
          let steps = 0
          while (renderer.interactionActive && steps++ < 100) {
            time += .1
            await render({ ...common, hoverTime: time, pointer, pointerSamples: [] })
          }
          require(steps <= 100 && !renderer.interactionActive, mode + ' Worker settles')
          require(same(baseline, pixels(output)), mode + ' Worker exact return')
          cases.push({ mode, transparent, matchedFrames: matched, peak, settleSeconds: steps * .1, exactRecovery: true })
        } finally { worker.dispose(); renderer.destroy() }
      }
      console.log('particles-boundaries: ' + mode + ' Worker transparency and recovery passed')
    }
    return cases
  })
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('public/artwork/porcelain-study-v1.png'))
  await page.waitForFunction(() => document.querySelector('.ascii-scroll .ascii-canvas')?.width > 100 && !document.querySelector('.editor-package')?.disabled)
  await page.locator('details.calibrated-effects').evaluate(d => { d.open = true })
  await page.getByRole('group', { name: '六模式悬停', exact: true }).getByRole('button', { name: '字符聚散试用', exact: true }).click()
  const html = await page.evaluate(async () => {
    const { artworkEmbedPage } = await import('/src/lib/art-engine/embed.ts')
    const state = document.querySelector('.art-editor').__vueParentComponent.setupState
    const original = state.artFrame
    const large = { ...original, columns: 512, rows: 512, width: 512, height: 512, cellWidth: 1, cellHeight: 1,
      indices: new Uint16Array(512 * 512), alpha: new Float32Array(512 * 512), colors: new Uint8ClampedArray(512 * 512 * 3) }
    state.artFrame = large
    return artworkEmbedPage(large, { title: '容量边界验证', motion: 'none', hover: 'particles', hoverStrength: .65, transparent: false })
  })
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.ascii-scroll .ascii-canvas')
    const state = document.querySelector('.art-editor').__vueParentComponent.setupState
    const renderer = state.artRenderers.get(canvas)
    return canvas && renderer && !renderer.pending && renderer.cacheStats?.particles.unavailable
  })
  report.editorCapacity = await page.locator('.ascii-scroll .ascii-canvas').evaluate(c => ({
    touchAction: getComputedStyle(c).touchAction,
    ...document.querySelector('.art-editor').__vueParentComponent.setupState.artRenderers.get(c).cacheStats.particles,
  }))
  assert.equal(report.editorCapacity.touchAction, 'auto'); assert.equal(report.editorCapacity.bytes, 0)
  await page.locator('.ascii-scroll .ascii-canvas').evaluate(c => {
    const r = document.querySelector('.art-editor').__vueParentComponent.setupState.artRenderers.get(c)
    const draw = r.render; window.__capacityDraws = 0
    r.render = function (...args) { window.__capacityDraws++; return draw.apply(r, args) }
  })
  const box = await page.locator('.ascii-scroll .ascii-canvas').boundingBox()
  for (let i = 0; i < 10; i++) await page.mouse.move(box.x + box.width * (.2 + i * .05), box.y + box.height * .5)
  await page.waitForTimeout(250)
  report.editorCapacity.pointerDraws = await page.evaluate(() => window.__capacityDraws)
  assert.equal(report.editorCapacity.pointerDraws, 0, 'Over-capacity pointer must not redraw a static work')
  await page.getByText('当前作品字符数量超过聚散容量，聚散未启用。可选择较低清晰度体验交互。', { exact: true }).waitFor()
  const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  const requests = []
  await offlineContext.route('**/*', route => { requests.push(route.request().url()); return route.abort() })
  const offline = await offlineContext.newPage()
  offline.on('pageerror', e => report.errors.push(e.message))
  await offline.setContent(html)
  await offline.waitForFunction(() => document.querySelector('canvas')?.dataset.ready === 'true')
  report.offlineCapacity = await offline.evaluate(() => ({ status: document.querySelector('#art-status').textContent, touchAction: getComputedStyle(document.querySelector('canvas')).touchAction }))
  assert.match(report.offlineCapacity.status, /聚散未启用/); assert.equal(report.offlineCapacity.touchAction, 'auto')
  await offline.evaluate(() => {
    const ctx = document.querySelector('canvas').getContext('2d'), clear = ctx.clearRect
    window.__capacityDraws = 0
    ctx.clearRect = function (...args) { window.__capacityDraws++; return clear.apply(ctx, args) }
  })
  const offlineBox = await offline.locator('canvas').boundingBox()
  for (let i = 0; i < 10; i++) await offline.mouse.move(offlineBox.x + offlineBox.width * (.2 + i * .05), offlineBox.y + offlineBox.height * .5)
  await offline.waitForTimeout(250)
  report.offlineCapacity.pointerDraws = await offline.evaluate(() => window.__capacityDraws)
  assert.equal(report.offlineCapacity.pointerDraws, 0, 'Offline capacity refusal must not redraw on pointer')
  assert.equal(requests.length, 0)
  await offlineContext.close()
  assert.deepEqual(report.errors, []); report.passed = true
} catch (error) { report.failure = error.stack }
finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  console.log(JSON.stringify({ out, ...report }, null, 2))
}
if (!report.passed) process.exitCode = 1
