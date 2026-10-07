import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(
  process.env.ASTRA_PNG_OUTPUT || `test-results/signature-png-profile-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = { browser: browser.version(), cases: [], errors: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(
    (process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/signature-portrait',
  )
  await page.evaluate((worker) => {
    window.__profileWorkerPng = worker
  }, process.argv.includes('--worker'))
  report.cases = await page.evaluate(
    async (sides) => {
      const { generateHandwritingVariants } =
        await import('/src/lib/signature-portrait/variants.ts')
      const { renderSignaturePortrait, paintPlacementsTiled, canvasToPngBlob } =
        await import('/src/lib/signature-portrait/layout.ts')
      const { prepareSignatureWash } = await import('/src/lib/signature-portrait/styled-wash.ts')
      const { exportSignaturePng } = await import('/src/lib/signature-portrait/png-export.ts')
      const image = new Image()
      image.src = '/artwork/portrait-reference.png'
      await image.decode()
      const stamps = await generateHandwritingVariants('林晓晚', {
        count: 10,
        seed: 20261007,
        maxSide: 420,
        font: 'mashanzheng',
      })
      const recipe = { washStyle: 'pop-v1', washPalette: 'blue-coral' },
        wash = await prepareSignatureWash(image, recipe),
        cases = []
      for (const side of sides) {
        const options = {
          ...recipe,
          maxSide: side,
          density: 30,
          minSizeRatio: 0.014,
          maxSizeRatio: 0.04,
          angleRange: 12,
          orientationMode: 'flow',
          orientationStrength: 0.8,
          toneGain: 3,
          colorize: true,
          underlay: 0.75,
          seed: 42,
          background: '#f5f3ef',
          skipPaint: true,
        }
        const layoutStart = performance.now(),
          scene = await renderSignaturePortrait(
            image,
            image.naturalWidth,
            image.naturalHeight,
            stamps,
            options,
          )
        const layoutMs = performance.now() - layoutStart
        scene.canvas.width = scene.canvas.height = 1
        const meter = {
          active: true,
          frames: [],
          timers: [],
          longTasks: [],
          previous: performance.now(),
          stage: 'draw',
        }
        const tick = (now) => {
          if (!meter.active) return
          meter.frames.push({ ms: now - meter.previous, stage: meter.stage })
          meter.previous = now
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        let last = performance.now()
        const timer = setInterval(() => {
          const now = performance.now()
          meter.timers.push({ ms: now - last, stage: meter.stage })
          last = now
        }, 20)
        let observer
        try {
          observer = new PerformanceObserver((list) =>
            meter.longTasks.push(
              ...list
                .getEntries()
                .map((e) => ({ startMs: e.startTime - started, duration: e.duration })),
            ),
          )
          observer.observe({ type: 'longtask', buffered: false })
        } catch {}
        const started = performance.now()
        let canvas,
          blob,
          drawMs = 0,
          encodeMs = 0,
          backend
        if (window.__profileWorkerPng) {
          let encodeStart = 0
          blob = await exportSignaturePng(
            {
              portrait: image,
              portraitFile: null,
              portraitName: 'public',
              options,
              placements: scene.placements,
              stamps,
              width: scene.width,
              height: scene.height,
            },
            {
              onBackend: (value) => {
                backend = value
              },
              onProgress: (stage) => {
                if (stage === 'encode' && !encodeStart) {
                  encodeStart = performance.now()
                  drawMs = encodeStart - started
                  meter.stage = 'encode'
                }
              },
            },
          )
          encodeMs = performance.now() - (encodeStart || started)
        } else {
          canvas = await paintPlacementsTiled(
            scene.placements,
            stamps,
            scene.width,
            scene.height,
            scene.width,
            scene.height,
            { ...options, portrait: wash, tileSize: 384 },
          )
          drawMs = performance.now() - started
          meter.stage = 'encode'
          const encodeStart = performance.now()
          blob = await canvasToPngBlob(canvas)
          encodeMs = performance.now() - encodeStart
        }
        await new Promise((r) => setTimeout(r, 100))
        meter.active = false
        clearInterval(timer)
        observer?.disconnect()
        const metric = (list) => {
          const sorted = list.map((e) => e.ms).sort((a, b) => a - b)
          return {
            count: sorted.length,
            p95: sorted[Math.floor((sorted.length - 1) * 0.95)] || 0,
            max: sorted.at(-1) || 0,
          }
        }
        const head = new DataView(await blob.slice(0, 32).arrayBuffer())
        if (
          head.getUint32(0) !== 0x89504e47 ||
          head.getUint32(16) !== scene.width ||
          head.getUint32(20) !== scene.height
        )
          throw new Error('PNG dimensions/signature')
        cases.push({
          mode: window.__profileWorkerPng ? 'worker-png' : 'current-main-canvas',
          backend,
          side,
          width: scene.width,
          height: scene.height,
          placements: scene.placements.length,
          templates: stamps.length,
          layoutMs,
          drawMs,
          encodeMs,
          totalMs: drawMs + encodeMs,
          blobBytes: blob.size,
          response: {
            raf: metric(meter.frames),
            timer: metric(meter.timers),
            drawRaf: metric(meter.frames.filter((e) => e.stage === 'draw')),
            encodeRaf: metric(meter.frames.filter((e) => e.stage === 'encode')),
            longTasks: meter.longTasks,
          },
        })
        if (canvas) canvas.width = canvas.height = 1
      }
      return cases
    },
    (process.env.ASTRA_PNG_SIDES || '4096').split(',').map(Number),
  )
  report.passed = report.errors.length === 0
} catch (error) {
  report.failure = error.stack
  process.exitCode = 1
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }))
}
