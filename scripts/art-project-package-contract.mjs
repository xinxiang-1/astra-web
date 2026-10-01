import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_PACKAGE_OUTPUT || 'sandbox/project-package/2026-10-01-v1/development',
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out, { recursive: false })
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const browser = await chromium.launch({ headless: true })
const options = {
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
  acceptDownloads: true,
}
const sourceContext = await browser.newContext(options)
const freshContext = await browser.newContext(options)
const page = await sourceContext.newPage(),
  restored = await freshContext.newPage()
for (const target of [page, restored]) {
  target.setDefaultTimeout(30000)
  target.setDefaultNavigationTimeout(60000)
}
const errors = [],
  uploads = []
for (const target of [page, restored]) {
  target.on('pageerror', (e) => errors.push(e.message))
  target.on('request', (request) => {
    if (request.method() === 'POST') uploads.push(request.url())
  })
}
const report = {
  base,
  browser: await browser.version(),
  scope:
    'Same browser, fresh storage, actual package/PNG downloads; no commercial aesthetics, real device or cross-browser certification',
  cases: [],
  rejected: [],
  errors,
  uploads,
  passed: false,
}
async function database(target) {
  return target.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('astra-art-projects', 1)
        request.onupgradeneeded = () =>
          request.result.createObjectStore('projects', { keyPath: 'id' })
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('projects', 'readonly'),
            query = tx.objectStore('projects').getAll()
          tx.oncomplete = async () => {
            db.close()
            try {
              resolve(
                await Promise.all(
                  query.result.map(async (p) => ({
                    id: p.id,
                    name: p.name,
                    kind: p.kind,
                    settings: p.settings,
                    engineVersion: p.engineVersion,
                    source: {
                      name: p.source.name,
                      size: p.source.size,
                      type: p.source.type,
                      lastModified: p.source.lastModified,
                    },
                    sourceHash: [
                      ...new Uint8Array(
                        await crypto.subtle.digest('SHA-256', await p.source.arrayBuffer()),
                      ),
                    ]
                      .map((n) => n.toString(16).padStart(2, '0'))
                      .join(''),
                  })),
                ),
              )
            } catch (error) {
              reject(error)
            }
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
      }),
  )
}
async function ready(target, mode = 'density') {
  await target.waitForFunction((mode) => {
    const canvas = document.querySelector('.ascii-canvas'),
      download = document.querySelector('.editor-package')
    return canvas?.width > 100 && canvas.dataset.mode === mode && download && !download.disabled
  }, mode)
  await target.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}
async function download(target, action, name) {
  const pending = target.waitForEvent('download')
  await action()
  const file = await pending
  assert.equal(await file.failure(), null)
  const dest = path.join(out, name)
  await file.saveAs(dest)
  return { dest, suggested: file.suggestedFilename(), bytes: await readFile(dest) }
}
async function png(target, name) {
  return download(
    target,
    async () => {
      await target.locator('.editor-header-actions .art-button').click()
      await target.locator('.format-grid button').filter({ hasText: 'PNG' }).click()
      await target.getByRole('button', { name: '1080 px', exact: true }).click()
      await target.getByRole('button', { name: '免费下载作品', exact: true }).click()
    },
    name,
  )
}
function unpack(bytes) {
  const size = bytes.readUInt32LE(8),
    manifest = JSON.parse(bytes.subarray(44, 44 + size).toString('utf8'))
  assert.equal(bytes.subarray(0, 8).toString(), 'ASTRA01\n')
  assert.equal(sha(bytes.subarray(44, 44 + size)), bytes.subarray(12, 44).toString('hex'))
  const source = bytes.subarray(44 + size, 44 + size + manifest.source.size)
  assert.equal(sha(source), manifest.source.sha256)
  assert.equal(sha(bytes.subarray(44 + size + source.length)), manifest.thumbnail.sha256)
  return { manifest, source, offset: 44 + size }
}
function mutate(bytes, change) {
  const size = bytes.readUInt32LE(8),
    manifest = JSON.parse(bytes.subarray(44, 44 + size).toString('utf8'))
  change(manifest)
  const json = Buffer.from(JSON.stringify(manifest)),
    header = Buffer.from(bytes.subarray(0, 44))
  header.writeUInt32LE(json.length, 8)
  createHash('sha256').update(json).digest().copy(header, 12)
  return Buffer.concat([header, json, bytes.subarray(44 + size)])
}
async function importPackage(target, bytes, name = 'import.astra') {
  await target
    .locator('input[aria-label="导入 Astra 作品包"]')
    .setInputFiles({ name, mimeType: 'application/x-astra-project', buffer: bytes })
  await target.locator('.package-status').filter({ hasText: '导入成功' }).waitFor()
  await target.getByRole('button', { name: '导入作品包', exact: true }).waitFor()
}

try {
  await restored.goto(`${base}/projects`)
  assert.equal(
    (await database(restored)).length,
    0,
    'import test must start in a different empty browser context',
  )
  const fixture = await readFile('public/artwork/portrait.jpg'),
    fixtureHash = sha(fixture)
  const profiles = [
    ['density', '光影字符', 'classic'],
    ['color', '原色字符', 'classic'],
    ['phrase', '中文铺字', 'classic'],
    ['contour', '轮廓线稿', 'classic'],
    ['braille', '点阵细节', 'classic'],
    ['halftone', '印刷网点', 'classic'],
    ['density', '光影字符', 'detailed'],
    ['density', '光影字符', 'smooth'],
    ['density', '光影字符', 'faithful'],
    ['color', '原色字符', 'faithful'],
  ]
  let firstBytes
  for (const [mode, label, quality] of profiles) {
    const key = `${mode}-${quality}`
    await page.goto(`${base}/ascii-art`)
    await page
      .locator('input[type=file]')
      .setInputFiles(path.resolve('public/artwork/portrait.jpg'))
    await ready(page)
    await page.locator('.six-modes button').filter({ hasText: label }).click()
    if (mode === 'phrase') await page.locator('input[maxlength="64"]').fill('山河🌙👩‍💻')
    if (quality !== 'classic') await page.locator(`button[data-quality="${quality}"]`).click()
    await page
      .getByLabel('作品名称')
      .fill(key === 'density-classic' ? '</script>山河🌙' : `作品-${key}`)
    await ready(page, mode)
    const before = await png(page, `${key}-before.png`)
    await page.keyboard.press('Escape')
    // Download an unsaved editor state, then independently save for metadata comparison.
    const packed = await download(
      page,
      () => page.getByRole('button', { name: '下载作品包', exact: true }).click(),
      `${key}.astra`,
    )
    assert(packed.suggested.endsWith('.astra'))
    const { manifest, source } = unpack(packed.bytes)
    assert.equal(sha(source), fixtureHash)
    assert.equal(manifest.engine.version, '2.2.0')
    assert.equal(manifest.project.settings.artMode, mode)
    assert.equal(manifest.project.settings.artQuality, quality)
    assert.equal(manifest.source.size, fixture.length)
    await page.locator('.editor-save').click()
    await page.locator('.save-status').filter({ hasText: '已保存到此浏览器' }).waitFor()
    const original = (await database(page)).find((p) => p.name === manifest.project.name)
    assert(original)
    await restored.goto(`${base}/projects`)
    const count = (await database(restored)).length
    await importPackage(restored, packed.bytes)
    const after = await database(restored)
    assert.equal(after.length, count + 1)
    const imported = after.find((p) => p.name === original.name)
    assert(imported && imported.id !== original.id)
    assert.deepEqual(imported.settings, original.settings)
    assert.deepEqual(imported.source, original.source)
    assert.equal(imported.sourceHash, fixtureHash)
    assert.equal(imported.engineVersion, original.engineVersion)
    await restored.goto(`${base}/ascii-art?project=${imported.id}`)
    await restored.locator('.save-status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
    await ready(restored, mode)
    const returned = await png(restored, `${key}-restored.png`)
    assert.equal(sha(returned.bytes), sha(before.bytes), `${key}: restored real PNG differs`)
    await restored.keyboard.press('Escape')
    await restored.reload()
    await restored.locator('.save-status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
    await ready(restored, mode)
    report.cases.push({
      key,
      packageHash: sha(packed.bytes),
      sourceHash: fixtureHash,
      pngHash: sha(before.bytes),
      exactPng: true,
      parameters: 'exact',
      sourceMetadata: 'exact',
      refresh: true,
    })
    if (!firstBytes) firstBytes = packed.bytes
    console.log(`PASS package and fresh restore: ${key}`)
  }
  // Projects page downloads, duplicate imports and corruption rejection use the actual product handlers.
  await page.goto(`${base}/projects`)
  const card = page.locator('.project-card').filter({ hasText: '作品-color-faithful' })
  const fromList = await download(
    page,
    () => card.getByRole('button', { name: '下载作品包' }).click(),
    'projects-page.astra',
  )
  assert.equal(unpack(fromList.bytes).manifest.project.settings.artQuality, 'faithful')
  await restored.goto(`${base}/projects`)
  const beforeDuplicate = await database(restored)
  await importPackage(restored, firstBytes)
  const duplicates = await database(restored)
  assert.equal(duplicates.length, beforeDuplicate.length + 1)
  assert.equal(new Set(duplicates.map((p) => p.id)).size, duplicates.length)
  assert.deepEqual(
    duplicates.filter((p) => beforeDuplicate.some((old) => old.id === p.id)),
    beforeDuplicate,
  )
  report.duplicate = { newId: true, originalsUnchanged: true }
  const changedHeader = Buffer.from(firstBytes)
  changedHeader[44] ^= 1
  const changedSource = Buffer.from(firstBytes)
  changedSource[unpack(firstBytes).offset + 5] ^= 1
  const changedThumb = Buffer.from(firstBytes)
  changedThumb[changedThumb.length - 5] ^= 1
  const invalidMedia = Buffer.from(firstBytes),
    decoded = unpack(invalidMedia)
  invalidMedia.fill(0, decoded.offset, decoded.offset + decoded.source.length)
  const invalidMediaChecked = mutate(invalidMedia, (m) => {
    m.source.sha256 = sha(Buffer.alloc(decoded.source.length))
  })
  const invalid = [
    ['wrong-format', Buffer.from('not an Astra project')],
    ['truncated', firstBytes.subarray(0, firstBytes.length - 10)],
    ['extra-payload', Buffer.concat([firstBytes, Buffer.from('tail')])],
    ['manifest-hash', changedHeader],
    ['source-hash', changedSource],
    ['thumbnail-hash', changedThumb],
    [
      'future-schema',
      mutate(firstBytes, (m) => {
        m.version = 99
      }),
    ],
    [
      'missing-parameter',
      mutate(firstBytes, (m) => {
        delete m.project.settings.columns
      }),
    ],
    [
      'incompatible-quality',
      mutate(firstBytes, (m) => {
        m.project.settings.artQuality = 'detailed'
        m.project.settings.artMode = 'color'
      }),
    ],
    [
      'future-engine',
      mutate(firstBytes, (m) => {
        m.engine.version = '99.0.0'
      }),
    ],
    [
      'engine-mismatch',
      mutate(firstBytes, (m) => {
        m.engine.id = 'legacy'
      }),
    ],
    [
      'invalid-parameter',
      mutate(firstBytes, (m) => {
        m.project.settings.columns = 1000000000
      }),
    ],
    [
      'non-finite-parameter',
      mutate(firstBytes, (m) => {
        m.project.settings.previewAspect = null
      }),
    ],
    [
      'unknown-parameter',
      mutate(firstBytes, (m) => {
        m.project.settings.constructor = 'injected'
      }),
    ],
    [
      'invalid-thumbnail-type',
      mutate(firstBytes, (m) => {
        m.thumbnail.type = 'text/html'
      }),
    ],
    [
      'oversize-source',
      mutate(firstBytes, (m) => {
        m.source.size = 64 * 1024 * 1024 + 1
      }),
    ],
    ['bad-media-with-correct-hash', invalidMediaChecked],
  ]
  for (const [key, bytes] of invalid) {
    await restored.locator('input[aria-label="导入 Astra 作品包"]').setInputFiles({
      name: `${key}.astra`,
      mimeType: 'application/x-astra-project',
      buffer: bytes,
    })
    await restored.locator('.art-error').waitFor()
    await restored.waitForFunction(
      () => !document.querySelector('.project-heading-actions button')?.disabled,
    )
    assert.deepEqual(
      await database(restored),
      duplicates,
      `${key}: rejected import modified storage`,
    )
    report.rejected.push({
      key,
      message: await restored.locator('.art-error').innerText(),
      noWrite: true,
    })
  }
  // Simulate an actual failed IndexedDB put; rejection must leave every existing row unchanged.
  await restored.evaluate(() => {
    window.packageOriginalPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('Storage full', 'QuotaExceededError')
    }
  })
  await restored
    .locator('input[aria-label="导入 Astra 作品包"]')
    .setInputFiles({
      name: 'quota.astra',
      mimeType: 'application/x-astra-project',
      buffer: firstBytes,
    })
  await restored.locator('.art-error').filter({ hasText: '存储空间可能不足' }).waitFor()
  await restored.evaluate(() => {
    IDBObjectStore.prototype.put = window.packageOriginalPut
    delete window.packageOriginalPut
  })
  assert.deepEqual(await database(restored), duplicates)
  report.storageFailure = {
    noWrite: true,
    message: await restored.locator('.art-error').innerText(),
  }
  // A historical unversioned legacy package remains explicitly legacy.
  const legacy = mutate(firstBytes, (m) => {
    m.engine = { id: 'legacy', version: null }
    delete m.project.settings.editorEngine
    delete m.project.settings.artMode
    delete m.project.settings.artQuality
    m.project.name = '历史作品'
  })
  await importPackage(restored, legacy)
  assert((await restored.locator('.package-status').innerText()).includes('没有版本记录'))
  const old = (await database(restored)).find((p) => p.name === '历史作品')
  await restored.goto(`${base}/ascii-art?project=${old.id}`)
  await restored.locator('.legacy-project-note').waitFor()
  await restored.locator('.save-status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
  report.legacy = { oldProject: true, noAutomaticUpgrade: true }
  // A real encoded short video, with an independently set 0.2–0.7 second segment.
  const moviePath = path.resolve('test-results/editor-contract-source.mp4'),
    movie = await readFile(moviePath)
  await page.goto(`${base}/ascii-art`)
  await page.locator('input[type=file]').setInputFiles(moviePath)
  await ready(page)
  if (await page.getByRole('button', { name: '暂停', exact: true }).isVisible())
    await page.getByRole('button', { name: '暂停', exact: true }).click()
  await page.getByRole('button', { name: /^超清/ }).click()
  await page.locator('.clip-panel').getByRole('button', { name: '自定义', exact: true }).click()
  await page.locator('.clip-custom-field input').first().fill('0.5')
  await page.locator('.clip-custom-field input').first().dispatchEvent('change')
  await page.locator('input[aria-label="片段起点"]').fill('0.2')
  await page.locator('input[aria-label="片段起点"]').dispatchEvent('input')
  await page.getByLabel('作品名称').fill('视频作品包')
  await ready(page)
  const video = await download(
    page,
    () => page.getByRole('button', { name: '下载作品包', exact: true }).click(),
    'video.astra',
  )
  const videoData = unpack(video.bytes)
  assert.equal(sha(videoData.source), sha(movie))
  assert.equal(videoData.manifest.project.settings.clipStart, 0.2)
  assert(Math.abs(videoData.manifest.project.settings.clipEnd - 0.7) < 1e-8)
  await restored.goto(`${base}/projects`)
  await importPackage(restored, video.bytes)
  const videoProject = (await database(restored)).find((p) => p.name === '视频作品包')
  await restored.goto(`${base}/ascii-art?project=${videoProject.id}`)
  await restored.locator('.save-status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
  await ready(restored)
  const playback = await restored.locator('video').evaluate((v) => ({
    currentTime: v.currentTime,
    paused: v.paused,
    duration: v.duration,
    width: v.videoWidth,
  }))
  assert(playback.paused && Math.abs(playback.currentTime - 0.2) < 0.005 && playback.width > 0)
  assert.equal(await restored.locator('.clip-custom-field input').first().inputValue(), '0.5')
  const videoRepacked = await download(
    restored,
    () => restored.getByRole('button', { name: '下载作品包', exact: true }).click(),
    'video-repacked.astra',
  )
  assert.deepEqual(
    unpack(videoRepacked.bytes).manifest.project.settings,
    videoData.manifest.project.settings,
  )
  report.video = { sourceHash: sha(movie), exactSettings: true, clip: [0.2, 0.7], playback }
  // Mobile controls, real download from the editor and imported project cards.
  await restored.setViewportSize({ width: 390, height: 844 })
  await restored.goto(`${base}/projects`)
  await restored.locator('.project-card').first().waitFor()
  assert.equal(
    await restored.locator('.package-file-input').isVisible(),
    false,
    'native file picker must be hidden behind the designed import button',
  )
  assert(await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await restored.screenshot({ path: path.join(out, 'projects-mobile.png') })
  await restored.locator('.project-open').filter({ hasText: '视频作品包' }).click()
  await restored.getByRole('button', { name: '素材与预设', exact: true }).click()
  await restored.getByRole('button', { name: '下载作品包', exact: true }).scrollIntoViewIfNeeded()
  await download(
    restored,
    () => restored.getByRole('button', { name: '下载作品包', exact: true }).click(),
    'mobile.astra',
  )
  assert(await restored.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await restored.screenshot({ path: path.join(out, 'editor-mobile.png'), fullPage: true })
  await page.goto(`${base}/projects`)
  assert.equal(await page.locator('.package-file-input').isVisible(), false)
  await page.screenshot({ path: path.join(out, 'projects-desktop.png'), fullPage: true })
  report.mobile = { width: 390, noOverflow: true, actualEditorDownload: true }
  assert.deepEqual(errors, [])
  assert.deepEqual(uploads, [])
  report.passed = true
  console.log(
    `PASS ${report.cases.length} image restores, ${report.rejected.length} atomic rejections, legacy, video and mobile`,
  )
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  await browser.close()
}
