import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(
  process.env.ASTRA_PNG_OUTPUT || `test-results/signature-png-contract-${Date.now()}`,
)
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180',
  parent = '70de56c100e6ca056e0f447d0c62744a25f5d54c'
await mkdir(out, { recursive: true })
const url = (name) =>
  '/' + path.relative(process.cwd(), path.join(out, name)).split(path.sep).join('/')
const frozenHashes = {}
for (const file of ['layout', 'trace', 'vector-ink']) {
  const original = execFileSync(
    'git',
    ['show', `${parent}:src/lib/signature-portrait/${file}.ts`],
    { encoding: 'utf8' },
  )
  frozenHashes[file] = createHash('sha256').update(original).digest('hex')
  const code = original.replace(
    /'\.\/([^']+)'/g,
    (_, dep) =>
      `'${['trace', 'vector-ink'].includes(dep) ? url(`frozen-${dep}.ts`) : `/src/lib/signature-portrait/${dep}`}'`,
  )
  await writeFile(path.join(out, `frozen-${file}.ts`), code)
}
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = { browser: browser.version(), parent, frozenHashes, errors: [], cases: [] }
let page
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/signature-portrait')
  report.cases = await page.evaluate(async (frozenUrl) => {
    const frozen = await import(frozenUrl)
    const { createTextStamp, loadImageElement } =
      await import('/src/lib/signature-portrait/extract.ts')
    const { traceStamps } = await import('/src/lib/signature-portrait/trace.ts')
    const { prepareSignatureWash } = await import('/src/lib/signature-portrait/styled-wash.ts')
    const { exportSignaturePng } = await import('/src/lib/signature-portrait/png-export.ts')
    const { packRasterPlacements, readRasterPlacement, RASTER_PLACEMENT_STRIDE } =
      await import('/src/lib/signature-portrait/raster-placement-wire.ts')
    const check = (v, label) => {
      if (!v) throw new Error(label)
    }
    const canvas = document.createElement('canvas')
    canvas.width = 640
    canvas.height = 800
    const ctx = canvas.getContext('2d'),
      gradient = ctx.createLinearGradient(0, 0, 640, 800)
    gradient.addColorStop(0, '#ed335e')
    gradient.addColorStop(0.5, '#143a73')
    gradient.addColorStop(1, '#ffbf61')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 640, 800)
    ctx.clearRect(0, 0, 90, 200)
    const file = new File([await new Promise((r) => canvas.toBlob(r))], 'controlled.png', {
      type: 'image/png',
    })
    const loaded = await loadImageElement(file),
      image = loaded.image
    const rawStamps = [
      createTextStamp('李云舟', { maxSide: 420 }),
      createTextStamp('Astra', { maxSide: 240 }),
    ]
    const large = document.createElement('canvas')
    large.width = 1181
    large.height = 319
    large.getContext('2d').drawImage(rawStamps[0].canvas, 0, 0, large.width, large.height)
    rawStamps.push({
      ...rawStamps[0],
      id: 'synthetic-large-template',
      canvas: large,
      width: large.width,
      height: large.height,
    })
    const tracedStamps = await traceStamps(rawStamps)
    const ps = Array.from({ length: 120 }, (_, i) => ({
      x: 18.25 + (i % 10) * 51.1,
      y: 20.75 + Math.floor(i / 10) * 43.4,
      angle: ((i % 5) - 2) * 0.1,
      targetSize: 28.5 + (i % 6) * 2.3,
      stampIndex: i % 3,
      strength: 0.13 + (i % 7) * 0.12,
      tint: { r: 20.5 + i * 1.1, g: 15.5 + i * 0.51, b: 30.7 + i * 0.85 },
      blend: i % 3 ? 'soft' : 'ink',
      depth: (i % 7) / 7,
      ...(i % 3 ? {} : { onEdge: i % 2 === 0 }),
      ...(i % 4 ? {} : { tintLiteral: i % 2 === 0 }),
    }))
    const geometry = JSON.stringify(ps),
      packed = await packRasterPlacements(ps)
    for (let row = 0; row < ps.length; row++) {
      const a = ps[row],
        b = readRasterPlacement(packed, row * RASTER_PLACEMENT_STRIDE)
      for (const key of [
        'x',
        'y',
        'angle',
        'targetSize',
        'stampIndex',
        'strength',
        'blend',
        'depth',
        'onEdge',
        'tintLiteral',
      ])
        check(a[key] === b[key], 'Lossless packed placement ' + key)
      for (const key of ['r', 'g', 'b'])
        check(a.tint[key] === b.tint[key], 'Lossless packed float RGB')
    }
    const NativeWorker = window.Worker,
      wire = { encoded: 0, fullPixels: 0, packedScenes: 0 }
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options)
        if (String(url).includes('raster.worker'))
          this.addEventListener('message', (event) => {
            if (event.data.type === 'encoded') wire.encoded++
            if (event.data.type === 'complete') wire.fullPixels++
          })
      }
      postMessage(message, transfer) {
        if (message.type === 'scene' && message.scene?.placements instanceof Float64Array)
          wire.packedScenes++
        super.postMessage(message, transfer)
      }
    }
    const pixels = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const compare = (a, b) => {
      const aa = pixels(a),
        bb = pixels(b)
      check(aa.length === bb.length, 'PNG dimensions')
      let changed = 0,
        max = 0
      for (let i = 0; i < aa.length; i++) {
        const d = Math.abs(aa[i] - bb[i])
        if (d) changed++
        max = Math.max(max, d)
      }
      return { changed, max, channels: aa.length }
    }
    const decoded = async (blob) => {
      const bitmap = await createImageBitmap(blob),
        c = document.createElement('canvas')
      c.width = bitmap.width
      c.height = bitmap.height
      c.getContext('2d').drawImage(bitmap, 0, 0)
      bitmap.close()
      return c
    }
    const cases = []
    const profiles = [
      { underlay: 0 },
      { underlay: 0.75 },
      { underlay: 0.75, washStyle: 'duotone-v1', washPalette: 'forest-rose' },
      { underlay: 0.85, washStyle: 'pop-v1', washPalette: 'violet-gold' },
    ]
    try {
      for (const background of ['#f5f3ef', '#111615'])
        for (const inkStyle of ['ink', 'cutout'])
          for (const [at, profile] of profiles.entries())
            for (const colorize of [false, true])
              for (const coverFill of [false, true]) {
                const stamps = at % 2 ? tracedStamps : rawStamps,
                  options = { ...profile, background, inkStyle, colorize, coverFill },
                  wash = profile.underlay ? await prepareSignatureWash(image, profile) : undefined
                const before = await frozen.paintPlacementsTiled(ps, stamps, 512, 640, 512, 640, {
                  ...options,
                  portrait: wash,
                  tileSize: 384,
                })
                let backend
                const blob = await exportSignaturePng(
                  {
                    portrait: image,
                    portraitFile: file,
                    portraitName: file.name,
                    options,
                    placements: ps,
                    stamps,
                    width: 512,
                    height: 640,
                  },
                  {
                    onBackend: (b) => {
                      backend = b
                    },
                  },
                )
                check(backend === 'worker', 'Actual supported Worker path, not silent fallback')
                const after = await decoded(blob),
                  oldPng = await decoded(await frozen.canvasToPngBlob(before)),
                  diff = compare(oldPng, after)
                if (diff.changed)
                  window.__pngDifference = { before: before.toDataURL(), after: after.toDataURL() }
                check(
                  diff.changed === 0,
                  `Exact frozen decoded RGBA ${inkStyle}/${at}/${colorize}/${coverFill}: ${JSON.stringify(diff)}`,
                )
                cases.push({
                  kind: 'frozen-png',
                  ...options,
                  traced: at % 2 === 1,
                  backend,
                  ...diff,
                })
                before.width =
                  before.height =
                  after.width =
                  after.height =
                  oldPng.width =
                  oldPng.height =
                    1
              }
      check(JSON.stringify(ps) === geometry, 'PNG transport/export never modifies geometry')
      check(
        wire.fullPixels === 0 && wire.encoded === 64 && wire.packedScenes === 64,
        'PNG returns Blob only, never full ImageData',
      )
      cases.push({ kind: 'wire-and-geometry', ...wire, stride: RASTER_PLACEMENT_STRIDE })
      for (const phase of ['immediate', 'render', 'encode']) {
        const signal = { cancelled: phase === 'immediate' }
        let rejected = false
        const start = performance.now()
        try {
          await exportSignaturePng(
            {
              portrait: image,
              portraitFile: file,
              portraitName: file.name,
              options: { colorize: true },
              placements: ps,
              stamps: rawStamps,
              width: 2048,
              height: 2048,
            },
            {
              signal,
              onProgress: (stage, ratio) => {
                if (stage === phase && (phase === 'encode' || ratio > 0)) signal.cancelled = true
              },
            },
          )
        } catch (e) {
          rejected = e.message === '已取消'
        }
        check(rejected, 'Cancelled at ' + phase)
        cases.push({ kind: 'cancel', phase, rejectMs: performance.now() - start })
      }
    } finally {
      window.Worker = NativeWorker
    }
    // Real Worker construction failure must use the same frozen pixels in compatibility mode.
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        if (String(url).includes('raster.worker')) throw new Error('QA export Worker unavailable')
        super(url, options)
      }
    }
    try {
      const options = {
          inkStyle: 'cutout',
          colorize: true,
          coverFill: true,
          background: '#111615',
          underlay: 0.75,
          washStyle: 'pop-v1',
          washPalette: 'blue-coral',
        },
        wash = await prepareSignatureWash(image, options)
      let backend
      const scene = {
        portrait: image,
        portraitFile: file,
        portraitName: file.name,
        options,
        placements: ps,
        stamps: rawStamps,
        width: 512,
        height: 640,
      }
      const blob = await exportSignaturePng(scene, {
        onBackend: (b) => {
          backend = b
        },
      })
      check(backend === 'canvas', 'Explicit compatibility status')
      const old = await frozen.paintPlacementsTiled(ps, rawStamps, 512, 640, 512, 640, {
          ...options,
          portrait: wash,
          tileSize: 384,
        }),
        after = await decoded(blob)
      const diff = compare(old, after)
      check(diff.changed === 0, 'Failure fallback exact RGBA')
      old.width = old.height = after.width = after.height = 1
      cases.push({ kind: 'worker-failure-compatibility', ...diff })
    } finally {
      window.Worker = NativeWorker
    }
    URL.revokeObjectURL(loaded.objectUrl)
    return cases
  }, url('frozen-layout.ts'))
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  process.exitCode = 1
  const pair = await page?.evaluate(() => window.__pngDifference).catch(() => null)
  if (pair)
    for (const [name, data] of Object.entries(pair))
      await writeFile(path.join(out, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'))
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({
      out,
      passed: report.passed,
      cases: report.cases.length,
      failure: report.failure,
    }),
  )
}
