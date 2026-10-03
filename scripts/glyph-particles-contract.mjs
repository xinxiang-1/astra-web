import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_PARTICLES_OUTPUT || `test-results/glyph-particles-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const report = { passed: false, base, cases: [], errors: [], hashes: {} }
for (const file of [
  'docs/prototypes/v9-glyph-particles/main.ts',
  'docs/prototypes/v9-glyph-particles/presentation.ts',
  'src/lib/art-engine/canvas.ts',
  'public/artwork/porcelain-study-v1.png',
])
  report.hashes[file] = createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
const browser = await chromium.launch({
  headless: true,
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
})
try {
  report.browser = browser.version()
  let page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
    reducedMotion: 'no-preference',
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.setDefaultTimeout(60000)
  await page.goto(base + '/docs/prototypes/v9-glyph-particles/index.html')
  await page.waitForFunction(() => window.astraParticlesPrototype?.ready)
  await page.evaluate(() => window.astraParticlesPrototype.setManual(true))
  const result = await page.evaluate(async (filter) => {
    const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
    const { createCanvasArtRenderer } = await import('/src/lib/art-engine/canvas.ts')
    const { createGlyphParticlePresentation } =
      await import('/docs/prototypes/v9-glyph-particles/presentation.ts')
    const require = (v, m) => {
      if (!v) throw Error(m)
    }
    const pixels = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])
    const changed = (a, b) => {
      let n = 0
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
      return n
    }
    const source = new Image()
    source.src = '/artwork/porcelain-study-v1.png'
    await source.decode()
    const cases = []
    for (const mode of ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']) {
      for (const quality of mode === 'density' || mode === 'color'
        ? ['classic', 'high', 'software']
        : ['classic']) {
        for (const transparent of [false, true]) {
          if (filter && `${mode}/${quality}/${transparent}` !== filter) continue
          const frame = prepareArtFrame(source, source.width, source.height, {
            mode,
            columns: 64,
            phrase: '我爱你中国，光与影。',
            fontFamily: mode === 'phrase' ? 'Microsoft YaHei, monospace' : 'Consolas, monospace',
            ...(quality !== 'classic' ? { rasterQuality: 'high', fontWeight: 600 } : {}),
            ...(quality === 'software'
              ? { softwareRaster: true, colorFidelity: mode === 'color', fontWeight: 400 }
              : {}),
          })
          const originalIndices = new Uint16Array(frame.indices),
            originalColors = new Uint8ClampedArray(frame.colors)
          const staticCanvas = document.createElement('canvas')
          staticCanvas.getContext('2d', { willReadFrequently: true })
          const reference = createCanvasArtRenderer(staticCanvas)
          reference.render(frame, { longEdge: 360, transparent })
          const rest = pixels(staticCanvas)
          const canvases = [document.createElement('canvas'), document.createElement('canvas')]
          canvases.forEach((c) => c.getContext('2d', { willReadFrequently: true }))
          const presentations = canvases.map(() => createGlyphParticlePresentation())
          const renderers = canvases.map((c, i) =>
            createCanvasArtRenderer(c, { experimentalTrail: presentations[i].prepare }),
          )
          let time = 0
          let pointer = { x: 0.85, y: 0.5, active: false }
          const render = (dt, events = [], strength = 0.65) => {
            time += dt
            if (events.length) pointer = events.at(-1)
            const options = {
              longEdge: 360,
              transparent,
              effectProfile: 'expressive',
              motion: 'none',
              hover: 'trail',
              hoverStrength: strength,
              hoverRadius: 0.38,
              hoverTime: time,
              pointer: { ...pointer, strength },
              pointerSamples: events,
            }
            for (let i = 0; i < 2; i++) {
              presentations[i].setTime(time)
              renderers[i].render(frame, options)
            }
          }
          render(0)
          require(equal(
            rest,
            pixels(canvases[0]),
          ), `${mode}/${quality}/${transparent} neutral pixels`)
          let peak = 0,
            maxChanged = 0
          for (let i = 0; i < 30; i++) {
            render(1 / 60, [
              {
                x: 0.15 + (i / 29) * 0.7,
                y: 0.5 + Math.sin((i / 29) * Math.PI * 2) * 0.16,
                time: (time + 1 / 60) * 1000,
                active: true,
              },
            ])
            peak = Math.max(peak, presentations[0].stats.peak)
            if (i === 29) {
              require(equal(
                pixels(canvases[0]),
                pixels(canvases[1]),
              ), `${mode} deterministic actual RGBA: ${JSON.stringify({ a: presentations[0].stats, b: presentations[1].stats, changed: changed(pixels(canvases[0]), pixels(canvases[1])), fa: renderers[0].sampleFluidField(0.5, 0.5), fb: renderers[1].sampleFluidField(0.5, 0.5) })}`)
              maxChanged = changed(rest, pixels(canvases[0]))
            }
          }
          require(peak > 0.01 && maxChanged > 100, `${mode}/${quality} distinguishable response`)
          render(1 / 60, [{ x: 0.85, y: 0.5, time: (time + 1 / 60) * 1000, active: false }])
          let steps = 0,
            tailPeak = 0
          for (; steps < 400; steps++) {
            render(0.1)
            if (!renderers[0].interactionActive) {
              tailPeak = Math.max(tailPeak, presentations[0].stats.peak)
            }
            if (!renderers[0].interactionActive && presentations[0].stats.moving === 0) break
          }
          require(steps < 400, `${mode}/${quality} settles within 40s`)
          const recoveredPixels = pixels(canvases[0])
          const pixelExamples = []
          for (let i = 0; i < rest.length && pixelExamples.length < 12; i += 4)
            if (
              rest[i] !== recoveredPixels[i] ||
              rest[i + 1] !== recoveredPixels[i + 1] ||
              rest[i + 2] !== recoveredPixels[i + 2] ||
              rest[i + 3] !== recoveredPixels[i + 3]
            )
              pixelExamples.push({
                pixel: i / 4,
                rest: [...rest.slice(i, i + 4)],
                now: [...recoveredPixels.slice(i, i + 4)],
              })
          require(equal(
            rest,
            recoveredPixels,
          ), `${mode}/${quality}/${transparent} exact natural recovery ${JSON.stringify({ pixelExamples, changed: changed(rest, recoveredPixels), stats: presentations[0].stats, fluid: renderers[0].sampleFluidField(0.5, 0.5) })}`)
          const settlingSeconds = steps * 0.1
          // Zero strength must erase all state even while the native field was active.
          render(1 / 60, [{ x: 0.4, y: 0.5, time: (time + 1 / 60) * 1000, active: true }])
          render(1 / 60, [], 0)
          require(equal(rest, pixels(canvases[0])), `${mode} zero strength recovery`)
          require(equal(originalIndices, frame.indices) &&
            equal(originalColors, frame.colors), `${mode} unchanged original glyph identities/RGB`)
          require(presentations[0].stats.bytes <=
            presentations[0].stats.limit, `${mode} state budget`)
          const bytes = presentations[0].stats.bytes
          presentations.forEach((p) => p.destroy())
          renderers.forEach((r) => r.destroy())
          reference.destroy()
          require(presentations.every((p) => p.stats.bytes === 0), 'particle buffers released')
          cases.push({
            mode,
            quality,
            transparent,
            peak,
            maxChanged,
            settlingSeconds,
            tailPeak,
            bytes,
            exactRecovery: true,
            deterministic: true,
          })
        }
      }
    }
    // Physical step invariance under a constant field, including velocity state.
    const small = prepareArtFrame(source, source.width, source.height, { columns: 8 })
    const a = createGlyphParticlePresentation(),
      b = createGlyphParticlePresentation()
    const field = () => ({
      velocityX: 0.24,
      velocityY: -0.13,
      offsetX: 0.03,
      offsetY: 0.01,
      density: 0.6,
      active: true,
    })
    for (const [p, steps] of [
      [a, 60],
      [b, 30],
    ]) {
      p.setTime(0)
      p.prepare(field, small, 0.65, 360, 450)
      for (let i = 1; i <= steps; i++) {
        p.setTime(i / steps)
        p.prepare(field, small, 0.65, 360, 450)
      }
    }
    const ca = a.prepare(field, small, 0.65, 360, 450),
      cb = b.prepare(field, small, 0.65, 360, 450)
    let springError = 0
    for (let y = 0; y < small.rows; y++)
      for (let x = 0; x < small.columns; x++) {
        const va = ca((x + 0.5) / small.columns, (y + 0.5) / small.rows),
          vb = cb((x + 0.5) / small.columns, (y + 0.5) / small.rows)
        springError = Math.max(
          springError,
          Math.abs(va.offsetX - vb.offsetX),
          Math.abs(va.offsetY - vb.offsetY),
        )
      }
    require(springError < 0.00001, 'exact spring integration across 30/60Hz')
    a.destroy()
    b.destroy()
    return { cases, springError }
  }, process.env.ASTRA_PARTICLES_FILTER || '')
  report.cases = result.cases
  report.springError = result.springError
  console.log(
    JSON.stringify({
      matrixCases: result.cases.length,
      springError: result.springError,
      maxTailPeak: Math.max(...result.cases.map((c) => c.tailPeak)),
    }),
  )
  // The matrix allocates and reads many offscreen canvases. Test real UI in a fresh page.
  await page.close()
  page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
    reducedMotion: 'no-preference',
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/docs/prototypes/v9-glyph-particles/index.html')
  await page.waitForFunction(() => window.astraParticlesPrototype?.ready)
  if (!(await page.locator('.boards').evaluate((el) => el.classList.contains('focused'))))
    await page.locator('#focus').click()
  await page.screenshot({ path: path.join(out, 'desktop-rest.png'), fullPage: true })
  const rect = await page.locator('#particles').boundingBox()
  await page.evaluate(() => window.astraParticlesPrototype.setManual(false))
  await page.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height * 0.45)
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      rect.x + rect.width * (0.2 + (i / 12) * 0.6),
      rect.y + rect.height * (0.45 + Math.sin((i / 12) * Math.PI * 2) * 0.12),
    )
    await page.waitForTimeout(25)
  }
  await page.screenshot({ path: path.join(out, 'desktop-hover.png'), fullPage: true })
  assert(
    (await page.evaluate(() => window.astraParticlesPrototype.state.stats.peak)) > 0.005,
    `real pointer response: ${JSON.stringify(await page.evaluate(() => window.astraParticlesPrototype.state))}`,
  )
  await page.mouse.move(0, 0)
  await page.waitForFunction(
    () => window.astraParticlesPrototype.state.stats.moving === 0,
    {},
    { timeout: 20000 },
  )
  await page.evaluate(() => window.astraParticlesPrototype.reset())
  const before = await page.evaluate(() => window.astraParticlesPrototype.state.paintCount)
  await page.waitForTimeout(300)
  assert.equal(
    await page.evaluate(() => window.astraParticlesPrototype.state.paintCount),
    before,
    'no redraw while idle',
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.mouse.move(rect.x + rect.width * 0.45, rect.y + rect.height * 0.5)
  await page.waitForTimeout(100)
  assert.equal(
    await page.evaluate(() => window.astraParticlesPrototype.state.stats.peak),
    0,
    'reduced motion static',
  )
  report.ui = { realMouse: true, idle: true, reducedMotion: true }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true })
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'mobile width',
  )
  report.ui.mobileWidth = 390
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const touchRect = await page.locator('#particles').boundingBox()
  const cdp = await page.context().newCDPSession(page)
  const touch = (x, y) => ({
    x: touchRect.x + touchRect.width * x,
    y: touchRect.y + touchRect.height * y,
    id: 1,
    radiusX: 3,
    radiusY: 3,
    force: 0.5,
  })
  await page.evaluate(() => {
    window.__particleTouch = { down: 0, move: 0, up: 0, cancel: 0 }
    const c = document.querySelector('#particles')
    for (const [event, key] of [
      ['pointerdown', 'down'],
      ['pointermove', 'move'],
      ['pointerup', 'up'],
      ['pointercancel', 'cancel'],
    ])
      c.addEventListener(event, () => window.__particleTouch[key]++)
  })
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [touch(0.2, 0.45)],
  })
  for (let i = 1; i <= 10; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [touch(0.2 + (i / 10) * 0.6, 0.45 + Math.sin((i / 10) * Math.PI * 2) * 0.1)],
    })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const touchEvents = await page.evaluate(() => window.__particleTouch)
  assert(
    touchEvents.down === 1 &&
      touchEvents.move >= 8 &&
      touchEvents.up === 1 &&
      touchEvents.cancel === 0,
    'touch path and release',
  )
  assert.equal(
    await page.evaluate(() => window.astraParticlesPrototype.state.pointer.active),
    false,
    'touch released',
  )
  report.ui.touch = {
    events: touchEvents,
    scope: '390px desktop Chromium touch emulation; not a real phone',
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ out, passed: report.passed, failure: report.failure }))
  await browser.close()
}
