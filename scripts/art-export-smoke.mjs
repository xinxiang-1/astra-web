import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
const out = path.resolve('test-results/art-ui')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
})
page.setDefaultTimeout(20000)
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5173'
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
async function ready() {
  await page.waitForFunction(() => document.querySelector('.ascii-canvas')?.width > 100)
  await page.locator('.editor-header-actions .art-button').waitFor({ state: 'visible' })
}
async function download(filename) {
  const event = page.waitForEvent('download', { timeout: 60000 })
  await page.getByRole('button', { name: '免费下载作品' }).click()
  const result = await event
  await result.saveAs(path.join(out, filename))
  assert.equal(await result.failure(), null)
  return result.suggestedFilename()
}
try {
  await page.goto(`${base}/ascii-art?preset=portrait`)
  await ready()
  await page.locator('.editor-header-actions .art-button').click()
  await page.getByRole('button', { name: '4K', exact: true }).click()
  await page.getByLabel('透明背景', { exact: true }).check()
  await download('transparent-4k.png')
  const png = await readFile(path.join(out, 'transparent-4k.png'))
  assert.equal(Math.max(png.readUInt32BE(16), png.readUInt32BE(20)), 3840)
  assert.equal(png[25], 6, 'RGBA PNG')
  await page.getByRole('button', { name: '文本 TXT', exact: true }).click()
  await download('characters.txt')
  assert((await readFile(path.join(out, 'characters.txt'), 'utf8')).split('\n').length > 30)
  await page.getByRole('button', { name: '动态网页 HTML', exact: true }).click()
  await download('artwork.html')
  const html = await readFile(path.join(out, 'artwork.html'), 'utf8')
  assert(html.includes('data:image/'))
  assert(html.includes('<html'))
  await page.keyboard.press('Escape')
  await page.goto(`${base}/ascii-art`)
  await page
    .locator('input[type=file]')
    .setInputFiles({
      name: 'broken.png',
      mimeType: 'image/png',
      buffer: Buffer.from('not an image'),
    })
  await page.locator('.status.error').waitFor()
  const video = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 160
    canvas.height = 120
    const ctx = canvas.getContext('2d')
    const stream = canvas.captureStream(10)
    const chunks = []
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' })
    const done = new Promise((resolve) => {
      recorder.ondataavailable = (e) => chunks.push(e.data)
      recorder.onstop = async () =>
        resolve(
          Array.from(new Uint8Array(await new Blob(chunks, { type: 'video/webm' }).arrayBuffer())),
        )
    })
    recorder.start()
    for (let i = 0; i < 12; i++) {
      ctx.fillStyle = '#111'
      ctx.fillRect(0, 0, 160, 120)
      ctx.fillStyle = '#fff'
      ctx.fillRect(i * 8, 20, 40, 60)
      await new Promise((r) => setTimeout(r, 100))
    }
    recorder.stop()
    stream.getTracks().forEach((t) => t.stop())
    return done
  })
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'motion.webm', mimeType: 'video/webm', buffer: Buffer.from(video) })
  await ready()
  await page.locator('.editor-save').click()
  await page.getByRole('status').filter({ hasText: '已保存到此浏览器' }).waitFor()
  await page.locator('.editor-header-actions .art-button').click()
  await page.getByRole('button', { name: '视频 MP4 / WebM', exact: true }).click()
  const name = await download('motion-export.bin')
  assert(/\.(mp4|webm)$/.test(name))
  assert((await readFile(path.join(out, 'motion-export.bin'))).length > 100)
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: '我的项目' }).click()
  await page.locator('.project-open').click()
  await page.getByRole('status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
  assert(await page.locator('.video-thumb.show').isVisible())
  await page.getByRole('link', { name: '我的项目' }).click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await page.locator('.project-open').count(), 1)
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.project-open'))
  assert.deepEqual(errors, [])
  console.log(
    'PASS: 4K RGBA PNG, TXT content, embedded HTML, invalid file error/recovery, video export, video project restoration, confirmed/cancelled deletion.',
  )
} finally {
  await browser.close()
}
