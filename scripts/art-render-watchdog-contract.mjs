import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_WATCHDOG_OUTPUT || `test-results/render-watchdog-${Date.now()}`)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'chrome', headless: true })
const report = { browser: browser.version(), passed: false }
try {
  const page = await browser.newPage()
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/ascii-art')
  report.cases = await page.evaluate(async () => {
    const { createFrameRenderWorker } = await import('/src/lib/art-engine/frame-render-client.ts')
    const originals = { Worker, setTimeout, clearTimeout }
    let now = 0, timerId = 0, lastWorker
    const timers = new Map(), cases = []
    const require = (v, message) => { if (!v) throw new Error(message) }
    // Only the client under test runs inside this virtual clock. No real browser
    // rendering or playback timings are inferred from these fault injections.
    window.setTimeout = (fn, delay) => { const id = ++timerId; timers.set(id, { fn, due: now + delay }); return id }
    window.clearTimeout = id => timers.delete(id)
    window.Worker = class {
      requests = []; terminated = false
      constructor() { lastWorker = this }
      postMessage(request) { this.requests.push(request) }
      terminate() { this.terminated = true }
      emit(message) { this.onmessage({ data: message }) }
    }
    const tick = delta => {
      now += delta
      for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.fn() }
    }
    const frame = { columns: 10, rows: 10, glyphs: [] }
    const make = (onProgress, options = {}) => {
      let errors = 0, presents = 0
      const client = createFrameRenderWorker(() => presents++, () => errors++, onProgress)
      require(client, 'Worker support is required')
      client.render(frame, options)
      return { client, worker: lastWorker, errors: () => errors, presents: () => presents }
    }
    const progress = (state, completedCells, overrides = {}) => state.worker.emit({ id: state.worker.requests.at(-1).id, completedCells, totalCells: 100, ...overrides })
    try {
      const observed = [], healthy = make(value => observed.push(value))
      tick(10000); progress(healthy, 30); tick(10000); progress(healthy, 70); tick(10000)
      require(healthy.errors() === 0 && healthy.client.pending, 'A frame with advancing progress survives more than 12 seconds')
      let closed = 0
      healthy.worker.emit({ id: 1, bitmap: { close() { closed++ } }, renderMs: 30000, interactionActive: false })
      require(healthy.presents() === 1 && closed === 1 && !healthy.client.pending, 'Only the completed bitmap is presented and closed')
      require(observed.length === 2 && observed[0] === .3 && observed[1] === .7, 'Progress reaches the caller')
      healthy.client.dispose()
      cases.push({ name: 'advancing-frame', virtualElapsedMs: 30000, progress: observed, completedBitmaps: 1, closedBitmaps: closed })

      const stalled = make(); tick(12000)
      require(stalled.errors() === 1 && stalled.worker.terminated, 'A silent worker still fails at 12 seconds')
      cases.push({ name: 'silent-worker', failsAfterVirtualMs: 12000, terminated: true })

      const duplicate = make(); tick(10000); progress(duplicate, 30); tick(10000); progress(duplicate, 30); tick(2000)
      require(duplicate.errors() === 1, 'Repeated progress cannot keep a hung frame alive')
      cases.push({ name: 'repeated-progress', rejected: true })

      for (const [name, overrides] of [
        ['stale-task', { id: 0 }], ['wrong-capacity', { totalCells: 200 }],
        ['invalid-number', { completedCells: NaN }], ['beyond-frame', { completedCells: 101 }],
      ]) {
        const invalid = make(); tick(10000); progress(invalid, 40, overrides); tick(2000)
        require(invalid.errors() === 1, name + ' must not reset the watchdog')
        cases.push({ name, rejected: true })
      }
      const callbackFailure = make(() => { throw new Error('Intentional progress consumer error') })
      progress(callbackFailure, 20)
      require(callbackFailure.errors() === 1 && callbackFailure.worker.terminated, 'A throwing progress consumer releases its worker')
      cases.push({ name: 'progress-consumer-error', terminated: true })

      const disposed = make(); disposed.client.dispose(); tick(20000); progress(disposed, 50)
      require(disposed.errors() === 0 && disposed.presents() === 0 && disposed.worker.terminated, 'Disposed work cannot be revived')
      cases.push({ name: 'disposed-task', ignoredLateProgress: true })

      const particleOptions = { hover: 'particles', hoverTime: 0, hoverStrength: .65, pointer: { x: .5, y: .5, strength: 0, active: false } }
      const makeParticle = (onProgress, options = particleOptions) => {
        const state = make(onProgress, options)
        state.worker.emit({ id: 1, bitmap: { close() {} }, renderMs: 1, interactionActive: false })
        state.client.render(frame, { ...options, hoverTime: 3 })
        return state
      }
      const phaseProgress = (state, completedSeconds, completedSteps, overrides = {}) => state.worker.emit({
        id: state.worker.requests.at(-1).id, phase: 'interaction', completedSeconds, completedSteps, totalSeconds: 3, ...overrides,
      })
      const phases = [], particle = makeParticle((value, _frame, _options, phase) => phases.push({ value, phase }))
      tick(10000); phaseProgress(particle, .5, 10); tick(10000); phaseProgress(particle, 1.5, 30); tick(10000)
      require(particle.errors() === 0 && particle.client.pending && phases.length === 2 && phases.every(p => p.phase === 'interaction'), 'Bounded advancing simulation survives a long frame and reports its own phase')
      particle.client.dispose(); cases.push({ name: 'advancing-interaction', virtualElapsedMs: 30000, phases })
      const lightPhases = [], light = makeParticle((value, _frame, _options, phase) => lightPhases.push({ value, phase }), { ...particleOptions, hover: 'light', effectProfile: 'expressive' })
      tick(10000); phaseProgress(light, .5, 10); tick(10000); phaseProgress(light, 1.5, 30); tick(10000)
      require(light.errors() === 0 && light.client.pending && lightPhases.length === 2 && lightPhases.every(p => p.phase === 'interaction'), 'Expressive light accepts advancing real-clock progress')
      light.client.dispose(); cases.push({ name: 'advancing-light-interaction', virtualElapsedMs: 30000, phases: lightPhases })
      const classicLight = makeParticle(undefined, { ...particleOptions, hover: 'light', effectProfile: 'classic', motionStyle: 'studio', motion: 'none' })
      tick(10000); phaseProgress(classicLight, .5, 10); tick(2000)
      require(classicLight.errors() === 1, 'Classic light has no native interaction clock and cannot claim simulation progress')
      cases.push({ name: 'classic-light-fake-interaction', rejected: true })
      for (const [name, overrides] of [
        ['interaction-stale-task', { id: 1 }], ['interaction-wrong-duration', { totalSeconds: 4 }],
        ['interaction-fractional-step', { completedSteps: 1.5 }], ['interaction-invalid-seconds', { completedSeconds: NaN }],
        ['interaction-excess-steps', { completedSteps: 317 }], ['interaction-beyond-duration', { completedSeconds: 4 }],
      ]) {
        const invalid = makeParticle(); tick(10000); phaseProgress(invalid, .5, 10, overrides); tick(2000)
        require(invalid.errors() === 1, name + ' must not reset the watchdog')
        cases.push({ name, rejected: true })
      }
      const firstPhase = make(undefined, particleOptions); tick(10000); phaseProgress(firstPhase, .5, 10); tick(2000)
      require(firstPhase.errors() === 1, 'First request cannot claim a previous interval')
      cases.push({ name: 'interaction-first-request', rejected: true })
      for (const [name, seconds, steps] of [['interaction-repeated-seconds', .5, 11], ['interaction-repeated-steps', .6, 10]]) {
        const repeated = makeParticle(); tick(10000); phaseProgress(repeated, .5, 10); tick(10000); phaseProgress(repeated, seconds, steps); tick(2000)
        require(repeated.errors() === 1, name + ' must not reset the watchdog')
        cases.push({ name, rejected: true })
      }
      const latePhase = makeParticle(); tick(10000); progress(latePhase, 10); tick(10000); phaseProgress(latePhase, .5, 10); tick(2000)
      require(latePhase.errors() === 1, 'Simulation messages after drawing starts cannot revive a hung draw')
      cases.push({ name: 'interaction-after-drawing', rejected: true })
      const phaseError = makeParticle(() => { throw new Error('Intentional simulation progress consumer error') })
      phaseProgress(phaseError, .5, 10)
      require(phaseError.errors() === 1 && phaseError.worker.terminated, 'Phase consumer error releases Worker')
      cases.push({ name: 'interaction-consumer-error', terminated: true })
      require(timers.size === 0, 'Watchdog timers are released')
      return cases
    } finally {
      window.Worker = originals.Worker; window.setTimeout = originals.setTimeout; window.clearTimeout = originals.clearTimeout
    }
  })
  assert.equal(report.cases.length, 23)
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify(report))
