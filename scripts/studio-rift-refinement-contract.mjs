import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_RIFT_OUTPUT || `test-results/rift-refinement-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out)
const sha = (raw) => createHash('sha256').update(raw).digest('hex')
const files = [
  'src/lib/art-engine/canvas.ts',
  'scripts/fixtures/rift-v7-renderer.ts',
  'docs/prototypes/v8-studio-rift/presentation.ts',
  'docs/prototypes/v8-studio-rift/main.ts',
  'docs/prototypes/v7-studio-rift/presentation.ts',
]
const hashes = Object.fromEntries(
  await Promise.all(files.map(async (file) => [file, sha(await readFile(file))])),
)
const frozen = await readFile(files[1], 'utf8')
const baseline = execFileSync('git', ['show', '8f4a9c5:src/lib/art-engine/canvas.ts'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
assert.equal(
  frozen
    .replace("from '../../src/lib/art-engine/types'", "from './types'")
    .replaceAll('\r\n', '\n'),
  baseline,
)
const report = {
  passed: false,
  hashes,
  errors: [],
  benchmarkScope:
    'Paired alternating complete renders + full RGBA readback on this desktop; fixed sampling and v7 presentation. No FPS/device/4K claim.',
}
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'no-preference',
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  page.setDefaultTimeout(90000)
  await page.goto(`${base}/docs/prototypes/v8-studio-rift/index.html`)
  await page.waitForFunction(() => window.astraRiftPrototype?.ready)
  await page.evaluate(() => window.astraRiftPrototype.setManual(true))
  Object.assign(
    report,
    await page.evaluate(async () => {
      const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
      const { createCanvasArtRenderer: old } = await import('/scripts/fixtures/rift-v7-renderer.ts')
      const { createCanvasArtRenderer: now } = await import('/src/lib/art-engine/canvas.ts')
      const { createRiftPresentation: oldPresentation } =
        await import('/docs/prototypes/v7-studio-rift/presentation.ts')
      const { createRiftPresentation: newPresentation } =
        await import('/docs/prototypes/v8-studio-rift/presentation.ts')
      const require = (v, m) => {
        if (!v) throw Error(m)
      }
      const pixels = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const equal = (a, b) => {
        require(a.length === b.length, 'geometry')
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
        return true
      }
      const image = async (source) => {
        const i = new Image()
        i.src = '/artwork/' + source
        await i.decode()
        return i
      }
      const modes = ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']
      const options = (i, extra = {}) => ({
        longEdge: 720,
        effectProfile: 'expressive',
        motion: 'none',
        hover: 'trail',
        hoverTime: i / 60,
        hoverStrength: 0.65,
        hoverRadius: 0.38,
        pointer: {
          x: 0.15 + (0.7 * (i % 24)) / 23,
          y: 0.5 + Math.sin((i / 23) * Math.PI * 2) * 0.18,
          active: true,
          strength: 0.65,
        },
        ...extra,
      })
      const frameFor = (img, mode, quality) =>
        prepareArtFrame(img, img.width, img.height, {
          mode,
          columns: 112,
          phrase: '我爱你中国，光与影。',
          fontFamily: 'Microsoft YaHei, monospace',
          ...(quality !== 'classic' ? { rasterQuality: 'high', fontWeight: 600 } : {}),
          ...(quality === 'software'
            ? { softwareRaster: true, colorFidelity: mode === 'color', fontWeight: 400 }
            : {}),
        })
      const exactCases = [],
        benchmarks = [],
        geometryCases = []
      const portrait = await image('portrait-reference.png')
      for (const mode of modes)
        for (const quality of ['density', 'color'].includes(mode)
          ? ['classic', 'high', 'software']
          : ['classic']) {
          const frame = frameFor(portrait, mode, quality),
            a = document.createElement('canvas'),
            b = document.createElement('canvas'),
            ra = old(a, { experimentalTrail: oldPresentation().prepare }),
            rb = now(b, { experimentalTrail: oldPresentation().prepare })
          for (let i = 0; i < 12; i++) {
            const opt = options(i, {
              transparent: i % 2 === 1,
              motion:
                i < 6
                  ? 'none'
                  : ['breathe', 'wave', 'assemble', 'current', 'reform', 'caustics'][i - 6],
              motionStyle: 'cinematic',
              time: 3.5 + i * 0.13,
            })
            ra.render(frame, opt)
            rb.render(frame, opt)
            require(equal(pixels(a), pixels(b)), `exact v7 mapping ${mode}/${quality}/${i}`)
          }
          require(rb.cacheStats.effectCellBytes <=
            rb.cacheStats.effectCellLimit, 'bounded cell reuse')
          exactCases.push({
            mode,
            quality,
            frames: 12,
            exact: true,
            bytes: rb.cacheStats.effectCellBytes,
          })
          ra.destroy()
          rb.destroy()
          require(rb.cacheStats.effectCellBytes === 0, 'cell destroy')
        }
      for (const source of ['portrait-reference.png', 'pet.jpg'])
        for (const quality of ['classic', 'software']) {
          const frame = frameFor(await image(source), 'color', quality),
            a = document.createElement('canvas'),
            b = document.createElement('canvas'),
            ra = old(a, { experimentalTrail: oldPresentation().prepare }),
            rb = now(b, { experimentalTrail: oldPresentation().prepare })
          const times = [[], []]
          for (let i = 0; i < 32; i++) {
            const opt = options(i)
            for (const id of i % 2 ? [1, 0] : [0, 1]) {
              const start = performance.now()
              ;[ra, rb][id].render(frame, opt)
              pixels([a, b][id])
              if (i >= 8) times[id].push(performance.now() - start)
            }
            require(equal(pixels(a), pixels(b)), `benchmark pixels ${source}/${quality}/${i}`)
          }
          const summary = (list) => {
            const sorted = [...list].sort((a, b) => a - b)
            return { p50: sorted[12], p95: sorted[22], samples: list }
          }
          benchmarks.push({
            source,
            quality,
            geometry: [frame.columns, frame.rows],
            size: [a.width, a.height],
            old: summary(times[0]),
            current: summary(times[1]),
            cache: rb.cacheStats,
          })
          ra.destroy()
          rb.destroy()
        }
      for (const mode of modes)
        for (const strength of [0.65, 1]) {
          const frame = frameFor(portrait, mode, 'classic'),
            a = document.createElement('canvas'),
            b = document.createElement('canvas'),
            pres = newPresentation(),
            prev = oldPresentation(),
            ra = now(a, { experimentalTrail: pres.prepare }),
            rb = old(b, { experimentalTrail: prev.prepare })
          let peak = 0,
            oldPeak = 0,
            minJ = 1,
            maxStrain = 0,
            minSampleJ = 1,
            positiveSamples = 0
          ra.render(
            frame,
            options(0, {
              hoverStrength: 0,
              pointer: { x: 0.5, y: 0.5, active: false, strength: 0 },
            }),
          )
          const still = pixels(a)
          for (let i = 0; i < 48; i++) {
            const opt = options(i, {
              hoverStrength: strength,
              pointer: {
                x: 0.12 + (0.76 * (i % 24)) / 23,
                y: 0.5 + Math.sin((i / 23) * Math.PI * 2) * 0.18,
                active: true,
                strength,
              },
            })
            ra.render(frame, opt)
            rb.render(frame, opt)
            peak = Math.max(peak, pres.stats.peakOffset)
            oldPeak = Math.max(oldPeak, prev.stats.peakOffset)
            minJ = Math.min(minJ, pres.stats.minJacobian)
            maxStrain = Math.max(maxStrain, pres.stats.maxStrain)
            require(pres.stats.maxStrain <= 0.72001 &&
              pres.stats.minJacobian >= 0.0783, 'nonfolding bilinear corners')
            require(pres.stats.bytes <= pres.stats.limit, 'bounded geometry')
            // Independent finite-difference query of the returned interpolation,
            // rather than trusting presentation telemetry alone.
            const map = pres.prepare(ra.sampleFluidField, frame, strength, a.width, a.height)
            if (map)
              for (let y = 1; y < 12; y++)
                for (let x = 1; x < 12; x++) {
                  const u = x / 12,
                    v = y / 12,
                    epsilon = 1e-5,
                    c = map(u, v),
                    dx = map(u + epsilon, v),
                    dy = map(u, v + epsilon)
                  const j =
                    (1 + (dx.offsetX - c.offsetX) / epsilon) *
                      (1 + (dy.offsetY - c.offsetY) / epsilon) -
                    ((dy.offsetX - c.offsetX) / epsilon) * ((dx.offsetY - c.offsetY) / epsilon)
                  require(j > 0.078, 'independent interpolation positive Jacobian')
                  minSampleJ = Math.min(minSampleJ, j)
                  positiveSamples++
                }
          }
          require(peak > 0.01, 'visible displacement retained')
          let recovered = null
          for (let i = 1; i <= 180; i++) {
            ra.render(
              frame,
              options(47 + i * 3, {
                hoverStrength: strength,
                pointer: { x: 0.5, y: 0.5, active: false, strength },
              }),
            )
            if (!ra.interactionActive) {
              require(equal(pixels(a), still), 'exact recovery')
              recovered = i / 20
              break
            }
          }
          require(recovered !== null, 'bounded recovery')
          ra.render(
            frame,
            options(230, {
              hoverStrength: 0,
              pointer: { x: 0.8, y: 0.4, active: true, strength: 0 },
            }),
          )
          require(equal(pixels(a), still), 'zero strength exact')
          geometryCases.push({
            mode,
            strength,
            peak,
            oldPeak,
            minJ,
            maxStrain,
            minSampleJ,
            positiveSamples,
            recovered,
            bytes: pres.stats.bytes,
          })
          ra.destroy()
          rb.destroy()
        }
      // Exercise bypass rather than letting oversized output allocate an unbounded cache.
      const seed = frameFor(portrait, 'density', 'classic'),
        count = 60000,
        large = {
          ...seed,
          columns: 300,
          rows: 200,
          indices: new Uint16Array(count).fill(seed.indices[0]),
          alpha: new Float32Array(count),
          colors: new Uint8ClampedArray(count * 3),
        },
        canvas = document.createElement('canvas'),
        r = now(canvas)
      r.render(large, { longEdge: 32, effectProfile: 'expressive', motion: 'none', hover: 'none' })
      require(r.cacheStats.effectCellBytes === 0, 'oversized bypass')
      r.destroy()
      return {
        exactCases,
        benchmarks,
        geometryCases,
        oversizedCacheBypassed: true,
        browser: navigator.userAgent,
      }
    }),
  )
  await page.evaluate(() => window.astraRiftPrototype.setManual(false))
  const count = await page.evaluate(() => window.astraRiftPrototype.state.paintCount)
  await page.waitForTimeout(400)
  assert.equal(
    await page.evaluate(() => window.astraRiftPrototype.state.paintCount),
    count,
    'idle draws stop',
  )
  const rect = await page.locator('#rift').boundingBox()
  await page.mouse.move(rect.x + rect.width * 0.3, rect.y + rect.height * 0.5)
  await page.mouse.move(rect.x + rect.width * 0.7, rect.y + rect.height * 0.5, { steps: 8 })
  await page.waitForFunction((c) => window.astraRiftPrototype.state.paintCount > c, count)
  report.idleWake = { idleDraws: 0, woke: true }
  assert.equal(report.errors.length, 0)
  report.passed = true
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: report.passed,
    exactCases: report.exactCases.length,
    geometryCases: report.geometryCases.length,
    benchmarks: report.benchmarks.map((x) => ({
      source: x.source,
      quality: x.quality,
      old: x.old.p50,
      current: x.current.p50,
    })),
    out,
  }),
)
