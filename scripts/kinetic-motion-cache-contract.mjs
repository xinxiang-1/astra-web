import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_KINETIC_CACHE_OUTPUT || `test-results/kinetic-cache-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
const report = {
  passed: false,
  cases: [],
  sourceSha256: createHash('sha256')
    .update(await readFile('src/lib/art-engine/canvas.ts'))
    .digest('hex'),
}
try {
  await page.goto(`${base}/ascii-art`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  report.cases = await page.evaluate(async () => {
    const { prepareArtFrame, createCanvasArtRenderer } =
      await import('/src/lib/art-engine/index.ts')
    const frames = []
    for (const source of ['portrait-reference.png', 'pet.jpg']) {
      const image = new Image()
      image.src = '/artwork/' + source
      await image.decode()
      frames.push(prepareArtFrame(image, image.width, image.height, { columns: 180 }))
    }
    const options = {
      longEdge: 720,
      motion: 'breathe',
      motionStyle: 'cinematic',
      effectProfile: 'expressive',
      time: 1.8,
      motionStrength: 0.65,
    }
    const cases = []
    for (const transparent of [false, true]) {
      const used = document.createElement('canvas'),
        fresh = document.createElement('canvas')
      const a = createCanvasArtRenderer(used),
        b = createCanvasArtRenderer(fresh)
      a.render(frames[0], { ...options, transparent })
      const firstCells = a.cacheStats.motionCells
      a.render(frames[1], { ...options, transparent })
      b.render(frames[1], { ...options, transparent })
      cases.push({
        transparent,
        sharedGrid: firstCells === a.cacheStats.motionCells,
        aspectA: frames[0].width / frames[0].height,
        aspectB: frames[1].width / frames[1].height,
        exactFreshRenderer: used.toDataURL() === fresh.toDataURL(),
      })
      a.destroy()
      b.destroy()
    }
    return cases
  })
  for (const item of report.cases) {
    assert(
      item.sharedGrid && item.aspectA !== item.aspectB,
      'Use different valid frames sharing the bounded field geometry',
    )
    assert(
      item.exactFreshRenderer,
      'Frozen time/image switch must rebuild the frame-dependent field',
    )
  }
  report.passed = true
} catch (error) {
  report.failure = error.stack
  throw error
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
}
console.log(`PASS same-time source switching matches a fresh renderer: ${out}`)
