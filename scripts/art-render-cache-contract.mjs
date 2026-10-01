import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const output = 'test-results/render-cache-contract'
await mkdir(output, { recursive: true })
const browser = await chromium.launch()
const report = {
  scope:
    'Renderer-only repair: existing sampling and quality defaults unchanged. Paired completed-render timings on this headless host, not real-device fps.',
  baseline: 'sandbox/ascii-optimizer/experiments/2026-10-01-quality-v3/baseline/canvas.ts',
  warmups: 3,
  samples: 7,
  cases: [],
}
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  await page.goto(`${base}/ascii-art`)
  for (const columns of [120, 180]) {
    console.log(`paired renderer ${columns} columns`)
    const result = await page.evaluate(async (columns) => {
      const engine = await import('/src/lib/art-engine/index.ts')
      const baseline =
        await import('/sandbox/ascii-optimizer/experiments/2026-10-01-quality-v3/baseline/index.ts')
      const image = new Image()
      image.src = '/artwork/portrait.jpg'
      await image.decode()
      const frame = engine.prepareArtFrame(image, image.width, image.height, {
        mode: 'color',
        columns,
        fontFamily: 'Consolas,monospace',
        charAspect: 0.55,
        normalize: true,
        contrast: 0.2,
      })
      const cases = []
      for (const [id, make] of [
        ['baseline', baseline.createCanvasArtRenderer],
        ['bounded-bitmaps', engine.createCanvasArtRenderer],
      ]) {
        const canvas = document.createElement('canvas'),
          renderer = make(canvas)
        function sample(time) {
          const start = performance.now()
          renderer.render(frame, { longEdge: 720, motion: 'wave', time })
          canvas.getContext('2d').getImageData(0, 0, 1, 1)
          return performance.now() - start
        }
        const coldMs = sample(0)
        for (let i = 0; i < 3; i++) sample(i * 0.1)
        const samples = []
        for (let i = 0; i < 7; i++) samples.push(sample(1 + i * 0.1))
        samples.sort((a, b) => a - b)
        const png = canvas.toDataURL()
        cases.push({
          id,
          columns,
          geometry: [frame.columns, frame.rows],
          coldMs,
          p50: samples[3],
          p95: samples[6],
          samples,
          cache: renderer.cacheStats,
          png,
        })
        renderer.destroy()
        if (renderer.cacheStats)
          cases.at(-1).released =
            renderer.cacheStats.backingBytes === 0 && renderer.cacheStats.scratchBytes === 0
      }
      return cases
    }, columns)
    assert.equal(result[0].png, result[1].png, 'Paired motion raster must remain byte identical')
    for (const record of result) {
      record.pngHash = createHash('sha256').update(record.png).digest('hex')
      delete record.png
      report.cases.push(record)
    }
    assert(result[1].released)
    assert(result[1].cache.backingBytes <= 16 * 1024 * 1024)
    assert(
      result[1].p50 < result[0].p50,
      'Repair must reduce median frame cost on the paired thrashing fixture',
    )
    await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  }
  report.saturation = await page.evaluate(async () => {
    const engine = await import('/src/lib/art-engine/index.ts'),
      baseline =
        await import('/sandbox/ascii-optimizer/experiments/2026-10-01-quality-v3/baseline/index.ts')
    const source = document.createElement('canvas')
    source.width = 256
    source.height = 256
    source.getContext('2d').fillRect(0, 0, 256, 256)
    const seed = engine.prepareArtFrame(source, 256, 256, { mode: 'color', columns: 128 }),
      count = 128 * 128,
      index = seed.glyphs.findIndex((g) => g.char === '@')
    const colors = new Uint8ClampedArray(count * 3)
    for (let i = 0; i < count; i++) colors.set([i >> 8, i & 255, (i * 3) % 255], i * 3)
    const frame = {
      ...seed,
      columns: 128,
      rows: 128,
      indices: new Uint16Array(count).fill(index),
      alpha: new Float32Array(count).fill(0.7),
      colors,
      text: Array.from({ length: 128 }, () => '@'.repeat(128)).join('\n'),
    }
    const a = document.createElement('canvas'),
      b = document.createElement('canvas'),
      old = baseline.createCanvasArtRenderer(a),
      next = engine.createCanvasArtRenderer(b)
    const options = {
      longEdge: 512,
      transparent: true,
      motion: 'wave',
      time: 0.8,
      hover: 'light',
      pointer: { x: 0.5, y: 0.5, strength: 0.8 },
    }
    old.render(frame, options)
    next.render(frame, options)
    const same = a.toDataURL() === b.toDataURL(),
      first = next.cacheStats
    next.render(frame, options)
    const stable = b.toDataURL() === a.toDataURL(),
      second = next.cacheStats
    const small = engine.prepareArtFrame(source, 256, 256, {
      mode: 'phrase',
      phrase: '山河',
      columns: 24,
      colored: false,
      fontFamily: '"Microsoft YaHei",sans-serif',
    })
    next.render(small, { longEdge: 256 })
    const changed = next.cacheStats
    old.destroy()
    next.destroy()
    return { same, stable, first, second, changed, released: next.cacheStats }
  })
  const s = report.saturation
  assert(s.same && s.stable)
  assert(s.first.entries < 16384 && s.first.backingBytes <= 16 * 1024 * 1024)
  assert(s.second.hits > s.first.hits && s.second.entries === s.first.entries)
  assert(s.changed.entries < s.second.entries)
  assert.equal(s.released.backingBytes, 0)
  assert.equal(s.released.scratchBytes, 0)
  report.browser = await browser.version()
  report.productionHash = createHash('sha256')
    .update(await readFile('src/lib/art-engine/canvas.ts'))
    .digest('hex')
  report.passed = true
  console.log(
    JSON.stringify({
      cases: report.cases.map(({ id, columns, coldMs, p50, p95, cache }) => ({
        id,
        columns,
        coldMs,
        p50,
        p95,
        cache,
      })),
      saturation: s,
      passed: true,
    }),
  )
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2))
  await browser.close()
}
