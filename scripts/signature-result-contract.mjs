import { openSignatureSection } from './signature-ui-helpers.mjs'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const directory = path.resolve(
  process.env.ASTRA_SIGNATURE_RESULT_OUTPUT || 'test-results/signature-result-contract',
)
await mkdir(directory, { recursive: true })
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const browser = await chromium.launch({
  headless: true,
  ...(process.env.ASTRA_BROWSER_CHANNEL ? { channel: process.env.ASTRA_BROWSER_CHANNEL } : {}),
})
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  const errors = []
  const waits = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/signature-portrait`)
  const generate = page.getByRole('button', { name: '生成预览', exact: true })
  async function settled() {
    const started = Date.now()
    try {
      const timeout = Number(process.env.ASTRA_SIGNATURE_WAIT_TIMEOUT || 30000)
      await generate.waitFor({ state: 'visible', timeout })
      await page.waitForFunction(
        () =>
          Array.from(document.querySelectorAll('button')).some(
            (button) => button.textContent.trim() === '生成预览' && !button.disabled,
          ),
        undefined,
        { timeout },
      )
      waits.push(Date.now() - started)
    } catch (error) {
      await page.screenshot({ path: path.join(directory, 'generation-failure.png') })
      await writeFile(
        path.join(directory, 'generation-failure.json'),
        JSON.stringify(
          { errors, waitedMs: Date.now() - started, ui: await page.locator('main').innerText() },
          null,
          2,
        ),
      )
      throw error
    }
  }
  async function download(label, name) {
    if (label === '下载矢量 JSON' || label === '下载 Path SVG')
      await openSignatureSection(page, '矢量导出')
    const waiting = page.waitForEvent('download', { timeout: 90000 }).catch(async (error) => {
      await page.screenshot({ path: path.join(directory, 'download-failure.png') })
      console.log({ label, uiError: await page.locator('.error').allTextContents() })
      throw error
    })
    await page.getByRole('button', { name: label, exact: true }).click()
    const file = await waiting
    const target = path.join(directory, name)
    await file.saveAs(target)
    await settled()
    return { bytes: await readFile(target), name: file.suggestedFilename() }
  }
  async function range(locator, value) {
    await locator.evaluate((element, next) => {
      element.value = String(next)
      element.dispatchEvent(new Event('input', { bubbles: true }))
      element.dispatchEvent(new Event('change', { bubbles: true }))
    }, value)
  }
  async function nativeHash(label) {
    await page.getByRole('button', { name: '原大', exact: true }).click()
    // Compare the same visible region; fit/native switching may retain scroll anchoring.
    await page.locator('.stage').evaluate((stage) => {
      stage.scrollLeft = 0
      stage.scrollTop = 0
      stage.dispatchEvent(new Event('scroll'))
    })
    // Wait for the debounced viewport redraw, then sample the mounted canvas.
    await page.waitForTimeout(400)
    await page.locator('.sharp-viewport-canvas').waitFor({ state: 'attached', timeout: 90000 })
    const native = await page.locator('.result-canvas').evaluate(async (canvas) => {
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      const hash = await crypto.subtle.digest('SHA-256', data)
      return {
        dimensions: [canvas.width, canvas.height],
        hash: Array.from(new Uint8Array(hash), (value) => value.toString(16).padStart(2, '0')).join(
          '',
        ),
        png: canvas.toDataURL().split(',')[1],
      }
    })
    const geometry = await page.evaluate(() => {
      const stage = document.querySelector('.stage'),
        root = document.querySelector('.compare')
      const rect = (el) => {
        const r = el.getBoundingClientRect()
        return { x: r.x, y: r.y, width: r.width, height: r.height }
      }
      return {
        stage: rect(stage),
        root: rect(root),
        stageScroll: [stage.scrollLeft, stage.scrollTop],
        documentScroll: [scrollX, scrollY],
      }
    })
    await writeFile(path.join(directory, `${label}-native.png`), Buffer.from(native.png, 'base64'))
    delete native.png
    native.sharp = await page.locator('.sharp-viewport-canvas').evaluate(async (canvas) => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', pixels))
      return {
        dimensions: [canvas.width, canvas.height],
        hash: Array.from(hash, (v) => v.toString(16).padStart(2, '0')).join(''),
        region: JSON.parse(canvas.dataset.region),
      }
    })
    await writeFile(
      path.join(directory, `${label}-native.json`),
      JSON.stringify({ ...native, geometry }, null, 2),
    )
    return native
  }
  await page.getByRole('button', { name: '2K', exact: true }).click()
  await page.getByRole('button', { name: '一键试用示例', exact: true }).click()
  await settled()
  const original = await download('下载矢量 JSON', 'before.json')
  const originalDoc = JSON.parse(original.bytes)
  assert.equal(originalDoc.maxSide, 2048)
  assert.equal(originalDoc.renderOptions.density, 30)
  assert.equal(originalDoc.renderOptions.underlay, 0)
  assert.equal(originalDoc.stampIds.length, originalDoc.stampCount)
  const originalPng = await download('下载 PNG', 'before.png')
  const originalSvg = await download('下载 Path SVG', 'before.svg')
  const originalNative = await nativeHash('original')

  await range(
    page.locator('label.ink-control').filter({ hasText: '墨量' }).locator('input[type=range]'),
    12,
  )
  await page.getByRole('button', { name: '4K', exact: true }).click()
  await openSignatureSection(page, '排布与尺寸')
  await range(
    page.locator('.sliders label').filter({ hasText: '最小印章' }).locator('input[type=range]'),
    2.1,
  )
  await page.locator('.result-settings-changed').waitFor({ state: 'visible' })
  const edited = await download('下载矢量 JSON', 'edited-controls.json')
  assert.deepEqual(
    JSON.parse(edited.bytes),
    originalDoc,
    'Unapplied controls must not change the exported project',
  )
  const editedPng = await download('下载 PNG', 'edited-controls.png')
  const editedSvg = await download('下载 Path SVG', 'edited-controls.svg')
  assert.equal(
    sha(editedPng.bytes),
    sha(originalPng.bytes),
    'PNG must use the generated result settings',
  )
  assert.equal(
    sha(editedSvg.bytes),
    sha(originalSvg.bytes),
    'SVG must use the generated result settings',
  )
  await page.getByRole('button', { name: '适应', exact: true }).click()
  const editedNative = await nativeHash('edited')
  assert.deepEqual(
    editedNative,
    originalNative,
    'Viewport repaint must retain the generated result settings',
  )
  await page
    .locator('.preview')
    .screenshot({ path: path.join(directory, 'edited-controls-retained-preview.png') })

  await generate.click()
  await settled()
  await page.locator('.result-settings-changed').waitFor({ state: 'hidden' })
  const regenerated = JSON.parse((await download('下载矢量 JSON', 'regenerated.json')).bytes)
  assert.equal(regenerated.maxSide, 4096)
  assert.equal(Math.max(regenerated.width, regenerated.height), 4096)
  assert.equal(regenerated.density, 12)
  assert.equal(regenerated.renderOptions.minSizeRatio, 0.021)
  assert.notDeepEqual(regenerated.placements, originalDoc.placements)
  assert.deepEqual(errors, [])
  const result = {
    browser: await browser.version(),
    original: {
      width: originalDoc.width,
      height: originalDoc.height,
      density: originalDoc.density,
      stampCount: originalDoc.stampCount,
    },
    pngSha256: sha(originalPng.bytes),
    svgSha256: sha(originalSvg.bytes),
    editedControlsRetainJson: true,
    editedControlsRetainPng: true,
    editedControlsRetainSvg: true,
    editedControlsRetainViewport: true,
    native: originalNative,
    regenerated: {
      width: regenerated.width,
      height: regenerated.height,
      density: regenerated.density,
      minSizeRatio: regenerated.renderOptions.minSizeRatio,
    },
    errors,
  }
  result.waitsMs = waits
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
}
