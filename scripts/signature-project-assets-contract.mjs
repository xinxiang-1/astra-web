import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(
  process.env.ASTRA_SIGNATURE_ASSETS_OUTPUT ||
    `test-results/signature-project-assets-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const page = await browser.newPage()
const report = { browser: browser.version() }
try {
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/tools', {
    waitUntil: 'domcontentloaded',
  })
  report.cases = await page.evaluate(async () => {
    const { createSignatureProject, readSignatureProject } =
      await import('/src/lib/signature-portrait/project.ts')
    const { loadImageElement } = await import('/src/lib/signature-portrait/extract.ts')
    const { paintPlacementsRegion } = await import('/src/lib/signature-portrait/layout.ts')
    const { traceStampCanvas } = await import('/src/lib/signature-portrait/trace.ts')
    const { generateHandwritingVariants } = await import('/src/lib/signature-portrait/variants.ts')
    const canvas = (w, h) => {
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      return c
    }
    const pixels = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    const delta = (a, b) => {
      if (a.length !== b.length) throw new Error('Pixel length changed')
      let changed = 0,
        maxDelta = 0
      for (let i = 0; i < a.length; i++) {
        const d = Math.abs(a[i] - b[i])
        if (d) changed++
        maxDelta = Math.max(maxDelta, d)
      }
      return { channels: a.length, changed, maxDelta }
    }
    const source = canvas(320, 240),
      ctx = source.getContext('2d'),
      gradient = ctx.createLinearGradient(0, 0, 320, 240)
    gradient.addColorStop(0, '#152a33')
    gradient.addColorStop(1, '#e5d8b2')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 320, 240)
    const original = new File(
      [await new Promise((resolve) => source.toBlob(resolve, 'image/png'))],
      'source.png',
      { type: 'image/png', lastModified: 1720000000000 },
    )
    const { image, objectUrl } = await loadImageElement(original)
    const ink = canvas(160, 56),
      i = ink.getContext('2d')
    i.strokeStyle = '#123d65'
    i.lineWidth = 2.7
    i.lineCap = 'round'
    i.beginPath()
    i.moveTo(7, 42)
    i.bezierCurveTo(55, -10, 38, 66, 88, 9)
    i.bezierCurveTo(55, 61, 128, 25, 150, 42)
    i.stroke()
    const alpha = canvas(64, 32),
      a = alpha.getContext('2d'),
      rgba = a.createImageData(64, 32)
    for (let n = 0; n < rgba.data.length; n += 4) {
      rgba.data[n] = (n * 17) % 256
      rgba.data[n + 1] = (n * 31 + 7) % 256
      rgba.data[n + 2] = (n * 11 + 3) % 256
      rgba.data[n + 3] = (n / 4) % 256
    }
    a.putImageData(rgba, 0, 0)
    const stamps = [
      {
        id: 'engineering-stroke',
        label: '工程笔迹，非真实用户签名',
        canvas: ink,
        width: 160,
        height: 56,
        previewUrl: '',
        vector: traceStampCanvas(ink),
      },
      {
        id: 'alpha-stress',
        label: '透明像素工程夹具',
        canvas: alpha,
        width: 64,
        height: 32,
        previewUrl: '',
        vector: { width: 64, height: 32, paths: ['M2 2 L55 4 L60 28 L3 29 Z'] },
      },
    ]
    const longcang = (
      await generateHandwritingVariants('柳', { count: 8, seed: 42, font: 'longcang' })
    )[0]
    longcang.vector = traceStampCanvas(longcang.canvas)
    stamps.push(longcang)
    const placements = Array.from({ length: 16 }, (_, n) => ({
      x: 42 + (n % 4) * 74,
      y: 30 + Math.floor(n / 4) * 58,
      angle: ((n % 3) - 1) * 0.15,
      targetSize: 80 + (n % 7),
      stampIndex: n % stamps.length,
      strength: 0.25 + (n % 4) * 0.2,
      tint: { r: 10 + n * 9, g: 20 + n * 7, b: 150 - n * 3 },
      blend: n % 2 ? 'ink' : 'soft',
      depth: (n % 6) / 6,
      onEdge: n % 2 === 0,
      tintLiteral: n % 3 === 0,
    }))
    const cases = []
    const hash = async (blob) =>
      Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
        (v) => v.toString(16).padStart(2, '0'),
      ).join('')
    try {
      for (const inkStyle of ['ink', 'cutout'])
        for (const background of ['#f5f3ef', '#111615']) {
          const options = {
            inkStyle,
            background,
            maxSide: 320,
            density: 12,
            colorize: true,
            coverFill: false,
            underlay: 0,
            seed: 42,
          }
          const project = {
            portrait: image,
            portraitFile: original,
            portraitName: '工程源图',
            stamps,
            placements,
            options,
            width: 320,
            height: 240,
          }
          const region = { x: 0, y: 0, w: 320, h: 240 }
          const before = paintPlacementsRegion(placements, stamps, region, 320, 240, {
            ...options,
            portrait: image,
            layoutW: 320,
            layoutH: 240,
          })
          const restored = await readSignatureProject(await createSignatureProject(project))
          const s = restored.project
          const after = paintPlacementsRegion(s.placements, s.stamps, region, 320, 240, {
            ...s.options,
            portrait: s.portrait,
            layoutW: 320,
            layoutH: 240,
          })
          const result = {
            inkStyle,
            background,
            sourceBytesEqual: (await hash(s.portraitFile)) === (await hash(original)),
            vectorsEqual:
              JSON.stringify(s.stamps.map((t) => t.vector)) ===
              JSON.stringify(stamps.map((t) => t.vector)),
            raster: delta(pixels(before), pixels(after)),
            templates: s.stamps.map((stamp, n) =>
              delta(pixels(stamps[n].canvas), pixels(stamp.canvas)),
            ),
          }
          const retained = s.stamps.map((stamp) => stamp.canvas)
          restored.dispose()
          restored.dispose()
          result.released =
            retained.every((c) => c.width === 1 && c.height === 1) &&
            !s.portrait.hasAttribute('src')
          cases.push(result)
        }
      // Native context failure while restoring a stamp releases its partially allocated surface.
      const file = await createSignatureProject({
        portrait: image,
        portraitFile: original,
        portraitName: '工程源图',
        stamps,
        placements,
        options: { underlay: 0 },
        width: 320,
        height: 240,
      })
      const getContext = HTMLCanvasElement.prototype.getContext
      let failedCanvas = null,
        threw = false
      HTMLCanvasElement.prototype.getContext = function (...args) {
        if (this.width === 160 && this.height === 56) {
          failedCanvas = this
          throw new Error('Intentional template context failure')
        }
        return getContext.apply(this, args)
      }
      try {
        await readSignatureProject(file)
      } catch {
        threw = true
      } finally {
        HTMLCanvasElement.prototype.getContext = getContext
      }
      cases.push({
        templateContextFailure: threw,
        partialSurfaceReleased: failedCanvas?.width === 1 && failedCanvas?.height === 1,
      })
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
    return cases
  })
  for (const c of report.cases) {
    if (c.raster) {
      assert.equal(c.raster.changed, 0, JSON.stringify(c))
      assert(
        c.templates.every((t) => t.changed === 0),
        JSON.stringify(c),
      )
      assert(c.sourceBytesEqual && c.vectorsEqual && c.released, JSON.stringify(c))
    } else assert(c.templateContextFailure && c.partialSurfaceReleased, JSON.stringify(c))
  }
  report.passed = true
} catch (e) {
  report.passed = false
  report.failure = e.stack
  throw e
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }, null, 2))
  await browser.close()
}
