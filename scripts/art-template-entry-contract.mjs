import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  database,
  download,
  exportFile,
  hash,
  ready,
  setRange,
  unpack,
} from './templates/delivery-ui.mjs'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_TEMPLATE_ENTRY_OUTPUT || 'sandbox/template-entry/2026-10-02-v1/development-r1',
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out, { recursive: false })
const sourcePaths = [
  'src/views/TemplatesView.vue',
  'src/views/CreationHelpView.vue',
  'src/lib/starter-templates.ts',
  'src/content/starter-templates.ts',
  'src/router/index.ts',
  'src/App.vue',
  'src/components/ArtHeader.vue',
  'src/components/ArtFooter.vue',
  'src/views/GalleryView.vue',
  'scripts/art-template-entry-contract.mjs',
  'scripts/publish-starter-demos.mjs',
  'scripts/templates/delivery-ui.mjs',
]
const sources = []
for (const relative of sourcePaths) {
  const bytes = await readFile(relative)
  const destination = path.join(out, 'source', relative)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, bytes)
  sources.push({ path: relative, sha256: hash(bytes) })
}
await writeFile(path.join(out, 'source-manifest.json'), JSON.stringify(sources, null, 2))
const catalogText = await readFile('src/content/starter-templates.ts', 'utf8')
const templates = JSON.parse(
  catalogText.match(/export const starterTemplates = ([\s\S]*?) as const/)[1],
)
const browser = await chromium.launch({ headless: true })
const report = {
  base,
  browser: browser.version(),
  scope:
    'Original starter entry and help, real local persistence and downloads; simulated touch/390px and injected network/quota failures; no commercial aesthetics, real devices or payment certification',
  cases: [],
  errors: [],
  uploads: [],
  passed: false,
}
const contexts = []
async function newPage(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
    acceptDownloads: true,
    ...options,
  })
  contexts.push(context)
  context.on('request', (request) => {
    if (request.method() === 'POST') report.uploads.push(request.url())
  })
  const page = await context.newPage()
  page.setDefaultTimeout(30000)
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('dialog', (dialog) => dialog.accept())
  return page
}
const modal = (page) => page.locator('dialog.template-dialog[open]')
async function details(page, template) {
  await page.goto(`${base}/templates`)
  await page.getByRole('button', { name: `查看${template.name}模板详情`, exact: true }).click()
  assert.equal(await modal(page).getByRole('heading', { level: 2 }).textContent(), template.name)
}
async function launch(page, template) {
  await details(page, template)
  await page.getByRole('button', { name: '用这个模板创作', exact: true }).click()
  await page.waitForURL(/\/ascii-art\?project=/)
  await ready(page)
  await page
    .locator('.save-status')
    .filter({ hasText: '已从此浏览器恢复' })
    .waitFor({ state: 'attached' })
  return new URL(page.url()).searchParams.get('project')
}
async function overflow(page) {
  assert(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    'Page overflow',
  )
  if (await modal(page).count())
    assert(
      await modal(page).evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      'Dialog overflow',
    )
}
async function screenshot(page, name) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(Array.from(document.images, (image) => image.decode().catch(() => {})))
  })
  await page.screenshot({ path: path.join(out, name), fullPage: true })
}
function passed(name, evidence = {}) {
  report.cases.push({ name, ...evidence })
  console.log(`PASS ${name}`)
}
try {
  // Assets are real downloads from the previous stage, not substituted marketing images.
  for (const template of templates)
    for (const asset of Object.values(template.assets)) {
      const bytes = await readFile(path.join('public', asset.path))
      assert.equal(bytes.length, asset.bytes)
      assert.equal(hash(bytes), asset.sha256)
    }
  passed('six-public-assets-exact')
  const page = await newPage()
  await page.goto(`${base}/templates`)
  assert.equal(await page.locator('.starter-card').count(), 3)
  for (const category of ['光影', '彩色', '中文']) {
    await page
      .getByRole('group', { name: '筛选模板' })
      .getByRole('button', { name: category, exact: true })
      .click()
    assert.equal(await page.locator('.starter-card').count(), 1)
  }
  await page.getByLabel('搜索模板').fill('不匹配')
  await page.getByRole('heading', { name: '没有找到匹配的模板' }).waitFor()
  await page.getByRole('button', { name: '重置筛选' }).click()
  assert.equal(await page.locator('.starter-card').count(), 3)
  await overflow(page)
  await screenshot(page, 'templates-desktop.png')
  passed('filter-search-reset')

  await details(page, templates[0])
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press(i < 4 ? 'Tab' : 'Shift+Tab')
    assert(
      await modal(page).evaluate((element) => element.contains(document.activeElement)),
      'Focus escaped dialog',
    )
  }
  await screenshot(page, 'details-desktop.png')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !document.querySelector('dialog[open]'))
  assert.equal(
    await page.evaluate(() => document.activeElement.getAttribute('aria-label')),
    `查看${templates[0].name}模板详情`,
  )
  passed('dialog-keyboard-focus-return')

  for (const template of templates) {
    const before = await database(page)
    const id = await launch(page, template)
    const records = await database(page)
    assert.equal(records.length, before.length + 1)
    for (const original of before)
      assert.deepEqual(
        records.find((item) => item.id === original.id),
        original,
      )
    const record = records.find((item) => item.id === id)
    const original = unpack(await readFile(path.join('public', template.assets.project.path)))
    assert.equal(record.sourceHash, hash(original.source))
    assert.deepEqual(record.settings, original.manifest.project.settings)
    assert.equal(record.engineVersion, template.engineVersion)
    assert.equal(await page.getByLabel('作品名称').inputValue(), template.name)
    const png = await exportFile(page, 'PNG', path.join(out, `${template.id}-original.png`))
    assert.equal(hash(png.bytes), template.assets.preview.sha256)
    if (template.category === '中文') await page.locator('input[maxlength="64"]').fill('万物有光')
    else
      await page.locator('input[type=file]').setInputFiles(path.resolve('public/artwork/pet.jpg'))
    await ready(page)
    await page.getByLabel('作品名称').fill(`${template.name} · 我的版本`)
    const edited = await download(
      page,
      () => page.locator('.editor-package').click(),
      path.join(out, `${template.id}-edited.astra`),
    )
    const editedProject = unpack(edited.bytes)
    if (template.category === '中文')
      assert.equal(editedProject.manifest.project.settings.phrase, '万物有光')
    else assert.notEqual(hash(editedProject.source), record.sourceHash)
    await page.locator('.editor-save').click()
    await page
      .locator('.save-status')
      .filter({ hasText: '已保存到此浏览器' })
      .waitFor({ state: 'attached' })
    const retained = await database(page)
    const duplicateId = await launch(page, template)
    assert.notEqual(duplicateId, id)
    const afterDuplicate = await database(page)
    assert.equal(afterDuplicate.length, retained.length + 1)
    for (const existing of retained)
      assert.deepEqual(
        afterDuplicate.find((item) => item.id === existing.id),
        existing,
      )
    passed(`${template.id}-create-edit-export-save-duplicate`, {
      originalSourceAndSettings: true,
      originalPngExact: true,
      actualEditedPackage: true,
      independentIdAndPreservation: true,
    })
  }

  await page.goto(`${base}/help`)
  await page.locator('.formats-section dt').first().waitFor()
  assert.equal(await page.locator('.formats-section dt').count(), 5)
  const summary = page.getByText('手机上怎样修改图片和文字？', { exact: true })
  await summary.focus()
  await page.keyboard.press('Enter')
  assert(await summary.evaluate((element) => element.parentElement.open))
  await page.goto(`${base}/templates`)
  await page.getByRole('link', { name: '了解保存与备份', exact: true }).click()
  await page.waitForURL(/\/help#save-and-backup$/)
  assert(
    await page
      .locator('#save-and-backup')
      .evaluate((element) => element.getBoundingClientRect().top < innerHeight),
  )
  await screenshot(page, 'help-desktop.png')
  passed('help-formats-faq-keyboard-backup-link')

  const failurePage = await newPage()
  await launch(failurePage, templates[2])
  const assetUrl = `${base}/${templates[0].assets.project.path}`
  const corrupt = await readFile(path.join('public', templates[0].assets.project.path))
  corrupt[corrupt.length - 1] ^= 1
  for (const failure of ['http-404', 'network', 'wrong-file', 'wrong-hash-same-length']) {
    const before = await database(failurePage)
    await failurePage.route(assetUrl, (route) =>
      failure === 'network'
        ? route.abort('failed')
        : route.fulfill({
            status: failure === 'http-404' ? 404 : 200,
            body: failure === 'wrong-hash-same-length' ? corrupt : 'not an Astra package',
          }),
    )
    await details(failurePage, templates[0])
    await failurePage.getByRole('button', { name: '用这个模板创作' }).click()
    await modal(failurePage).getByRole('alert').waitFor()
    assert.match(await modal(failurePage).getByRole('alert').textContent(), /模板.*(读取|不完整)/)
    assert.deepEqual(await database(failurePage), before)
    assert(await failurePage.getByRole('button', { name: '用这个模板创作' }).isEnabled())
    await failurePage.unroute(assetUrl)
    passed(`${failure}-no-write-retryable`)
  }
  let timeoutRelease, timeoutFinished
  const timeoutGate = new Promise((resolve) => {
    timeoutRelease = resolve
  })
  const timeoutDone = new Promise((resolve) => {
    timeoutFinished = resolve
  })
  await failurePage.route(assetUrl, async (route) => {
    await timeoutGate
    await route.continue().catch(() => {})
    timeoutFinished()
  })
  const beforeTimeout = await database(failurePage)
  await details(failurePage, templates[0])
  await failurePage.getByRole('button', { name: '用这个模板创作' }).click()
  await modal(failurePage).getByRole('alert').filter({ hasText: '模板读取超时' }).waitFor()
  assert.deepEqual(await database(failurePage), beforeTimeout)
  assert(await failurePage.getByRole('button', { name: '用这个模板创作' }).isEnabled())
  timeoutRelease()
  await timeoutDone
  await failurePage.unroute(assetUrl)
  passed('real-15s-timeout-no-write-retryable')
  await details(failurePage, templates[0])
  await failurePage.evaluate(() => {
    window.__starterPut = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('test quota', 'QuotaExceededError')
    }
  })
  const beforeQuota = await database(failurePage)
  await failurePage.getByRole('button', { name: '用这个模板创作' }).click()
  await modal(failurePage).getByRole('alert').filter({ hasText: '浏览器未能保存模板' }).waitFor()
  assert.deepEqual(await database(failurePage), beforeQuota)
  await failurePage.evaluate(() => {
    IDBObjectStore.prototype.put = window.__starterPut
  })
  await failurePage.getByRole('button', { name: '用这个模板创作' }).click()
  await failurePage.waitForURL(/\/ascii-art\?project=/)
  await ready(failurePage)
  assert.equal((await database(failurePage)).length, beforeQuota.length + 1)
  passed('quota-no-write-real-retry')

  // One physical activation cannot create multiple copies while the fetch is pending.
  await details(failurePage, templates[1])
  let release, fetched
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const started = new Promise((resolve) => {
    fetched = resolve
  })
  let requests = 0
  const heldUrl = `${base}/${templates[1].assets.project.path}`
  await failurePage.route(heldUrl, async (route) => {
    requests++
    fetched()
    await gate
    await route.continue().catch(() => {})
  })
  const retained = await database(failurePage)
  await failurePage.getByRole('button', { name: '用这个模板创作' }).click()
  await started
  assert(await failurePage.getByRole('button', { name: '正在准备…' }).isDisabled())
  await failurePage.keyboard.press('Escape')
  assert.equal(await modal(failurePage).count(), 1)
  await failurePage
    .locator('.launch-template')
    .evaluate((button) => button.dispatchEvent(new MouseEvent('click', { bubbles: true })))
  release()
  await failurePage.waitForURL(/\/ascii-art\?project=/)
  await ready(failurePage)
  assert.equal(requests, 1)
  assert.equal((await database(failurePage)).length, retained.length + 1)
  await failurePage.unroute(heldUrl)
  passed('pending-duplicate-and-escape-guard')

  await details(failurePage, templates[0])
  let lateRelease, lateFetched, lateFinished
  const lateGate = new Promise((resolve) => {
    lateRelease = resolve
  })
  const lateStarted = new Promise((resolve) => {
    lateFetched = resolve
  })
  const lateDone = new Promise((resolve) => {
    lateFinished = resolve
  })
  await failurePage.route(assetUrl, async (route) => {
    lateFetched()
    await lateGate
    await route.continue().catch(() => {})
    lateFinished()
  })
  const beforeLeave = await database(failurePage)
  await failurePage.getByRole('button', { name: '用这个模板创作' }).click()
  await lateStarted
  await failurePage.locator('.dialog-help').click()
  await failurePage.waitForURL(/\/help$/)
  lateRelease()
  await lateDone
  assert.deepEqual(await database(failurePage), beforeLeave)
  assert.match(failurePage.url(), /\/help$/)
  await failurePage.unroute(assetUrl)
  passed('unmount-aborts-late-template')

  for (const template of templates) {
    const mobile = await newPage({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
    await mobile.goto(`${base}/help`)
    await mobile.getByLabel('切换导航菜单').click()
    await mobile.locator('.art-header nav').getByRole('link', { name: '模板', exact: true }).click()
    await mobile.waitForURL(/\/templates$/)
    await overflow(mobile)
    if (template === templates[0]) await screenshot(mobile, 'templates-mobile.png')
    await mobile.getByRole('button', { name: `查看${template.name}模板详情`, exact: true }).click()
    await overflow(mobile)
    await screenshot(mobile, `${template.id}-details-mobile.png`)
    assert(
      await mobile.locator('.launch-template').evaluate((button) => {
        const action = button.getBoundingClientRect()
        const dialog = button.closest('dialog').getBoundingClientRect()
        return action.top >= dialog.top && action.bottom <= Math.min(dialog.bottom, innerHeight)
      }),
      'Primary creation action must be fully visible before scrolling',
    )
    await mobile.getByRole('button', { name: '用这个模板创作' }).click()
    await mobile.waitForURL(/\/ascii-art\?project=/)
    await ready(mobile)
    await mobile.getByRole('button', { name: '调整效果', exact: true }).click()
    if (template.category === '中文') await mobile.locator('input[maxlength="64"]').fill('流光入梦')
    else await setRange(mobile, '对比度', 0.35)
    await ready(mobile)
    await mobile.getByLabel('作品名称').fill(`${template.name}手机`)
    const png = await exportFile(mobile, 'PNG', path.join(out, `${template.id}-mobile.png`))
    assert.equal(Math.max(png.bytes.readUInt32BE(16), png.bytes.readUInt32BE(20)), 1080)
    assert.notEqual(hash(png.bytes), template.assets.preview.sha256)
    const backup = await download(
      mobile,
      async () => {
        await mobile.getByRole('button', { name: '素材与预设', exact: true }).click()
        await mobile.locator('.editor-package').click()
      },
      path.join(out, `${template.id}-mobile.astra`),
    )
    assert.equal(unpack(backup.bytes).manifest.project.name, `${template.name}手机`)
    await mobile
      .locator('.mobile-editor-tabs')
      .getByRole('button', { name: '保存项目', exact: true })
      .click()
    await mobile
      .locator('.save-status')
      .filter({ hasText: '已保存到此浏览器' })
      .waitFor({ state: 'attached' })
    await mobile.getByRole('link', { name: 'Astra 首页', exact: true }).click()
    await mobile.waitForURL(base + '/')
    await mobile.getByLabel('切换导航菜单').click()
    await mobile
      .locator('.art-header nav')
      .getByRole('link', { name: '我的项目', exact: true })
      .click()
    await mobile.waitForURL(/\/projects$/)
    await mobile.locator('.project-open').first().waitFor()
    await mobile.locator('.project-open').first().click()
    await ready(mobile)
    assert.equal(await mobile.getByLabel('作品名称').inputValue(), `${template.name}手机`)
    await overflow(mobile)
    passed(`${template.id}-390px-navigation-create-export-backup-reopen`, {
      actualPngAndPackage: true,
      noOverflow: true,
      primaryActionFullyVisible: true,
    })
  }
  const motionPage = await newPage({ reducedMotion: 'no-preference' })
  await motionPage.goto(`${base}/templates`)
  await motionPage.locator('.template-next').scrollIntoViewIfNeeded()
  await motionPage.locator('.template-next.is-revealed').waitFor()
  const image = motionPage.locator('.template-preview img').first()
  await image.hover()
  await motionPage.waitForFunction(
    () => getComputedStyle(document.querySelector('.template-preview img')).transform !== 'none',
  )
  assert.equal(
    await motionPage
      .locator('.starter-card-title h3')
      .first()
      .evaluate((element) => getComputedStyle(element).transform),
    'none',
  )
  await motionPage.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await image.evaluate((element) => getComputedStyle(element).transform), 'none')
  await motionPage.goto(`${base}/help`)
  await motionPage.locator('.help-heading h1').waitFor()
  assert.equal(await motionPage.locator('[data-reveal]').count(), 4)
  assert(
    await motionPage
      .locator('[data-reveal]')
      .evaluateAll((elements) =>
        elements.every((element) => getComputedStyle(element).opacity === '1'),
      ),
  )
  await overflow(motionPage)
  await screenshot(motionPage, 'help-top-desktop.png')
  await motionPage.setViewportSize({ width: 390, height: 844 })
  await overflow(motionPage)
  await screenshot(motionPage, 'help-mobile.png')
  passed('native-reveal-hover-no-text-transform-reduced-motion')
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.uploads, [])
  report.passed = true
  console.log(
    `PASS ${report.cases.length} template entry/help tasks; no uploads or runtime exceptions`,
  )
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  console.error(error)
  process.exitCode = 1
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  for (const context of contexts) await context.close()
  await browser.close()
}
