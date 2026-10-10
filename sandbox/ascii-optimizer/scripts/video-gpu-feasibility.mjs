import { chromium } from 'playwright'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
const experiment = process.env.ASTRA_GPU_EXPERIMENT || 'video-gpu-20261010-r3'
if (!/^[a-zA-Z0-9_-]+$/.test(experiment)) throw new Error('Invalid experiment ID')
const root = `sandbox/ascii-optimizer/experiments/${experiment}`
const engine = `sandbox/ascii-optimizer/engine/${experiment}/art-engine`
await mkdir(root, { recursive: false })
await cp('src/lib/art-engine', engine, { recursive: true })
const hash = (data) => createHash('sha256').update(data).digest('hex')
let canvas = await readFile(`${engine}/canvas.ts`, 'utf8')
const frozenHash = hash(canvas)
canvas = canvas.replace('export type CanvasArtPrototypeOptions = {', `export type CanvasArtPrototypeOptions = {
  beginBatch?: (frame: ArtFrame, width: number, height: number) => void
  glyphBatch?: (index: number, color: string, alpha: number, x: number, y: number, width: number, height: number) => void
  endBatch?: () => void`)
canvas = canvas.replace('const effect = yield* effects(options, w, h)', 'const effect = yield* effects(options, w, h)\n    prototype.beginBatch?.(frame, w, h)')
canvas = canvas.replace('frame.settings.softwareRaster &&\n', '!prototype.glyphBatch && frame.settings.softwareRaster &&\n')
canvas = canvas.replace('ctx.drawImage(\n          tile(index, color),', `if (prototype.glyphBatch) {
          prototype.glyphBatch(index, color, ctx.globalAlpha,
            x * cw + dx + (cw - dw) * .5, y * ch + dy + (ch - dh) * .5, dw, dh)
          continue
        }
        ctx.drawImage(\n          tile(index, color),`)
canvas = canvas.replace('renderGlow(effect, w, h)\n    return', 'prototype.endBatch?.()\n    if (!prototype.glyphBatch) renderGlow(effect, w, h)\n    return')
await writeFile(`${engine}/canvas.ts`, canvas)
const browser = await chromium.launch({ channel: 'msedge' })
let deadline
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.exposeFunction('recordProgress', async (record) => {
    await writeFile(path.join(root, 'progress.json'), JSON.stringify(record, null, 2))
    console.log(JSON.stringify(record))
  })
  const completed = []
  await page.exposeFunction('recordCompleted', async (record) => {
    const bytes = Buffer.from(record.captures[0].split(',')[1], 'base64')
    record.artifact = `${record.mode}-${record.columns}-${record.path}.png`
    record.artifactHash = hash(bytes)
    await writeFile(path.join(root, record.artifact), bytes)
    delete record.captures
    completed.push(record)
    await writeFile(path.join(root, 'completed.json'), JSON.stringify(completed, null, 2))
    console.log(JSON.stringify({ mode: record.mode, columns: record.columns, path: record.path, p95Ms: record.p95Ms, stoppedEarly: record.stoppedEarly }))
  })
  deadline = setTimeout(() => { void page.close() }, 240000)
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://localhost:5173') + '/art-lab')
  const results = await page.evaluate(async ({ engine, root }) => {
    await window.recordProgress({ stage: 'imports' })
    const { createCanvasArtRenderer } = await import('/' + engine + '/canvas.ts')
    const { ART_DEFAULTS, createArtCore } = await import('/' + engine + '/index.ts')
    const { createBatchGpu } = await import('/sandbox/ascii-optimizer/engine/video-gpu-20261010-r1/batch-gpu.ts')
    await document.fonts.ready
    await window.recordProgress({ stage: 'fonts-ready', hidden: document.hidden })
    const image = new Image(); image.src = '/artwork/portrait.jpg'; await image.decode()
    const core = createArtCore(ART_DEFAULTS, '2.2.0-frozen')
    const records = []
    const pct = (a, p) => [...a].sort((a, b) => a - b)[Math.ceil(a.length * p) - 1]
    let device
    for (const mode of ['density', 'color', 'phrase']) {
      for (const [columns, edge] of [[80, 720], [180, 1920], [400, 3840]]) {
        const preparedAt = performance.now()
        const frame = core.prepareArtFrame(image, image.naturalWidth, image.naturalHeight, { mode, columns, phrase: '山河与光影', fontFamily: '"Microsoft YaHei", sans-serif' })
        const preparedMs = performance.now() - preparedAt
        for (const path of ['canvas2d', 'native-geometry-gpu-batch']) {
          await window.recordProgress({ mode, columns, edge, path, stage: 'render' })
          const target = document.createElement('canvas')
          const gpu = path === 'canvas2d' ? null : createBatchGpu()
          if (path !== 'canvas2d' && !gpu) throw new Error('WebGL2 unavailable')
          device = gpu?.device ?? device
          const renderer = createCanvasArtRenderer(target, gpu?.hooks)
          const costs = [], field = [], samples = []
          let stoppedEarly = false
          for (let i = 0; i < 14; i++) {
            const t = i / 60
            const options = { longEdge: edge, effectProfile: 'expressive', motion: 'wave', motionStyle: 'cinematic', hover: 'trail', hoverStrength: .45, hoverRadius: .38,
              time: t, hoverTime: t, pointer: { x: .2 + i * .04, y: .5, strength: .45, active: true },
              pointerSamples: [{ x: .2 + i * .04, y: .5, time: t * 1000, active: true }] }
            const start = performance.now()
            renderer.render(frame, options)
            if (gpu) gpu.finish()
            else target.getContext('2d').getImageData(0, 0, 1, 1)
            const elapsed = performance.now() - start
            if (i >= 4 || elapsed > 100) costs.push(elapsed)
            if (i === 13 || elapsed > 100) {
              const rendered = gpu?.surface ?? target
              // Early-stop paths and completed paths capture different timeline frames.
              // These images are observations, not pixel-parity evidence.
              const copy = document.createElement('canvas'); copy.width = rendered.width; copy.height = rendered.height
              copy.getContext('2d').drawImage(rendered, 0, 0)
              samples.push(copy.toDataURL('image/png'))
            }
            if (elapsed > 100) { stoppedEarly = true; break }
            await new Promise((resolve) => setTimeout(resolve, 0))
          }
          const record = { mode, columns, edge, path, preparedMs, costs, p50Ms: pct(costs, .5), p95Ms: pct(costs, .95), frameBudgetPassed: !stoppedEarly && pct(costs, .95) <= 16.67, captures: samples, field, stoppedEarly }
          records.push(record)
          await window.recordCompleted(record)
          renderer.destroy(); gpu?.destroy()
        }
      }
    }
    return { records, device, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: navigator.deviceMemory, dpr: devicePixelRatio, font: 'Microsoft YaHei', viewport: [innerWidth, innerHeight] }
  }, { engine, root })
  clearTimeout(deadline)
  const records = results.records
  for (const [index, record] of records.entries()) {
    const bytes = Buffer.from(record.captures[0].split(',')[1], 'base64')
    record.artifact = `${index}-${record.mode}-${record.columns}-${record.path}.png`
    record.artifactHash = hash(bytes)
    await writeFile(path.join(root, record.artifact), bytes)
    delete record.captures
  }
  const report = { experimentId: experiment, engineCommit: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(), frozenCanvasHash: frozenHash,
    gpuSourceHash: hash(await readFile('sandbox/ascii-optimizer/engine/video-gpu-20261010-r1/batch-gpu.ts')),
    harnessHash: hash(await readFile('sandbox/ascii-optimizer/scripts/video-gpu-feasibility.mjs')),
    parameters: { modes: ['density', 'color', 'phrase'], columnsAndLongEdge: [[80, 720], [180, 1920], [400, 3840]], phrase: '山河与光影', effectProfile: 'expressive', motion: 'wave', motionStyle: 'cinematic', hover: 'trail', hoverStrength: .45, hoverRadius: .38, timeStep: 1 / 60 },
    earlyStop: 'Any frame over 100ms ends that path; the first slow frame is a cold observation, not a warmed percentile',
    screenshotComparability: 'Early-stop and completed paths have different capture times; do not use these screenshots for pixel parity',
    candidateCanvasHash: hash(canvas), inputHash: hash(await readFile('public/artwork/portrait.jpg')), dataset: 'Single repository portrait feasibility probe; no train/holdout claims',
    evaluatorVersion: 'native-glyph-batch-v1', seed: 42, budget: '18 paths, 4 warmup + 10 samples; no paid judge; no production renderer promotion',
    browser: await browser.version(), scope: 'Detached renderer including GPU finish; excludes browser presentation, live decode and multi-device 60fps certification', ...results }
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report.records.map(({ mode, columns, path, p50Ms, p95Ms }) => ({ mode, columns, path, p50Ms, p95Ms }))))
} finally { clearTimeout(deadline); await browser.close() }
