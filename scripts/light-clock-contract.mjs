import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
const out = path.resolve(process.env.ASTRA_CLOCK_OUTPUT || `test-results/light-clock-${Date.now()}`)
await mkdir(out, { recursive: true })
const instrument = source => source.replaceAll('\r\n', '\n').replace("from './types'", "from '/src/lib/art-engine/types'").replace('    get interactionActive() {', `    sampleLightState() { return [interaction?.lensX ?? 0, interaction?.lensY ?? 0, interaction?.lensStrength ?? 0, interaction?.energy ?? 0] },
    get interactionActive() {`)
await writeFile(path.join(out, 'frozen.ts'), instrument(execFileSync('git', ['show', '59790af:src/lib/art-engine/canvas.ts'], { encoding: 'utf8' })))
await writeFile(path.join(out, 'current.ts'), instrument(await readFile('src/lib/art-engine/canvas.ts', 'utf8')))
const prefix = '/' + path.relative(process.cwd(), out).split(path.sep).join('/')
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'chrome', headless: true })
const report = { browser: browser.version(), passed: false, scope: 'Algorithm-only alpha-zero/coverage-zero fixture; exact native lens state and real Worker activity, not image quality or FPS' }
try {
  const page = await browser.newPage()
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/ascii-art')
  report.result = await page.evaluate(async prefix => {
    const { createCanvasArtRenderer: frozen } = await import(prefix + '/frozen.ts')
    const { createCanvasArtRenderer: current } = await import(prefix + '/current.ts')
    const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
    const { createFrameRenderWorker } = await import('/src/lib/art-engine/frame-render-client.ts')
    const source = new Image(); source.src = '/artwork/porcelain-study-v1.png'; await source.decode()
    const frame = prepareArtFrame(source, source.width, source.height, { columns: 24, mode: 'color' })
    frame.alpha.fill(0); frame.glyphs = frame.glyphs.map(g => ({ ...g, coverage: 0 }))
    const surface = () => { const c = document.createElement('canvas'); c.getContext('2d', { willReadFrequently: false }); return c }
    const old = frozen(surface()), fine = frozen(surface()), now = current(surface()), responsive = current(surface())
    const common = { hover: 'light', hoverStrength: .65, hoverRadius: .38, motion: 'none', effectProfile: 'expressive', longEdge: 360 }
    let pointer = { x: .15, y: .5, strength: .65, active: false }, resolve, reject
    const options = (time, samples = []) => ({ ...common, hoverTime: time, pointer: { ...pointer }, pointerSamples: samples })
    const render = (renderer, time, samples = []) => renderer.render(frame, options(time, samples))
    const delta = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
    const worker = createFrameRenderWorker(result => resolve(result.cacheStats.interactionActive), () => reject(new Error('Light Worker failed')))
    if (!worker) throw new Error('Worker unavailable')
    const send = (time, samples = []) => new Promise((r, j) => { resolve = r; reject = j; worker.render(frame, options(time, samples)) })
    try {
      for (const r of [old, fine, now, responsive]) render(r, 0)
      await send(0)
      let shortDelta = 0, time = 0, workerActiveFrames = 0, workerActivityMatches = true
      for (let i = 1; i <= 30; i++) {
        time = i / 60; pointer = { ...pointer, x: .15 + .7 * i / 30, y: .5 + Math.sin(i / 30 * Math.PI * 2) * .14, active: true }
        const samples = [{ ...pointer, time: time * 1000 }]
        for (const r of [old, fine, now, responsive]) render(r, time, samples)
        shortDelta = Math.max(shortDelta, delta(old.sampleLightState(), now.sampleLightState()))
        const workerActive = await send(time, samples)
        workerActiveFrames += Number(workerActive)
        workerActivityMatches &&= workerActive === now.interactionActive
      }
      pointer = { ...pointer, active: false }
      const release = [{ ...pointer, time: time * 1000 }]
      for (const r of [old, fine, now, responsive]) render(r, time, release)
      const workerActiveOnRelease = await send(time, release)
      const cases = []
      for (const gap of [1, 2, 5]) {
        const end = time + gap; let clock = time
        while (end - clock > 1e-8) { clock += Math.min(.05, end - clock); render(fine, clock) }
        render(old, end); render(now, end)
        await responsive.renderResponsive(frame, options(end))
        const workerActive = await send(end)
        cases.push({ gap, maxStateDelta: delta(fine.sampleLightState(), now.sampleLightState()),
          responsiveDelta: delta(now.sampleLightState(), responsive.sampleLightState()),
          active: now.interactionActive, workerActive, oldStrength: old.sampleLightState()[2], newStrength: now.sampleLightState()[2] })
        time = end
      }
      const events = [
        { x: .3, y: .4, active: true, time: (time + 1.6) * 1000 },
        { x: .7, y: .55, active: true, time: (time + 1.75) * 1000 },
        { x: .7, y: .55, active: false, time: (time + 1.8) * 1000 },
      ]
      const end = time + 2; let clock = time
      for (const event of events) {
        while (event.time / 1000 - clock > 1e-8) { clock += Math.min(.05, event.time / 1000 - clock); render(fine, clock) }
        pointer = { ...pointer, ...event }; render(fine, clock, [event])
      }
      while (end - clock > 1e-8) { clock += Math.min(.05, end - clock); render(fine, clock) }
      render(now, end, events)
      const workerReplayActive = await send(end, events)
      const replay = { maxStateDelta: delta(fine.sampleLightState(), now.sampleLightState()), strength: now.sampleLightState()[2], active: now.interactionActive, workerActive: workerReplayActive }
      return { shortDelta, workerActiveFrames, workerActivityMatches, workerActiveOnRelease, cases, replay }
    } finally { worker.dispose(); for (const r of [old, fine, now, responsive]) r.destroy() }
  }, prefix)
  assert.equal(report.result.shortDelta, 0)
  assert.equal(report.result.workerActiveFrames, 30, 'Real Worker must receive and activate for each moving input frame')
  assert.equal(report.result.workerActivityMatches, true)
  assert.equal(report.result.workerActiveOnRelease, true, 'Worker must retain a real light field before long-gap decay')
  assert(report.result.cases.every(c => c.maxStateDelta < 1e-6 && c.responsiveDelta === 0 && c.active === c.workerActive && !c.active && c.newStrength === 0))
  assert(report.result.replay.maxStateDelta < 1e-6 && report.result.replay.strength > .005)
  assert.equal(report.result.replay.active, report.result.replay.workerActive)
  const html = await page.evaluate(async () => {
    const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
    const { artworkEmbedPage } = await import('/src/lib/art-engine/embed.ts')
    const image = new Image(); image.src = '/artwork/porcelain-study-v1.png'; await image.decode()
    const frame = prepareArtFrame(image, image.width, image.height, { columns: 48, mode: 'color' })
    return artworkEmbedPage(frame, { title: 'Light clock contract', hover: 'light', motion: 'none', transparent: false, effectProfile: 'expressive', hoverStrength: .65, hoverRadius: .38 })
  })
  await writeFile(path.join(out, 'light-offline.html'), html)
  const offline = await browser.newPage({ viewport: { width: 640, height: 640 } }), network = [], errors = []
  await offline.route('**/*', route => { network.push(route.request().url()); return route.abort() })
  offline.on('pageerror', error => errors.push(error.message))
  // Deliberately sparse scheduling exercises the serialized long-gap runtime;
  // real glyph pixels remain untouched. This is not a throughput measurement.
  await offline.evaluate(() => {
    const raf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = fn => raf(() => setTimeout(() => fn(performance.now()), 600))
  })
  await offline.setContent(html, { waitUntil: 'load' })
  await offline.waitForFunction(() => document.querySelector('canvas')?.dataset.ready === 'true')
  const canvas = offline.locator('canvas'), baseline = await canvas.evaluate(c => c.toDataURL()), box = await canvas.boundingBox()
  await offline.mouse.move(box.x + box.width * .5, box.y + box.height * .5)
  await offline.waitForFunction(baseline => document.querySelector('canvas').toDataURL() !== baseline, baseline, { timeout: 60000 })
  await offline.mouse.move(0, 0)
  await offline.waitForFunction(baseline => document.querySelector('canvas').toDataURL() === baseline, baseline, { timeout: 60000 })
  assert.deepEqual(errors, []); assert.equal(network.length, 0)
  report.offline = { columns: 48, realGlyphPixels: true, visibleLight: true, exactRecovery: true, networkRequests: 0, delayedSchedulingMs: 600 }
  await offline.close()
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally {
  report.sourceHashes = Object.fromEntries(await Promise.all(['src/lib/art-engine/canvas.ts', 'src/lib/art-engine/frame-render-client.ts', 'src/views/AsciiArtView.vue', 'src/lib/art-engine/embed.ts'].map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close()
}
console.log(JSON.stringify(report))
