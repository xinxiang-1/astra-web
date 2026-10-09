import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
try {
  const page = await browser.newPage()
  await page.route('http://127.0.0.1:5210/__image_baseline', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }))
  await page.goto('http://127.0.0.1:5210/__image_baseline')
  const result = await page.evaluate(async () => {
    const { loadImageElement } = await import('/src/lib/signature-portrait/extract.ts')
    const { openSignaturePhoto } = await import('/src/lib/signature-portrait/cutout-client.ts')
    const bytes = await (await fetch('/artwork/portrait.jpg')).blob()
    const file = new File([bytes], 'public-portrait.jpg', { type: 'image/jpeg' })
    const NativeImage = window.Image
    window.Image = function () {
      const image = new NativeImage()
      Object.defineProperty(image, 'onload', {
        get() { return this.__onload },
        set(handler) {
          this.__onload = handler
          Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'onload').set.call(this,
            handler ? (event) => setTimeout(() => handler.call(image, event), 450) : null)
        },
      })
      return image
    }
    const rows = []
    for (const api of ['loadImageElement', 'openSignaturePhoto']) {
      const controller = new AbortController(), start = performance.now()
      setTimeout(() => controller.abort(), 20)
      let status, error
      try {
        const loaded = await (api === 'loadImageElement' ? loadImageElement(file, { signal: controller.signal }) : openSignaturePhoto(file, controller.signal))
        status = 'resolved-after-abort'; URL.revokeObjectURL(loaded.objectUrl)
      } catch (e) { status = 'rejected'; error = e.name }
      rows.push({ api, status, error, elapsedMs: performance.now() - start, abortAtMs: 20, artificialLoadDelayMs: 450 })
    }
    window.Image = NativeImage
    return { reproduced: rows[0].status === 'resolved-after-abort' && rows[1].elapsedMs >= 450, rows }
  })
  await writeFile('test-results/signature-image-baseline-r1.json', JSON.stringify({ browser: browser.version(), ...result }, null, 2) + '\n', { flag: 'wx' })
  console.log(JSON.stringify(result))
} finally { await browser.close() }
