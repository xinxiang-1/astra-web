import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve('test-results/home-interaction')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto(base)
  const result = await page.evaluate(async () => {
    await document.fonts.ready
    const { prepareArtFrame, createArtRenderer } = await import('/src/lib/art-engine/index.ts')
    const source = document.createElement('canvas')
    source.width = 480; source.height = 112
    const ctx = source.getContext('2d')
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 480, 112)
    const frame = prepareArtFrame(source, 480, 112, {
      mode: 'phrase', phrase: 'FJRq光与你', columns: 24,
      normalize: false, contrast: 0, ink: '#ffffff',
    })
    frame.alpha.fill(1)
    frame.width = frame.columns * frame.cellWidth
    frame.height = frame.rows * frame.cellHeight
    const gpuCanvas = document.createElement('canvas')
    const cpuCanvas = document.createElement('canvas')
    const gpu = createArtRenderer(gpuCanvas)
    const cpu = createArtRenderer(cpuCanvas, { forceCanvas: true })
    const options = { longEdge: Math.max(frame.width, frame.height), transparent: true }
    gpu.render(frame, options); cpu.render(frame, options)
    function error(a, b, flipX, flipY) {
      let sum = 0
      for (let y = 0; y < frame.height; y++) for (let x = 0; x < frame.width; x++) {
        const tx = Math.floor(x / frame.cellWidth) * frame.cellWidth + (flipX ? frame.cellWidth - 1 - x % frame.cellWidth : x % frame.cellWidth)
        const ty = Math.floor(y / frame.cellHeight) * frame.cellHeight + (flipY ? frame.cellHeight - 1 - y % frame.cellHeight : y % frame.cellHeight)
        sum += Math.abs(a[(y * frame.width + x) * 4 + 3] - b[(ty * frame.width + tx) * 4 + 3]) / 255
      }
      return sum / (frame.width * frame.height)
    }
    function comparison() {
      const a = gpuCanvas.getContext('2d').getImageData(0, 0, frame.width, frame.height).data
      const b = cpuCanvas.getContext('2d').getImageData(0, 0, frame.width, frame.height).data
      return { upright: error(a, b, false, false), mirrorX: error(a, b, true, false), mirrorY: error(a, b, false, true), upsideDown: error(a, b, true, true) }
    }
    const result = { backend: gpu.backend, errors: comparison(), text: frame.text.split('\n')[0], width: frame.width, height: frame.height, gpu: gpuCanvas.toDataURL(), canvas: cpuCanvas.toDataURL(), hoverCases: [] }
    const hoverFrame = { ...frame, alpha: new Float32Array(frame.alpha.length).fill(.45) }
    gpu.render(hoverFrame, options)
    const before = gpuCanvas.getContext('2d').getImageData(0, 0, frame.width, frame.height).data
    for (const hover of ['light', 'ripple']) {
      const input = { ...options, hover, time: 2, pointer: { x: .5, y: .5, strength: .8 } }
      gpu.render(hoverFrame, input); cpu.render(hoverFrame, input)
      const pixels = gpuCanvas.getContext('2d').getImageData(0, 0, frame.width, frame.height).data
      let changed = 0, inkLoss = 0, maskChanges = 0
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== before[i]) changed++
        if (pixels[i] < before[i]) inkLoss++
        if ((pixels[i] > 0) !== (before[i] > 0)) maskChanges++
      }
      result.hoverCases.push({ hover, errors: comparison(), changed, inkLoss, maskChanges, image: gpuCanvas.toDataURL() })
    }
    gpu.destroy(); cpu.destroy()
    return result
  })
  for (const name of ['gpu', 'canvas']) {
    await writeFile(path.join(out, `glyph-${name}.png`), Buffer.from(result[name].split(',')[1], 'base64'))
    delete result[name]
  }
  for (const item of result.hoverCases) {
    await writeFile(path.join(out, `glyph-hover-${item.hover}.png`), Buffer.from(item.image.split(',')[1], 'base64'))
    delete item.image
  }
  await writeFile(path.join(out, 'glyph-orientation.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
  assert.equal(result.backend, 'webgl2', 'Must exercise actual GPU glyphs')
  assert(result.errors.upright < .015, 'GPU glyphs must match upright Canvas glyphs')
  for (const name of ['mirrorX', 'mirrorY', 'upsideDown']) {
    assert(result.errors.upright * 4 < result.errors[name], `GPU must be closer to upright than ${name}`)
  }
  for (const item of result.hoverCases) {
    assert(item.changed > 0, `${item.hover} must change actual pixels`)
    assert(item.errors.upright < .02, `${item.hover} GPU/Canvas alpha mismatch`)
    for (const name of ['mirrorX', 'mirrorY', 'upsideDown']) {
      assert(item.errors.upright * 4 < item.errors[name], `${item.hover} must keep upright glyphs`)
    }
    if (item.hover === 'light') {
      assert.equal(item.maskChanges, 0, 'Light hover must not move or replace any glyph')
      assert.equal(item.inkLoss, 0, 'Light hover must not invert or remove ink')
    }
  }
} finally {
  await browser.close()
}
