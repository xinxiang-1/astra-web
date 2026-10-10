import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_STATE_OUTPUT || 'sandbox/editor-state/2026-10-02-v1/development',
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out, { recursive: false })
const sourceManifest = []
for (const sourcePath of [
  'src/views/AsciiArtView.vue',
  'src/lib/art-media-source.ts',
  'src/components/UnsavedChangesDialog.vue',
  'scripts/art-editor-state-contract.mjs',
  'scripts/art-editor-contract.mjs',
  'scripts/art-effects-media-contract.mjs',
  'scripts/art-project-package-contract.mjs',
]) {
  const bytes = await readFile(sourcePath)
  const destination = path.join(out, 'source', sourcePath)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, bytes)
  sourceManifest.push({
    path: sourcePath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  })
}
await writeFile(path.join(out, 'source', 'manifest.json'), JSON.stringify(sourceManifest, null, 2))
const video = path.join(out, 'source.mp4')
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=160x120:rate=12',
    '-t',
    '1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    video,
  ],
  { windowsHide: true },
)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
  acceptDownloads: true,
})
await context.addInitScript(() => {
  const state = (window.__editorState = {
    urls: new Map(),
    gates: {},
    nativeDialogs: [],
    restorePut: null,
  })
  const create = URL.createObjectURL.bind(URL),
    revoke = URL.revokeObjectURL.bind(URL)
  URL.createObjectURL = (blob) => {
    const url = create(blob)
    if (blob instanceof File) state.urls.set(url, blob.name)
    return url
  }
  URL.revokeObjectURL = (url) => {
    state.urls.delete(url)
    revoke(url)
  }
  const decode = window.createImageBitmap.bind(window)
  window.createImageBitmap = async (...args) => {
    const bitmap = await decode(...args)
    const file = args[0]
    if (!(file instanceof File) || !file.name.startsWith('held-')) return bitmap
    const gate = (state.gates[file.name] = { closed: false, released: false })
    const close = bitmap.close.bind(bitmap)
    bitmap.close = () => {
      gate.closed = true
      close()
    }
    await new Promise((resolve) => {
      gate.release = () => {
        gate.released = true
        resolve()
      }
    })
    return bitmap
  }
})
const page = await context.newPage()
page.setDefaultTimeout(30000)
page.setDefaultNavigationTimeout(60000)
const report = {
  base,
  browser: browser.version(),
  scope:
    'Real Chromium UI/storage/media and native unload; delayed decode and quota failure injected; no aesthetics/real-device certification',
  cases: [],
  errors: [],
  passed: false,
}
page.on('pageerror', (e) => report.errors.push(e.message))
let dismissUnload = false
page.on('dialog', async (dialog) => {
  report.cases.push({ nativeDialog: dialog.type(), dismissed: dismissUnload })
  if (dismissUnload) await dialog.dismiss()
  else await dialog.accept()
})
const image = await readFile('public/artwork/portrait.jpg')
const other = await readFile('public/artwork/landscape.jpg')
const pet = await readFile('public/artwork/pet.jpg')
const file = (name, buffer = image, mimeType = 'image/jpeg') => ({ name, mimeType, buffer })
const hash = (s) => createHash('sha256').update(s).digest('hex')
const input = () => page.locator('input[type=file]')
const modal = () => page.locator('dialog.unsaved-dialog[open]')
async function ready() {
  await page.waitForFunction(
    () =>
      document.querySelector('.ascii-scroll canvas')?.width > 100 &&
      !document.querySelector('.editor-save')?.disabled,
  )
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await page.locator('.stage-feedback').waitFor({ state: 'hidden' })
  await page.waitForFunction(() => {
    const image = document.querySelector('.drop img'), canvas = document.querySelector('.ascii-scroll canvas')
    return !image || (image.complete && image.naturalHeight > 0 && Math.abs(canvas.width / canvas.height - image.naturalWidth / image.naturalHeight) < 0.02)
  })
}
const pixels = async () =>
  hash(await page.locator('.ascii-scroll canvas').evaluate((c) => c.toDataURL()))
const unloadProtected = () =>
  page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))
async function save() {
  await page.locator('.editor-save').click()
  await page.locator('.save-status').filter({ hasText: '已保存到此浏览器' }).waitFor()
  assert.equal(await unloadProtected(), false)
}
async function records() {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('astra-art-projects', 2)
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result,
            tx = db.transaction('projects'),
            query = tx.objectStore('projects').getAll()
          tx.oncomplete = async () => {
            db.close()
            resolve(
              await Promise.all(
                query.result.map(async (p) => ({
                  id: p.id,
                  name: p.name,
                  kind: p.kind,
                  settings: p.settings,
                  sourceName: p.source.name,
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
          }
          tx.onerror = () => {
            db.close()
            reject(tx.error)
          }
        }
      }),
  )
}
async function hiddenButton(name) {
  const button = page.getByRole('button', { name, exact: true, includeHidden: true })
  await button.evaluate((b) => {
    for (let p = b.parentElement; p; p = p.parentElement)
      if (p instanceof HTMLDetailsElement) p.open = true
  })
  return button
}
async function holdSaveCompletion() {
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')
    window.__editorState.saveGate = null
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', {
      ...descriptor,
      set(callback) {
        if (this.mode !== 'readwrite') return descriptor.set.call(this, callback)
        const tx = this
        descriptor.set.call(tx, (event) => {
          window.__editorState.saveGate = { release: () => callback.call(tx, event) }
        })
      },
    })
    window.__editorState.restoreComplete = () =>
      Object.defineProperty(IDBTransaction.prototype, 'oncomplete', descriptor)
  })
}
async function releaseSaveCompletion() {
  await page.evaluate(() => {
    window.__editorState.restoreComplete()
    window.__editorState.saveGate.release()
  })
  await page.waitForFunction(() => !document.querySelector('.editor-save').disabled)
}
try {
  await page.goto(`${base}/ascii-art`, { waitUntil: 'domcontentloaded' })
  assert.equal(await unloadProtected(), false)
  await input().setInputFiles(file('portrait.jpg'))
  await ready()
  await page.locator('button[data-quality="classic"]').click()
  await ready()
  await page.waitForFunction(() => document.querySelector('.ascii-scroll canvas')?.dataset.quality === 'classic')
  await page.getByLabel('作品名称').fill('受保护的作品')
  assert.equal(await unloadProtected(), true)
  await save()
  const original = await pixels(),
    sourceUrl = await page.locator('.drop img').getAttribute('src')
  const saved = await records()
  for (const [name, bad] of [
    ['broken-image', file('broken.png', Buffer.from('bad png'), 'image/png')],
    ['broken-video', file('broken.mp4', Buffer.from('bad mp4'), 'video/mp4')],
    ['unsupported', file('unsupported.txt', Buffer.from('hello'), 'text/plain')],
    ['empty', file('empty.png', Buffer.alloc(0), 'image/png')],
  ]) {
    await input().setInputFiles(bad)
    await page.locator('.status.error').waitFor()
    await ready()
    assert.equal(await pixels(), original)
    assert.equal(await page.locator('.drop img').getAttribute('src'), sourceUrl)
    assert.equal(await unloadProtected(), false)
    assert.deepEqual(await records(), saved)
    report.cases.push({ name, preserved: true, noStorageWrite: true })
  }
  await page.evaluate(() => {
    const dt = new DataTransfer()
    dt.items.add(
      new File([new Uint8Array(64 * 1024 * 1024 + 1)], 'too-large.png', { type: 'image/png' }),
    )
    const input = document.querySelector('input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.locator('.status.error').filter({ hasText: '64 MiB' }).waitFor()
  assert.equal(await pixels(), original)
  report.cases.push({ name: 'oversize-before-decode', preserved: true })
  for (const [name, width, height, message] of [
    ['too-small', 1, 2, '尺寸太小'],
    ['longest-side', 16385, 2, '尺寸过大'],
    ['pixel-limit', 5700, 5700, '尺寸过大'],
  ]) {
    await page.evaluate(
      async ({ name, width, height }) => {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
        const dt = new DataTransfer()
        dt.items.add(new File([blob], name + '.png', { type: 'image/png' }))
        const input = document.querySelector('input[type=file]')
        input.files = dt.files
        input.dispatchEvent(new Event('change', { bubbles: true }))
      },
      { name, width, height },
    )
    await page.locator('.status.error').filter({ hasText: message }).waitFor()
    assert.equal(await pixels(), original)
    assert.equal(await page.locator('.drop img').getAttribute('src'), sourceUrl)
    assert.equal(await unloadProtected(), false)
    report.cases.push({ name: `decoded-${name}`, preserved: true, width, height })
  }
  await input().setInputFiles(file('held-cancel.jpg', pet))
  await page.waitForFunction(() => window.__editorState.gates['held-cancel.jpg'])
  assert.equal(await pixels(), original)
  await page.getByRole('button', { name: '取消读取', exact: true }).click()
  await page.evaluate(() => window.__editorState.gates['held-cancel.jpg'].release())
  await page.waitForFunction(() => window.__editorState.gates['held-cancel.jpg'].closed)
  assert.equal(await pixels(), original)
  assert.equal(await unloadProtected(), false)
  report.cases.push({ name: 'cancel-decode', preserved: true, staleBitmapClosed: true })
  await input().setInputFiles(file('held-old.jpg', pet))
  await page.waitForFunction(() => window.__editorState.gates['held-old.jpg'])
  await input().setInputFiles(file('newest.jpg', other))
  await page.waitForFunction(() => window.__editorState.urls.get(document.querySelector('.drop img')?.src) === 'newest.jpg')
  await ready()
  const newest = await pixels()
  assert.notEqual(newest, original)
  await page.evaluate(() => window.__editorState.gates['held-old.jpg'].release())
  await page.waitForFunction(() => window.__editorState.gates['held-old.jpg'].closed)
  assert.equal(await pixels(), newest)
  await save()
  assert.equal((await records())[0].sourceHash, hash(other))
  report.cases.push({
    name: 'late-image-cannot-overwrite',
    latestSourceHash: hash(other),
    staleBitmapClosed: true,
  })
  await input().setInputFiles(file('newest.jpg', other))
  await ready()
  assert.equal(await unloadProtected(), true)
  await save()
  report.cases.push({ name: 'source-only-change-is-dirty', passed: true })
  await page.getByLabel('作品名称').fill('保存中的旧名称')
  await holdSaveCompletion()
  await page.locator('.editor-save').click()
  await page.waitForFunction(() => window.__editorState.saveGate)
  await page.getByLabel('作品名称').fill('保存期间的新名称')
  const contrastInput = page
    .locator('.field')
    .filter({ hasText: '对比度' })
    .locator('input[type=range]')
  await contrastInput.evaluate((input) => {
    input.value = '0.35'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await releaseSaveCompletion()
  assert.equal((await records())[0].name, '保存中的旧名称')
  assert.equal((await records())[0].settings.contrast, 0.2)
  assert.equal(await contrastInput.inputValue(), '0.35')
  assert.equal(await unloadProtected(), true)
  await save()
  assert.equal((await records())[0].name, '保存期间的新名称')
  assert.equal((await records())[0].settings.contrast, 0.35)
  report.cases.push({ name: 'save-completion-cannot-mark-later-parameters-saved', passed: true })
  await holdSaveCompletion()
  await page.locator('.editor-save').click()
  await page.waitForFunction(() => window.__editorState.saveGate)
  await input().setInputFiles(file('during-save.jpg', pet))
  await page.waitForFunction(
    () =>
      document.querySelector('.drop img')?.src &&
      !document.querySelector('.editor-package').disabled,
  )
  await releaseSaveCompletion()
  assert.equal((await records())[0].sourceHash, hash(other))
  assert.equal(await unloadProtected(), true)
  await save()
  assert.equal((await records())[0].sourceHash, hash(pet))
  await input().setInputFiles(file('restore-newest.jpg', other))
  await contrastInput.evaluate((input) => {
    input.value = '0.2'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await ready()
  await save()
  report.cases.push({ name: 'save-completion-cannot-mark-later-source-saved', passed: true })
  await input().setInputFiles(video)
  await ready()
  const active = page.locator('.video-thumb.show')
  await active.evaluate((v) => v.pause())
  await ready()
  const videoPixels = await pixels(),
    videoUrl = await active.getAttribute('src')
  for (const bad of [
    file('bad-again.mp4', Buffer.from('bad'), 'video/mp4'),
    file('bad-again.png', Buffer.from('bad'), 'image/png'),
  ]) {
    await input().setInputFiles(bad)
    await page.locator('.status.error').waitFor()
    await ready()
    assert.equal(await pixels(), videoPixels)
    assert.equal(await active.getAttribute('src'), videoUrl)
  }
  report.cases.push({ name: 'video-preserved-after-image-and-video-failure', passed: true })
  await input().setInputFiles(file('pet.jpg', pet))
  await ready()
  assert.equal(await page.locator('.video-thumb.show').count(), 0)
  assert.equal(await page.evaluate(() => window.__editorState.urls.size), 1)
  report.cases.push({ name: 'image-video-image-resource-transfer', activeSourceUrls: 1 })
  const protectedPixels = await pixels()
  await (await hiddenButton('清空')).click()
  await modal().waitFor()
  await modal().getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.equal(await pixels(), protectedPixels)
  await page.locator('.editor-projects').click()
  await modal().waitFor()
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '继续编辑')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '继续编辑')
  await page.keyboard.press('Shift+Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '保存并离开')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '继续编辑')
  await page.screenshot({ path: path.join(out, 'unsaved-desktop.png') })
  await page.keyboard.press('Escape')
  await modal().waitFor({ state: 'hidden' })
  assert.equal(await pixels(), protectedPixels)
  report.cases.push({ name: 'clear-cancel-escape-and-native-focus-trap', passed: true })
  await page.locator('.editor-projects').click()
  await modal().waitFor()
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put
    window.__editorState.restorePut = () => {
      IDBObjectStore.prototype.put = put
    }
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('Quota test', 'QuotaExceededError')
    }
  })
  await modal().getByRole('button', { name: '保存并离开', exact: true }).click()
  await modal().getByRole('alert').filter({ hasText: '保存失败' }).waitFor()
  assert(page.url().includes('/ascii-art'))
  assert.equal(await pixels(), protectedPixels)
  assert.equal((await records())[0].sourceHash, hash(other))
  await page.evaluate(() => window.__editorState.restorePut())
  await modal().getByRole('button', { name: '保存并离开', exact: true }).click()
  await page.waitForURL('**/projects')
  assert.equal((await records())[0].sourceHash, hash(pet))
  assert.equal(await page.evaluate(() => window.__editorState.urls.size), 0)
  report.cases.push({ name: 'save-failure-keeps-original-target-and-success-leaves', passed: true })
  await page.locator('.project-open').first().click()
  await ready()
  assert.equal(await unloadProtected(), false)
  await page.getByLabel('作品名称').fill('导航保护测试')
  const projectUrl = page.url()
  await page.evaluate(() => {
    const router = document.querySelector('#app').__vue_app__.config.globalProperties.$router
    void router.push(location.pathname + location.search + '&state=guard-check')
  })
  await modal().waitFor()
  await modal().getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.equal(page.url(), projectUrl)
  await page.evaluate(() => history.back())
  await modal().waitFor()
  await modal().getByRole('button', { name: '继续编辑', exact: true }).click()
  await page.waitForURL(projectUrl)
  report.cases.push({ name: 'same-route-query-and-browser-back-cancel', passed: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('link', { name: 'Astra 首页', exact: true }).click()
  await modal().waitFor()
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: path.join(out, 'unsaved-mobile.png') })
  await modal().getByRole('button', { name: '继续编辑', exact: true }).click()
  dismissUnload = true
  await page.close({ runBeforeUnload: true })
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(page.isClosed(), false)
  assert(report.cases.some((c) => c.nativeDialog === 'beforeunload' && c.dismissed))
  dismissUnload = false
  report.cases.push({ name: 'native-close-cancel-and-mobile-dialog', passed: true })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.evaluate(() => history.back())
  await modal().waitFor()
  await modal().getByRole('button', { name: '放弃更改并离开', exact: true }).click()
  await page.waitForURL('**/projects')
  await page.locator('.project-open').first().click()
  await ready()
  const beforeClear = await records()
  await page.getByLabel('作品名称').fill('待清空的更改')
  await (await hiddenButton('清空')).click()
  await modal().getByRole('button', { name: '放弃更改并清空', exact: true }).click()
  await page.locator('.ascii-scroll canvas').waitFor({ state: 'hidden' })
  assert.deepEqual(await records(), beforeClear)
  await input().setInputFiles(file('new-project.jpg'))
  await ready()
  await save()
  const afterClear = await records()
  assert.equal(afterClear.length, beforeClear.length + 1)
  for (const old of beforeClear)
    assert.deepEqual(
      afterClear.find((p) => p.id === old.id),
      old,
    )
  report.cases.push({
    name: 'confirmed-clear-creates-new-project-without-overwriting',
    passed: true,
  })
  await input().setInputFiles(file('held-unmount.jpg'))
  await page.waitForFunction(() => window.__editorState.gates['held-unmount.jpg'])
  await page.getByRole('button', { name: '取消读取', exact: true }).click()
  await page.getByRole('link', { name: 'Astra 首页', exact: true }).click()
  await page.waitForURL(base + '/')
  await page.evaluate(() => window.__editorState.gates['held-unmount.jpg'].release())
  await page.waitForFunction(() => window.__editorState.gates['held-unmount.jpg'].closed)
  assert.equal(await page.evaluate(() => window.__editorState.urls.size), 0)
  assert.equal(await unloadProtected(), false)
  report.cases.push({ name: 'discard-and-unmount-release-late-candidate', passed: true })
  assert.deepEqual(report.errors, [])
  report.passed = true
  console.log(`PASS ${report.cases.length} editor state checks`)
} catch (cause) {
  report.failure = { message: cause.message, stack: cause.stack }
  if (!page.isClosed()) await page.screenshot({ path: path.join(out, 'failure.png') })
  throw cause
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
