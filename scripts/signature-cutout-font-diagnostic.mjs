import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const out = path.resolve(
  process.env.ASTRA_CUTOUT_DIAGNOSTIC_OUTPUT || 'test-results/signature-cutout-font-diagnostic',
)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:5180/signature-portrait')
  const result = await page.evaluate(async () => {
    const e = await import('/src/lib/signature-portrait/index.ts')
    const stamps = await e.traceStamps(
      await e.generateHandwritingVariants('心上人', { count: 8, seed: 42 }),
    )
    const rows = [],
      images = []
    const placements = []
    for (const size of [8, 24, 96])
      for (const angle of [0, 0.07])
        for (const strength of [0.4, 1]) {
          const p = {
            x: 112,
            y: 112,
            targetSize: size,
            angle,
            strength,
            stampIndex: 0,
            tint: { r: 32, g: 38, b: 41 },
            depth: 0.6,
            blend: 'ink',
          }
          const options = { inkStyle: 'cutout', background: '#f5f3ef', colorize: false }
          const canvas = e.paintPlacementsScaled([p], stamps, 224, 224, 224, 224, options)
          const svg = e.buildPathSvgDocument([p], stamps, 224, 224, options)
          const img = new Image(),
            url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
          img.src = url
          await img.decode()
          const ref = document.createElement('canvas')
          ref.width = 224
          ref.height = 224
          ref.getContext('2d').drawImage(img, 0, 0)
          URL.revokeObjectURL(url)
          const a = canvas.getContext('2d').getImageData(0, 0, 224, 224).data,
            b = ref.getContext('2d').getImageData(0, 0, 224, 224).data
          let error = 0,
            changed = 0,
            amax = 0,
            bmax = 0
          for (let i = 0; i < a.length; i += 4) {
            if (a[i] < 240 || b[i] < 240) changed++
            for (let j = 0; j < 3; j++) error += Math.abs(a[i + j] - b[i + j])
            amax += 245 - a[i]
            bmax += 245 - b[i]
          }
          rows.push({
            size,
            angle,
            strength,
            mae: error / (224 * 224 * 3 * 255),
            changed,
            inkMassCanvas: amax,
            inkMassSvg: bmax,
          })
          if (size === 96 && angle === 0.07 && strength === 1)
            images.push(
              { name: 'single-canvas', png: canvas.toDataURL().split(',')[1] },
              { name: 'single-svg', png: ref.toDataURL().split(',')[1] },
            )
        }
    const image = new Image()
    image.src = '/artwork/portrait.jpg'
    await image.decode()
    const layout = await e.renderSignaturePortrait(image, image.width, image.height, stamps, {
      maxSide: 768,
      skipPaint: true,
      density: 30,
      seed: 42,
      minSizeRatio: 0.014,
      maxSizeRatio: 0.04,
      angleRange: 12,
    })
    const options = { inkStyle: 'cutout', background: '#f5f3ef', colorize: false, coverFill: false }
    const canvas = e.paintPlacementsScaled(
      layout.placements,
      stamps,
      layout.width,
      layout.height,
      layout.width,
      layout.height,
      options,
    )
    const svg = e.buildPathSvgDocument(
      layout.placements,
      stamps,
      layout.width,
      layout.height,
      options,
    )
    const img = new Image(),
      url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    img.src = url
    await img.decode()
    const ref = document.createElement('canvas')
    ref.width = layout.width
    ref.height = layout.height
    ref.getContext('2d').drawImage(img, 0, 0)
    URL.revokeObjectURL(url)
    images.push(
      { name: 'portrait-canvas', png: canvas.toDataURL().split(',')[1] },
      { name: 'portrait-svg', png: ref.toDataURL().split(',')[1] },
    )
    const ring = document.createElement('canvas')
    ring.width = 128
    ring.height = 128
    const ringCtx = ring.getContext('2d')
    ringCtx.strokeStyle = '#121018'
    ringCtx.lineWidth = 12
    ringCtx.beginPath()
    ringCtx.arc(64, 64, 32, 0, Math.PI * 2)
    ringCtx.stroke()
    const ringStamp = {
      id: 'ring',
      label: 'Engineering cavity fixture',
      canvas: ring,
      width: 128,
      height: 128,
      previewUrl: ring.toDataURL(),
    }
    const ringOut = e.paintPlacementsScaled(
      [
        {
          x: 128,
          y: 128,
          targetSize: 128,
          angle: 0,
          strength: 1,
          stampIndex: 0,
          tint: { r: 20, g: 20, b: 20 },
          tintLiteral: true,
          depth: 1,
          blend: 'ink',
        },
      ],
      [ringStamp],
      256,
      256,
      256,
      256,
      { inkStyle: 'cutout', background: '#f5f3ef', colorize: false },
    )
    const sample = (x, y) => ringOut.getContext('2d').getImageData(x, y, 1, 1).data[0]
    const cavities = {
      innerHole: sample(128, 128),
      inkRing: sample(160, 128),
      outerPlate: sample(178, 128),
      outside: sample(220, 128),
    }
    return { rows, images, svg, cavities }
  })
  for (const img of result.images)
    await writeFile(path.join(out, img.name + '.png'), Buffer.from(img.png, 'base64'))
  await writeFile(path.join(out, 'portrait.svg'), result.svg)
  delete result.images
  delete result.svg
  await writeFile(path.join(out, 'report.json'), JSON.stringify(result, null, 2))
  for (const row of result.rows) assert(row.mae < 0.00005, JSON.stringify(row))
  assert(
    result.cavities.innerHole < 80 &&
      result.cavities.outerPlate < 80 &&
      result.cavities.inkRing > 240 &&
      result.cavities.outside === 245,
    'Negative ink must preserve positive internal holes',
  )
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
