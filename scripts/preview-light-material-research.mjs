import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_LIGHT_MATERIAL_OUTPUT || `test-results/preview-light-material-${Date.now()}`)
await mkdir(out, { recursive: true })
const frozen = execFileSync('git', ['show', '92bc304:src/lib/art-engine/canvas.ts'], { encoding: 'utf8' }).replaceAll('\r\n', '\n')
const replace = (source, from, to) => { assert(source.includes(from), 'Missing material anchor: ' + from); return source.replace(from, to) }
let candidate = frozen
candidate = replace(candidate, '  const tinted = new Map<string, HTMLCanvasElement | ImageBitmap>()', `  const tinted = new Map<string, HTMLCanvasElement | ImageBitmap>()
  const lightTinted = new Map<string, HTMLCanvasElement | ImageBitmap>()
  const lightLimit = 2 * 1024 * 1024
  let lightGlyphs: ArtFrame['glyphs'] | null = null
  let lightGeometry = ''
  let lightBytes = 0, lightHits = 0, lightMisses = 0`)
candidate = replace(candidate, '  function tile(glyphIndex: number, color: string) {\n    const key', `  function tile(glyphIndex: number, color: string, fixedLight = false) {
    const cache = fixedLight ? lightTinted : tinted
    const key`)
candidate = replace(candidate, '    const existing = tinted.get(key)', '    const existing = cache.get(key)')
candidate = replace(candidate, '      hits++\n      return existing', '      hits++\n      if (fixedLight) lightHits++\n      return existing')
candidate = replace(candidate, '    misses++\n    scratch', '    misses++\n    if (fixedLight) lightMisses++\n    scratch')
candidate = replace(candidate, '    if (tinted.size >= maxEntries || backingBytes + bytes > maxBackingBytes) return scratch', `    if ((fixedLight ? lightBytes + bytes > lightLimit : tinted.size >= maxEntries) || backingBytes + lightBytes + bytes > maxBackingBytes) return scratch`)
candidate = replace(candidate, '    tinted.set(key, result)\n    backingBytes += bytes', '    cache.set(key, result)\n    if (fixedLight) lightBytes += bytes\n    else backingBytes += bytes')
candidate = replace(candidate, '  function clearTiles() {', `  function clearLightTiles() {
    for (const value of lightTinted.values()) if ('close' in value) value.close()
    lightTinted.clear(); lightGlyphs = null; lightGeometry = ''; lightBytes = 0
  }

  function clearTiles() {`)
candidate = replace(candidate, '        const glyphLight = tile(e.glyph, lightColor),', '        const glyphLight = tile(e.glyph, lightColor, !effect.motionLight && !effect.sourceLight && !effect.cinematicLight),')
candidate = replace(candidate, '    frame = next\n    if (current !== frame)', `    frame = next
    const geometry = frame.cellWidth + ':' + frame.cellHeight
    if (lightGlyphs !== frame.glyphs || lightGeometry !== geometry) {
      clearLightTiles(); lightGlyphs = frame.glyphs; lightGeometry = geometry
    }
    if (current !== frame)`)
candidate = replace(candidate, '      current = null\n      clearTiles()', '      current = null\n      clearLightTiles()\n      clearTiles()')
candidate = replace(candidate, '    get cacheStats() {', '    get lightMaterialStats() { return { entries: lightTinted.size, bytes: lightBytes, limit: lightLimit, hits: lightHits, misses: lightMisses, totalBackingBytes: backingBytes + lightBytes } },\n    get cacheStats() {')
candidate = replace(candidate, '        backingBytes,\n        maxBackingBytes,', '        backingBytes: backingBytes + lightBytes,\n        maxBackingBytes,')
const prepare = text => text.replace("from './types'", "from '/src/lib/art-engine/types'")
await writeFile(path.join(out, 'frozen.ts'), prepare(frozen))
await writeFile(path.join(out, 'candidate.ts'), prepare(candidate))
let patch
try { patch = execFileSync('git', ['diff', '--no-index', path.join(out, 'frozen.ts'), path.join(out, 'candidate.ts')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) }
catch (error) { if (error.status !== 1) throw error; patch = error.stdout }
await writeFile(path.join(out, 'candidate.patch'), patch)
const workerSource = (await readFile('src/lib/art-engine/frame-render.worker.ts', 'utf8')).replace("from './canvas'", "from './candidate'").replace("from './types'", "from '/src/lib/art-engine/types'").replace("from './frame-render-protocol'", "from '/src/lib/art-engine/frame-render-protocol'").replace('cacheStats: renderer.cacheStats,', 'cacheStats: renderer.cacheStats, lightMaterialStats: renderer.lightMaterialStats,')
await writeFile(path.join(out, 'material-frame.worker.ts'), workerSource)
if (process.env.ASTRA_LIGHT_MATERIAL_BUILD_ONLY === '1') { console.log(JSON.stringify({ out, generated: true })); process.exit(0) }
const prefix = '/' + path.relative(process.cwd(), out).split(path.sep).join('/')
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'chrome', headless: true })
const report = { browser: browser.version(), parent: '92bc304', sourceHash: createHash('sha256').update(frozen).digest('hex'), candidateHash: createHash('sha256').update(candidate).digest('hex'), scope: 'Independent immutable fixed-color glow glyph reuse. Native source-in and primitive geometry unchanged, original main 64 entries unchanged, combined native backing <=16MiB and constant light <=2MiB. Neither atlas, software tint nor a temporary pool-size sweep. Full alpha/RGB parity required before cost. No production change or stable FPS claim.', cases: [], passed: false }
const save = () => writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
try {
  const page = await browser.newPage()
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/ascii-art')
  const modes = (process.env.ASTRA_LIGHT_MATERIAL_MODES || 'density,color,phrase,contour,braille,halftone').split(',')
  for (const mode of modes) {
    const cases = await page.evaluate(async ({ prefix, mode }) => {
      const { createCanvasArtRenderer: frozen } = await import(prefix + '/frozen.ts')
      const { createCanvasArtRenderer: candidate } = await import(prefix + '/candidate.ts')
      const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
      const image = new Image(); image.src = '/artwork/porcelain-study-v1.png'; await image.decode()
      const frame = prepareArtFrame(image, image.width, image.height, { mode, columns: 72, colored: mode === 'color' || mode === 'phrase', phrase: '把名字写成光，ASTRA。', fontFamily: mode === 'phrase' ? 'Microsoft YaHei, monospace' : 'Consolas, monospace' })
      const records = []
      for (const transparent of [false, true]) {
        const a = new OffscreenCanvas(1, 1), b = new OffscreenCanvas(1, 1)
        a.getContext('2d', { willReadFrequently: false }); b.getContext('2d', { willReadFrequently: false })
        const hooks = { createSurface: () => new OffscreenCanvas(1, 1), maxTileEntries: 64 }
        const old = frozen(a, hooks), now = candidate(b, hooks)
        const options = { longEdge: 571, hover: 'light', hoverStrength: .65, hoverRadius: .38, effectProfile: 'expressive', motion: 'none', transparent }
        const events = [{ x: .2, y: .4, active: false, time: 0 }, { x: .2, y: .4, active: true, time: 33 }, { x: .7, y: .55, active: true, time: 66 }, { x: .7, y: .55, active: true, time: 200 }, { x: .7, y: .55, active: false, time: 233 }, { x: .7, y: .55, active: false, time: 3000 }]
        try {
          for (const event of events) {
            const renderOptions = { ...options, hoverTime: event.time / 1000, pointer: { ...event, strength: event.active ? .65 : 0 }, pointerSamples: [event] }
            const cloned = { ...frame, indices: frame.indices.slice(), alpha: frame.alpha.slice(), colors: frame.colors.slice() }
            old.render(cloned, renderOptions); now.render(cloned, renderOptions)
            const expected = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, actual = b.getContext('2d').getImageData(0, 0, b.width, b.height).data
            let changed = 0, maxDelta = 0
            for (let i = 0; i < expected.length; i++) { const delta = Math.abs(expected[i] - actual[i]); if (delta) changed++; maxDelta = Math.max(maxDelta, delta) }
            records.push({ mode, transparent, time: event.time, changed, maxDelta, stats: now.lightMaterialStats })
          }
        } finally { old.destroy(); now.destroy() }
        records.push({ mode, transparent, release: now.lightMaterialStats })
      }
      return records
    }, { prefix, mode })
    report.cases.push(...cases); await save()
    assert(cases.filter(c => 'changed' in c).every(c => c.changed === 0), 'Every channel must match, including transparent RGB')
    assert(cases.filter(c => c.release).every(c => c.release.bytes === 0 && c.release.entries === 0))
    console.log('light-material: ' + mode + ' exact parity/release passed')
  }
  assert(report.cases.some(c => c.stats?.hits > 0), 'Constant light material must actually reuse its native glyphs')
  if (process.env.ASTRA_LIGHT_MATERIAL_PARITY_ONLY !== '1') {
    report.cost = []
    for (const mode of ['color', 'phrase']) {
      const result = await page.evaluate(async ({ prefix, mode }) => {
        const { createCanvasArtRenderer: frozen } = await import(prefix + '/frozen.ts')
        const { createCanvasArtRenderer: candidate } = await import(prefix + '/candidate.ts')
        const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
        const image = new Image(); image.src = '/artwork/porcelain-study-v1.png'; await image.decode()
        const frame = prepareArtFrame(image, image.width, image.height, { mode, columns: 180, colored: true, phrase: '把名字写成光，ASTRA。', fontFamily: mode === 'phrase' ? 'Microsoft YaHei, monospace' : 'Consolas, monospace' })
        const a = new OffscreenCanvas(1, 1), b = new OffscreenCanvas(1, 1)
        a.getContext('2d', { willReadFrequently: false }); b.getContext('2d', { willReadFrequently: false })
        const hooks = { createSurface: () => new OffscreenCanvas(1, 1), maxTileEntries: 64 }
        const old = frozen(a, hooks), now = candidate(b, hooks)
        const records = []
        const events = [{ x: .2, y: .4, active: false, time: 0 }, ...Array.from({ length: 8 }, (_, i) => ({ x: .15 + .7 * i / 7, y: .5 + Math.sin(i / 7 * Math.PI * 2) * .14, active: true, time: 33 * (i + 1) })), { x: .85, y: .5, active: false, time: 5000 }]
        try {
          for (let i = 0; i < events.length; i++) {
            const event = events[i], options = { longEdge: 713, hover: 'light', hoverStrength: .65, hoverRadius: .38, effectProfile: 'expressive', motion: 'none', hoverTime: event.time / 1000, pointer: { ...event, strength: event.active ? .65 : 0 }, pointerSamples: [event] }
            const pair = i % 2 ? [['candidate', now, b], ['frozen', old, a]] : [['frozen', old, a], ['candidate', now, b]], timings = {}
            for (const [name, renderer, surface] of pair) {
              const cloned = { ...frame, indices: frame.indices.slice(), alpha: frame.alpha.slice(), colors: frame.colors.slice() }
              const start = performance.now(); renderer.render(cloned, options); surface.getContext('2d').getImageData(0, 0, 1, 1)
              timings[name] = performance.now() - start
            }
            const expected = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, actual = b.getContext('2d').getImageData(0, 0, b.width, b.height).data
            let changed = 0, maxDelta = 0
            for (let p = 0; p < expected.length; p++) { const delta = Math.abs(expected[p] - actual[p]); if (delta) changed++; maxDelta = Math.max(maxDelta, delta) }
            records.push({ inputFrame: i, changed, maxDelta, timings, stats: now.lightMaterialStats })
          }
          const measured = records.filter(r => r.inputFrame >= 3 && r.inputFrame <= 8)
          const summary = name => {
            const values = measured.map(r => r.timings[name]).sort((a, b) => a - b)
            const q = p => { const at = (values.length - 1) * p, lo = Math.floor(at); return values[lo] + (values[Math.min(lo + 1, values.length - 1)] - values[lo]) * (at - lo) }
            return { samples: values.length, p50: q(.5), p95: q(.95) }
          }
          return { mode, columns: frame.columns, rows: frame.rows, width: a.width, height: a.height, records, summary: { frozen: summary('frozen'), candidate: summary('candidate') } }
        } finally { old.destroy(); now.destroy() }
      }, { prefix, mode })
      report.cost.push(result); await save()
      assert(result.records.every(r => r.changed === 0))
      console.log('light-material: ' + mode + ' high-density paired cost complete')
    }
  }
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await save(); await browser.close() }
console.log(JSON.stringify({ out, passed: report.passed, failure: report.failure }))
