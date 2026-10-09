import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { openSignatureSection } from './signature-ui-helpers.mjs'
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:4210'
const channel = process.env.ASTRA_BROWSER_CHANNEL || 'msedge'
const mobile = process.env.ASTRA_CREATIVE_MOBILE === '1'
const out = `test-results/workflow-package-ui-${channel}${mobile ? '-mobile' : ''}`
const fixture = process.env.ASTRA_WORKFLOW_FIXTURE || `test-results/workflow-package-core-${channel}/source.astra-signature`
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel, headless: true })
const report = { base, browser: browser.version(), mobile, cases: [], errors: [] }
let target
try {
  const options = {
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 960 },
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'reduce',
    acceptDownloads: true,
  }
  const sourceContext = await browser.newContext(options),
    source = await sourceContext.newPage()
  source.on('pageerror', (e) => report.errors.push(e.message))
  const activate = (locator) => (mobile ? locator.tap() : locator.click())
  const signatureReady = async (page) => {
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
  const rows = (page, store = 'creative-index') =>
    page.evaluate(async (store) => {
      const db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('astra-art-projects')
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      try {
        return await new Promise((resolve) => {
          const r = db.transaction(store).objectStore(store).getAll()
          r.onsuccess = () => resolve(r.result)
        })
      } finally {
        db.close()
      }
    }, store)
  const listReady = async (page) => {
    await page.locator('.projects-heading h1').waitFor()
    await page.locator('.project-card').first().waitFor()
  }
  const toProjects = async (page) => {
    // App modules are warmed by SPA navigation; the setup does not create any saved art.
    await page.evaluate(() => document.querySelector('a[href="/projects"]').click())
    await page.locator('.projects-heading h1').waitFor()
  }
  const importWorkflow = async (page) => {
    await page.locator('input[type=file]').setInputFiles(out + '/workflow.astra-workflow')
    await page.waitForFunction(
      () => document.querySelector('.package-status')?.textContent.includes('已导入'),
      null,
      { timeout: 90000 },
    )
    await listReady(page)
    assert.equal(await page.locator('.art-error').count(), 0)
  }
  const downloadSignatureJson = async (page, name) => {
    await openSignatureSection(page, '矢量导出')
    const event = page.waitForEvent('download')
    await activate(page.getByRole('button', { name: '下载矢量 JSON', exact: true }))
    await (await event).saveAs(out + '/' + name + '.json')
    return JSON.parse(await readFile(out + '/' + name + '.json'))
  }
  await source.goto(base + '/signature-portrait', { waitUntil: 'domcontentloaded' })
  await source.locator('input[type=file][accept=".astra-signature"]').setInputFiles(fixture)
  await signatureReady(source)
  const expectedSignature = await downloadSignatureJson(source, 'source')
  await openSignatureSection(source, '继续创作')
  await source.getByLabel('动态字符配方', { exact: true }).selectOption('hologram')
  await activate(source.getByRole('button', { name: '创建动态字符项目', exact: true }))
  await source
    .getByRole('link', { name: '打开动态字符项目', exact: true })
    .waitFor({ timeout: 90000 })
  await activate(source.getByRole('link', { name: '查看我的项目', exact: true }))
  await listReady(source)
  const expectedArt = (await rows(source, 'projects'))[0]
  assert.equal(expectedArt.settings.artMotion, 'caustics')
  const downloading = source.waitForEvent('download', { timeout: 90000 })
  await activate(source.getByRole('button', { name: '下载完整工作流', exact: true }))
  await (await downloading).saveAs(out + '/workflow.astra-workflow')
  assert(
    (await readFile(out + '/workflow.astra-workflow')).byteLength >
      (await readFile(fixture)).byteLength,
  )
  report.cases.push('production-download-contains-original-and-real-character-project')
  const context = await browser.newContext(options)
  target = await context.newPage()
  target.on('pageerror', (e) => report.errors.push(e.message))
  await target.goto(base + '/projects', { waitUntil: 'domcontentloaded' })
  await activate(target.getByRole('link', { name: '签名画像', exact: true }))
  await target.getByRole('button', { name: '打开作品文件', exact: true }).waitFor()
  await toProjects(target)
  await activate(target.getByRole('link', { name: '新建作品', exact: true }))
  await target
    .getByRole('button', { name: '保存项目', exact: true })
    .first()
    .waitFor({ state: 'attached' })
  await toProjects(target)
  await context.setOffline(true)
  await importWorkflow(target)
  const initial = await rows(target),
    firstArt = initial.find((p) => p.kind === 'image'),
    original = initial.find((p) => p.kind === 'signature')
  assert.equal(initial.length, 2)
  assert.equal(firstArt.origin.projectId, original.id)
  assert.equal(firstArt.origin.sha256, original.signatureHash)
  const receivedArt = (await rows(target, 'projects'))[0]
  assert.deepEqual(receivedArt.settings, expectedArt.settings)
  await importWorkflow(target)
  assert.equal((await rows(target)).length, 2)
  report.cases.push('fresh-browser-offline-import-and-repeat-deduplication')
  await activate(target.getByRole('link', { name: /打开签名原作/ }))
  await target
    .getByText('作品已恢复，可继续调整并保存。原设备的名字库保持原样。', { exact: true })
    .waitFor({ timeout: 90000 })
  await signatureReady(target)
  const receivedSignature = await downloadSignatureJson(target, 'restored-signature')
  assert.deepEqual(receivedSignature.placements, expectedSignature.placements)
  assert.deepEqual(receivedSignature.renderOptions, expectedSignature.renderOptions)
  report.cases.push('offline-signature-restores-real-font-stamps-layout-and-options')
  await activate(target.getByRole('link', { name: '查看我的项目', exact: true }))
  await listReady(target)
  await activate(target.locator(`.project-open[href*="project=${firstArt.id}"]`))
  await target.waitForFunction(() => !!document.querySelector('.ascii-canvas'), null, {
    timeout: 90000,
  })
  await target.getByText('已从此浏览器恢复', { exact: true }).first().waitFor({ state: 'attached' })
  await activate(target.getByRole('button', { name: '保存项目', exact: true }).first())
  await target.getByText('已保存到此浏览器', { exact: true }).first().waitFor({ state: 'attached' })
  await toProjects(target)
  await importWorkflow(target)
  const noChange = await rows(target)
  await writeFile(
    out + '/unchanged-save-diagnostic.json',
    JSON.stringify(
      {
        expected: expectedArt.settings,
        saved: (await rows(target, 'projects')).find((p) => p.id === firstArt.id).settings,
        counts: noChange.length,
      },
      null,
      2,
    ) + '\n',
  )
  assert.equal(noChange.length, 2, 'An unchanged editor save created a duplicate backup version')
  report.cases.push('unchanged-production-editor-save-keeps-import-receipt')
  await activate(target.locator(`.project-open[href*="project=${firstArt.id}"]`))
  await target.waitForFunction(() => !!document.querySelector('.ascii-canvas'), null, {
    timeout: 90000,
  })
  await target.getByText('已从此浏览器恢复', { exact: true }).first().waitFor({ state: 'attached' })
  if (mobile) await activate(target.getByRole('button', { name: '调整效果', exact: true }))
  const recipes = target.locator('details.calibrated-effects')
  if (!(await recipes.evaluate((el) => el.open))) await activate(recipes.locator('summary'))
  await target.locator('#art-recipe').selectOption('glyph-bloom')
  await activate(target.getByRole('button', { name: '保存项目', exact: true }).first())
  await target.getByText('已保存到此浏览器', { exact: true }).first().waitFor({ state: 'attached' })
  assert.equal(
    (await rows(target, 'projects')).find((p) => p.id === firstArt.id).settings.artMotion,
    'reform',
  )
  await toProjects(target)
  await importWorkflow(target)
  const afterEdit = await rows(target),
    restoredArt = afterEdit.find((p) => p.kind === 'image' && p.id !== firstArt.id)
  assert.equal(afterEdit.length, 3)
  assert(restoredArt)
  assert.equal(
    (await rows(target, 'projects')).find((p) => p.id === firstArt.id).settings.artMotion,
    'reform',
  )
  assert.deepEqual(
    (await rows(target, 'projects')).find((p) => p.id === restoredArt.id).settings,
    expectedArt.settings,
  )
  await importWorkflow(target)
  assert.equal((await rows(target)).length, 3)
  report.cases.push('edited-production-copy-preserved-and-backup-restored-separately')
  const broken = await readFile(out + '/workflow.astra-workflow')
  broken[broken.length - 1] ^= 1
  await target
    .locator('input[type=file]')
    .setInputFiles({
      name: 'broken.astra-workflow',
      mimeType: 'application/octet-stream',
      buffer: broken,
    })
  await target.locator('.art-error').waitFor()
  assert.equal((await rows(target)).length, 3)
  report.cases.push('bad-workflow-import-keeps-existing-projects')
  // A held old read is cancelled immediately; a new import must retain ownership of status/busy.
  await target.evaluate(() => {
    window.wfNativeBuffer = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = async function () {
      if (window.wfHold) {
        window.wfHold = false
        window.wfWaiting = true
        await new Promise((resolve) => {
          window.wfRelease = resolve
        })
      }
      return window.wfNativeBuffer.call(this)
    }
    window.wfHold = true
    window.wfWaiting = false
  })
  await target.locator('input[type=file]').setInputFiles(out + '/workflow.astra-workflow')
  await target.waitForFunction(() => window.wfWaiting)
  await activate(target.getByRole('button', { name: '取消文件操作', exact: true }))
  assert.equal(
    await target.getByRole('button', { name: '导入作品包', exact: true }).isEnabled(),
    true,
  )
  await importWorkflow(target)
  await target.evaluate(() => window.wfRelease())
  await target.waitForTimeout(100)
  assert.equal((await rows(target)).length, 3)
  assert((await target.locator('.package-status').innerText()).includes('已导入'))
  assert.equal(await target.locator('.art-error').count(), 0)
  report.cases.push('cancelled-old-read-cannot-clear-new-import-result')
  const originalCard = target
    .locator('.project-card')
    .filter({ has: target.locator(`.project-open[href*="signature=${original.id}"]`) })
  await activate(originalCard.getByRole('button', { name: '删除', exact: true }))
  await activate(originalCard.getByRole('button', { name: '确认删除', exact: true }))
  await originalCard.waitFor({ state: 'detached' })
  assert.equal(await target.getByRole('button', { name: '下载完整工作流', exact: true }).count(), 0)
  await importWorkflow(target)
  assert.equal((await rows(target)).length, 3)
  assert.equal(await target.getByRole('link', { name: /打开签名原作/ }).count(), 2)
  report.cases.push('deleted-original-recovered-and-derivatives-remain-usable')
  for (const theme of ['dark', 'light']) {
    await target.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme)
    assert(
      await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'workflow list overflows',
    )
    for (const element of await target
      .locator('.workflow-actions button, .workflow-actions small')
      .all()) {
      const box = await element.boundingBox()
      assert(
        box && box.x >= 0 && box.x + box.width <= (mobile ? 391 : 1441),
        'workflow action overflows',
      )
    }
    await target.screenshot({ path: `${out}/workflow-${theme}.png`, fullPage: true })
  }
  report.cases.push('both-themes-and-touch-control-bounds')
  assert.equal(report.cases.length, 9)
  assert.deepEqual(report.errors, [])
  console.log(JSON.stringify(report))
} catch (error) {
  report.failure = String(error)
  if (target)
    await target.screenshot({ path: out + '/failure.png', fullPage: true }).catch(() => {})
  throw error
} finally {
  await writeFile(out + '/report.json', JSON.stringify(report, null, 2) + '\n')
  await browser.close()
}
