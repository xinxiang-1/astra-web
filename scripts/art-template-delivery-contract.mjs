import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { starterRecipes } from './templates/starter-source-art.mjs'
import {
  hash,
  ready,
  setRange,
  exportFile,
  download,
  unpack,
  database,
} from './templates/delivery-ui.mjs'
import { deliveryFiles, safeRelativePath } from './templates/delivery-files.mjs'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5194'
const pack = path.resolve(process.env.ASTRA_TEMPLATE_PACK || 'output/astra-starter-pack-v1')
const out = path.resolve(
  process.env.ASTRA_TEMPLATE_CONTRACT_OUTPUT ||
    'sandbox/template-delivery/2026-10-02-v1/contract-production',
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out, { recursive: false })
const scripts = [
  'scripts/art-template-delivery-contract.mjs',
  'scripts/templates/starter-source-art.mjs',
  'scripts/templates/delivery-ui.mjs',
  'scripts/templates/delivery-files.mjs',
  'scripts/templates/verify-delivery.ps1',
]
const sourceManifest = []
for (const relative of scripts) {
  const bytes = await readFile(relative),
    dest = path.join(out, 'source', relative)
  await mkdir(path.dirname(dest), { recursive: true })
  await writeFile(dest, bytes)
  sourceManifest.push({ path: relative, sha256: hash(bytes) })
}
await writeFile(path.join(out, 'source-manifest.json'), JSON.stringify(sourceManifest, null, 2))
const report = {
  base,
  pack,
  scope:
    'Three original geometric templates; real Chromium UI/download/storage and offline file playback, simulated 390px touch; not natural-photo/Chinese/signature commercial quality or real-device/cross-browser certification',
  cases: [],
  rejected: [],
  errors: [],
  uploads: [],
  passed: false,
}
const browser = await chromium.launch({ headless: true })
report.browser = browser.version()
let activePage
function observe(page, nativeDiscard = false) {
  activePage = page
  page.setDefaultTimeout(30000)
  page.setDefaultNavigationTimeout(60000)
  page.on('pageerror', (error) => report.errors.push(error.message))
  page.on('request', (request) => {
    if (request.method() === 'POST') report.uploads.push(request.url())
  })
  if (nativeDiscard) page.on('dialog', (dialog) => dialog.accept())
}
let verifierFailureCount = 0
function verify(root, zip) {
  const args = [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(pack, 'VERIFY.ps1'),
    '-PackageRoot',
    root,
  ]
  if (zip) args.push('-ZipPath', zip)
  try {
    return JSON.parse(
      execFileSync('powershell.exe', args, {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000,
        maxBuffer: 1024 * 1024,
      }),
    )
  } catch (error) {
    const stderr = String(error.stderr || error.message)
    writeFileSync(path.join(out, `verifier-error-${++verifierFailureCount}.txt`), stderr)
    throw new Error(stderr.slice(0, 1000))
  }
}
async function importAndWait(page, bytes, count) {
  await page.locator('input[aria-label="导入 Astra 作品包"]').setInputFiles({
    name: 'template.astra',
    mimeType: 'application/x-astra-project',
    buffer: bytes,
  })
  await page.locator('.package-status').filter({ hasText: '导入成功' }).waitFor()
  for (let i = 0; i < 100; i++) {
    const projects = await database(page)
    if (projects.length === count) return projects
    await page.waitForTimeout(100)
  }
  throw new Error('Template import did not commit the expected number of projects')
}
const canvasHash = async (page) =>
  hash(await page.locator('canvas').evaluate((canvas) => canvas.toDataURL()))
try {
  const metadata = JSON.parse(await readFile(path.join(pack, 'manifest.json'), 'utf8'))
  assert.equal(metadata.schemaVersion, 1)
  assert.equal(metadata.engineVersion, '2.2.0')
  assert.equal(metadata.templates.length, 3)
  assert.equal(
    hash(await readFile(path.join(pack, 'VERIFY.ps1'))),
    hash(await readFile('scripts/templates/verify-delivery.ps1')),
    'Verify the actual shipped tool, not a newer repository substitute',
  )
  const assetPaths = metadata.assets.map((asset) => safeRelativePath(asset.path))
  assert.equal(new Set(assetPaths).size, assetPaths.length)
  assert.deepEqual(await deliveryFiles(pack), [...assetPaths, 'manifest.json'].sort())
  for (const asset of metadata.assets) {
    const bytes = await readFile(path.join(pack, asset.path))
    assert.equal(bytes.length, asset.bytes)
    assert.equal(hash(bytes), asset.sha256)
  }
  report.archive = verify(pack, pack + '.zip')
  assert(report.archive.passed && report.archive.zipChecked)
  const zipBytes = await readFile(pack + '.zip')
  assert.equal((await readFile(pack + '.zip.sha256', 'utf8')).split(/\s/)[0], hash(zipBytes))
  report.archive.sha256 = hash(zipBytes)
  // Tampering is checked with the independent .NET verifier, in separate copies of the sample.
  for (const [name, mutate] of [
    [
      'changed-asset',
      async (root) => {
        const file = path.join(root, 'templates/orbital-light/source.png')
        await writeFile(file, Buffer.concat([await readFile(file), Buffer.from([1])]))
      },
    ],
    [
      'wrong-hash',
      async (root) => {
        const file = path.join(root, 'manifest.json'),
          m = JSON.parse(await readFile(file))
        m.assets[0].sha256 = '0'.repeat(64)
        await writeFile(file, JSON.stringify(m))
      },
    ],
    [
      'path-traversal',
      async (root) => {
        const file = path.join(root, 'manifest.json'),
          m = JSON.parse(await readFile(file))
        m.assets[0].path = '../escape.png'
        await writeFile(file, JSON.stringify(m))
      },
    ],
    [
      'unlisted-file',
      async (root) => {
        await writeFile(path.join(root, 'extra.txt'), 'unexpected')
      },
    ],
  ]) {
    const root = path.join(out, 'rejections', name)
    await cp(pack, root, { recursive: true, errorOnExist: true, force: false })
    await mutate(root)
    let rejected = false
    try {
      verify(root)
    } catch (error) {
      rejected = true
      await writeFile(
        path.join(out, 'rejections', name + '.txt'),
        String(error.stderr || error.message),
      )
    }
    assert(rejected, name)
    report.rejected.push({ name, rejected: true, verifier: 'independent .NET/PowerShell' })
  }
  const brokenZip = Buffer.from(zipBytes),
    sourceBytes = await readFile(path.join(pack, 'templates/orbital-light/source.png'))
  const zipSourceOffset = brokenZip.indexOf(sourceBytes)
  assert(zipSourceOffset > 0)
  brokenZip[zipSourceOffset + 40] ^= 1
  const brokenZipPath = path.join(out, 'rejections/changed-archive.zip')
  await writeFile(brokenZipPath, brokenZip)
  let rejected = false
  try {
    verify(pack, brokenZipPath)
  } catch (error) {
    rejected = true
    await writeFile(
      path.join(out, 'rejections/changed-archive.txt'),
      String(error.stderr || error.message),
    )
  }
  assert(rejected, 'archive tamper')
  report.rejected.push({
    name: 'changed-archive',
    rejected: true,
    verifier: 'independent .NET ZipArchive',
  })
  for (const recipe of starterRecipes) {
    const directory = path.join(pack, 'templates', recipe.id),
      projectBytes = await readFile(path.join(directory, 'project.astra'))
    const definition = JSON.parse(await readFile(path.join(directory, 'recipe.json'), 'utf8'))
    const { manifest, source } = unpack(projectBytes)
    assert.equal(manifest.version, 1)
    assert.equal(definition.projectPackageSchema, 1)
    assert.equal(definition.engineVersion, manifest.engine.version)
    assert.equal(definition.templateId, recipe.id)
    assert.equal(definition.templateVersion, '1.0.0')
    assert.deepEqual(definition.settings, manifest.project.settings)
    assert.equal(hash(source), hash(await readFile(path.join(directory, 'source.png'))))
    const context = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      reducedMotion: 'reduce',
      acceptDownloads: true,
    })
    const page = await context.newPage()
    observe(page, true)
    await page.goto(base + '/projects', { waitUntil: 'domcontentloaded' })
    assert.equal((await database(page)).length, 0)
    const first = (await importAndWait(page, projectBytes, 1))[0]
    assert.deepEqual(first.settings, definition.settings)
    assert.equal(first.sourceHash, definition.source.sha256)
    assert.equal(first.engineVersion, '2.2.0')
    const duplicated = await importAndWait(page, projectBytes, 2)
    assert.equal(new Set(duplicated.map((project) => project.id)).size, 2)
    assert.deepEqual(
      duplicated.find((project) => project.id === first.id),
      first,
    )
    await page.goto(`${base}/ascii-art?project=${first.id}`, { waitUntil: 'domcontentloaded' })
    await page.locator('.save-status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
    await ready(page, recipe.mode)
    const restored = await exportFile(page, 'PNG', path.join(out, recipe.id + '-restored.png'))
    const original = await readFile(path.join(directory, 'preview.png'))
    assert.equal(hash(restored.bytes), hash(original), recipe.id + ': restored PNG differs')
    assert.equal(Math.max(original.readUInt32BE(16), original.readUInt32BE(20)), 1080)
    if (recipe.mode === 'phrase') await page.locator('input[maxlength="64"]').fill('万物有光')
    else {
      const alternate = starterRecipes.find((candidate) => candidate.id !== recipe.id)
      await page
        .locator('input[type=file]')
        .setInputFiles(path.join(pack, 'templates', alternate.id, 'source.png'))
    }
    await ready(page, recipe.mode)
    const edited = await exportFile(page, 'PNG', path.join(out, recipe.id + '-edited.png'))
    assert.notEqual(hash(edited.bytes), hash(original), recipe.id + ': edit must affect the result')
    const editedPackage = await download(
      page,
      () => page.getByRole('button', { name: '下载作品包', exact: true }).click(),
      path.join(out, recipe.id + '-edited.astra'),
    )
    const editedData = unpack(editedPackage.bytes)
    if (recipe.mode === 'phrase')
      assert.equal(editedData.manifest.project.settings.phrase, '万物有光')
    else {
      assert.notEqual(hash(editedData.source), definition.source.sha256)
      assert.deepEqual(editedData.manifest.project.settings, definition.settings)
    }
    assert.deepEqual(
      duplicated,
      await database(page),
      'editing unsaved copy must not overwrite stored templates',
    )
    report.cases.push({
      id: recipe.id,
      task: 'desktop-import-duplicate-edit-export',
      exactSource: true,
      exactSettings: true,
      exactRestoredPng: true,
      newIds: true,
      editedPngDifferent: true,
    })
    await context.close()
    const html = await readFile(path.join(directory, 'playback.html'), 'utf8')
    const data = JSON.parse(
      html.match(/<script id="art-data" type="application\/json">([\s\S]*?)<\/script>/)[1],
    )
    assert.equal(data.frame.version, '2.2.0')
    assert.equal(data.frame.settings.mode, recipe.mode)
    assert.equal(data.motion, recipe.motion)
    assert.equal(data.hover, recipe.hover)
    assert.equal(data.effectProfile, 'expressive')
    assert.equal(data.motionSpeed, recipe.motionSpeed)
    assert.equal(data.motionStrength, recipe.motionStrength)
    assert.equal(data.hoverStrength, recipe.hoverStrength)
    assert.equal(data.hoverRadius, recipe.hoverRadius)
    const offlineContext = await browser.newContext({
      offline: true,
      viewport: { width: 1200, height: 1000 },
      reducedMotion: 'no-preference',
    })
    const offline = await offlineContext.newPage()
    observe(offline)
    const requests = []
    offline.on('request', (request) => {
      if (/^https?:/.test(request.url())) requests.push(request.url())
    })
    await offline.goto(pathToFileURL(path.join(directory, 'playback.html')).href)
    await offline.locator('canvas[data-ready=true]').waitFor()
    const before = await canvasHash(offline),
      rectangle = await offline.locator('canvas').boundingBox()
    await offline.mouse.move(
      rectangle.x + rectangle.width * 0.35,
      rectangle.y + rectangle.height * 0.57,
    )
    await offline.waitForTimeout(550)
    assert.notEqual(
      await canvasHash(offline),
      before,
      recipe.id + ': offline hover must change glyph rendering',
    )
    await offline.mouse.move(0, 0)
    await offline.waitForTimeout(1600)
    await offline.locator('#play').click()
    await offline.waitForTimeout(350)
    const moving = await canvasHash(offline)
    await offline.waitForTimeout(450)
    assert.notEqual(
      await canvasHash(offline),
      moving,
      recipe.id + ': offline motion must change frame',
    )
    await offline.locator('#play').click()
    await offline.waitForTimeout(200)
    const paused = await canvasHash(offline),
      time = await offline.locator('canvas').getAttribute('data-time')
    await offline.waitForTimeout(300)
    assert.equal(await canvasHash(offline), paused)
    assert.equal(await offline.locator('canvas').getAttribute('data-time'), time)
    assert.deepEqual(requests, [])
    await offline.screenshot({ path: path.join(out, recipe.id + '-offline.png') })
    report.cases.push({
      id: recipe.id,
      task: 'file-offline-motion-hover-pause',
      requests: 0,
      hover: true,
      motion: true,
      paused: true,
    })
    await offlineContext.close()
    console.log(`PASS ${recipe.id}: restore, edit and offline playback`)
  }
  const sourceContext = await browser.newContext({
    offline: true,
    viewport: { width: 1200, height: 1000 },
    acceptDownloads: true,
  })
  const tool = await sourceContext.newPage()
  observe(tool)
  const requests = []
  tool.on('request', (request) => {
    if (/^https?:/.test(request.url())) requests.push(request.url())
  })
  await tool.goto(pathToFileURL(path.join(pack, 'source/generate-sources.html')).href)
  for (const recipe of starterRecipes) {
    const result = await download(
      tool,
      () => tool.locator(`[data-source="${recipe.id}"]`).click(),
      path.join(out, recipe.id + '-regenerated.png'),
    )
    assert.equal(
      hash(result.bytes),
      hash(await readFile(path.join(pack, 'templates', recipe.id, 'source.png'))),
    )
    report.cases.push({ id: recipe.id, task: 'offline-source-rebuild', exactPng: true })
  }
  assert.deepEqual(requests, [])
  await tool.screenshot({ path: path.join(out, 'source-tool-desktop.png') })
  await tool.setViewportSize({ width: 390, height: 844 })
  assert(await tool.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await tool.screenshot({ path: path.join(out, 'source-tool-mobile.png') })
  await sourceContext.close()
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
    acceptDownloads: true,
  })
  const mobile = await mobileContext.newPage()
  observe(mobile, true)
  for (const [index, recipe] of starterRecipes.entries()) {
    const directory = path.join(pack, 'templates', recipe.id),
      bytes = await readFile(path.join(directory, 'project.astra'))
    await mobile.goto(base + '/projects', { waitUntil: 'domcontentloaded' })
    await importAndWait(mobile, bytes, index + 1)
    await mobile
      .locator('.project-card')
      .filter({ hasText: recipe.name })
      .locator('.project-open')
      .click()
    await mobile
      .locator('.save-status')
      .filter({ hasText: '已从此浏览器恢复' })
      .waitFor({ state: 'attached' })
    await ready(mobile, recipe.mode)
    await mobile.getByRole('button', { name: '调整效果', exact: true }).click()
    if (recipe.mode === 'phrase') await mobile.locator('input[maxlength="64"]').fill('流光入梦')
    else await setRange(mobile, '对比度', 0.35)
    await ready(mobile, recipe.mode)
    const png = await exportFile(mobile, 'PNG', path.join(out, recipe.id + '-mobile-edited.png'))
    assert.notEqual(hash(png.bytes), hash(await readFile(path.join(directory, 'preview.png'))))
    assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await mobile.screenshot({ path: path.join(out, recipe.id + '-mobile.png') })
    report.cases.push({
      id: recipe.id,
      task: '390px-import-open-modify-download',
      actualDownload: true,
      noOverflow: true,
    })
  }
  await mobileContext.close()
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.uploads, [])
  report.passed = true
  console.log(
    `PASS ${report.cases.length} template tasks, ${report.rejected.length} integrity rejections; independent ZIP and zero-upload/offline checks`,
  )
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  if (activePage && !activePage.isClosed())
    await activePage.screenshot({ path: path.join(out, 'failure.png') })
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
