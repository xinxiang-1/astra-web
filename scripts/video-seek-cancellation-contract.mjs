import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5212'
const out = path.resolve(
  process.env.ASTRA_SEEK_OUTPUT || `output/playwright/video-seek-cancellation-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out, { recursive: false })
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const baseline = process.env.ASTRA_SEEK_BASELINE === '1'
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim()
const modules = {}
for (const file of ['src/lib/ascii/media.ts', 'src/lib/ascii/prerender.ts']) {
  const source = baseline
    ? execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8', windowsHide: true })
    : await readFile(file, 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/(from ['"]\.\/(?:constants|media))(['"])/g, '$1.ts$2')
  modules[file] = { source, code }
}
let browser
const errors = []
const report = {
  scope: 'Actual browser modules with controlled EventTarget media; no real codec, physical mobile, image-quality or total-heap certification',
  channel,
  browser: null,
  baseline,
  head,
  sourceModules: Object.fromEntries(Object.entries(modules).map(([file, value]) => [file, {
    sha256: createHash('sha256').update(value.source).digest('hex'),
    origin: baseline ? 'git HEAD' : 'working tree',
  }])),
  errors,
  cases: [],
  passed: false,
}
try {
  browser = await chromium.launch({ channel })
  report.browser = await browser.version()
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  page.on('pageerror', (error) => errors.push(error.message))
  if (baseline) for (const [file, { code }] of Object.entries(modules))
    await page.route(`**/${file}*`, (route) => route.fulfill({ contentType: 'text/javascript', body: code }))
  await page.goto(`${base}/ascii-art`)
  report.cases = await page.evaluate(async () => {
    const { seekVideoTo } = await import('/src/lib/ascii/media.ts')
    const { prerenderVideoFrames } = await import('/src/lib/ascii/prerender.ts')
    const original = {
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      setInterval: window.setInterval.bind(window),
      clearInterval: window.clearInterval.bind(window),
    }
    const timers = new Set()
    const intervals = new Set()
    const sleep = (ms) => new Promise((resolve) => original.setTimeout(resolve, ms))
    const deadline = async (promise, ms = 1000) => {
      let id
      try {
        return await Promise.race([
          promise,
          new Promise((_, reject) => {
            id = original.setTimeout(() => reject(new Error(`Contract deadline ${ms}ms exceeded`)), ms)
          }),
        ])
      } finally {
        original.clearTimeout(id)
      }
    }
    const check = (condition, message) => {
      if (!condition) throw new Error(message)
    }
    const outcome = async (promise) => {
      try {
        await deadline(promise)
        return { ok: true }
      } catch (error) {
        return { ok: false, name: error.name, message: error.message }
      }
    }
    const expectAbort = (result) =>
      check(!result.ok && result.name === 'AbortError', `Expected AbortError: ${JSON.stringify(result)}`)
    const videos = []
    const signals = []
    function trackListeners(target) {
      const add = target.addEventListener.bind(target)
      const remove = target.removeEventListener.bind(target)
      const listeners = new Map()
      const keyOf = (type, capture) => `${type}:${capture}`
      target.addEventListener = (type, listener, options) => {
        if (!listener) return
        const capture = typeof options === 'boolean' ? options : options?.capture ?? false
        const key = keyOf(type, capture)
        const entries = listeners.get(key) || new Map()
        if (entries.has(listener)) return
        const wrapped = (event) => {
          if (typeof options === 'object' && options.once) {
            entries.delete(listener)
            if (!entries.size) listeners.delete(key)
          }
          if (typeof listener === 'function') listener.call(target, event)
          else listener.handleEvent(event)
        }
        entries.set(listener, wrapped)
        listeners.set(key, entries)
        add(type, wrapped, options)
      }
      target.removeEventListener = (type, listener, options) => {
        const capture = typeof options === 'boolean' ? options : options?.capture ?? false
        const key = keyOf(type, capture)
        const entries = listeners.get(key)
        const wrapped = entries?.get(listener)
        if (!wrapped) return
        remove(type, wrapped, options)
        entries.delete(listener)
        if (!entries.size) listeners.delete(key)
      }
      return {
        count: () => [...listeners.values()].reduce((sum, entries) => sum + entries.size, 0),
        clear: () => {
          for (const [key, entries] of listeners)
            for (const wrapped of entries.values())
              remove(key.slice(0, key.lastIndexOf(':')), wrapped, key.endsWith(':true'))
          listeners.clear()
        },
      }
    }
    class ControlledVideo extends EventTarget {
      constructor(mode = 'hang') {
        super()
        this.mode = mode
        this.duration = 4
        this.readyState = 2
        this.videoWidth = 8
        this.videoHeight = 8
        this.seeking = false
        this.src = 'blob:controlled-original'
        this.currentSrc = this.src
        this.time = 0.1
        this.sets = []
        this.onSet = null
        this.listeners = trackListeners(this)
        videos.push(this)
      }
      get currentTime() { return this.time }
      set currentTime(value) {
        this.sets.push(value)
        if (this.mode === 'throw') throw new Error('Controlled seek setter failure')
        this.time = value
        this.seeking = true
        this.onSet?.(value)
        if (this.mode === 'auto') original.setTimeout(() => this.complete(), 4)
      }
      getAttribute(name) { return name === 'src' ? this.src : null }
      complete() {
        this.seeking = false
        this.dispatchEvent(new Event('seeked'))
      }
      replace() {
        this.src = this.currentSrc = 'blob:controlled-replacement'
        this.time = 3
        this.seeking = false
        this.dispatchEvent(new Event('emptied'))
      }
    }
    const controller = () => {
      const value = new AbortController()
      signals.push(trackListeners(value.signal))
      return value
    }
    const resources = () => ({
      videoListeners: videos.reduce((sum, video) => sum + video.listeners.count(), 0),
      signalListeners: signals.reduce((sum, signal) => sum + signal.count(), 0),
      timeouts: timers.size,
      intervals: intervals.size,
    })
    const cleanResources = () => {
      for (const video of videos) video.listeners.clear()
      for (const signal of signals) signal.clear()
      for (const id of timers) original.clearTimeout(id)
      for (const id of intervals) original.clearInterval(id)
      timers.clear()
      intervals.clear()
      videos.length = 0
      signals.length = 0
    }
    window.setTimeout = (handler, delay, ...args) => {
      let id
      id = original.setTimeout(() => {
        timers.delete(id)
        if (typeof handler === 'function') handler(...args)
        else throw new Error('Unexpected string timer in seek contract')
      }, delay)
      timers.add(id)
      return id
    }
    window.clearTimeout = (id) => {
      timers.delete(id)
      original.clearTimeout(id)
    }
    window.setInterval = (handler, delay, ...args) => {
      const id = original.setInterval(handler, delay, ...args)
      intervals.add(id)
      return id
    }
    window.clearInterval = (id) => {
      intervals.delete(id)
      original.clearInterval(id)
    }
    const cases = []
    const run = async (name, work) => {
      const started = performance.now()
      let details
      let failure
      try {
        details = await work()
      } catch (error) {
        failure = `${error.name}: ${error.message}`
      }
      const retained = resources()
      if (Object.values(retained).some((count) => count !== 0))
        failure = [failure, `Leaked resources: ${JSON.stringify(retained)}`].filter(Boolean).join('; ')
      cases.push({ name, passed: !failure, elapsedMs: performance.now() - started, retained, details, failure })
      cleanResources()
    }
    const prerender = (video, extra = {}) => prerenderVideoFrames({
      video, fps: 8, startTime: 0.2, endTime: 0.45,
      shouldAbort: () => false,
      getFrameSource: () => ({ source: video, width: 8, height: 8 }),
      convertFrame: () => ({ text: '山河', columns: 2, rows: 1, colors: new Uint8ClampedArray([1, 2, 3, 4, 5, 6]) }),
      seekTimeoutMs: 150,
      ...extra,
    })
    try {
      await run('successful-seek-and-already-positioned', async () => {
        const video = new ControlledVideo('auto')
        await deadline(seekVideoTo(video, 2, { timeoutMs: 150 }))
        check(video.currentTime === 2, 'Seek did not apply its target')
        await deadline(seekVideoTo(video, 2, { timeoutMs: 150 }))
        check(video.sets.length === 1, 'Already-positioned seek should not set currentTime')
        return { seeks: video.sets }
      })
      await run('late-seeked-does-not-complete-an-active-seek', async () => {
        const video = new ControlledVideo()
        let settled = false
        const pending = seekVideoTo(video, 2, { timeoutMs: 500 })
        void pending.then(() => { settled = true }, () => { settled = true })
        video.dispatchEvent(new Event('seeked'))
        await sleep(20)
        check(video.seeking && !settled, 'A queued old seeked event completed the active positioning wait')
        check(video.listeners.count() > 0, 'The active seek lost its listeners after a stale event')
        video.complete()
        await deadline(pending)
        check(!video.seeking && settled && video.currentTime === 2, 'Actual seek completion did not settle the wait')
        return { ignoredWhileSeeking: true, seeks: video.sets }
      })
      await run('preaborted-and-shouldAbort-zero-seek', async () => {
        const video = new ControlledVideo()
        const aborted = controller()
        aborted.abort()
        expectAbort(await outcome(seekVideoTo(video, video.currentTime, { signal: aborted.signal })))
        expectAbort(await outcome(seekVideoTo(video, 2, { shouldAbort: () => true })))
        check(video.sets.length === 0, 'Pre-cancellation mutated media position')
        return { seeks: 0 }
      })
      await run('invalid-targets-rejected-before-seek', async () => {
        const video = new ControlledVideo()
        const results = []
        for (const target of [NaN, Infinity, -Infinity]) {
          const result = await outcome(seekVideoTo(video, target, { timeoutMs: 60 }))
          check(!result.ok && result.name !== 'AbortError' && !/Contract deadline/.test(result.message), 'Invalid target must fail immediately')
          results.push(result)
        }
        check(video.sets.length === 0, 'Invalid target reached media setter')
        return { results, seeks: 0 }
      })
      await run('signal-cancels-in-flight-seek', async () => {
        const video = new ControlledVideo()
        const abort = controller()
        const pending = seekVideoTo(video, 2, { signal: abort.signal, timeoutMs: 500 })
        original.setTimeout(() => abort.abort(), 20)
        const result = await outcome(pending)
        expectAbort(result)
        return { result, seeks: video.sets }
      })
      await run('shouldAbort-cancels-in-flight-seek', async () => {
        const video = new ControlledVideo()
        let aborted = false
        const pending = seekVideoTo(video, 2, { shouldAbort: () => aborted, timeoutMs: 500 })
        original.setTimeout(() => { aborted = true }, 20)
        const result = await outcome(pending)
        expectAbort(result)
        return { result, seeks: video.sets }
      })
      for (const event of ['emptied', 'abort', 'error']) await run(`media-${event}-settles-seek`, async () => {
        const video = new ControlledVideo()
        const pending = seekVideoTo(video, 2, { timeoutMs: 500 })
        original.setTimeout(() => video.dispatchEvent(new Event(event)), 20)
        const result = await outcome(pending)
        if (event === 'error') check(!result.ok && result.name !== 'AbortError', 'Decoder error must remain a failure')
        else expectAbort(result)
        return { result }
      })
      await run('timeout-is-bounded-and-readable', async () => {
        const video = new ControlledVideo()
        const started = performance.now()
        const result = await outcome(seekVideoTo(video, 2, { timeoutMs: 45 }))
        check(!result.ok && result.name !== 'AbortError' && /超时/.test(result.message), 'Timeout must explain the media delay')
        const elapsedMs = performance.now() - started
        check(elapsedMs < 350, 'Seek timeout did not bound pending work')
        return { result, elapsedMs }
      })
      await run('throwing-setter-cleans-listeners-and-timers', async () => {
        const video = new ControlledVideo('throw')
        const abort = controller()
        const result = await outcome(seekVideoTo(video, 2, { signal: abort.signal, shouldAbort: () => false, timeoutMs: 500 }))
        check(!result.ok && result.message.includes('Controlled seek setter failure'), 'Seek setter error must be preserved')
        return { result }
      })
      await run('cancelled-seek-can-retry', async () => {
        const video = new ControlledVideo()
        const abort = controller()
        const first = seekVideoTo(video, 1, { signal: abort.signal, timeoutMs: 500 })
        abort.abort()
        expectAbort(await outcome(first))
        check(video.listeners.count() === 0, 'Cancelled attempt left media listeners')
        video.mode = 'auto'
        await deadline(seekVideoTo(video, 2, { timeoutMs: 150 }))
        check(video.currentTime === 2 && video.sets.length === 2, 'Retry did not complete independently')
        return { seeks: video.sets }
      })
      await run('two-elements-do-not-share-cancellation', async () => {
        const first = new ControlledVideo()
        const second = new ControlledVideo()
        const abort = controller()
        const firstPending = seekVideoTo(first, 1, { signal: abort.signal, timeoutMs: 500 })
        const secondPending = seekVideoTo(second, 2, { timeoutMs: 500 })
        abort.abort()
        expectAbort(await outcome(firstPending))
        check(first.listeners.count() === 0 && second.listeners.count() > 0, 'Cancellation crossed media elements')
        second.complete()
        await deadline(secondPending)
        return { firstSeeks: first.sets, secondSeeks: second.sets }
      })
      await run('prerender-preabort-does-not-seek-or-progress', async () => {
        const video = new ControlledVideo()
        const abort = controller()
        abort.abort()
        let progress = 0
        const result = await deadline(prerender(video, { signal: abort.signal, onProgress: () => { progress++ } }))
        check(!result.ok && result.aborted === true && progress === 0 && video.sets.length === 0, 'Pre-aborted prerender performed work')
        return { result, progress, seeks: video.sets }
      })
      for (const cancellation of ['signal', 'shouldAbort']) await run(`prerender-${cancellation}-during-seek`, async () => {
        const video = new ControlledVideo()
        const abort = controller()
        let flag = false
        let progress = 0
        let converted = 0
        const pending = prerender(video, {
          signal: abort.signal,
          shouldAbort: () => flag,
          convertFrame: () => { converted++; return { text: 'x', columns: 1, rows: 1 } },
          onProgress: () => { progress++ },
        })
        original.setTimeout(() => {
          if (cancellation === 'signal') abort.abort()
          else flag = true
        }, 20)
        const started = performance.now()
        const result = await deadline(pending, 500)
        check(!result.ok && result.aborted === true, 'Interrupted prerender did not report cancellation')
        check(performance.now() - started < 350 && video.currentTime === 0.1, 'Cancelled seek did not promptly restore same-source position')
        await sleep(80)
        check(progress === 0 && converted === 0, 'Cancelled seek produced late conversion/progress')
        return { result, progress, converted, seeks: video.sets }
      })
      await run('prerender-seek-timeout-restores-without-waiting-again', async () => {
        const video = new ControlledVideo()
        let progress = 0
        const started = performance.now()
        const result = await deadline(prerender(video, { seekTimeoutMs: 45, onProgress: () => { progress++ } }), 500)
        check(!result.ok && result.aborted !== true && /超时/.test(result.error), 'Timed-out prerender did not retain the timeout failure')
        check(performance.now() - started < 350 && video.currentTime === 0.1 && progress === 0, 'Failure waited on another stalled restoration seek')
        return { result, progress, seeks: video.sets }
      })
      await run('prerender-source-replacement-never-restores-old-position', async () => {
        const video = new ControlledVideo()
        let progress = 0
        const pending = prerender(video, { onProgress: () => { progress++ } })
        original.setTimeout(() => video.replace(), 20)
        const result = await deadline(pending, 500)
        check(!result.ok && result.aborted === true, 'Replaced media should cancel prerender')
        check(video.currentTime === 3 && video.sets.length === 1, 'Old task restored its position into replacement source')
        await sleep(80)
        check(progress === 0, 'Replaced source received late progress')
        return { result, progress, seeks: video.sets, replacementTime: video.currentTime }
      })
      for (const phase of ['conversion', 'raster']) await run(`prerender-cancel-during-${phase}-has-no-late-progress`, async () => {
        const video = new ControlledVideo('auto')
        const abort = controller()
        let progress = 0
        const interrupt = async (value) => {
          original.setTimeout(() => abort.abort(), 10)
          await sleep(35)
          return value
        }
        const extra = phase === 'conversion'
          ? { convertFrame: () => interrupt({ text: 'x', columns: 1, rows: 1 }) }
          : { renderRaster: () => interrupt(new Blob(['controlled-raster'])) }
        const result = await deadline(prerender(video, { signal: abort.signal, onProgress: () => { progress++ }, ...extra }), 500)
        check(!result.ok && result.aborted === true && video.currentTime === 0.1, 'Async frame cancellation was not restored/reported')
        await sleep(80)
        check(progress === 0, 'Cancelled asynchronous frame emitted progress')
        return { result, progress, seeks: video.sets }
      })
      await run('same-source-obsolete-task-cannot-restore-new-task-position', async () => {
        const video = new ControlledVideo('auto')
        const abort = controller()
        let ownsSource = true
        let progress = 0
        let release
        let entered
        const conversionStarted = new Promise((resolve) => { entered = resolve })
        const conversion = new Promise((resolve) => { release = resolve })
        const pending = prerender(video, {
          signal: abort.signal,
          canRestoreSource: () => ownsSource,
          convertFrame: () => { entered(); return conversion },
          onProgress: () => { progress++ },
        })
        await deadline(conversionStarted)
        abort.abort()
        ownsSource = false
        await deadline(seekVideoTo(video, 2, { timeoutMs: 150 }))
        const expectedSeeks = video.sets.length
        release({ text: 'old', columns: 3, rows: 1 })
        const result = await deadline(pending, 500)
        await sleep(80)
        check(!result.ok && result.aborted === true && progress === 0, 'Obsolete task emitted success/progress')
        check(video.currentTime === 2 && video.sets.length === expectedSeeks, 'Obsolete same-source task overwrote new task position')
        return { result, progress, seeks: video.sets, retainedNewTime: video.currentTime }
      })
      await run('prerender-success-preserves-frames-and-restores', async () => {
        const video = new ControlledVideo('auto')
        const progress = []
        const result = await deadline(prerender(video, { onProgress: ({ done }) => progress.push(done) }))
        check(result.ok && result.frames.length === 3 && result.resumeTime === 0.1 && video.currentTime === 0.1, 'Successful same-source prerender did not restore')
        check(JSON.stringify(progress) === '[1,2,3]', 'Successful prerender progress is incomplete')
        check(result.frames.every((frame) => frame.text === '山河' && [...frame.colors].join(',') === '1,2,3,4,5,6'), 'Typed-frame content changed')
        return { frames: result.frames.length, progress, seeks: video.sets }
      })
      await run('prerender-conversion-failure-restores-without-blocking', async () => {
        const video = new ControlledVideo('auto')
        let converted = 0
        let progress = 0
        const result = await deadline(prerender(video, {
          convertFrame: () => {
            if (++converted === 2) {
              video.mode = 'hang'
              throw new Error('Controlled conversion failure')
            }
            return { text: 'x', columns: 1, rows: 1 }
          },
          onProgress: () => { progress++ },
        }), 500)
        check(!result.ok && result.error === 'Controlled conversion failure' && progress === 1 && video.currentTime === 0.1, 'Conversion failure did not promptly restore')
        return { result, progress, seeks: video.sets }
      })
      for (const failure of ['signal', 'timeout']) await run(`prerender-success-restoration-${failure}-is-bounded`, async () => {
        const video = new ControlledVideo('auto')
        const abort = controller()
        video.onSet = (value) => {
          if (value === 0.1) {
            video.mode = 'hang'
            if (failure === 'signal') original.setTimeout(() => abort.abort(), 20)
          }
        }
        const result = await deadline(prerender(video, { signal: abort.signal, seekTimeoutMs: 45 }), 500)
        if (failure === 'signal') check(!result.ok && result.aborted === true, 'Success restoration did not accept cancellation')
        else check(!result.ok && /超时/.test(result.error), 'Success restoration timeout was not surfaced')
        return { result, seeks: video.sets }
      })
      return cases
    } finally {
      cleanResources()
      window.setTimeout = original.setTimeout
      window.clearTimeout = original.clearTimeout
      window.setInterval = original.setInterval
      window.clearInterval = original.clearInterval
    }
  })
  assert.equal(errors.length, 0, JSON.stringify(errors))
  const failures = report.cases.filter((item) => !item.passed)
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2))
  report.passed = true
} catch (error) {
  report.failure = `${error.name}: ${error.message}`
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser?.close()
}
console.log(JSON.stringify({ out, browser: report.browser, cases: report.cases.length, passed: report.passed }))
