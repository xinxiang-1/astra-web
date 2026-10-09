import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_DELIVERY_PREVIEW_URL
const backend = process.env.ASTRA_DELIVERY_API_URL
const token = process.env.ASTRA_DELIVERY_OWNER_TOKEN
const other = process.env.ASTRA_DELIVERY_OTHER_TOKEN
const out = process.env.ASTRA_DELIVERY_OUTPUT
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const mobile = process.env.ASTRA_CREATIVE_MOBILE === 'true'
assert(base && backend && token && other && out, 'Owned Java fixture required')
assert.equal(new URL(base).hostname, '127.0.0.1')
assert.equal(new URL(backend).hostname, '127.0.0.1')
await mkdir(out, { recursive: true })
const fixtures = 'docs/validation/2026-10-09/creative-workflow-package/core-edge/source'
const expectedWorkflow = await readFile(fixtures + '.astra-workflow')
const expectedSignature = await readFile(fixtures + '.astra-signature')
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const browser = await chromium.launch({ channel, headless: true })
const report = {
  scope:
    'Actual isolated MySQL/Redis/gateway/private files; trusted mock payment; auth/me simulated503; engineering workflow fixture',
  browser: browser.version(),
  mobile,
  checks: [],
  requests: [],
  errors: [],
}
let page
const check = (name) => {
  report.checks.push(name)
  console.log(name)
}
async function state() {
  return page.evaluate(async () => {
    const entries = await new Promise((resolve, reject) => {
      const request = indexedDB.open('astra-art-projects', 2)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['projects', 'signature-projects', 'creative-index'])
        const requests = ['projects', 'signature-projects', 'creative-index'].map((name) =>
          tx.objectStore(name).getAll(),
        )
        tx.oncomplete = () => {
          db.close()
          resolve(requests.map((r) => r.result))
        }
        tx.onabort = () => {
          db.close()
          reject(tx.error)
        }
      }
      request.onerror = () => reject(request.error)
    })
    return Promise.all(
      entries.map(async (rows) =>
        Promise.all(
          rows
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(async (entry) => {
              const value = { ...entry }
              for (const key of ['file', 'source'])
                if (value[key] instanceof Blob) {
                  const file = value[key]
                  value[key] = {
                    name: file.name,
                    type: file.type,
                    size: file.size,
                    lastModified: file.lastModified,
                    sha256: Array.from(
                      new Uint8Array(
                        await crypto.subtle.digest('SHA-256', await file.arrayBuffer()),
                      ),
                      (b) => b.toString(16).padStart(2, '0'),
                    ).join(''),
                  }
                }
              return value
            }),
        ),
      ),
    )
  })
}
try {
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
    hasTouch: mobile,
    isMobile: mobile,
    reducedMotion: 'reduce',
  })
  await context.addInitScript((value) => localStorage.setItem('astra_access_token', value), token)
  page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
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
  await page.route('**/api/system/**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/download'))
      assert.equal(route.request().headers().authorization, undefined)
    const response = await route.fetch({
      url: `${backend}${url.pathname}${url.search}`,
      maxRedirects: 0,
    })
    report.requests.push({
      method: route.request().method(),
      path: url.pathname,
      status: response.status(),
    })
    if (corrupt && url.pathname.endsWith('/download') && response.status() === 200) {
      const bytes = await response.body()
      bytes[0] ^= 1
      await route.fulfill({ response, body: bytes })
    } else await route.fulfill({ response })
  })
  await page.goto(base + '/templates', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-template="orbital-light"]').getByRole('button').first().click()
  await page.getByRole('button', { name: '用这个模板创作' }).click()
  await page.waitForURL((url) => url.pathname === '/ascii-art')
  const original = await state()
  assert.equal(original[0].length, 1)
  await page.goto(base + '/account/library', { waitUntil: 'domcontentloaded' })
  const workflow = page.locator('[data-asset="189304737000010304"]')
  const signature = page.locator('[data-asset="189304737000010305"]')
  await workflow.waitFor()
  const idle = () => page.waitForFunction(() => !document.querySelector('.transfer-status'))
  const activate = async (asset, name) => {
    await asset.getByRole('button', { name, exact: true }).click()
    await idle()
  }
  const download = async (asset, expected, filename) => {
    const event = page.waitForEvent('download')
    await asset.getByRole('button', { name: '下载文件', exact: true }).click()
    const item = await event
    assert(item.suggestedFilename().endsWith(path.extname(filename)))
    await item.saveAs(path.join(out, filename))
    assert.equal(hash(await readFile(path.join(out, filename))), hash(expected))
    await idle()
  }
  await download(workflow, expectedWorkflow, 'received.astra-workflow')
  assert.deepEqual(await state(), original)
  check('authorized-workflow-download-exact-bytes-and-no-project-write')
  await activate(workflow, '导入完整工作流')
  await page.getByText('工作流已导入，', { exact: false }).waitFor()
  const saved = await state()
  assert.equal(saved[0].length, 2)
  assert.equal(saved[1].length, 1)
  assert.equal(saved[2].length, 3)
  assert.deepEqual(
    saved[0].find((p) => p.id === original[0][0].id),
    original[0][0],
  )
  assert.deepEqual(
    saved[2].find((p) => p.id === original[2][0].id),
    original[2][0],
  )
  const derived = saved[0].find((p) => p.workflowKey)
  assert.equal(derived.origin.projectId, saved[1][0].id)
  assert.equal(saved[1][0].file.sha256, hash(expectedSignature))
  check('workflow-import-saves-both-originals-and-index-atomically-preserving-unrelated-project')
  await activate(workflow, '导入完整工作流')
  await page.getByText('此工作流版本已导入', { exact: false }).waitFor()
  assert.equal((await state())[2].length, 3)
  check('repeat-claim-deduplicates-workflow-version')
  await activate(signature, '导入签名原作')
  await page.getByText('签名原作已保存', { exact: false }).waitFor()
  assert.equal((await state())[2].length, 3)
  check('separate-signature-import-reuses-identical-original')
  await download(signature, expectedSignature, 'received.astra-signature')
  const stable = await state()
  check('authorized-signature-download-exact-bytes-and-no-project-write')
  await activate(page.locator('[data-asset="189304737000010404"]'), '导入完整工作流')
  await page.getByRole('alert').waitFor()
  assert.deepEqual(await state(), stable)
  check('authentic-transport-with-invalid-nested-package-does-not-write')
  corrupt = true
  await activate(workflow, '导入完整工作流')
  await page.getByRole('alert').waitFor()
  corrupt = false
  assert.deepEqual(await state(), stable)
  check('corrupt-transport-fails-before-package-parse')
  await page.evaluate(() => {
    window.deliveryPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'projects')
        throw new DOMException('Owned quota injection', 'QuotaExceededError')
      return window.deliveryPut.apply(this, args)
    }
  })
  await activate(workflow, '导入完整工作流')
  await page.getByText('浏览器未能保存项目', { exact: false }).waitFor()
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = window.deliveryPut
  })
  assert.deepEqual(await state(), stable)
  check('actual-three-store-transaction-rolls-back-on-quota-error')
  await page.evaluate(() => {
    const read = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = async function () {
      if (window.holdWorkflow && this.size === 46) {
        window.holdWorkflow = false
        window.workflowWaiting = true
        await new Promise((resolve) => {
          window.releaseWorkflow = resolve
        })
      }
      return read.call(this)
    }
  })
  await page.evaluate(() => {
    window.holdWorkflow = true
  })
  await workflow.getByRole('button', { name: '导入完整工作流', exact: true }).click()
  await page.waitForFunction(() => window.workflowWaiting)
  await page.getByRole('button', { name: '取消领取', exact: true }).click()
  await page.evaluate(() => {
    window.releaseWorkflow()
    window.workflowWaiting = false
  })
  await idle()
  assert.deepEqual(await state(), stable)
  check('cancel-during-strict-file-read-disposes-candidate-and-does-not-write')
  await page.evaluate(() => {
    window.holdWorkflow = true
  })
  await workflow.getByRole('button', { name: '导入完整工作流', exact: true }).click()
  await page.waitForFunction(() => window.workflowWaiting)
  await page.evaluate((value) => {
    localStorage.setItem('astra_access_token', value)
    window.releaseWorkflow()
  }, other)
  await idle()
  assert.deepEqual(await state(), stable)
  check('identity-change-during-parse-cannot-save-or-show-old-user-result')
  await activate(workflow, '下载文件')
  await page.getByRole('alert').waitFor()
  assert(report.requests.some((r) => r.path.endsWith('/download-ticket') && r.status === 404))
  assert.deepEqual(await state(), stable)
  check('stale-owner-interface-cannot-grant-another-user-download')
  await page.evaluate((value) => localStorage.setItem('astra_access_token', value), token)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await workflow.waitFor()
  for (const theme of ['dark', 'light']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value
    }, theme)
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    for (const button of await page.locator('.file-actions button').all()) {
      const box = await button.boundingBox()
      assert(box && box.height >= 44 && box.x >= 0 && box.x + box.width <= (mobile ? 391 : 1441))
    }
    await page.screenshot({ path: path.join(out, `library-${theme}.png`), fullPage: true })
  }
  assert(
    await page.evaluate(() =>
      Object.values(localStorage).every((value) => !value.includes('?ticket=')),
    ),
  )
  check('both-themes-and-desktop-or-touch-controls-fit-without-ticket-storage')
  assert.equal(report.checks.length, 12)
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = String(error)
  await page?.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
