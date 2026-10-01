import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const root = path.resolve(process.env.ASTRA_EFFECTS_BASELINE_OUTPUT || 'sandbox/art-effects/2026-10-01-v2/baseline-evidence')
await mkdir(root, { recursive: false })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' })
const errors = []
page.on('pageerror', e => errors.push(e.message))
try {
  await page.goto('http://127.0.0.1:5180/ascii-art', { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.locator('input[type=file]').setInputFiles(path.resolve('public/artwork/portrait.jpg'))
  await page.waitForFunction(() => document.querySelector('.ascii-canvas')?.width > 100 && !document.querySelector('.editor-package')?.disabled)
  await page.locator('details:has([aria-label="六模式悬停"])').evaluate(d => { d.open = true })
  const options = await page.getByRole('group', { name: '六模式悬停', exact: true }).innerText()
  const motions = await page.getByRole('group', { name: '六模式微动', exact: true }).innerText()
  async function snapshot() { return page.locator('.ascii-canvas').evaluate(c => c.toDataURL()) }
  async function hoverCase(name) {
    await page.mouse.move(0, 0)
    await page.waitForTimeout(700)
    const before = await snapshot()
    const box = await page.locator('.ascii-canvas').boundingBox()
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4)
    await page.waitForTimeout(600)
    const after = await snapshot()
    await page.screenshot({ path: path.join(root, `${name}.png`) })
    return { name, equal: before === after }
  }
  const cases = [await hoverCase('classic-hover')]
  await page.locator('button[data-quality="faithful"]').click()
  cases.push(await hoverCase('faithful-hover'))
  await page.getByRole('button', { name: '暂停动效', exact: true }).click()
  cases.push(await hoverCase('faithful-paused-hover'))
  const api = await page.evaluate(async () => {
    const { prepareArtFrame, createCanvasArtRenderer } = await import('/src/lib/art-engine/index.ts')
    const image = await createImageBitmap(await (await fetch('/artwork/portrait.jpg')).blob())
    const source = document.createElement('canvas'); source.width = image.width; source.height = image.height; source.getContext('2d').drawImage(image, 0, 0); image.close()
    const report = []
    for (const quality of ['classic', 'faithful']) {
      const frame = prepareArtFrame(source, source.width, source.height, { mode: 'density', columns: 120, invert: true, fontFamily: 'Consolas,monospace', ...(quality === 'faithful' ? { softwareRaster: true, colorFidelity: true, fontWeight: 600 } : {}) })
      const canvas = document.createElement('canvas'), renderer = createCanvasArtRenderer(canvas)
      renderer.render(frame, { longEdge: 720, motion: 'none' }); const before = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      renderer.render(frame, { longEdge: 720, motion: 'none', hover: 'light', pointer: { x: .5, y: .4, strength: 1 } }); const after = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let changed = 0, total = 0; for (let i = 0; i < before.length; i++) { const delta = Math.abs(before[i] - after[i]); if (delta) changed++; total += delta }
      report.push({ quality, changedChannels: changed, meanChannelDelta: total / before.length, fullInkCells: [...frame.alpha].filter(a => a >= .995).length, cells: frame.alpha.length }); renderer.destroy()
    }
    return report
  })
  await writeFile(path.join(root, 'report.json'), JSON.stringify({ options, motions, cases, api, errors, reducedMotion: false }, null, 2), { flag: 'wx' })
  console.log(JSON.stringify({ options, motions, cases, api, errors }))
} finally { await browser.close() }
