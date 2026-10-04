import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_RASTER_OUTPUT || `test-results/signature-raster-${Date.now()}`,
)
const baselineCommit = '00c41a628557c7971f13893adacb0851f50b31bb'
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const original = execFileSync(
  'git',
  ['show', `${baselineCommit}:src/lib/signature-portrait/layout.ts`],
  { encoding: 'utf8' },
)
assert.equal(sha(original), '66a53f4d4be2155420368a040c54fefbcadf3dfee9c8d64575f2a796e5a2539b')
await mkdir(out, { recursive: true })
const frozen = original.replace(/'\.\/([^']+)'/g, "'/src/lib/signature-portrait/$1'")
await writeFile(path.join(out, 'baseline-layout.ts'), frozen)
const frozenUrl =
  '/' + path.relative(process.cwd(), path.join(out, 'baseline-layout.ts')).split(path.sep).join('/')
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(base + '/signature-portrait')
  const records = await page.evaluate(
    async ({ frozenUrl, cacheOnly, realOnly }) => {
      const baseline = await import(frozenUrl)
      const optimized = await import('/src/lib/signature-portrait/layout.ts')
      const { createTintedStampCache } = await import('/src/lib/signature-portrait/raster-cache.ts')
      const { signatureTint } = await import('/src/lib/signature-portrait/render-style.ts')
      const { generateHandwritingVariants } =
        await import('/src/lib/signature-portrait/variants.ts')
      function check(value, label) {
        if (!value) throw new Error(label)
      }
      function compare(a, b) {
        const pa = a.getContext('2d').getImageData(0, 0, a.width, a.height).data
        const pb = b.getContext('2d').getImageData(0, 0, b.width, b.height).data
        check(pa.length === pb.length, 'Pixel dimensions')
        let changedChannels = 0,
          maxDelta = 0
        for (let i = 0; i < pa.length; i++)
          if (pa[i] !== pb[i]) {
            changedChannels++
            maxDelta = Math.max(maxDelta, Math.abs(pa[i] - pb[i]))
          }
        return { changedChannels, maxDelta, channels: pa.length }
      }
      if (realOnly) {
        const image = new Image()
        image.src = '/demos/ascii-live/aristotle-bust.webp'
        await image.decode()
        const stamps = await generateHandwritingVariants('心上人', { count: 100, seed: 42 })
        const options = {
          inkStyle: 'ink',
          maxSide: 2048,
          density: 30,
          angleRange: 12,
          allowVertical: false,
          minSizeRatio: 0.014,
          maxSizeRatio: 0.04,
          fillHighlights: false,
          invertDensity: false,
          colorize: true,
          coverFill: false,
          overlap: 0.22,
          gamma: 1.15,
          background: '#f5f3ef',
          underlay: 0,
          seed: 42,
          edgeOutline: true,
          edgeBoost: 0.95,
          edgeThreshold: 0.32,
          edgeColorMode: 'auto',
          edgeColor: { r: 28, g: 72, b: 96 },
          skipPaint: true,
        }
        const layout = await optimized.renderSignaturePortrait(
          image,
          image.width,
          image.height,
          stamps,
          options,
        )
        const width = 1280,
          height = Math.round((layout.height * width) / layout.width)
        const paints = []
        for (const [label, engine] of [
          ['baseline', baseline],
          ['optimized', optimized],
        ]) {
          const start = performance.now()
          const canvas = await engine.paintPlacementsTiled(
            layout.placements,
            stamps,
            layout.width,
            layout.height,
            width,
            height,
            { ...options, tileSize: 320 },
          )
          // Both measurements include the complete native raster/readback, not only submission.
          const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data
          const ms = performance.now() - start
          const hash = Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)),
            (b) => b.toString(16).padStart(2, '0'),
          ).join('')
          paints.push({ label, canvas, ms, hash })
        }
        return {
          matrix: [],
          recolor: [],
          invalid: [],
          release: [],
          cacheStats: null,
          real: {
            stamps: stamps.length,
            placements: layout.placements.length,
            layoutDimensions: [layout.width, layout.height],
            outputDimensions: [width, height],
            comparison: compare(paints[0].canvas, paints[1].canvas),
            paints: paints.map(({ label, ms, hash }) => ({ label, ms, hash })),
            png: paints[1].canvas.toDataURL().split(',')[1],
          },
        }
      }
      function synthetic(w, h, id) {
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        const pixels = ctx.createImageData(w, h)
        for (let y = 0; y < h; y++)
          for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4
            pixels.data[i] = 20
            pixels.data[i + 1] = 24
            pixels.data[i + 2] = 32
            pixels.data[i + 3] = (x * 7 + y * 11) % 256
          }
        ctx.putImageData(pixels, 0, 0)
        return {
          id,
          label: id,
          width: w,
          height: h,
          canvas,
          previewUrl: '',
          vector: {
            width: w,
            height: h,
            paths: [`M0 0H${w}V${h}H0Z M${w * 0.2} ${h * 0.2}H${w * 0.8}V${h * 0.8}H${w * 0.2}Z`],
          },
        }
      }
      const syntheticStamps = [
        synthetic(640, 157, 'wide'),
        synthetic(37, 211, 'tall'),
        synthetic(256, 256, 'square'),
        synthetic(7, 4, 'tiny'),
      ]
      const fonts = await generateHandwritingVariants('心上人', { count: 8, seed: 42 })
      const stamps = [...syntheticStamps, ...fonts]
      const placements = []
      for (let i = 0; i < 360; i++)
        placements.push({
          x: ((i * 79.137) % 690) - 35,
          y: ((i * 101.37) % 580) - 35,
          angle: (((i * 17) % 180) * Math.PI) / 180,
          targetSize: [0.1, 2, 7, 27, 62, 151, 410][i % 7],
          stampIndex: i % stamps.length,
          strength: [0, 0.07, 0.33, 0.81, 1][i % 5],
          depth: (i % 31) / 30,
          tint: { r: (i * 71) % 256, g: (i * 137) % 256, b: (i * 199) % 256 },
          blend: i % 2 ? 'soft' : 'ink',
          tintLiteral: i % 3 === 0,
        })
      // Exact tile boundaries, rotations, points outside the tile and the output.
      for (const x of [-125, -3, 0, 127.999, 128, 128.001, 256, 512, 644]) {
        placements.push({
          ...placements[28],
          x,
          y: 128,
          targetSize: 180,
          angle: Math.PI / 4,
          stampIndex: 2,
          strength: 0.91,
        })
      }
      const matrix = []
      for (const inkStyle of cacheOnly ? [] : ['ink', 'cutout'])
        for (const background of ['#f5f3ef', '#111615'])
          for (const colorize of [false, true])
            for (const coverFill of [false, true]) {
              const options = {
                inkStyle,
                background,
                colorize,
                coverFill,
                tileSize: 128,
                stampMaxLong: 480,
              }
              const record = { ...options }
              for (const mode of ['direct', 'tiled']) {
                const a =
                  mode === 'direct'
                    ? baseline.paintPlacements(placements, stamps, 619, 507, options)
                    : await baseline.paintPlacementsTiled(
                        placements,
                        stamps,
                        700,
                        580,
                        619,
                        507,
                        options,
                      )
                const b =
                  mode === 'direct'
                    ? optimized.paintPlacements(placements, stamps, 619, 507, options)
                    : await optimized.paintPlacementsTiled(
                        placements,
                        stamps,
                        700,
                        580,
                        619,
                        507,
                        options,
                      )
                record[mode] = compare(a, b)
              }
              matrix.push(record)
            }
      // Exact recoloring after eviction, dimension changes and oversized temporary reuse.
      const cache = createTintedStampCache(
        syntheticStamps.map((s) => s.canvas),
        true,
        270000,
        2,
      )
      const recolor = []
      const originalTint = (source, r, g, b, depth, literal) => {
        const canvas = document.createElement('canvas')
        canvas.width = source.width
        canvas.height = source.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(source, 0, 0)
        ctx.globalCompositeOperation = 'source-in'
        ctx.fillStyle = `rgb(${signatureTint(true, r, g, b, depth, literal).join(',')})`
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        return canvas
      }
      const surfaces = new Set()
      for (let i = 0; i < 60; i++) {
        const index = i % 4,
          literal = i % 2 === 0
        const actual = cache.get(index, i * 3, i * 7, i * 11, i / 60, literal)
        surfaces.add(actual)
        // Match production consumers: draw the source, then read the destination.
        // Reading the same cached source repeatedly triggers Chromium's CPU migration.
        const snapshot = (source) => {
          const canvas = document.createElement('canvas')
          canvas.width = source.width
          canvas.height = source.height
          canvas.getContext('2d').drawImage(source, 0, 0)
          return canvas
        }
        recolor.push(
          compare(
            snapshot(
              originalTint(syntheticStamps[index].canvas, i * 3, i * 7, i * 11, i / 60, literal),
            ),
            snapshot(actual),
          ),
        )
        check(cache.stats.bytes <= 270000 && cache.stats.entries <= 2, 'Retained byte/count limits')
      }
      const cacheStats = cache.stats
      cache.clear()
      check(
        cache.stats.bytes === 0 && cache.stats.temporaryBytes === 0 && cache.stats.entries === 0,
        'Clear accounting',
      )
      check(
        [...surfaces].every((canvas) => canvas.width === 1 && canvas.height === 1),
        'Clear backing surfaces',
      )
      const hitCache = createTintedStampCache([syntheticStamps[3].canvas], false, 1000, 2)
      check(
        hitCache.get(0, 1, 2, 3, 0.5) === hitCache.get(0, 70, 80, 90, 0.5),
        'Same exact palette must hit',
      )
      check(hitCache.stats.hits === 1, 'Cache hit count')
      hitCache.clear()
      const invalid = []
      for (const limits of [
        [0, 2],
        [1000, 0],
        [NaN, 2],
        [1000, 1.5],
      ]) {
        try {
          createTintedStampCache([], true, ...limits)
          invalid.push(false)
        } catch {
          invalid.push(true)
        }
      }
      // Observe the actual production caches, including errors and cancellation after a tile.
      const fillRect = CanvasRenderingContext2D.prototype.fillRect,
        tinted = new Set()
      CanvasRenderingContext2D.prototype.fillRect = function (...args) {
        if (this.globalCompositeOperation === 'source-in') tinted.add(this.canvas)
        return fillRect.apply(this, args)
      }
      const release = []
      try {
        const small = placements.filter((p) => p.targetSize <= 151).slice(0, 120)
        for (const kind of ['success', 'callback-error', 'cancelled']) {
          tinted.clear()
          const signal = { cancelled: false }
          let threw = false
          try {
            await optimized.paintPlacementsTiled(small, stamps, 700, 580, 619, 507, {
              tileSize: 128,
              signal,
              onTile: ({ done }) => {
                if (done === 1 && kind === 'callback-error')
                  throw new Error('intentional callback failure')
                if (done === 1 && kind === 'cancelled') signal.cancelled = true
              },
            })
          } catch {
            threw = true
          }
          release.push({
            kind,
            threw,
            canvases: tinted.size,
            released: [...tinted].every((c) => c.width === 1 && c.height === 1),
          })
        }
        tinted.clear()
        let threw = false
        try {
          optimized.paintPlacements(
            [...small, { ...small[0], stampIndex: 999, targetSize: 0.01 }],
            stamps,
            619,
            507,
          )
        } catch {
          threw = true
        }
        release.push({
          kind: 'invalid-stamp',
          threw,
          canvases: tinted.size,
          released: [...tinted].every((c) => c.width === 1 && c.height === 1),
        })
      } finally {
        CanvasRenderingContext2D.prototype.fillRect = fillRect
      }
      return { matrix, recolor, cacheStats, invalid, release }
    },
    {
      frozenUrl,
      cacheOnly: process.argv.includes('--cache-only'),
      realOnly: process.argv.includes('--real-only'),
    },
  )
  const files = [
    'layout.ts',
    'raster-cache.ts',
    'extract.ts',
    'ink-style.ts',
    'vector-ink.ts',
    'render-style.ts',
    'variants.ts',
    'fonts.ts',
    'trace.ts',
  ]
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [file, sha(await readFile('src/lib/signature-portrait/' + file))]),
    ),
  )
  if (records.real) {
    await writeFile(path.join(out, 'real-portrait.png'), Buffer.from(records.real.png, 'base64'))
    delete records.real.png
  }
  const report = {
    baselineCommit,
    baselineSha256: sha(original),
    browser: browser.version(),
    sourceHashes,
    errors,
    ...records,
    scope:
      'Whole RGBA-buffer equality against frozen production renderer. Synthetic boundary/support cases plus real Chinese font glyphs. Desktop contract, not commercial visual acceptance.',
  }
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify(
      {
        out,
        cases: records.matrix.length,
        differences: records.matrix.filter(
          (r) => r.direct.changedChannels || r.tiled.changedChannels,
        ),
        recolorDifferences: records.recolor.filter((r) => r.changedChannels).length,
        cacheStats: records.cacheStats,
        release: records.release,
        real: records.real,
        errors,
      },
      null,
      2,
    ),
  )
  assert.deepEqual(errors, [])
  for (const r of records.matrix) {
    assert.equal(r.direct.changedChannels, 0, JSON.stringify(r))
    assert.equal(r.tiled.changedChannels, 0, JSON.stringify(r))
  }
  for (const r of records.recolor) assert.equal(r.changedChannels, 0, JSON.stringify(r))
  assert(records.invalid.every(Boolean))
  if (records.cacheStats)
    assert(records.cacheStats.reused > 0 && records.cacheStats.created < records.cacheStats.misses)
  if (records.real) assert.equal(records.real.comparison.changedChannels, 0)
  for (const r of records.release) {
    assert(r.canvases > 0 && r.released, JSON.stringify(r))
    assert.equal(r.threw, r.kind !== 'success')
  }
} finally {
  await browser.close()
}
