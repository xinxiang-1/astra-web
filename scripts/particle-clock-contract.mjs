import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(process.env.ASTRA_CLOCK_OUTPUT || `test-results/particle-clock-${Date.now()}`)
await mkdir(out, { recursive: true })
const instrument = source => source.replace('    return {\n      prepare,\n      reset,\n      destroy,', `    return {
      sampleState(cell: number) { return Array.from(data.slice(cell * 8, cell * 8 + 8)) },
      prepare,
      reset,
      destroy,`).replace('    get cacheStats() {', `    sampleParticleState(cell: number) { return particlePresentation.sampleState(cell) },
    get cacheStats() {`).replace("from './types'", "from '/src/lib/art-engine/types'")
const current = await readFile('src/lib/art-engine/canvas.ts', 'utf8')
await writeFile(path.join(out, 'current.ts'), instrument(current))
await writeFile(path.join(out, 'frozen.ts'), instrument(execFileSync('git', ['show', 'b6eb80c:src/lib/art-engine/canvas.ts'], { encoding: 'utf8' })))
const prefix = '/' + path.relative(process.cwd(), out).split(path.sep).join('/')
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'chrome', headless: true })
const report = { browser: browser.version(), passed: false, scope: 'Algorithm-only alpha-zero fixture and real Worker phase contract; actual page/Canvas quality is checked separately' }
try {
  const page = await browser.newPage()
  await page.goto(base + '/ascii-art')
  report.result = await page.evaluate(async prefix => {
    const { createCanvasArtRenderer: frozen } = await import(prefix + '/frozen.ts')
    const { createCanvasArtRenderer: current } = await import(prefix + '/current.ts')
    const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
    const { createFrameRenderWorker } = await import('/src/lib/art-engine/frame-render-client.ts')
    const source = new Image(); source.src = '/artwork/porcelain-study-v1.png'; await source.decode()
    const frame = prepareArtFrame(source, source.width, source.height, { columns: 24, mode: 'phrase', phrase: '名字成画', colored: true, fontFamily: 'Microsoft YaHei' })
    frame.alpha.fill(0)
    const surface = () => { const c = document.createElement('canvas'); c.getContext('2d', { willReadFrequently: false }); return c }
    const old = frozen(surface()), fine = frozen(surface()), now = current(surface()), compatibility = current(surface())
    const common = { longEdge: 360, hover: 'particles', motion: 'none', hoverStrength: .65, hoverRadius: .38 }
    const snapshot = renderer => Array.from({ length: frame.columns * frame.rows }, (_, i) => renderer.sampleParticleState(i)).flat()
    const difference = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
    let clock = 0, pointer = { x: .15, y: .5, strength: .65, active: false }, resolve, reject
    const renderOptions = (time, samples = [], value = pointer) => ({ ...common, hoverTime: time, pointer: value, pointerSamples: samples })
    const render = (renderer, time, samples = [], value = pointer) => renderer.render(frame, renderOptions(time, samples, value))
    const observed = []
    const worker = createFrameRenderWorker(result => resolve(result.cacheStats.particles), () => reject(new Error('Particle clock Worker failed')),
      (value, _frame, _options, phase) => observed.push({ value, phase }))
    if (!worker) throw new Error('Worker unavailable')
    const renderWorker = options => new Promise((r, j) => { resolve = r; reject = j; worker.render(frame, options) })
    const cases = []
    try {
      for (const r of [old, fine, now, compatibility]) render(r, 0)
      await renderWorker(renderOptions(0))
      let fastMax = 0
      for (let i = 0; i < 30; i++) {
        clock = (i + 1) / 60
        pointer = { ...pointer, x: .15 + .7 * i / 29, y: .5 + Math.sin(i / 29 * Math.PI * 2) * .16, active: true }
        const events = [{ ...pointer, time: clock * 1000 }]
        for (const r of [old, fine, now, compatibility]) render(r, clock, events)
        await renderWorker(renderOptions(clock, events))
        fastMax = Math.max(fastMax, difference(snapshot(old), snapshot(now)))
      }
      cases.push({ kind: 'fast-frozen', maxStateDelta: fastMax })
      pointer = { ...pointer, active: false }
      const release = [{ ...pointer, time: clock * 1000 }]
      for (const r of [old, fine, now, compatibility]) render(r, clock, release)
      await renderWorker(renderOptions(clock, release))
      for (const gap of [1, 2, 5]) {
        const end = clock + gap; let t = clock
        while (end - t > 1e-8) { t += Math.min(.05, end - t); render(fine, t) }
        render(now, end); render(old, end)
        const phases = [], timers = [], slices = []
        let previous = performance.now(), lastProgress = previous, heartbeatCount = 0
        const timer = setInterval(() => { const next = performance.now(); timers.push(next - previous); previous = next }, 20)
        try {
          await compatibility.renderResponsive(frame, renderOptions(end), undefined, undefined, progress => {
            const next = performance.now(); slices.push(next - lastProgress); lastProgress = next
            phases.push(progress)
            // Each advertised yield must actually run queued work before continuing.
            setTimeout(() => heartbeatCount++, 0)
          })
          slices.push(performance.now() - lastProgress)
        }
        finally { clearInterval(timer) }
        const workerStats = await renderWorker(renderOptions(end))
        cases.push({ kind: 'released-gap', gap,
          maxStateDelta: difference(snapshot(fine), snapshot(now)), responsiveStateDelta: difference(snapshot(now), snapshot(compatibility)),
          oldPeak: old.cacheStats.particles.peak, newPeak: now.cacheStats.particles.peak, finePeak: fine.cacheStats.particles.peak,
          workerPeakDelta: Math.abs(workerStats.peak - now.cacheStats.particles.peak), active: now.interactionActive,
          phaseMessages: phases.length, heartbeatCount, maxProgressSliceMs: Math.max(...slices),
          completedSteps: phases.at(-1)?.completedSteps, timerCount: timers.length, timerMax: Math.max(...timers),
        })
        clock = end
      }
      const events = [
        { x: .2, y: .45, active: true, time: (clock + .2) * 1000 },
        { x: .4, y: .6, active: true, time: (clock + .4) * 1000 },
        { x: .7, y: .5, active: true, time: (clock + .55) * 1000 },
        { x: .7, y: .5, active: false, time: (clock + .6) * 1000 },
      ]
      const end = clock + .8; let t = clock
      for (const event of events) {
        while (event.time / 1000 - t > 1e-8) { t += Math.min(.05, event.time / 1000 - t); render(fine, t) }
        pointer = { ...pointer, ...event }; render(fine, t, [event])
      }
      while (end - t > 1e-8) { t += Math.min(.05, end - t); render(fine, t) }
      render(now, end, events, pointer)
      cases.push({ kind: 'timestamp-replay', maxStateDelta: difference(snapshot(fine), snapshot(now)), newPeak: now.cacheStats.particles.peak })
      let abort = false, cancelled = false, fired = false
      const cancelTimer = setTimeout(() => { fired = abort = true }, 0)
      try { await now.renderResponsive(frame, renderOptions(end + 10), undefined, () => abort) }
      catch (error) { cancelled = error.name === 'AbortError' }
      finally { clearTimeout(cancelTimer) }
      const cancel = { cancelled, timerFiredDuringSimulation: fired }
      now.destroy()
      const bounded = current(surface()), start = performance.now()
      render(bounded, 0); render(bounded, Number.MAX_SAFE_INTEGER)
      const extreme = { durationMs: performance.now() - start, finite: snapshot(bounded).every(Number.isFinite) }; bounded.destroy()
      return { cases, cancel, extreme, workerObservedPhases: [...new Set(observed.map(p => p.phase))] }
    } finally { worker.dispose(); for (const r of [old, fine, now, compatibility]) r.destroy() }
  }, prefix)
  assert.equal(report.result.cases[0].maxStateDelta, 0)
  assert(report.result.cases.every(c => c.maxStateDelta < 1e-5))
  assert(report.result.cases.filter(c => c.kind === 'released-gap').every(c => c.responsiveStateDelta === 0 && c.workerPeakDelta === 0 && c.phaseMessages > 0 && c.heartbeatCount === c.phaseMessages && c.maxProgressSliceMs < 200 && c.timerCount > 0 && c.timerMax < 200))
  assert.equal(report.result.cases[3].active, false)
  assert(report.result.cases.at(-1).newPeak > .005)
  assert(report.result.cancel.cancelled && report.result.cancel.timerFiredDuringSimulation)
  assert(report.result.extreme.finite && report.result.extreme.durationMs < 1000)
  assert(report.result.workerObservedPhases.includes('interaction'))
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally {
  report.sourceHashes = Object.fromEntries(await Promise.all(['src/lib/art-engine/canvas.ts', 'src/lib/art-engine/frame-render-client.ts', 'src/lib/art-engine/frame-render.worker.ts', 'src/lib/art-engine/embed.ts', 'src/views/AsciiArtView.vue'].map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])))
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close()
}
console.log(JSON.stringify({ out, ...report }))
