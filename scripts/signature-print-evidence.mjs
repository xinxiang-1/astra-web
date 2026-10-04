import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const r1Dir = path.resolve(process.env.ASTRA_R1_DATA || 'test-results/signature-capacity-partition-r1-20261004')
const r2Dir = path.resolve(process.env.ASTRA_PRINT_DATA || 'test-results/signature-print-research')
const out = path.resolve(process.env.ASTRA_PRINT_EVIDENCE || 'test-results/signature-print-evidence')
const r1 = JSON.parse(await readFile(path.join(r1Dir, 'report.json')))
const r2 = JSON.parse(await readFile(path.join(r2Dir, 'report.json')))
assert(r1.engineeringPassed && r2.engineeringPassed)
await mkdir(out, { recursive: true })
for (const [file, sha256] of Object.entries(r2.sourceHashes)) assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), sha256, file)
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const report = { provenance: 'actual frozen PNGs; overviews scaled; 280x180 crops at native 1:1; no new rendering or image generation', cases: [] }
try {
  const page = await browser.newPage()
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/docs/research/2026-10-04-signature-capacity/experiment-r2.json')
  for (const label of ['beethoven-porcelain-paper', 'chinese-portrait-night', 'english-portrait-paper']) {
    const panels = []
    for (const size of [1024, 2048, 4096]) {
      const row = (size === 1024 ? r1 : r2).cases.find(c => c.label === (size === 1024 ? label : `${label}-${size}`) && c.profile === 'candidate')
      assert(row)
      const file = path.join(size === 1024 ? r1Dir : r2Dir, `${row.label}-candidate.png`)
      panels.push({ size, count: row.count, rgbaSha256: row.rgbaSha256, width: row.width, height: row.height, png: (await readFile(file)).toString('base64') })
    }
    const result = await page.evaluate(async panels => {
      const board = document.createElement('canvas'); board.width = 1320; board.height = 860
      const ctx = board.getContext('2d'); ctx.fillStyle = '#f6f7f2'; ctx.fillRect(0, 0, board.width, board.height)
      const audits = []
      for (let i = 0; i < panels.length; i++) {
        const panel = panels[i], image = new Image(); image.src = 'data:image/png;base64,' + panel.png; await image.decode()
        const native = document.createElement('canvas'); native.width = image.naturalWidth; native.height = image.naturalHeight
        const nctx = native.getContext('2d', { willReadFrequently: true }); nctx.drawImage(image, 0, 0)
        const pixels = nctx.getImageData(0, 0, native.width, native.height).data
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), n => n.toString(16).padStart(2, '0')).join('')
        const x = i * 440 + 20
        ctx.fillStyle = '#17382d'; ctx.font = '24px "Microsoft YaHei", sans-serif'; ctx.fillText(`${panel.size}px / ${panel.size === 1024 ? 'R1' : 'R2'}`, x, 42)
        ctx.font = '15px "Microsoft YaHei", sans-serif'; ctx.fillText(`${panel.count}枚完整签名 · 笔迹原生高度≥${panel.size === 1024 ? 8 : 16}px`, x, 72)
        const fit = Math.min(400 / native.width, 500 / native.height), w = native.width * fit, h = native.height * fit
        ctx.drawImage(native, x + (400 - w) / 2, 94, w, h)
        ctx.fillStyle = '#17382d'; ctx.fillText('原生裁片 / 280×180 / 1:1', x, 626)
        const crop = document.createElement('canvas'); crop.width = 280; crop.height = 180
        const x0 = Math.round(native.width * .5 - 140), y0 = Math.round(native.height * .36 - 90)
        crop.getContext('2d').drawImage(native, x0, y0, 280, 180, 0, 0, 280, 180)
        const actual = crop.getContext('2d').getImageData(0, 0, 280, 180).data
        let changedChannels = 0
        for (let y = 0; y < 180; y++) for (let px = 0; px < 280; px++) for (let c = 0; c < 4; c++) if (actual[(y * 280 + px) * 4 + c] !== pixels[((y0 + y) * native.width + x0 + px) * 4 + c]) changedChannels++
        ctx.drawImage(crop, x, 646)
        audits.push({ size: panel.size, width: native.width, height: native.height, rgbaSha256: hash, cropChangedChannels: changedChannels, cropChannels: actual.length })
        native.width = 1; native.height = 1
      }
      return { audits, png: board.toDataURL('image/png').split(',')[1] }
    }, panels)
    for (let i = 0; i < panels.length; i++) {
      assert.equal(result.audits[i].rgbaSha256, panels[i].rgbaSha256)
      assert.equal(result.audits[i].cropChangedChannels, 0)
      assert.equal(result.audits[i].width, panels[i].width)
      assert.equal(result.audits[i].height, panels[i].height)
    }
    await writeFile(path.join(out, label + '-comparison.png'), Buffer.from(result.png, 'base64'))
    report.cases.push({ label, panels: result.audits })
  }
  report.passed = true
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ out, passed: report.passed, cases: report.cases.length }))
