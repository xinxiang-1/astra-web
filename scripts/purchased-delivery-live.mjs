import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_DELIVERY_PREVIEW_URL
const backend = process.env.ASTRA_DELIVERY_API_URL
const token = process.env.ASTRA_DELIVERY_OWNER_TOKEN
const other = process.env.ASTRA_DELIVERY_OTHER_TOKEN
const out = process.env.ASTRA_DELIVERY_OUTPUT
assert.ok(base && backend && token && other && out, 'Owned Java fixture required')
assert.equal(new URL(base).hostname, '127.0.0.1')
assert.equal(new URL(backend).hostname, '127.0.0.1')
await mkdir(out, { recursive: true })
const expected = await readFile('public/templates/starter-v1/orbital-light/project.astra')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  scope:
    'Owned real MySQL/Redis/gateway/filesystem delivery; trusted mock settlement; auth/me mocked503; free original package copied only as private test fixture',
  checks: [],
  requests: [],
}
const check = (name) => {
  report.checks.push(name)
  console.log(name)
}
const fixtureAsset = '189304737000010304'
async function projects(page) {
  return page.evaluate(async () => {
    const rows = await new Promise((resolve, reject) => {
      const request = indexedDB.open('astra-art-projects', 2)
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction('projects'),
          get = tx.objectStore('projects').getAll()
        tx.oncomplete = () => {
          db.close()
          resolve(get.result)
        }
        tx.onerror = () => reject(tx.error)
      }
      request.onerror = () => reject(request.error)
    })
    return Promise.all(
      rows.map(async (p) => ({
        id: p.id,
        name: p.name,
        thumbnail: p.thumbnail,
        updatedAt: p.updatedAt,
        settings: p.settings,
        sourceSha: Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', await p.source.arrayBuffer())),
          (n) => n.toString(16).padStart(2, '0'),
        ).join(''),
      })),
    )
  })
}
try {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  await context.addInitScript((value) => localStorage.setItem('astra_access_token', value), token)
  const page = await context.newPage()
  await page.route(
    (url) => url.origin !== new URL(base).origin,
    (route) => route.abort(),
  )
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"code":503,"msg":"夹具没有auth服务"}',
    }),
  )
  let corrupt = false
  let slow = false
  let binarySent = 0
  await page.route('**/api/system/**', async (route) => {
    const url = new URL(route.request().url())
    const isBinary = url.pathname.endsWith('/download')
    if (isBinary) {
      binarySent++
      assert.equal(route.request().headers().authorization, undefined)
      if (slow) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    const response = await route.fetch({
      url: `${backend}${url.pathname}${url.search}`,
      maxRedirects: 0,
    })
    report.requests.push({
      method: route.request().method(),
      path: url.pathname,
      status: response.status(),
    })
    try {
      if (corrupt && isBinary && response.status() === 200) {
        const data = await response.body()
        data[0] ^= 1
        await route.fulfill({ response, body: data })
      } else await route.fulfill({ response })
    } catch (error) {
      if (!slow) throw error // Canceled browser request is expected during the slow case.
    }
  })
  await page.goto(`${base}/templates`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-template="orbital-light"]').getByRole('button').first().click()
  await page.getByRole('button', { name: '用这个模板创作' }).click()
  await page.waitForURL((url) => url.pathname === '/ascii-art', { waitUntil: 'domcontentloaded' })
  const original = await projects(page)
  assert.equal(original.length, 1)
  await page.goto(`${base}/account/library`, { waitUntil: 'domcontentloaded' })
  const asset = page.locator(`[data-asset="${fixtureAsset}"]`)
  await asset.waitFor()
  const pendingDownload = page.waitForEvent('download')
  await asset.getByRole('button', { name: '下载文件', exact: true }).click()
  const download = await pendingDownload
  await download.saveAs(path.join(out, 'received.astra'))
  assert.equal(sha(await readFile(path.join(out, 'received.astra'))), sha(expected))
  assert.deepEqual(await projects(page), original)
  check(
    'Actual private gateway download has exact source bytes; downloading does not modify projects',
  )
  await asset.getByRole('button', { name: '导入为新项目' }).click()
  await page.getByText('导入成功，已保存为新项目。', { exact: false }).waitFor()
  const imported = await projects(page)
  assert.equal(imported.length, 2)
  assert.deepEqual(
    imported.find((p) => p.id === original[0].id),
    original[0],
  )
  const copy = imported.find((p) => p.id !== original[0].id)
  assert.equal(copy.sourceSha, original[0].sourceSha)
  check(
    'Validated actual .astra import creates a new ID and preserves existing source/settings/thumbnail',
  )
  corrupt = true
  await asset.getByRole('button', { name: '导入为新项目' }).click()
  await page.getByRole('alert').waitFor()
  assert.deepEqual(await projects(page), imported)
  corrupt = false
  check('Altered private response fails SHA256 before import and leaves projects unchanged')
  const invalid = page.locator('[data-asset="189304737000010104"]')
  await invalid.getByRole('button', { name: '导入为新项目' }).click()
  await page.getByText('请选择 Astra 导出的 .astra 作品包', { exact: false }).waitFor()
  assert.deepEqual(await projects(page), imported)
  check('Authentic but unsupported .astra payload is rejected without changing existing projects')
  slow = true
  const sentBefore = binarySent
  await asset.getByRole('button', { name: '导入为新项目' }).click()
  await page.waitForFunction(() => document.querySelector('.transfer-status'))
  while (binarySent === sentBefore) await new Promise((resolve) => setTimeout(resolve, 10))
  await page.getByRole('button', { name: '取消领取' }).click()
  await page.waitForFunction(() => !document.querySelector('.transfer-status'))
  await new Promise((resolve) => setTimeout(resolve, 1200))
  slow = false
  assert.deepEqual(await projects(page), imported)
  check('Canceling in-flight private download creates no project and restores controls')
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(out, 'delivery-mobile.png'), fullPage: true })
  check('Mobile file actions are visible without horizontal overflow')
  await page.evaluate((value) => localStorage.setItem('astra_access_token', value), other)
  await asset.getByRole('button', { name: '下载文件', exact: true }).click()
  await page.getByRole('alert').waitFor()
  assert.ok(report.requests.some((r) => r.path.endsWith('/download-ticket') && r.status === 404))
  assert.deepEqual(await projects(page), imported)
  check('Stale owner UI cannot grant another real user a ticket; backend rejects the request')
  assert.ok(
    await page.evaluate(() =>
      Object.values(localStorage).every((value) => !value.includes('?ticket=')),
    ),
  )
  report.passed = true
  report.sourceSha256 = sha(expected)
  console.log(`Private delivery browser: ${report.checks.length} checks passed.`)
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
