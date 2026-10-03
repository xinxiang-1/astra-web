import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_CONTROLS_OUTPUT || `test-results/site-controls-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = {
  browser: browser.version(),
  controls: {},
  touch: {},
  files: {},
  shortScreens: [],
  errors: [],
}
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'no-preference',
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push({ url: page.url(), message: error.message }))
  page.setDefaultTimeout(30000)
  await page.goto(base + '/tools')
  const row = page.locator('.catalog-row').first()
  const before = await row.boundingBox()
  await row.hover()
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('.row-go')).transform === 'matrix(1, 0, 0, 1, 4, 0)',
  )
  assert.deepEqual(
    await row.boundingBox(),
    before,
    'Hover must preserve the clickable row geometry',
  )
  const button = page.getByRole('link', { name: '开始做字符画', exact: false })
  await button.hover({ position: { x: 15, y: 15 } })
  const pointA = await button.evaluate((el) => [
    el.style.getPropertyValue('--bx'),
    el.style.getPropertyValue('--by'),
  ])
  await button.hover({ position: { x: 100, y: 25 } })
  const pointB = await button.evaluate((el) => [
    el.style.getPropertyValue('--bx'),
    el.style.getPropertyValue('--by'),
  ])
  assert.notDeepEqual(pointA, pointB)
  await page.mouse.move(0, 300)
  await page.waitForFunction(
    () => getComputedStyle(document.querySelector('.fx-btn .shine')).opacity === '0',
  )
  report.controls.pointer = { stableTarget: true, followsPointer: true, clearsOnLeave: true }

  // This fixture mounts the real shared component and router; exercise its disabled navigation.
  await page.goto(base + '/scripts/fixtures/site-controls.html')
  const disabled = page.getByRole('button', { name: '继续创作', exact: true })
  assert(await disabled.isDisabled())
  assert.equal(await page.getByRole('link', { name: '继续创作' }).count(), 0)
  const disabledBox = await disabled.boundingBox()
  await page.mouse.click(
    disabledBox.x + disabledBox.width / 2,
    disabledBox.y + disabledBox.height / 2,
  )
  assert.equal(await page.getByLabel('当前路径').textContent(), '/')
  await page.getByRole('button', { name: '切换可用状态' }).click()
  await page.getByRole('link', { name: '继续创作' }).click()
  await page.waitForFunction(() => document.querySelector('output').textContent === '/destination')
  report.controls.disabledNavigation = { prevented: true, reenabled: true }

  const touchContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  })
  const phone = await touchContext.newPage()
  phone.on('pageerror', (error) => report.errors.push({ url: phone.url(), message: error.message }))
  await phone.goto(base + '/tools')
  const menu = phone.getByRole('button', { name: '切换导航菜单', exact: true })
  await menu.tap()
  assert.equal(await menu.getAttribute('aria-expanded'), 'true')
  await phone.touchscreen.tap(10, 800)
  assert.equal(await menu.getAttribute('aria-expanded'), 'false')
  await menu.tap()
  await phone.locator('#site-navigation').getByRole('link', { name: '模板', exact: true }).tap()
  await phone.waitForURL(base + '/templates')
  assert.equal(await menu.getAttribute('aria-expanded'), 'false')
  report.touch = { opens: true, outsideCloses: true, navigationCloses: true }

  await page.goto(base + '/file-upload')
  await page.locator('input[type=file]').setInputFiles({
    name: '本地预览合同.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Astra 本地文件预览合同\nUTF-8 中文内容与第二行。', 'utf8'),
  })
  await page.getByRole('button', { name: '打开预览', exact: true }).click()
  await page.waitForURL(base + '/file-preview')
  await page
    .locator('.viewer-shell')
    .getByText('Astra 本地文件预览合同', { exact: false })
    .first()
    .waitFor({ timeout: 60000 })
  await page.screenshot({ path: path.join(out, 'file-text.png') })
  await page.locator('input[type=file]').setInputFiles(path.resolve('public/artwork/pet.jpg'))
  await page.getByRole('heading', { name: 'pet.jpg', exact: true }).waitFor()
  await page.waitForFunction(() => {
    const search = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) return true
        if (el.shadowRoot && search(el.shadowRoot)) return true
      }
      return false
    }
    return search(document.querySelector('.viewer-shell'))
  })
  await page.screenshot({ path: path.join(out, 'file-replacement.png') })
  await page.getByRole('button', { name: '清除并返回', exact: true }).click()
  await page.waitForURL(base + '/file-upload')
  assert.equal(await page.locator('.file-name').count(), 0)
  await page.goto(base + '/file-preview')
  await page.getByText('还没有可预览的文件', { exact: true }).waitFor()
  report.files = { utf8Text: true, replacementImage: true, cleared: true }

  // Phone landscape and short desktop: all effect controls remain reachable under the shared header.
  for (const viewport of [
    { width: 744, height: 390 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport)
    for (const route of ['/prism', '/webgl-fluid']) {
      await page.goto(base + route)
      const panel = page.locator('.page > aside.panel')
      const box = await panel.boundingBox()
      const header = await page.locator('.art-header').boundingBox()
      assert(box.y >= header.height + 12)
      assert(box.y + box.height <= viewport.height - 12)
      const last = panel.locator('button,input,select').last()
      await last.focus()
      const lastBox = await last.boundingBox()
      assert(
        lastBox.y >= box.y && lastBox.y + lastBox.height <= box.y + box.height + 1,
        'Last effect control must be reachable by keyboard scroll',
      )
      await page.screenshot({
        path: path.join(out, `${route.slice(1)}-${viewport.width}x${viewport.height}.png`),
      })
      report.shortScreens.push({ route, ...viewport, controlsReachable: true })
    }
    await page.goto(base + '/register')
    const submit = page.getByRole('button', { name: '创建账户', exact: true })
    await submit.focus()
    const box = await submit.boundingBox()
    assert(
      box.y >= 0 && box.y + box.height <= viewport.height + 1,
      'Account submission must remain scroll-reachable',
    )
    await page.screenshot({
      path: path.join(out, `register-${viewport.width}x${viewport.height}.png`),
    })
    report.shortScreens.push({ route: '/register', ...viewport, submissionReachable: true })
  }
  const noGpuContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await noGpuContext.addInitScript(() => {
    delete Navigator.prototype.gpu
  })
  const noGpu = await noGpuContext.newPage()
  report.gpuUnavailable = []
  for (const route of ['/prism', '/black-hole', '/fluid']) {
    await noGpu.goto(base + route)
    await noGpu.locator('.error').waitFor()
    const header = await noGpu.locator('.art-header').boundingBox()
    const error = await noGpu.locator('.error').boundingBox()
    assert(error.y >= header.height + 12)
    if (route === '/prism')
      assert.equal(
        await noGpu.locator('.page > aside.panel').count(),
        0,
        'Unavailable controls must not cover the error',
      )
    report.gpuUnavailable.push({
      route,
      errorY: error.y,
      headerHeight: header.height,
      message: await noGpu.locator('.error').textContent(),
    })
    await noGpu.screenshot({ path: path.join(out, `${route.slice(1)}-gpu-unavailable.png`) })
  }
  assert.deepEqual(report.errors, [])
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, ...report }, null, 2))
} catch (error) {
  for (const [index, currentPage] of browser
    .contexts()
    .flatMap((context) => context.pages())
    .entries()) {
    await currentPage.screenshot({ path: path.join(out, `failure-${index}.png`) }).catch(() => {})
    const content = await currentPage
      .evaluate(() => {
        const read = (root) =>
          Array.from(root.querySelectorAll('*'))
            .flatMap((el) => [
              el.tagName === 'IFRAME' ? `iframe:${el.src}` : '',
              el.shadowRoot ? el.shadowRoot.textContent + read(el.shadowRoot) : '',
            ])
            .join('\n')
        return {
          url: location.href,
          text: document.body.innerText,
          shadow: read(document),
          html: document.querySelector('.viewer-shell')?.innerHTML,
        }
      })
      .catch(() => null)
    await writeFile(path.join(out, `failure-${index}.json`), JSON.stringify(content, null, 2))
  }
  await writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify({ ...report, error: error.stack }, null, 2),
  )
  throw error
} finally {
  await browser.close()
}
