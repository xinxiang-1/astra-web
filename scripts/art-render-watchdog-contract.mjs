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
    const make = (onProgress) => {
      let errors = 0, presents = 0
      const client = createFrameRenderWorker(() => presents++, () => errors++, onProgress)
      require(client, 'Worker support is required')
      client.render(frame, {})
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
      require(timers.size === 0, 'Watchdog timers are released')
      return cases
    } finally {
      window.Worker = originals.Worker; window.setTimeout = originals.setTimeout; window.clearTimeout = originals.clearTimeout
    }
  })
  assert.equal(report.cases.length, 9)
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify(report))
