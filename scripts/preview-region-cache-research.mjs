import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_REGION_OUTPUT || `test-results/preview-region-${Date.now()}`)
const revision = process.env.ASTRA_REGION_REVISION || 'r2'
assert(['r1', 'r2'].includes(revision), 'Unknown region-cache revision')
await mkdir(out, { recursive: true })
const frozen = execFileSync('git', ['show', '92bc304:src/lib/art-engine/canvas.ts'], { encoding: 'utf8' }).replaceAll('\r\n', '\n')
const replace = (source, from, to) => { assert(source.includes(from), 'Missing research anchor: ' + from); return source.replace(from, to) }
let candidate = frozen
candidate = replace(candidate, '  const riftPresentation = createRiftPresentation()', `  let neutralCache: HTMLCanvasElement | null = null
  let neutralFrame: ArtFrame | null = null
  let neutralKey = ''
  let regionStats = { hits: 0, patches: 0, full: 0, bytes: 0, area: 1 }
  const riftPresentation = createRiftPresentation()`)
candidate = replace(candidate, '    const time = options.time ?? 0,\n      motion = options.motion ?? \'none\'\n    let sliceStart', `    const regionEligible = effect.expressive && scale === 1 && (options.motion ?? 'none') === 'none'
    const cacheKey = JSON.stringify([w, h, options.transparent, frame.settings])
    const sameFrame = neutralFrame !== null && neutralFrame.glyphs === frame.glyphs && neutralFrame.width === frame.width && neutralFrame.height === frame.height && neutralFrame.columns === frame.columns && neutralFrame.rows === frame.rows && neutralFrame.cellWidth === frame.cellWidth && neutralFrame.cellHeight === frame.cellHeight && neutralFrame.indices.length === frame.indices.length && neutralFrame.indices.every((v, i) => v === frame.indices[i]) && neutralFrame.alpha.length === frame.alpha.length && neutralFrame.alpha.every((v, i) => v === frame.alpha[i]) && neutralFrame.colors.length === frame.colors.length && neutralFrame.colors.every((v, i) => v === frame.colors[i])
    if (!sameFrame || neutralKey !== cacheKey || !regionEligible) {
      if (neutralCache) neutralCache.width = neutralCache.height = 1
      neutralCache = null; neutralFrame = null; neutralKey = ''; regionStats.bytes = 0
    }
    let region: { left: number; top: number; right: number; bottom: number } | null = null
    let neutral = regionEligible
    if (regionEligible) {
      let left = w, top = h, right = 0, bottom = 0
      for (let y = 0; y < frame.rows; y++) for (let x = 0; x < frame.columns; x++) {
        const index = y * frame.columns + x, alpha = frame.alpha[index]!, glyph = frame.indices[index]!
        const e = effect.cell(x, y, cw, ch, alpha)
        const wasVisible = alpha >= .005 && frame.glyphs[glyph]!.coverage >= .001
        const isVisible = e.opacity >= .005 && frame.glyphs[e.glyph]!.coverage >= .001
        const changed = wasVisible !== isVisible || ((wasVisible || isVisible) && (e.dx !== 0 || e.dy !== 0 || e.intensity !== 1 || e.opacity !== alpha || e.glyph !== glyph || e.size !== 1))
        if (!changed) continue
        neutral = false
        const dw = cw * e.size, dh = ch * e.size
        left = Math.min(left, x * cw - 2, x * cw + e.dx + (cw - dw) * .5 - 2)
        top = Math.min(top, y * ch - 2, y * ch + e.dy + (ch - dh) * .5 - 2)
        right = Math.max(right, (x + 1) * cw + 2, x * cw + e.dx + (cw + dw) * .5 + 2)
        bottom = Math.max(bottom, (y + 1) * ch + 2, y * ch + e.dy + (ch + dh) * .5 + 2)
      }
      if (!neutral) region = { left: Math.max(0, Math.floor(left)), top: Math.max(0, Math.floor(top)), right: Math.min(w, Math.ceil(right)), bottom: Math.min(h, Math.ceil(bottom)) }
    }
    let patching = false, skipMain = false
    regionStats.area = region ? (region.right - region.left) * (region.bottom - region.top) / (w * h) : (neutral ? 0 : 1)
    if (neutralCache && (neutral || regionStats.area < .8)) {
      ctx.globalCompositeOperation = 'copy'
      ctx.drawImage(neutralCache, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      if (neutral) { skipMain = true; regionStats.hits++ }
      else if (region) {
        ctx.save(); ctx.beginPath(); ctx.rect(region.left, region.top, region.right - region.left, region.bottom - region.top); ctx.clip()
        ctx.clearRect(0, 0, w, h)
        if (!options.transparent) { ctx.fillStyle = frame.settings.background; ctx.fillRect(0, 0, w, h) }
        patching = true; regionStats.patches++
      }
    } else regionStats.full++
    const time = options.time ?? 0,
      motion = options.motion ?? 'none'
    let sliceStart`)
candidate = replace(candidate, '    for (let y = 0; y < frame.rows; y++)\n      for (let x = 0; x < frame.columns; x++) {\n        const cell = y * frame.columns + x,', '    for (let y = 0; !skipMain && y < frame.rows; y++)\n      for (let x = 0; x < frame.columns; x++) {\n        const cell = y * frame.columns + x,')
candidate = replace(candidate, '        ctx.drawImage(\n          tile(index, color),', `        if (patching && region && (x * cw + dx + (cw + dw) * .5 + 2 < region.left || x * cw + dx + (cw - dw) * .5 - 2 > region.right || y * ch + dy + (ch + dh) * .5 + 2 < region.top || y * ch + dy + (ch - dh) * .5 - 2 > region.bottom)) continue
        ctx.drawImage(
          tile(index, color),`)
candidate = replace(candidate, '    ctx.globalAlpha = 1\n    if (ctx !== outputCtx)', `    if (patching) ctx.restore()
    ctx.globalAlpha = 1
    const snapshotBytes = frame.indices.byteLength + frame.alpha.byteLength + frame.colors.byteLength
    if (neutral && !neutralCache && w * h * 4 + snapshotBytes <= 16 * 1024 * 1024) {
      neutralCache = canvas(w, h); neutralCache.getContext('2d')!.globalCompositeOperation = 'copy'; neutralCache.getContext('2d')!.drawImage(target, 0, 0)
      neutralFrame = { ...frame, indices: frame.indices.slice(), alpha: frame.alpha.slice(), colors: frame.colors.slice() }; neutralKey = cacheKey; regionStats.bytes = w * h * 4 + snapshotBytes
    }
    if (ctx !== outputCtx)`)
candidate = replace(candidate, '    get cacheStats() {', '    get regionStats() { return { ...regionStats } },\n    get cacheStats() {')
candidate = replace(candidate, '    destroy() {\n      particlePresentation.destroy()', `    destroy() {
      if (neutralCache) neutralCache.width = neutralCache.height = 1
      neutralCache = null; neutralFrame = null; neutralKey = ''; regionStats.bytes = 0
      particlePresentation.destroy()
`)
if (revision === 'r2') {
  candidate = replace(candidate, "        ctx.save(); ctx.beginPath(); ctx.rect(region.left, region.top, region.right - region.left, region.bottom - region.top); ctx.clip()\n        ctx.clearRect(0, 0, w, h)\n        if (!options.transparent) { ctx.fillStyle = frame.settings.background; ctx.fillRect(0, 0, w, h) }", "        ctx.clearRect(region.left, region.top, region.right - region.left, region.bottom - region.top)\n        if (!options.transparent) { ctx.fillStyle = frame.settings.background; ctx.fillRect(region.left, region.top, region.right - region.left, region.bottom - region.top) }")
  candidate = replace(candidate, '    if (patching) ctx.restore()', `    if (patching && region) {
      // Native glyph quads remain unclipped. Restore incidental unchanged ink
      // outside the patch with integer, nearest-neighbour pixel copies.
      ctx.save(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'copy'; ctx.imageSmoothingEnabled = false
      const outside = [[0, 0, w, region.top], [0, region.bottom, w, h - region.bottom], [0, region.top, region.left, region.bottom - region.top], [region.right, region.top, w - region.right, region.bottom - region.top]]
      ctx.beginPath()
      for (const [x, y, width, height] of outside) if (width! > 0 && height! > 0) ctx.rect(x!, y!, width!, height!)
      ctx.clip(); ctx.drawImage(neutralCache!, 0, 0)
      ctx.restore()
    }`)
}
const prepare = source => source.replace("from './types'", "from '/src/lib/art-engine/types'")
await writeFile(path.join(out, 'frozen.ts'), prepare(frozen))
await writeFile(path.join(out, 'candidate.ts'), prepare(candidate))
let patch
try { patch = execFileSync('git', ['diff', '--no-index', path.join(out, 'frozen.ts'), path.join(out, 'candidate.ts')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }
catch (error) { if (error.status !== 1) throw error; patch = error.stdout }
await writeFile(path.join(out, 'candidate.patch'), patch)
const workerSource = (await readFile('src/lib/art-engine/frame-render.worker.ts', 'utf8')).replace("from './canvas'", "from './candidate'").replace("from './types'", "from '/src/lib/art-engine/types'").replace("from './frame-render-protocol'", "from '/src/lib/art-engine/frame-render-protocol'").replace('cacheStats: renderer.cacheStats,', 'cacheStats: renderer.cacheStats, regionStats: renderer.regionStats,')
await writeFile(path.join(out, 'region-frame.worker.ts'), workerSource)
if (process.env.ASTRA_REGION_BUILD_ONLY === '1') { console.log(JSON.stringify({ out, revision, generated: true })); process.exit(0) }
const prefix = '/' + path.relative(process.cwd(), out).split(path.sep).join('/')
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'chrome', headless: true })
const report = { browser: browser.version(), parent: '92bc304', revision, sourceHash: createHash('sha256').update(frozen).digest('hex'), candidateHash: createHash('sha256').update(candidate).digest('hex'), scope: 'Independent same-frame static base and exact bounding-rectangle redraw candidate. Original six modes/alpha/RGB, 64 tiles, actual OffscreenCanvas readback. No production change, approximation, or FPS claim; completed measurements do not approve production performance.', cases: [], passed: false }
try {
  const page = await browser.newPage()
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/ascii-art')
  for (const mode of ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']) {
    const cases = await page.evaluate(async ({ prefix, mode }) => {
      const { createCanvasArtRenderer: frozen } = await import(prefix + '/frozen.ts')
      const { createCanvasArtRenderer: candidate } = await import(prefix + '/candidate.ts')
      const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
      const image = new Image(); image.src = '/artwork/porcelain-study-v1.png'; await image.decode()
      const frame = prepareArtFrame(image, image.width, image.height, { mode, columns: 72, colored: mode === 'color' || mode === 'phrase', phrase: '把名字写成光，ASTRA。', fontFamily: mode === 'phrase' ? 'Microsoft YaHei, monospace' : 'Consolas, monospace' })
      const records = []
      for (const transparent of [false, true]) for (const hover of ['light', 'particles']) {
        const a = new OffscreenCanvas(1, 1), b = new OffscreenCanvas(1, 1)
        a.getContext('2d', { willReadFrequently: false }); b.getContext('2d', { willReadFrequently: false })
        const hooks = { createSurface: () => new OffscreenCanvas(1, 1), maxTileEntries: 64 }
        const old = frozen(a, hooks), now = candidate(b, hooks)
        const options = { longEdge: 571, hover, hoverStrength: .65, hoverRadius: .38, effectProfile: 'expressive', motion: 'none', transparent }
        let maxDelta = 0, changed = 0
        try {
          const events = [{ x: .2, y: .4, active: false, time: 0 }, { x: .2, y: .4, active: true, time: 33 }, { x: .7, y: .55, active: true, time: 66 }, { x: .7, y: .55, active: true, time: 200 }, { x: .7, y: .55, active: false, time: 233 }, { x: .7, y: .55, active: false, time: 3000 }]
          for (const event of events) {
            const renderOptions = { ...options, hoverTime: event.time / 1000, pointer: { ...event, strength: event.active ? .65 : 0 }, pointerSamples: [event] }
            const cloned = { ...frame, indices: frame.indices.slice(), alpha: frame.alpha.slice(), colors: frame.colors.slice() }
            old.render(cloned, renderOptions); now.render(cloned, renderOptions)
            const expected = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, actual = b.getContext('2d').getImageData(0, 0, b.width, b.height).data
            let frameChanges = 0, frameMax = 0
            for (let i = 0; i < expected.length; i++) { const delta = Math.abs(expected[i] - actual[i]); if (delta) frameChanges++; frameMax = Math.max(frameMax, delta) }
            changed += frameChanges; maxDelta = Math.max(maxDelta, frameMax)
            records.push({ mode, transparent, hover, time: event.time, changed: frameChanges, maxDelta: frameMax, ...now.regionStats })
          }
        } finally { old.destroy(); now.destroy() }
      }
      return records
    }, { prefix, mode })
    report.cases.push(...cases)
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
    console.log('region-cache: ' + mode + ' complete, differences ' + cases.filter(c => c.changed).length)
  }
  assert(report.cases.every(c => c.changed === 0), 'Every alpha/RGB channel must match, including transparent pixels')
  report.worker = await page.evaluate(async prefix => {
    const { createCanvasArtRenderer: frozen } = await import(prefix + '/frozen.ts')
    const { createFrameRenderWorker } = await import('/src/lib/art-engine/frame-render-client.ts')
    const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
    const image = new Image(); image.src = '/artwork/porcelain-study-v1.png'; await image.decode()
    const frame = prepareArtFrame(image, image.width, image.height, { mode: 'phrase', columns: 72, colored: true, phrase: '把名字写成光，ASTRA。', fontFamily: 'Microsoft YaHei, monospace' })
    const Native = window.Worker
    window.Worker = class extends Native {
      constructor(url, options) { super(String(url).includes('frame-render.worker') ? prefix + '/region-frame.worker.ts?worker_file&type=module' : url, options) }
    }
    let resolve, reject
    const canvas = document.createElement('canvas'), reference = document.createElement('canvas')
    canvas.getContext('2d', { willReadFrequently: false }); reference.getContext('2d', { willReadFrequently: false })
    const renderer = frozen(reference)
    const worker = createFrameRenderWorker(result => {
      canvas.width = result.bitmap.width; canvas.height = result.bitmap.height
      canvas.getContext('2d').drawImage(result.bitmap, 0, 0)
      resolve({ stats: result.regionStats, active: result.interactionActive, renderMs: result.renderMs })
    }, () => reject(new Error('Experimental real Worker failed')))
    if (!worker) throw new Error('Real Worker support required')
    const records = []
    try {
      const events = [{ x: .2, y: .4, active: false, time: 0 }, { x: .2, y: .4, active: true, time: 33 }, { x: .7, y: .55, active: true, time: 66 }, { x: .7, y: .55, active: false, time: 99 }, { x: .7, y: .55, active: false, time: 5000 }]
      for (const event of events) {
        const options = { longEdge: 571, hover: 'particles', hoverStrength: .65, hoverRadius: .38, effectProfile: 'expressive', motion: 'none', hoverTime: event.time / 1000, pointer: { ...event, strength: event.active ? .65 : 0 }, pointerSamples: [event] }
        renderer.render(frame, options)
        const completed = await new Promise((r, j) => { resolve = r; reject = j; worker.render(frame, options) })
        const expected = reference.getContext('2d').getImageData(0, 0, reference.width, reference.height).data, actual = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        let changed = 0, maxDelta = 0
        for (let i = 0; i < expected.length; i++) { const delta = Math.abs(expected[i] - actual[i]); if (delta) changed++; maxDelta = Math.max(maxDelta, delta) }
        records.push({ time: event.time, changed, maxDelta, ...completed })
      }
    } finally { worker.dispose(); renderer.destroy(); window.Worker = Native }
    return records
  }, prefix)
  assert(report.worker.every(r => r.changed === 0), 'Structured-clone Worker frames preserve exact Chinese pixels')
  assert(report.worker.some(r => r.stats.hits > 0) && report.worker.some(r => r.stats.patches > 0), 'Real Worker must actually reuse the content snapshot and redraw regions')
  console.log('region-cache: real Worker clone/reuse/Chinese RGBA complete')
  if (process.env.ASTRA_REGION_PARITY_ONLY !== '1') {
    report.performance = []
    for (const mode of ['color', 'phrase']) for (const hover of ['light', 'particles']) {
      const record = await page.evaluate(async ({ prefix, mode, hover }) => {
        const { createCanvasArtRenderer: frozen } = await import(prefix + '/frozen.ts')
        const { createCanvasArtRenderer: candidate } = await import(prefix + '/candidate.ts')
        const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
        const image = new Image(); image.src = '/artwork/porcelain-study-v1.png'; await image.decode()
        const frame = prepareArtFrame(image, image.width, image.height, { mode, columns: 180, colored: true, phrase: '把名字写成光，ASTRA。', fontFamily: mode === 'phrase' ? 'Microsoft YaHei, monospace' : 'Consolas, monospace' })
        const a = new OffscreenCanvas(1, 1), b = new OffscreenCanvas(1, 1)
        a.getContext('2d', { willReadFrequently: false }); b.getContext('2d', { willReadFrequently: false })
        const hooks = { createSurface: () => new OffscreenCanvas(1, 1), maxTileEntries: 64 }
        const old = frozen(a, hooks), now = candidate(b, hooks)
        const records = [], samples = { frozen: [], candidate: [] }
        const events = [{ x: .45, y: .45, active: false, time: 0 }, ...Array.from({ length: 7 }, (_, i) => ({ x: .45 + i * .005, y: .45 + Math.sin(i * .4) * .008, active: true, time: (i + 1) * 33 })), { x: .48, y: .45, active: false, time: 5000 }]
        try {
          for (let i = 0; i < events.length; i++) {
            const event = events[i], options = { longEdge: 713, hover, hoverStrength: .65, hoverRadius: .38, effectProfile: 'expressive', motion: 'none', hoverTime: event.time / 1000, pointer: { ...event, strength: event.active ? .65 : 0 }, pointerSamples: [event] }
            const pair = i % 2 ? [['candidate', now, b], ['frozen', old, a]] : [['frozen', old, a], ['candidate', now, b]]
            const timings = {}
            for (const [name, renderer, canvas] of pair) {
              const cloned = { ...frame, indices: frame.indices.slice(), alpha: frame.alpha.slice(), colors: frame.colors.slice() }
              const start = performance.now(); renderer.render(cloned, options); canvas.getContext('2d').getImageData(0, 0, 1, 1)
              timings[name] = performance.now() - start
              if (i >= 2 && i <= 7) samples[name].push(timings[name])
            }
            const expected = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, actual = b.getContext('2d').getImageData(0, 0, b.width, b.height).data
            let changed = 0, maxDelta = 0
            for (let p = 0; p < expected.length; p++) { const delta = Math.abs(expected[p] - actual[p]); if (delta) changed++; maxDelta = Math.max(maxDelta, delta) }
            records.push({ inputFrame: i, time: event.time, ...timings, changed, maxDelta, peak: now.cacheStats.particles.peak, ...now.regionStats })
          }
          const summary = values => {
            const sorted = values.slice().sort((a, b) => a - b)
            const quantile = p => { const rank = (sorted.length - 1) * p, lo = Math.floor(rank), hi = Math.ceil(rank); return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo) }
            return { count: values.length, quantileMethod: 'linear interpolation at (n-1)*p', p50: quantile(.5), p95: quantile(.95) }
          }
          return { mode, hover, columns: frame.columns, rows: frame.rows, width: a.width, height: a.height, samples: { frozen: summary(samples.frozen), candidate: summary(samples.candidate) }, records }
        } finally { old.destroy(); now.destroy() }
      }, { prefix, mode, hover })
      report.performance.push(record)
      await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
      console.log('region-cache: paired dense ' + mode + '/' + hover + ' complete')
      assert(record.records.every(r => r.changed === 0), 'Dense paired input still requires exact RGBA')
      if (hover === 'particles') assert(record.records.some(r => r.peak > .005), 'Timed scatter must visibly activate')
    }
  }
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ out, passed: report.passed, failure: report.failure }))
