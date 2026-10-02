import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_CINEMATIC_VISUAL_OUTPUT || `test-results/cinematic-visual-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
page.setDefaultTimeout(180000)
const report = {
  base,
  browser: browser.version(),
  scope: 'Development visual evidence, not independent human preference scores',
  errors: [],
  passed: false,
  hashes: {},
  boards: [],
}
page.on('pageerror', (e) => report.errors.push(e.message))
for (const file of [
  'src/lib/art-engine/canvas.ts',
  'src/views/AsciiArtView.vue',
  'scripts/cinematic-motion-visual.mjs',
])
  report.hashes[file] = createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
try {
  await page.goto(`${base}/ascii-art`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  for (const [source, mode] of [
    ['portrait-reference.png', 'density'],
    ['pet.jpg', 'color'],
    ['landscape.jpg', 'phrase'],
  ]) {
    const result = await page.evaluate(
      async ({ source, mode }) => {
        const { prepareArtFrame, createCanvasArtRenderer, createArtRenderer } =
          await import('/src/lib/art-engine/index.ts')
        await document.fonts.ready
        const image = new Image()
        image.src = '/artwork/' + source
        await image.decode()
        const frame = prepareArtFrame(image, image.width, image.height, {
          columns: 120,
          mode,
          phrase: '我爱你中国，光与影。',
          fontFamily: 'Microsoft YaHei, monospace',
        })
        const board = document.createElement('canvas')
        board.width = 1440
        board.height = 6 * 480 + 64
        const bc = board.getContext('2d')
        bc.fillStyle = '#111615'
        bc.fillRect(0, 0, board.width, board.height)
        bc.fillStyle = '#eeeae2'
        bc.font = '24px Microsoft YaHei'
        bc.fillText('Studio 移植层', 100, 42)
        bc.fillText('电影感 · 同素材 / 同时间 / 同强度', 800, 42)
        const canvas = document.createElement('canvas'),
          renderer = createCanvasArtRenderer(canvas)
        const details = []
        for (const [row, [motion, name, time]] of [
          ['breathe', '光息', 1.8],
          ['wave', '流动', 1.8],
          ['assemble', '聚合', 1.1],
          ['current', '慢流', 1.8],
          ['reform', '重组', 1.8],
          ['caustics', '光斑', 1.8],
        ].entries()) {
          bc.fillStyle = '#58e8ed'
          bc.font = '20px Microsoft YaHei'
          bc.fillText(name, 24, 100 + row * 480)
          let previous
          for (const [col, motionStyle] of ['studio', 'cinematic'].entries()) {
            renderer.render(frame, {
              longEdge: 600,
              motion,
              motionStyle,
              effectProfile: 'expressive',
              time,
              motionStrength: 0.65,
            })
            const scale = Math.min(640 / canvas.width, 420 / canvas.height),
              w = canvas.width * scale,
              h = canvas.height * scale
            bc.drawImage(canvas, col * 720 + (720 - w) / 2, 110 + row * 480, w, h)
            const data = canvas.toDataURL()
            if (!col) previous = data
            else details.push({ motion, time, different: data !== previous })
          }
        }
        // Canvas wrapper must not silently select GPU's old ambient path.
        const wrappedCanvas = document.createElement('canvas'),
          wrapped = createArtRenderer(wrappedCanvas)
        const options = { longEdge: 600, motion: 'wave', motionStyle: 'cinematic', time: 1.8 }
        renderer.render(frame, options)
        wrapped.render(frame, options)
        const wrapper = {
          backend: wrapped.backend,
          exactPixels: wrappedCanvas.toDataURL() === canvas.toDataURL(),
        }
        renderer.destroy()
        wrapped.destroy()
        return { png: board.toDataURL(), details, wrapper }
      },
      { source, mode },
    )
    const file = `${mode}-comparison.png`
    await writeFile(path.join(out, file), Buffer.from(result.png.split(',')[1], 'base64'))
    assert(result.details.every((d) => d.different))
    assert.equal(result.wrapper.backend, 'canvas2d')
    assert(result.wrapper.exactPixels)
    report.boards.push({ source, mode, file, details: result.details, wrapper: result.wrapper })
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(`PASS three source/mode visual boards and Canvas-wrapper parity: ${out}`)
