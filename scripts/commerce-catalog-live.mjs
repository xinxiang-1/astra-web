import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_CATALOG_PREVIEW_URL
const backend = process.env.ASTRA_CATALOG_API_URL
const out = process.env.ASTRA_CATALOG_OUTPUT
const emptyMode = process.env.ASTRA_CATALOG_MODE === 'empty'
assert.ok(base && backend && out, 'Owned Java fixture required')
assert.equal(new URL(base).hostname, '127.0.0.1')
assert.equal(new URL(backend).hostname, '127.0.0.1')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const report = {
  scope:
    'Anonymous real owned MySQL/system/gateway catalogue; local shared Redis preserved; no payment or auth fixtures; external invalid previews blocked; 503 faults and delayed responses explicitly injected',
  browser: browser.version(),
  checks: [],
  requests: [],
  injectedFailures: [],
  passed: false,
}
const check = (name) => {
  report.checks.push(name)
  console.log(name)
}
const firstSku = '189304737000000103'
const secondSku = '189304737000000113'
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.route(
    (url) => url.origin !== new URL(base).origin,
    (route) => route.abort(),
  )
  let singlePage = false,
    failContent = false,
    failFlags = false,
    delayFirst = false
  let delayStarted
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    assert.equal(request.method(), 'GET', 'Catalogue browsing must never write transactions')
    assert.ok(
      url.pathname.startsWith('/api/system/catalog/'),
      'Anonymous page must only request public catalogue',
    )
    assert.equal(request.headers().authorization, undefined)
    if (
      (failContent && url.pathname.endsWith('/products/test-theme-0')) ||
      (failFlags && url.pathname.endsWith('/capabilities'))
    ) {
      report.injectedFailures.push({ path: url.pathname, status: 503 })
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"code":503,"msg":"Explicit transport failure fixture"}',
      })
      return
    }
    if (singlePage && url.pathname.endsWith('/products')) url.searchParams.set('limit', '1')
    const response = await route.fetch({ url: `${backend}${url.pathname}${url.search}` })
    report.requests.push({
      method: 'GET',
      path: url.pathname,
      status: response.status(),
      body: await response.json(),
    })
    if (delayFirst && url.pathname.endsWith('/products/test-theme-0')) {
      delayStarted?.()
      await new Promise((resolve) => setTimeout(resolve, 800))
    }
    await route.fulfill({ response }).catch((error) => {
      if (!/closed|disposed|canceled|cancelled/i.test(error.message)) throw error
    })
  })
  await page.goto(`${base}/collections`, { waitUntil: 'domcontentloaded' })
  if (emptyMode) {
    await page
      .getByText('这个分类还没有公开内容。先从免费模板开始创作吧。', { exact: true })
      .waitFor()
    assert.equal(await page.locator('[data-product]').count(), 0)
    assert.ok(
      report.requests.some(
        (r) => r.path.endsWith('/products') && r.status === 200 && r.body.data.items.length === 0,
      ),
    )
    check('Actual empty database renders empty catalogue and disabled sale state')
    await page.getByRole('link', { name: '免费入门模板', exact: true }).click()
    await page.locator('[data-template="orbital-light"]').waitFor()
    assert.equal(await page.locator('[data-template]').count(), 3)
    await page.locator('[data-template="orbital-light"]').getByRole('button').first().click()
    await page.getByRole('button', { name: '用这个模板创作' }).click()
    await page.waitForURL((url) => url.pathname === '/ascii-art', { waitUntil: 'domcontentloaded' })
    const savedCount = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('astra-art-projects', 1)
          request.onerror = () => reject(request.error)
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction('projects'),
              count = tx.objectStore('projects').count()
            tx.oncomplete = () => {
              db.close()
              resolve(count.result)
            }
            tx.onerror = () => reject(tx.error)
          }
        }),
    )
    assert.equal(savedCount, 1)
    check('Free three starter templates remain usable with no published paid catalogue')
  } else {
    await page.waitForFunction(() => document.querySelectorAll('[data-product]').length === 3)
    const ids = await page
      .locator('[data-product]')
      .evaluateAll((nodes) => nodes.map((n) => n.dataset.product))
    assert.ok(ids.every((id) => BigInt(id) > BigInt(Number.MAX_SAFE_INTEGER)))
    await page.getByText('购买尚未开放，你可以先了解内容与交付说明。', { exact: true }).waitFor()
    check(
      'Anonymous real catalogue renders three products with exact bigint IDs and backend sale disabled',
    )
    singlePage = true
    await page.getByRole('button', { name: '刷新内容' }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-product]').length === 1)
    for (const count of [2, 3]) {
      await page.getByRole('button', { name: '读取更多' }).click()
      await page.waitForFunction(
        (n) => document.querySelectorAll('[data-product]').length === n,
        count,
      )
    }
    assert.deepEqual(
      await page
        .locator('[data-product]')
        .evaluateAll((nodes) => nodes.map((n) => n.dataset.product)),
      ids,
    )
    assert.equal(await page.getByRole('button', { name: '读取更多' }).count(), 0)
    check('Three actual limit=1 cursor pages append without missing or duplicate products')
    singlePage = false
    await page.getByRole('button', { name: '创作工作流', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-product]').length === 1)
    assert.match(await page.locator('[data-product]').innerText(), /中文测试商品1/)
    await page.getByRole('button', { name: '模板合集', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-product]').length === 2)
    assert.ok(
      !(await page.locator('[data-product]').allTextContents()).some((s) =>
        s.includes('中文测试商品1'),
      ),
    )
    check('Changing product kind resets pagination and uses actual backend filters')
    await page.locator('a[href="/collections/test-theme-0"]').click()
    await page.locator('[data-product-detail]').waitFor()
    assert.equal(await page.locator('[data-catalog-price]').innerText(), '¥99.00')
    assert.equal(await page.getByLabel('选择内容版本').inputValue(), secondSku)
    await page.locator('summary').filter({ hasText: '使用许可' }).click()
    await page.getByText('<em>这里只是文本，不执行HTML</em>', { exact: false }).waitFor()
    assert.equal(await page.locator('.policy-copy em').count(), 0)
    await page.getByLabel('选择内容版本').selectOption(firstSku)
    assert.equal(await page.locator('[data-catalog-price]').innerText(), '¥39.00')
    assert.match(await page.locator('.delivery-information').innerText(), /中文模板.astra\s+1 B/)
    await page.locator('summary').filter({ hasText: '使用许可' }).click()
    assert.match(
      await page.locator('.policy-copy').first().innerText(),
      /测试LICENSE条款，未用于销售/,
    )
    assert.equal(
      await page.getByRole('button', { name: '购买尚未开放', exact: true }).isDisabled(),
      true,
    )
    check(
      'Real SKU selection switches exact price, files, delivery contents and versioned license; HTML is plain text',
    )
    await page.getByLabel('选择内容版本').selectOption(secondSku)
    await page.locator('.product-preview img').waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('.product-preview img')].every(
        (img) => img.complete && img.naturalWidth > 0,
      ),
    )
    await page.screenshot({ path: path.join(out, 'catalog-detail-desktop.png'), fullPage: true })
    check(
      'Actual backend preview URL loads original free fixture image; public metadata grants no file or payment action',
    )
    failContent = true
    await page.getByRole('button', { name: '刷新内容' }).click()
    await page.getByRole('alert').waitFor()
    assert.equal(await page.locator('[data-product-detail]').count(), 0)
    failContent = false
    await page.getByRole('button', { name: '重新读取' }).click()
    await page.locator('[data-product-detail]').waitFor()
    check(
      'Explicit content503 clears stale offer and recovers through user retry without order creation',
    )
    failFlags = true
    await page.getByRole('button', { name: '刷新内容' }).click()
    await page.getByRole('button', { name: '购买状态待确认', exact: true }).waitFor()
    assert.equal(
      await page.getByRole('button', { name: '购买状态待确认', exact: true }).isDisabled(),
      true,
    )
    assert.equal(await page.locator('[data-catalog-price]').innerText(), '¥99.00')
    failFlags = false
    await page.getByRole('button', { name: '刷新内容' }).click()
    await page.getByRole('button', { name: '购买尚未开放', exact: true }).waitFor()
    check('Capability503 preserves readable detail but never enables or guesses purchase state')
    await page.getByRole('link', { name: '全部内容合集', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-product]').length === 2)
    assert.equal(
      await page
        .getByRole('button', { name: '模板合集', exact: true })
        .getAttribute('aria-pressed'),
      'true',
    )
    await page.getByRole('button', { name: '全部', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-product]').length === 3)
    delayFirst = true
    const pendingDelay = new Promise((resolve) => {
      delayStarted = resolve
    })
    await page.locator('a[href="/collections/test-theme-0"]').click()
    await Promise.race([
      pendingDelay,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Owned delayed response did not start')), 10000),
      ),
    ])
    await page.getByRole('link', { name: '全部内容合集', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('[data-product]').length === 3)
    await page.locator('a[href="/collections/test-theme-2"]').focus()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { level: 1, name: '中文测试商品2', exact: true }).waitFor()
    await new Promise((resolve) => setTimeout(resolve, 1000))
    assert.equal(
      await page.locator('[data-product-detail]').getAttribute('data-product-detail'),
      '189304737000000300',
    )
    delayFirst = false
    await page.getByText('预览暂不可用', { exact: false }).waitFor()
    check(
      'Late previous detail cannot replace new route; keyboard navigation and failed preview fallback work',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.getByRole('button', { name: /切换到(亮|暗)色/ }).click()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: path.join(out, 'catalog-detail-mobile.png'), fullPage: true })
    check('390px detail and controls fit both themes without horizontal overflow')
    await page.goto(`${base}/collections/not-a-product`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('alert').waitFor()
    assert.equal(await page.locator('[data-product-detail]').count(), 0)
    assert.ok(
      report.requests.some((r) => r.path.endsWith('/products/not-a-product') && r.status === 404),
    )
    await page.getByRole('link', { name: '我的已购内容 ↗', exact: true }).waitFor()
    check(
      'Actual unpublished404 offers catalogue and owned-library paths without exposing an old offer',
    )
  }
  assert.equal(await page.evaluate(() => localStorage.getItem('astra_access_token')), null)
  report.passed = true
  console.log(`Catalogue browser: ${report.checks.length} checks passed.`)
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
