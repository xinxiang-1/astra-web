import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
const base = process.env.ASTRA_DEV_URL || 'http://localhost:5173'
const out = process.env.ASTRA_CREATIVE_CORE_OUTPUT || 'test-results/creative-workflow'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
try {
  const page = await browser.newPage()
  await page.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  const report = await page.evaluate(async () => {
    const { createTextStamp } = await import('/src/lib/signature-portrait/extract.ts')
    const { renderSignaturePortrait } = await import('/src/lib/signature-portrait/layout.ts')
    const { signatureInkStrength } = await import('/src/lib/signature-portrait/render-style.ts')
    const { createSignatureProject, readSignatureProject } =
      await import('/src/lib/signature-portrait/project.ts')
    const { exportSignaturePng } = await import('/src/lib/signature-portrait/png-export.ts')
    const { signatureArtProject } = await import('/src/lib/signature-art-workflow.ts')
    const { createArtProjectPackage, readArtProjectPackage } =
      await import('/src/lib/art-project-package.ts')
    const { ART_RECIPES } = await import('/src/lib/art-recipes.ts')
    const { traceStamps, buildPathSvgDocument } =
      await import('/src/lib/signature-portrait/trace.ts')
    const check = (v, s) => {
        if (!v) throw new Error(s)
      },
      cases = []
    for (const a of [0, 0.05, 0.4, 0.8, 1]) {
      check(signatureInkStrength(a, 1) === a, 'old gain1 changed')
      check(
        signatureInkStrength(a, 0.2) <= a && signatureInkStrength(a, 3) >= a,
        'opacity monotonic',
      )
    }
    cases.push('gain-one-and-monotonic-alpha')
    const photo = document.createElement('canvas')
    photo.width = 320
    photo.height = 256
    const ctx = photo.getContext('2d'),
      pixels = ctx.createImageData(320, 256)
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 320; x++)
        pixels.data.set(
          x < 160 ? [210, 40 + y / 4, 30, 255] : [30, 50 + y / 4, 215, 255],
          (y * 320 + x) * 4,
        )
    ctx.putImageData(pixels, 0, 0)
    const png = await new Promise((r) => photo.toBlob(r, 'image/png')),
      file = new File([png], 'regional.png', { type: 'image/png' })
    const image = new Image()
    image.src = URL.createObjectURL(file)
    await image.decode()
    const stamps = [createTextStamp('Astra'), createTextStamp('李云舟')]
    let retained
    const geom = (p) => p.map(({ strength, tint, tintLiteral, ...rest }) => rest)
    for (const layoutMethod of ['woven', 'stipple']) {
      const options = {
        maxSide: 320,
        density: 0.7,
        layoutMethod,
        seed: 42,
        minSizeRatio: 0.035,
        maxSizeRatio: 0.09,
        colorize: true,
        background: '#f5f3ef',
        colorMode: 'source',
        inkColorMode: 'source',
        toneGain: 1,
      }
      const base = await renderSignaturePortrait(image, 320, 256, stamps, options)
      const custom = await renderSignaturePortrait(image, 320, 256, stamps, {
        ...options,
        ink: { r: 16, g: 112, b: 168 },
        inkColorMode: 'custom',
      })
      const light = await renderSignaturePortrait(image, 320, 256, stamps, {
        ...options,
        toneGain: 0.4,
      })
      check(base.placements.length > 10, 'empty placements')
      check(
        JSON.stringify(geom(base.placements)) === JSON.stringify(geom(custom.placements)),
        'colour relayout',
      )
      check(
        JSON.stringify(geom(base.placements)) === JSON.stringify(geom(light.placements)),
        'concentration relayout',
      )
      check(
        custom.placements.every(
          (p) => p.tint.r === 16 && p.tint.g === 112 && p.tint.b === 168 && p.tintLiteral,
        ),
        'custom RGB ignored',
      )
      check(
        base.placements.filter((p) => p.x < 120).every((p) => p.tint.r > p.tint.b),
        'left regional colour',
      )
      check(
        base.placements.filter((p) => p.x > 200).every((p) => p.tint.b > p.tint.r),
        'right regional colour',
      )
      check(
        light.placements.every((p, i) => p.strength <= base.placements[i].strength),
        'lightened alpha',
      )
      const scene = {
        portrait: image,
        portraitFile: file,
        portraitName: '区域彩墨',
        options: { ...options, toneGain: 0.4 },
        stamps,
        placements: light.placements,
        width: base.width,
        height: base.height,
      }
      const packed = await createSignatureProject(scene),
        restored = await readSignatureProject(new File([packed], 'source.astra-signature'))
      check(
        restored.project.options.inkColorMode === 'source' &&
          restored.project.options.toneGain === 0.4,
        'project loses ink controls',
      )
      check(
        restored.project.placements.length === scene.placements.length &&
          restored.project.placements.every((p, i) =>
            Object.entries(scene.placements[i]).every(
              ([key, value]) => JSON.stringify(p[key]) === JSON.stringify(value),
            ),
          ),
        'project loses placements',
      )
      restored.dispose()
      cases.push(layoutMethod + '-geometry-rgb-opacity-project')
      if (layoutMethod === 'woven') retained = scene
      const svg = buildPathSvgDocument(
        custom.placements,
        await traceStamps(stamps),
        custom.width,
        custom.height,
        { ...options, ink: { r: 16, g: 112, b: 168 } },
      )
      check(svg.includes('#1070a8'), 'SVG loses custom RGB')
    }
    const bounded = await exportSignaturePng(retained, { longEdge: 128 }),
      bitmap = await createImageBitmap(bounded)
    check(bitmap.width === 128 && bitmap.height === 102, 'bounded PNG dims')
    bitmap.close()
    const NativeWorker = window.Worker
    let backend
    try {
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          if (String(url).includes('raster.worker'))
            throw new Error('QA bounded export worker unavailable')
          super(url, options)
        }
      }
      const fallback = await exportSignaturePng(retained, {
        longEdge: 128,
        onBackend: (value) => (backend = value),
      })
      const image = await createImageBitmap(fallback)
      check(
        backend === 'canvas' && image.width === 128 && image.height === 102,
        'bounded PNG fallback',
      )
      image.close()
      const noUpscale = await exportSignaturePng(retained, { longEdge: 2048 })
      const original = await createImageBitmap(noUpscale)
      check(
        original.width === retained.width && original.height === retained.height,
        'workflow PNG upscaled',
      )
      original.close()
      cases.push('bounded-png-fallback-and-no-upscale')
    } finally {
      window.Worker = NativeWorker
    }
    for (const recipe of ART_RECIPES) {
      const p = signatureArtProject(
        new File([bounded], 'derived.png', { type: 'image/png' }),
        photo.toDataURL('image/jpeg'),
        '区域彩墨',
        '#f5f3ef',
        recipe.id,
      )
      const packed = await createArtProjectPackage(p),
        r = await readArtProjectPackage(new File([packed], 'derived.astra'))
      check(
        JSON.stringify(r.project.settings) === JSON.stringify(p.settings),
        'recipe lost from package',
      )
      cases.push('recipe-package-' + recipe.id)
    }
    const packed = await createSignatureProject(retained)
    const bytes = new Uint8Array(await packed.arrayBuffer())
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return { cases, packed: btoa(binary), placements: retained.placements.length }
  })
  const packed = report.packed
  delete report.packed
  await writeFile(out + '/source.astra-signature', Buffer.from(packed, 'base64'))
  await writeFile(
    out + '/core-' + (process.env.ASTRA_BROWSER_CHANNEL || 'msedge') + '.json',
    JSON.stringify({ browser: browser.version(), ...report }, null, 2) + '\n',
  )
  assert.equal(report.cases.length, 7)
  console.log(JSON.stringify(report))
} finally {
  await browser.close()
}
