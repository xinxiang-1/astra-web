import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_PROFILE_OUTPUT || `test-results/preview-frame-profile-${Date.now()}`)
await mkdir(out, { recursive: true })
const source = (await readFile('src/lib/art-engine/canvas.ts', 'utf8')).replaceAll('\r\n', '\n')
const change = (text, from, to) => {
  if (!text.includes(from)) throw new Error('Profile anchor missing: ' + from)
  return text.replace(from, to)
}
let instrumented = source.replace("from './types'", "from '/src/lib/art-engine/types'")
instrumented = change(instrumented, '  const riftPresentation = createRiftPresentation()', '  let profile = { effectsMs: 0, glyphMs: 0, glowMs: 0, tiles: 0 }\n  const riftPresentation = createRiftPresentation()')
instrumented = change(instrumented, '  function tile(glyphIndex: number, color: string) {', '  function tile(glyphIndex: number, color: string) {\n    profile.tiles++')
instrumented = change(instrumented, '    const effect = yield* effects(options, w, h)', '    profile = { effectsMs: 0, glyphMs: 0, glowMs: 0, tiles: 0 }\n    const effect = yield* effects(options, w, h)\n    profile.effectsMs = performance.now() - start')
instrumented = change(instrumented, '    const quality =\n', '    const glyphStart = performance.now()\n    const quality =\n')
instrumented = change(instrumented, '    renderGlow(effect, w, h)\n    return { width: w, height: h, renderMs:', '    outputCtx.getImageData(0, 0, 1, 1)\n    profile.glyphMs = performance.now() - glyphStart\n    const glowStart = performance.now()\n    renderGlow(effect, w, h)\n    outputCtx.getImageData(0, 0, 1, 1)\n    profile.glowMs = performance.now() - glowStart\n    return { width: w, height: h, renderMs:')
instrumented = change(instrumented, '    get cacheStats() {', '    get profile() { return { ...profile } },\n    get cacheStats() {')
await writeFile(path.join(out, 'profile.ts'), instrumented)
const url = '/' + path.relative(process.cwd(), path.join(out, 'profile.ts')).split(path.sep).join('/')
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'chrome', headless: true })
const report = { browser: browser.version(), sourceHash: createHash('sha256').update(source).digest('hex'), scope: 'Isolated original shared renderer in actual OffscreenCanvas with 64 temporary tiles. Extra GPU readback between passes isolates cost and changes batching; not a throughput or real-device FPS benchmark.', cases: [], passed: false }
try {
  const page = await browser.newPage()
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/ascii-art')
  for (const mode of ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']) {
    const result = await page.evaluate(async ({ url, mode }) => {
      const { createCanvasArtRenderer } = await import(url)
      const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
      const image = new Image(); image.src = '/artwork/porcelain-study-v1.png'; await image.decode()
      const frame = prepareArtFrame(image, image.width, image.height, { mode, columns: 180, colored: mode === 'color' || mode === 'phrase', phrase: '把名字写成光，ASTRA。', fontFamily: mode === 'phrase' ? 'Microsoft YaHei, monospace' : 'Consolas, monospace' })
      const visible = Array.from(frame.indices.keys()).filter(i => frame.glyphs[frame.indices[i]].coverage >= .001)
      const alphas = { visible: visible.length, opaque: visible.filter(i => frame.alpha[i] === 1).length, translucent: visible.filter(i => frame.alpha[i] > .005 && frame.alpha[i] < 1).length }
      const records = []
      for (const hover of ['light', 'particles']) {
        const canvas = new OffscreenCanvas(1, 1)
        canvas.getContext('2d', { willReadFrequently: false })
        const renderer = createCanvasArtRenderer(canvas, { createSurface: () => new OffscreenCanvas(1, 1), maxTileEntries: 64 })
        const common = { longEdge: 713, hover, hoverStrength: .65, hoverRadius: .38, effectProfile: 'expressive', motion: 'none' }
        try {
          const pointers = [{ x: .2, y: .4, active: false }, { x: .2, y: .4, active: true }, { x: .7, y: .55, active: true }]
          for (let i = 0; i < pointers.length; i++) {
            const time = i / 30, pointer = { ...pointers[i], strength: pointers[i].active ? .65 : 0 }
            const start = performance.now()
            const result = renderer.render(frame, { ...common, hoverTime: time, pointer, pointerSamples: [{ ...pointer, time: time * 1000 }] })
            canvas.getContext('2d').getImageData(0, 0, 1, 1)
            records.push({ hover, inputFrame: i, width: result.width, height: result.height, wallMs: performance.now() - start, ...renderer.profile, cache: renderer.cacheStats })
          }
        } finally { renderer.destroy() }
      }
      return { mode, columns: frame.columns, rows: frame.rows, alphas, records }
    }, { url, mode })
    report.cases.push(result)
    await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
    console.log('frame-profile: ' + mode + ' complete')
  }
  report.passed = true
} catch (error) { report.failure = error.stack; process.exitCode = 1 }
finally { await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await browser.close() }
console.log(JSON.stringify({ out, passed: report.passed, failure: report.failure }))
