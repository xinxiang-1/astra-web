import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5173'
const out = path.resolve(process.env.ASTRA_GIF_OUTPUT || 'test-results/gif-resource-contract')
await mkdir(out, { recursive: true })
const gif = process.env.ASTRA_GIF_INPUT || path.join(out, 'source.gif')
const mp4 = path.join(out, 'source.mp4')
function fixture(output, extra) {
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=150x150:rate=15', '-t', '2', ...extra, output], { windowsHide: true })
}
if (!process.env.ASTRA_GIF_INPUT) fixture(gif, [])
fixture(mp4, ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
const sourceBytes = await readFile(gif)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge' })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce', acceptDownloads: true })
const page = await context.newPage()
page.setDefaultTimeout(60000)
const errors = [], posts = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('request', (r) => { if (r.method() === 'POST') posts.push(r.url()) })
page.on('dialog', (d) => d.accept())
const report = { sourceHash: sha(sourceBytes), browser: await browser.version(), scope: 'Local Edge, real GIF plus synthetic MP4; no physical mobile or total-heap certification', errors, posts }
const controls = page.locator('.video-controls')
const play = controls.locator('button').first()
const activeVideo = () => page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => v.getAttribute('src'))
  .map((v) => ({ time: v.currentTime, duration: v.duration, paused: v.paused, ended: v.ended, loop: v.loop }))[0])
async function ready() {
  await page.waitForFunction(() => document.querySelector('.ascii-canvas')?.width > 100 && !document.querySelector('.editor-package')?.disabled)
}
async function center(name, viewport) {
  await page.setViewportSize(viewport)
  await page.locator('.stage-fullscreen').click()
  await page.locator('.fs-scroll canvas').waitFor()
  await page.waitForTimeout(700)
  const theme = await page.evaluate(() => document.documentElement.dataset.theme)
  await page.locator('.fs-tools .theme-toggle').click()
  assert.notEqual(await page.evaluate(() => document.documentElement.dataset.theme), theme)
  await page.locator('.fs-tools .theme-toggle').click()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), theme)
  const bounds = await page.evaluate(() => {
    const area = document.querySelector('.fs-scroll').getBoundingClientRect()
    const art = document.querySelector('.fs-scroll canvas').getBoundingClientRect()
    return { dx: Math.abs(art.x + art.width / 2 - area.x - area.width / 2), dy: Math.abs(art.y + art.height / 2 - area.y - area.height / 2), width: art.width, height: art.height }
  })
  assert(bounds.dx < 2 && bounds.dy < 2, JSON.stringify(bounds))
  await page.screenshot({ path: path.join(out, `${name}.png`) })
  await page.getByRole('button', { name: '退出全屏', exact: true }).click()
  return bounds
}
try {
  await page.goto(`${base}/ascii-art`)
  const start = performance.now()
  await page.locator('input[type=file]').setInputFiles(gif)
  await play.filter({ hasText: '暂停' }).waitFor()
  await ready()
  report.uploadMs = Math.round(performance.now() - start)
  assert.equal(await page.getByLabel('视频预览方式').inputValue(), 'economy')
  assert.match(await page.locator('[aria-label="采样清晰度"] .on').innerText(), /低清/)
  await page.locator('.six-modes button').filter({ hasText: '光影字符' }).click()
  const micro = page.locator('[aria-label="六模式微动"] button').filter({ hasText: /关闭|静止|无动效/ })
  if (await micro.count()) await micro.first().click()
  await page.locator('.ascii-canvas').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  const a = await page.locator('.ascii-canvas').first().screenshot({ path: path.join(out, 'frame-a.png') })
  await page.waitForTimeout(900)
  const b = await page.locator('.ascii-canvas').first().screenshot({ path: path.join(out, 'frame-b.png') })
  assert.notEqual(sha(a), sha(b), 'Actual source frames must change with reduced motion')
  report.changedFrames = [sha(a), sha(b)]
  const beforeLoop = await activeVideo()
  await page.waitForTimeout(beforeLoop.duration * 1000 + 350)
  assert.equal((await activeVideo()).paused, false)
  await page.getByLabel('循环播放').uncheck()
  await page.evaluate(() => { const v = [...document.querySelectorAll('video')].find((v) => v.getAttribute('src')); v.currentTime = v.duration - 0.2 })
  await play.filter({ hasText: '播放' }).waitFor()
  assert.equal((await activeVideo()).ended, true)
  await play.click()
  await play.filter({ hasText: '暂停' }).waitFor()
  await play.click()
  await ready()
  report.gif = await activeVideo()
  assert.equal(report.gif.paused, true)
  await page.waitForTimeout(500)
  const pausedA = await page.locator('.ascii-canvas').first().screenshot()
  await page.waitForTimeout(350)
  assert.equal(sha(pausedA), sha(await page.locator('.ascii-canvas').first().screenshot()))
  report.fullscreenDesktop = await center('fullscreen-desktop', { width: 1440, height: 960 })
  report.fullscreenMobile = await center('fullscreen-mobile', { width: 390, height: 844 })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByLabel('视频帧率').selectOption('60')
  await page.getByLabel('视频导出尺寸').selectOption('1920')
  const [pack] = await Promise.all([page.waitForEvent('download'), page.locator('.editor-package').click()])
  const packPath = path.join(out, 'gif.astra')
  await pack.saveAs(packPath)
  const bytes = await readFile(packPath), size = bytes.readUInt32LE(8)
  const manifest = JSON.parse(bytes.subarray(44, 44 + size))
  assert.equal(manifest.source.type, 'image/gif')
  assert.equal(manifest.source.sha256, sha(sourceBytes))
  assert.equal(sha(bytes.subarray(44 + size, 44 + size + manifest.source.size)), sha(sourceBytes))
  assert.equal(manifest.project.settings.videoLoopEnabled, false)
  assert.equal(manifest.project.settings.videoExportEdge, 1920)
  report.package = { originalHashRetained: true, settings: manifest.project.settings }
  const fresh = await context.newPage()
  await fresh.goto(`${base}/projects`)
  await fresh.locator('input[aria-label="导入 Astra 作品包"]').setInputFiles(packPath)
  await fresh.locator('.package-status').filter({ hasText: '导入成功' }).waitFor()
  const project = await fresh.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('astra-art-projects', 2)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('projects', 'readonly'), query = tx.objectStore('projects').getAll()
      tx.oncomplete = () => { db.close(); resolve(query.result[0]) }
    }
  }))
  assert.equal(project.kind, 'image')
  await fresh.goto(`${base}/ascii-art?project=${project.id}`)
  await fresh.locator('.save-status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
  assert.equal(await fresh.getByLabel('视频帧率').inputValue(), '60')
  assert.equal(await fresh.getByLabel('视频导出尺寸').inputValue(), '1920')
  assert.equal(await fresh.getByLabel('循环播放').isChecked(), false)
  await fresh.close()
  report.projectRestored = true
  await page.locator('.editor-header-actions .art-button').click()
  await page.locator('.format-grid button').filter({ hasText: '动态网页' }).click()
  const [html] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '免费下载作品', exact: true }).click()])
  const htmlPath = path.join(out, 'gif.html'); await html.saveAs(htmlPath)
  await page.keyboard.press('Escape')
  const offline = await context.newPage()
  const offlineErrors = []; offline.on('pageerror', (e) => offlineErrors.push(e.message))
  await offline.goto('file:///' + htmlPath.replaceAll('\\', '/'))
  await offline.locator('canvas').waitFor()
  const offlinePlay = offline.getByRole('button', { name: '播放作品', exact: true })
  await offlinePlay.click()
  await offline.getByRole('button', { name: '暂停作品', exact: true }).waitFor()
  await offlinePlay.waitFor({ timeout: 30000 })
  await offlinePlay.click()
  await offline.getByRole('button', { name: '暂停作品', exact: true }).waitFor()
  assert.equal(offlineErrors.length, 0)
  await offline.close()
  report.offlineReplay = true
  await page.locator('input[type=file]').setInputFiles({ name: 'broken.gif', mimeType: 'image/gif', buffer: Buffer.from('invalid GIF') })
  await page.waitForTimeout(500)
  assert.equal((await activeVideo()).duration, report.gif.duration, 'Failed replacement keeps previous source')
  await page.locator('input[type=file]').setInputFiles(mp4)
  await ready()
  assert.match(await page.locator('[aria-label="采样清晰度"] .on').innerText(), /低清/)
  await page.getByLabel('视频帧率').selectOption('15')
  await page.getByLabel('视频预览方式').selectOption('quality')
  await play.click()
  await play.filter({ hasText: '暂停' }).waitFor()
  await page.getByLabel('循环播放').uncheck()
  await play.filter({ hasText: '播放' }).waitFor()
  await play.click()
  await play.filter({ hasText: '暂停' }).waitFor()
  await play.click()
  report.qualityReplay = true
  // Exercise memory accounting and 60fps export directly with actual browser media APIs.
  report.resources = await page.evaluate(async (source) => {
    const { prerenderVideoFrames } = await import('/src/lib/ascii/prerender.ts')
    const { exportAsciiVideo, planVideoExportFrames } = await import('/src/lib/ascii/export-video.ts')
    const video = document.createElement('video'); video.muted = true
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; video.src = source })
    video.currentTime = 0.1
    await new Promise((resolve) => { video.onseeked = resolve })
    const sourceFrame = () => ({ source: video, width: video.videoWidth, height: video.videoHeight })
    let conversions = 0
    const options = { video, fps: 15, startTime: 0.2, endTime: 0.7, shouldAbort: () => false, getFrameSource: sourceFrame,
      convertFrame: () => { conversions++; return { text: 'x'.repeat(10000), columns: 100, rows: 100 } } }
    const memory = await prerenderVideoFrames({ ...options, maxCacheBytes: 30000 })
    const earlyCount = conversions
    const raster = await prerenderVideoFrames({ ...options, convertFrame: () => ({ text: 'x', columns: 1, rows: 1 }), renderRaster: async () => new Blob([new Uint8Array(10000)]), maxCacheBytes: 20000 })
    const resumeTime = video.currentTime
    const plan = planVideoExportFrames(0.1, 60)
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080
    canvas.getContext('2d').fillRect(0, 0, 1920, 1080)
    const exported = await exportAsciiVideo({ frameCount: plan.total, fps: plan.fps, maxEdge: 1920, bufferFrames: 0, getFrame: async () => ({ text: 'x', raster: canvas }) })
    const url = URL.createObjectURL(exported.blob)
    const v = document.createElement('video')
    await new Promise((resolve, reject) => { v.onloadedmetadata = resolve; v.onerror = reject; v.src = url })
    const result = { earlyRejected: !memory.ok, earlyCount, rasterRejected: !raster.ok, resumeTime, fps: plan.fps, exportWidth: v.videoWidth, exportHeight: v.videoHeight, exportDuration: v.duration, exportBytes: exported.blob.size }
    URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); video.removeAttribute('src'); video.load()
    return result
  }, `data:video/mp4;base64,${(await readFile(mp4)).toString('base64')}`)
  assert(report.resources.earlyRejected && report.resources.earlyCount === 1 && report.resources.rasterRejected)
  assert(Math.abs(report.resources.resumeTime - 0.1) < 0.001)
  assert.equal(report.resources.fps, 60)
  assert.equal(report.resources.exportWidth, 1920)
  assert.equal(report.resources.exportHeight, 1080)
  assert(Math.abs(report.resources.exportDuration - 7 / 60) < 0.002)
  await page.locator('input[type=file]').setInputFiles(path.resolve('public/artwork/portrait.jpg'))
  await ready()
  assert.equal(await controls.count(), 0)
  report.staticFullscreen = await center('fullscreen-static', { width: 1440, height: 960 })
  assert.equal(errors.length, 0, JSON.stringify(errors))
  assert.equal(posts.length, 0, 'Media conversion must remain local')
  report.passed = true
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
console.log('PASS: GIF motion/loop/pause/package, MP4 defaults/quality replay, memory budget, 1920/60fps export, desktop/mobile fullscreen center.')
