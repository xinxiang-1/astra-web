import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const out = path.resolve(process.env.ASTRA_CLOCK_OUTPUT || `output/playwright/prerender-clock-${Date.now()}`)
await mkdir(out, { recursive: false })
const browser = await chromium.launch({ channel: 'msedge' })
try {
  const page = await browser.newPage()
  await page.goto(process.env.ASTRA_PREVIEW_URL || 'http://localhost:5173/ascii-art')
  const report = await page.evaluate(async () => {
    const { createPrerenderFrameLoop } = await import('/src/lib/ascii/playback.ts')
    const raf = requestAnimationFrame, cancel = cancelAnimationFrame
    let callback, hidden = false, active = true, index = 0, ended = 0, emitted = []
    const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden')
    window.requestAnimationFrame = cb => { callback = cb; return 1 }
    window.cancelAnimationFrame = () => { callback = null }
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    const emit = time => { const cb = callback; callback = null; cb?.(time) }
    const make = (count = 100, loop = true) => createPrerenderFrameLoop({ fps: 60, frameCount: count,
      shouldTick: () => active, getIndex: () => index, setIndex: value => { index = value },
      onFrame: value => emitted.push(value), getLoop: () => loop, onEnded: () => { ended++ } })
    let handle
    try {
      handle = make()
      for (const t of [0, 16.6, 33.3, 49.9, 66.6, 83.2]) emit(t)
      if (JSON.stringify(emitted) !== '[0,1,2,3,4,5]') throw new Error('60Hz jitter drops frames')
      emit(183.3)
      if (emitted.at(-1) !== 11) throw new Error('Slow rendering must catch up to media time')
      hidden = true; emit(1000); hidden = false; emit(5000)
      if (emitted.at(-1) !== 12) throw new Error('Hidden time must not skip the paused clip')
      handle.stop(); handle = null
      index = 0; emitted = []; handle = make(3, false)
      emit(0); emit(100)
      if (JSON.stringify(emitted) !== '[0,2]' || ended !== 1 || callback !== null) throw new Error('Non-looping playback must show final frame and stop exactly once')
      return { passed: true, jitterKeeps60Hz: true, mediaClockCatchup: true, hiddenResumeFreezes: true, finalFrameAndStop: true }
    } finally {
      handle?.stop(); window.requestAnimationFrame = raf; window.cancelAnimationFrame = cancel
      if (descriptor) Object.defineProperty(document, 'hidden', descriptor); else delete document.hidden
    }
  })
  assert(report.passed)
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }))
} finally { await browser.close() }
