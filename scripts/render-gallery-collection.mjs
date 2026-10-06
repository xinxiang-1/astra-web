import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(
  process.env.ASTRA_GALLERY_OUTPUT || 'test-results/gallery-collection-20261005',
)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = { browser: browser.version(), engineHashes: {}, cases: [] }
for (const file of [
  'src/lib/art-engine/core.ts',
  'src/lib/art-engine/canvas.ts',
  'src/lib/art-engine/gpu.ts',
]) {
  report.engineHashes[file] = createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
}
try {
  const page = await browser.newPage()
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/ascii-art')
  const art = await page.evaluate(
    async () => (await import('/src/content/artwork.ts')).artworkPresets,
  )
  for (const preset of art) {
    const result = await page.evaluate(async (preset) => {
      const { prepareArtFrame, createArtRenderer, ART_ENGINE_VERSION } =
        await import('/src/lib/art-engine/index.ts')
      const image = new Image()
      image.src = preset.src
      await image.decode()
      await document.fonts.ready
      const frame = prepareArtFrame(image, image.naturalWidth, image.naturalHeight, {
        mode: preset.phrase ? 'phrase' : 'density',
        phrase: preset.phrase || '光与影',
        columns: 180,
        colored: preset.color,
      })
      const canvas = document.createElement('canvas'),
        renderer = createArtRenderer(canvas)
      try {
        const dimensions = renderer.render(frame, {
          longEdge: 1402,
          motion: 'none',
          hover: 'light',
        })
        return {
          id: preset.id,
          title: preset.title,
          source: preset.src,
          preview: preset.preview,
          sourceWidth: image.naturalWidth,
          sourceHeight: image.naturalHeight,
          engine: ART_ENGINE_VERSION,
          backend: renderer.backend,
          columns: frame.columns,
          rows: frame.rows,
          nonEmpty: frame.statistics.nonEmpty,
          mode: frame.settings.mode,
          colored: frame.settings.colored,
          phrase: frame.settings.phrase,
          ...dimensions,
          png: canvas.toDataURL('image/png').split(',')[1],
        }
      } finally {
        renderer.destroy()
      }
    }, preset)
    const pixels = Buffer.from(result.png, 'base64')
    delete result.png
    await writeFile(path.join(out, preset.id + '-characters.png'), pixels)
    result.pngSha256 = createHash('sha256').update(pixels).digest('hex')
    report.cases.push(result)
    await writeFile(path.join(out, 'render.json'), JSON.stringify(report, null, 2))
    console.log(
      JSON.stringify({
        id: result.id,
        dimensions: [result.width, result.height],
        glyphs: result.nonEmpty,
        backend: result.backend,
      }),
    )
  }
} finally {
  await browser.close()
}
