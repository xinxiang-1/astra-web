import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_RIFT_OUTPUT || `test-results/rift-integration-${Date.now()}`,
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out)
const sha = (b) => createHash('sha256').update(b).digest('hex')
const sources = [
  'src/lib/art-engine/canvas.ts',
  'src/lib/art-engine/index.ts',
  'src/lib/art-engine/gpu.ts',
  'src/lib/art-engine/types.ts',
  'src/views/AsciiArtView.vue',
  'src/lib/art-project-package.ts',
  'src/lib/art-engine/embed.ts',
  'scripts/fixtures/rift-v8-renderer.ts',
  'docs/prototypes/v8-studio-rift/presentation.ts',
]
const report = {
  passed: false,
  errors: [],
  hashes: Object.fromEntries(
    await Promise.all(sources.map(async (f) => [f, sha(await readFile(f))])),
  ),
}
const previous = execFileSync('git', ['show', '95b114b:src/lib/art-engine/canvas.ts'], {
  encoding: 'utf8',
  maxBuffer: 32 * 1024 * 1024,
})
assert.equal(
  (await readFile('scripts/fixtures/rift-v8-renderer.ts', 'utf8'))
    .replace("from '../../src/lib/art-engine/types'", "from './types'")
    .replaceAll('\r\n', '\n'),
  previous,
)
const body = (s) =>
  s.slice(s.indexOf('  function makeStudioInteraction('), s.indexOf('  let interaction:'))
assert.equal(body((await readFile(sources[0], 'utf8')).replaceAll('\r\n', '\n')), body(previous))
for (const f of [
  'src/views/ArtHomeView.vue',
  'src/components/CharacterArtwork.vue',
  'src/lib/ascii/studio-preview.ts',
])
  assert.equal(
    (await readFile(f, 'utf8')).replaceAll('\r\n', '\n'),
    execFileSync('git', ['show', `95b114b:${f}`], { encoding: 'utf8' }),
  )
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  page.setDefaultTimeout(90000)
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(`${base}/docs/prototypes/v8-studio-rift/index.html`)
  await page.waitForFunction(() => window.astraRiftPrototype?.ready)
  await page.evaluate(() => window.astraRiftPrototype.setManual(true))
  Object.assign(
    report,
    await page.evaluate(async () => {
      const { prepareArtFrame, createArtRenderer } = await import('/src/lib/art-engine/index.ts')
      const { createCanvasArtRenderer: now } = await import('/src/lib/art-engine/canvas.ts')
      const { createCanvasArtRenderer: old } = await import('/scripts/fixtures/rift-v8-renderer.ts')
      const { createRiftPresentation } =
        await import('/docs/prototypes/v8-studio-rift/presentation.ts')
      const require = (v, m) => {
        if (!v) throw Error(m)
      }
      const pixels = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const exact = (a, b) => {
        if (a.length !== b.length) return false
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
        return true
      }
      const image = new Image()
      image.src = '/artwork/portrait-reference.png'
      await image.decode()
      await document.fonts.ready
      const options = (i, hover = 'rift', active = true) => ({
        longEdge: 560,
        hover,
        hoverTime: i / 30,
        hoverStrength: 0.65,
        hoverRadius: 0.38,
        motion: 'none',
        pointer: {
          x: 0.2 + 0.6 * Math.min(1, i / 23),
          y: 0.5 + Math.sin((i / 23) * Math.PI * 2) * 0.18,
          active,
          strength: 0.65,
        },
      })
      const cases = []
      let defaultFrames = 0,
        riftFrames = 0,
        maxBytes = 0
      for (const mode of ['density', 'color', 'phrase', 'contour', 'braille', 'halftone'])
        for (const quality of ['density', 'color'].includes(mode)
          ? ['classic', 'high', 'software']
          : ['classic'])
          for (const transparent of [false, true]) {
            const frame = prepareArtFrame(image, image.width, image.height, {
              mode,
              columns: 96,
              phrase: '我爱你中国，光与影。',
              fontFamily: 'Microsoft YaHei, monospace',
              ...(quality !== 'classic' ? { rasterQuality: 'high', fontWeight: 600 } : {}),
              ...(quality === 'software'
                ? { fontWeight: 400, softwareRaster: true, colorFidelity: mode === 'color' }
                : {}),
            })
            const a = document.createElement('canvas'),
              b = document.createElement('canvas'),
              c = document.createElement('canvas')
            const ra = old(a, { experimentalTrail: createRiftPresentation().prepare }),
              rb = now(b),
              rc = old(c)
            rb.render(frame, {
              ...options(0),
              transparent,
              hoverStrength: 0,
              pointer: { x: 0.5, y: 0.5, strength: 0, active: false },
            })
            const still = pixels(b)
            let changed = false
            for (let i = 0; i < 24; i++) {
              const opt = { ...options(i), transparent }
              ra.render(frame, { ...opt, hover: 'trail' })
              rb.render(frame, opt)
              require(exact(
                pixels(a),
                pixels(b),
              ), `rift equals frozen v8 ${mode}/${quality}/${transparent}/${i}`)
              changed ||= !exact(pixels(b), still)
              riftFrames++
              maxBytes = Math.max(maxBytes, rb.cacheStats.rift.bytes)
              require(rb.cacheStats.rift.bytes <= rb.cacheStats.rift.limit &&
                rb.cacheStats.rift.maxStrain <= 0.72001, 'bounded production rift')
            }
            require(changed, 'actual rift feedback')
            let recovered = null
            for (let i = 1; i <= 180; i++) {
              rb.render(frame, { ...options(23 + i * 1.5, 'rift', false), transparent })
              if (!rb.interactionActive) {
                require(exact(pixels(b), still), 'exact recovery')
                recovered = i / 20
                break
              }
            }
            require(recovered !== null, 'bounded settle')
            rb.render(frame, { ...options(200), hoverStrength: 0, transparent })
            require(exact(pixels(b), still), 'zero strength')
            for (const hover of [
              'trail',
              'water',
              'silk',
              'vortex',
              'contour',
              'dissolve',
              'light',
              'ripple',
              'displace',
            ])
              for (let i = 0; i < 3; i++) {
                const opt = { ...options(210 + i, hover), transparent, effectProfile: 'expressive' }
                rb.render(frame, opt)
                rc.render(frame, opt)
                require(exact(
                  pixels(b),
                  pixels(c),
                ), `legacy hover exact ${mode}/${quality}/${hover}/${i}`)
                defaultFrames++
              }
            for (const [i, motion] of [
              'breathe',
              'wave',
              'assemble',
              'current',
              'reform',
              'caustics',
            ].entries()) {
              const opt = {
                longEdge: 560,
                transparent,
                hover: 'light',
                hoverStrength: 0,
                motion,
                effectProfile: 'expressive',
                motionStyle: 'cinematic',
                time: 3.4 + i * 0.11,
              }
              rb.render(frame, opt)
              rc.render(frame, opt)
              require(exact(pixels(b), pixels(c)), `ambient exact ${mode}/${quality}/${motion}`)
              defaultFrames++
            }
            cases.push({
              mode,
              quality,
              transparent,
              riftExactFrames: 24,
              oldExactFrames: 33,
              recovered,
              bytes: maxBytes,
            })
            ra.destroy()
            rb.destroy()
            rc.destroy()
            require(rb.cacheStats.rift.bytes === 0, 'rift destroy release')
          }
      const frame = prepareArtFrame(image, image.width, image.height, {
          mode: 'density',
          columns: 96,
        }),
        canvas = document.createElement('canvas'),
        wrapper = createArtRenderer(canvas)
      wrapper.render(frame, options(0))
      require(wrapper.backend === 'canvas2d', 'rift by itself selects shared Canvas')
      wrapper.destroy()
      return {
        cases,
        riftFrames,
        defaultFrames,
        maxBytes,
        nativeSolverUnchanged: true,
        protectedFilesUnchanged: true,
        wrapperRiftBackend: 'canvas2d',
        browser: navigator.userAgent,
      }
    }),
  )
  assert.equal(report.errors.length, 0)
  report.passed = true
} catch (e) {
  report.failure = String(e)
  throw e
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
}
console.log(
  JSON.stringify({
    passed: report.passed,
    cases: report.cases.length,
    riftFrames: report.riftFrames,
    defaultFrames: report.defaultFrames,
    maxBytes: report.maxBytes,
    out,
  }),
)
