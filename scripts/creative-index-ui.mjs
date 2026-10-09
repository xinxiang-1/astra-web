import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { openSignatureSection } from './signature-ui-helpers.mjs'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:4210'
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const mobile = process.env.ASTRA_CREATIVE_MOBILE === '1'
const out = `test-results/creative-index-ui-${channel}${mobile ? '-mobile' : ''}`
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel, headless: true })
const report = { base, browser: browser.version(), mobile, cases: [], errors: [] }
let page
try {
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  page = await context.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  const rows = async (target = page, store = 'creative-index') =>
    target.evaluate(async (store) => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('astra-art-projects')
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction(store)
          const r = tx.objectStore(store).getAll()
          r.onsuccess = () => resolve(r.result)
          tx.onabort = () => reject(tx.error)
        })
      } finally {
        db.close()
      }
    }, store)
  const ready = async () => {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent.trim() === '生成预览' && !b.disabled,
        ),
      null,
      { timeout: 90000 },
    )
    assert.equal(await page.locator('.error').count(), 0)
  }
  const signatureInput = () => page.locator('input[type=file][accept=".astra-signature"]')
  const json = async (name) => {
    await openSignatureSection(page, '矢量导出')
    const event = page.waitForEvent('download', { timeout: 90000 })
    await page.getByRole('button', { name: '下载矢量 JSON', exact: true }).click()
    const download = await event
    await download.saveAs(`${out}/${name}.json`)
    await ready()
    return JSON.parse(await readFile(`${out}/${name}.json`))
  }
  const listReady = async () => {
    await page.locator('.projects-heading h1').waitFor()
    await page.waitForFunction(
      () => !document.querySelector('.projects-main [role=status]')?.textContent?.includes('读取'),
    )
    await page.locator('.project-card').first().waitFor()
  }
  const openCard = async (id) => {
    await page.locator(`.project-open[href*="signature=${id}"]`).click()
    await page
      .getByText('作品已恢复，可继续调整并保存。原设备的名字库保持原样。', { exact: true })
      .waitFor({ timeout: 90000 })
    await ready()
  }
  await page.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  await signatureInput().setInputFiles(
    'docs/validation/2026-10-09/creative-workflow/source.astra-signature',
  )
  await ready()
  const original = await json('original')
  await page.getByRole('button', { name: '保存到我的项目', exact: true }).click()
  await ready()
  const first = (await rows()).find((p) => p.kind === 'signature')
  assert(first)
  await page.getByRole('button', { name: '保存到我的项目', exact: true }).click()
  await ready()
  assert.equal((await rows()).length, 1)
  report.cases.push('local-save-and-identical-snapshot-deduplication')
  await page.getByRole('link', { name: '查看我的项目', exact: true }).click()
  await listReady()
  await page.getByRole('button', { name: '签名', exact: true }).click()
  assert.equal(await page.locator('.project-card').count(), 1)
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载作品包', exact: true }).click()
  await (await downloading).saveAs(out + '/original.astra-signature')
  await page.locator('input[type=file]').setInputFiles(out + '/original.astra-signature')
  await page
    .getByText('签名原作已保存到我的项目，可继续编辑。相同版本不会重复添加。', { exact: true })
    .waitFor()
  assert.equal((await rows()).length, 1)
  await openCard(first.id)
  assert.deepEqual((await json('restored-original')).placements, original.placements)
  report.cases.push('signature-filter-card-restore-and-backup-import')
  await page.getByLabel('笔迹颜色', { exact: true }).selectOption('custom')
  await page.getByLabel('自定义墨色', { exact: true }).evaluate((el) => {
    el.value = '#1070a8'
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(400)
  await ready()
  const changed = await json('changed')
  assert.deepEqual(changed.renderOptions.ink, { r: 16, g: 112, b: 168 })
  await page.getByRole('button', { name: '保存到我的项目', exact: true }).click()
  await ready()
  const second = (await rows()).find((p) => p.kind === 'signature' && p.id !== first.id)
  assert(second && second.signatureHash !== first.signatureHash)
  await page.getByRole('link', { name: '查看我的项目', exact: true }).click()
  await listReady()
  await openCard(first.id)
  assert.deepEqual((await json('old-version')).placements, original.placements)
  report.cases.push('changed-snapshot-keeps-reopenable-old-version')
  await openSignatureSection(page, '继续创作')
  await page.getByRole('button', { name: '创建动态字符项目', exact: true }).click()
  const derivedLink = page.getByRole('link', { name: '打开动态字符项目', exact: true })
  await derivedLink.waitFor({ timeout: 90000 })
  const derived = (await rows()).find((p) => p.kind === 'image')
  assert.equal(derived.origin.projectId, first.id)
  assert.equal(derived.origin.sha256, first.signatureHash)
  assert.equal((await rows()).length, 3)
  const popup = page.waitForEvent('popup')
  await derivedLink.click()
  const ascii = await popup
  ascii.on('pageerror', (e) => report.errors.push(e.message))
  await ascii.waitForFunction(
    () => document.querySelector('.ascii-canvas')?.dataset.quality === 'faithful',
    null,
    { timeout: 90000 },
  )
  if (mobile) await ascii.getByRole('button', { name: '调整效果', exact: true }).click()
  const recipes = ascii.locator('details.calibrated-effects')
  if (!(await recipes.evaluate((el) => el.open))) await recipes.locator('summary').click()
  await ascii.locator('#art-recipe').selectOption('hologram')
  await ascii.getByRole('button', { name: '保存项目', exact: true }).first().click()
  await ascii.getByText('已保存到此浏览器', { exact: true }).first().waitFor({ state: 'attached' })
  const stored = (await rows(ascii, 'projects')).find((p) => p.id === derived.id)
  assert.deepEqual(stored.origin, derived.origin)
  assert.equal(stored.settings.artMotion, 'caustics')
  report.cases.push('atomic-derivative-and-origin-survive-editor-save')
  if (mobile) await ascii.getByRole('button', { name: '素材与预设', exact: true }).tap()
  const artDownload = ascii.waitForEvent('download', { timeout: 90000 })
  await ascii.getByRole('button', { name: '下载作品包', exact: true }).click()
  await (await artDownload).saveAs(out + '/derivative.astra')
  await page.getByRole('link', { name: '查看我的项目', exact: true }).click()
  await listReady()
  assert.equal(await page.getByRole('link', { name: /打开签名原作/ }).count(), 1)
  await page.getByRole('link', { name: /打开签名原作/ }).click()
  await ready()
  assert.deepEqual((await json('origin-link')).placements, original.placements)
  report.cases.push('project-list-opens-exact-signature-origin')
  // A fresh browser gets the portable description, without pretending to have the original.
  const other = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  const imported = await other.newPage()
  imported.on('pageerror', (e) => report.errors.push(e.message))
  await imported.goto(base + '/projects', { waitUntil: 'domcontentloaded' })
  await imported.locator('input[type=file]').setInputFiles(out + '/derivative.astra')
  await imported.locator('.project-card').waitFor()
  assert.equal(await imported.getByRole('link', { name: /打开签名原作/ }).count(), 0)
  assert.equal(await imported.getByText(/原作未保存在此浏览器/).count(), 1)
  assert.deepEqual((await rows(imported)).find((p) => p.kind === 'image').origin, derived.origin)
  await other.close()
  report.cases.push('portable-art-package-keeps-origin-and-shows-missing-original')
  // Delay a real project read, then cancel it. The previous complete scene must remain.
  await page.evaluate(() => {
    window.indexNativeBuffer = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = async function () {
      if (
        window.indexHoldAny ||
        (window.indexHold && this instanceof File && this.name === 'signature.astra-signature')
      ) {
        window.indexHoldAny = false
        window.indexHold = false
        window.indexWaiting = true
        await new Promise((resolve) => {
          window.indexRelease = resolve
        })
      }
      return window.indexNativeBuffer.call(this)
    }
  })
  await page.evaluate(() => {
    window.indexHoldAny = true
    window.indexWaiting = false
  })
  await signatureInput().setInputFiles(out + '/original.astra-signature')
  await page.waitForFunction(() => window.indexWaiting)
  await page.getByRole('button', { name: '取消文件操作', exact: true }).click()
  await page.evaluate(() => window.indexRelease())
  await ready()
  assert.deepEqual((await json('after-cancel')).placements, original.placements)
  report.cases.push('cancelled-replacement-keeps-previous-complete-scene')
  await page.getByRole('link', { name: '查看我的项目', exact: true }).click()
  await listReady()
  await page.evaluate(() => {
    window.indexHold = true
    window.indexWaiting = false
  })
  await page.locator(`.project-open[href*="signature=${second.id}"]`).click()
  await page.waitForFunction(() => window.indexWaiting)
  // Restore an initial complete scene while no local read is in flight on this instance.
  await page.getByRole('button', { name: '取消文件操作', exact: true }).click()
  await page.evaluate(() => window.indexRelease())
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent.trim() === '打开作品文件' && !b.disabled,
    ),
  )
  await signatureInput().setInputFiles(out + '/original.astra-signature')
  await ready()
  // A malformed replacement keeps this complete scene available.
  await signatureInput().setInputFiles({
    name: 'invalid.astra-signature',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('broken'),
  })
  await page.locator('.error').waitFor()
  await openSignatureSection(page, '矢量导出')
  const failDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '下载矢量 JSON', exact: true }).click()
  await (await failDownload).saveAs(out + '/after-failure.json')
  assert.deepEqual(
    JSON.parse(await readFile(out + '/after-failure.json')).placements,
    original.placements,
  )
  report.cases.push('cancelled-local-read-and-malformed-file-preserve-complete-scene')
  await page.getByRole('link', { name: '我的项目', exact: true }).first().click()
  await listReady()
  await page.evaluate(() => {
    window.indexHold = true
    window.indexWaiting = false
  })
  await page.locator(`.project-open[href*="signature=${first.id}"]`).click()
  await page.waitForFunction(() => window.indexWaiting)
  await page.getByRole('link', { name: '我的项目', exact: true }).first().click()
  await listReady()
  await openCard(second.id)
  await page.evaluate(() => window.indexRelease())
  assert.deepEqual((await json('after-late-read')).placements, changed.placements)
  report.cases.push('late-unmounted-read-cannot-replace-newly-opened-version')
  // Removing a source leaves the independently editable derivative.
  await page.goto(base + '/projects', { waitUntil: 'domcontentloaded' })
  await listReady()
  const firstCard = page
    .locator('.project-card')
    .filter({ has: page.locator(`.project-open[href*="signature=${first.id}"]`) })
  await firstCard.getByRole('button', { name: '删除', exact: true }).click()
  await firstCard.getByText('删除原作？已有派生作品保留。', { exact: true }).waitFor()
  await firstCard.getByRole('button', { name: '确认删除', exact: true }).click()
  await firstCard.waitFor({ state: 'detached' })
  assert.equal((await rows()).length, 2)
  assert.equal(await page.getByRole('link', { name: /打开签名原作/ }).count(), 0)
  assert.equal(await page.getByText(/原作未保存在此浏览器/).count(), 1)
  await ascii.reload({ waitUntil: 'domcontentloaded' })
  await ascii.waitForFunction(() => !!document.querySelector('.ascii-canvas'), null, {
    timeout: 90000,
  })
  if (mobile) await ascii.getByRole('button', { name: '素材与预设', exact: true }).tap()
  const independent = ascii.waitForEvent('download')
  await ascii.getByRole('button', { name: '下载作品包', exact: true }).click()
  await (await independent).saveAs(out + '/independent.astra')
  report.cases.push('delete-original-keeps-derivative-openable-and-exportable')
  // Changing source material ends the provenance relationship.
  await ascii
    .locator('input[type=file]')
    .first()
    .setInputFiles('public/artwork/portrait-reference.png')
  await ascii.waitForTimeout(400)
  await ascii.waitForFunction(() => !!document.querySelector('.ascii-canvas'), null, {
    timeout: 90000,
  })
  await ascii.getByRole('button', { name: '保存项目', exact: true }).first().click()
  await ascii.getByText('已保存到此浏览器', { exact: true }).first().waitFor({ state: 'attached' })
  assert.equal((await rows(ascii, 'projects')).find((p) => p.id === derived.id).origin, undefined)
  report.cases.push('new-source-clears-signature-provenance')
  const themes = ['dark', 'light']
  for (const theme of themes) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme)
    assert(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'project list overflows',
    )
    for (const element of await page
      .locator('.project-heading-actions button, .projects-tools button, .project-origin')
      .all()) {
      const box = await element.boundingBox()
      assert(
        box && box.x >= 0 && box.x + box.width <= (mobile ? 391 : 1441),
        'new project controls overflow',
      )
    }
    await page.screenshot({ path: `${out}/projects-${theme}.png`, fullPage: true })
  }
  report.cases.push('project-list-both-themes-and-responsive-control-bounds')
  assert.deepEqual(report.errors, [])
  console.log(JSON.stringify(report))
} catch (error) {
  report.failure = String(error)
  if (page) await page.screenshot({ path: out + '/failure.png', fullPage: true }).catch(() => {})
  throw error
} finally {
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
