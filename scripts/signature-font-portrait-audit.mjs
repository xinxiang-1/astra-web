/** Visual evidence and measured capacity; this is not a commercial aesthetic pass. */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_SIGNATURE_PORTRAIT_OUTPUT ||
    `test-results/signature-font-portrait-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  await page.goto(`${base}/signature-portrait`)
  const result = await page.evaluate(async () => {
    const engine = await import('/src/lib/signature-portrait/index.ts')
    const { generateHandwritingVariants: old } =
      await import('/scripts/fixtures/signature-variants-v1.ts')
    const image = new Image()
    image.src = '/artwork/porcelain-study-v1.png'
    await image.decode()
    const records = [],
      artifacts = []
    const sheet = document.createElement('canvas')
    sheet.width = 1440
    sheet.height = 4 * 654
    const ctx = sheet.getContext('2d')
    ctx.fillStyle = '#e9e5df'
    ctx.fillRect(0, 0, sheet.width, sheet.height)
    let row = 0
    for (const name of ['李云舟', 'Alexander Montgomery']) {
      const sets = [
        ['old-platform', await old(name, { count: 40, seed: 20261004 })],
        [
          'mashanzheng',
          await engine.generateHandwritingVariants(name, {
            count: 40,
            seed: 20261004,
            font: 'mashanzheng',
          }),
        ],
        [
          'longcang',
          await engine.generateHandwritingVariants(name, {
            count: 40,
            seed: 20261004,
            font: 'longcang',
          }),
        ],
      ]
      for (const surface of ['paper', 'night']) {
        let col = 0
        for (const [font, stamps] of sets) {
          const options = {
            maxSide: 960,
            density: 30,
            seed: 42,
            inkStyle: 'ink',
            minSizeRatio: 0.014,
            maxSizeRatio: 0.04,
            angleRange: 12,
            allowVertical: false,
            invertDensity: surface === 'night',
            ink: surface === 'night' ? { r: 238, g: 234, b: 226 } : undefined,
            background: surface === 'night' ? '#111615' : '#f5f3ef',
            colorize: false,
            coverFill: false,
            underlay: 0,
            edgeOutline: true,
            edgeThreshold: 0.32,
            edgeBoost: 0.95,
            edgeColorMode: 'auto',
            gamma: 1.15,
            overlap: 0.22,
          }
          const started = performance.now()
          const layout = await engine.renderSignaturePortrait(
            image,
            image.width,
            image.height,
            stamps,
            options,
          )
          const png = layout.canvas.toDataURL('image/png').split(',')[1]
          artifacts.push({
            file: `${name === '李云舟' ? 'chinese' : 'long-latin'}-${surface}-${font}.png`,
            png,
          })
          const crop = engine.paintPlacementsRegion(
            layout.placements,
            stamps,
            {
              x: layout.width * 0.3,
              y: layout.height * 0.28,
              w: layout.width * 0.3,
              h: layout.height * 0.25,
            },
            960,
            800,
            options,
          )
          artifacts.push({
            file: `${name === '李云舟' ? 'chinese' : 'long-latin'}-${surface}-${font}-crop.png`,
            png: crop.toDataURL('image/png').split(',')[1],
          })
          ctx.fillStyle = '#302c28'
          ctx.font = '16px sans-serif'
          ctx.fillText(`${name} · ${surface} · ${font}`, col * 480 + 12, row * 654 + 24)
          ctx.drawImage(layout.canvas, col * 480 + 8, row * 654 + 36, 464, 580)
          records.push({
            name,
            font,
            surface,
            width: layout.width,
            height: layout.height,
            placements: layout.placements.length,
            elapsed: performance.now() - started,
            underlay: options.underlay,
            photographLayer: false,
          })
          col++
        }
        row++
      }
    }
    return { records, artifacts, sheet: sheet.toDataURL('image/png').split(',')[1] }
  })
  for (const artifact of result.artifacts)
    await writeFile(path.join(out, artifact.file), Buffer.from(artifact.png, 'base64'))
  await writeFile(path.join(out, 'portrait-comparison.png'), Buffer.from(result.sheet, 'base64'))
  await writeFile(
    path.join(out, 'report.json'),
    JSON.stringify(
      {
        date: new Date().toISOString(),
        browser: browser.version(),
        scope:
          'Font source comparison with unchanged production woven layout. Developer inspection, no user aesthetic acceptance.',
        records: result.records,
      },
      null,
      2,
    ),
  )
  console.log(
    JSON.stringify(
      { out, cases: result.records.length, artifacts: result.artifacts.length },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
}
