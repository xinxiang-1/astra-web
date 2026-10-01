import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(process.env.ASTRA_CONTRACT_OUTPUT || 'test-results/editor-contract')
await mkdir(out, { recursive: true })
const modes = ['density', 'color', 'phrase', 'contour', 'braille', 'halftone']
const names = ['光影字符', '原色字符', '中文铺字', '轮廓线稿', '点阵细节', '印刷网点']
const reference = (
  await Promise.all(
    ['core', 'canvas'].map(async (name) => {
      const source = (await readFile(`src/lib/art-engine/${name}.ts`, 'utf8')).replace(
        'export function',
        'function',
      )
      return ts
        .transpileModule(source, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        })
        .outputText.replace(/export \{\};?\s*$/, '')
    }),
  )
).join('\n')
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
  reducedMotion: 'reduce',
})
const page = await context.newPage()
page.setDefaultTimeout(30000)
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
// This contract deliberately resets test pages; navigation protection has its own UI contract.
page.on('dialog', (dialog) => dialog.accept())
const report = {
  base,
  browser: await browser.version(),
  viewport: [1440, 960],
  dpr: 1,
  scope: 'UI/media regression; no aesthetic holdout or real-device performance certification',
  cases: [],
  errors,
}
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function settle(mode) {
  await page.waitForFunction((expected) => {
    const canvas = document.querySelector('.ascii-canvas')
    return (
      canvas?.dataset.engine === 'calibrated' &&
      canvas?.dataset.mode === expected &&
      canvas.width > 100
    )
  }, mode)
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}
async function exportFile(format, filename, { edge = '1080 px', transparent = false } = {}) {
  await page.locator('.editor-header-actions .art-button').click()
  await page.getByRole('heading', { name: '导出作品', exact: true }).waitFor()
  await page.locator('.format-grid button').filter({ hasText: format }).click()
  if (format === 'PNG') {
    await page.getByRole('button', { name: edge, exact: true }).click()
    await page.getByRole('checkbox', { name: '透明背景', exact: true }).setChecked(transparent)
  }
  const event = page.waitForEvent('download', { timeout: 120000 })
  await page.getByRole('button', { name: '免费下载作品', exact: true }).click()
  const download = await event
  const target = path.join(out, filename || download.suggestedFilename())
  await download.saveAs(target)
  await page.keyboard.press('Escape')
  await page.getByRole('heading', { name: '导出作品', exact: true }).waitFor({ state: 'hidden' })
  return target
}
async function payloadOf(file) {
  const html = await readFile(file, 'utf8')
  const data = html.match(/<script id="art-data" type="application\/json">([\s\S]*?)<\/script>/)
  assert(data, 'download must contain the actual frame and embedded font atlas')
  assert(!/https?:\/\/|src="\/\//.test(html), 'offline export must not need a CDN')
  return JSON.parse(data[1])
}
async function installReference(target) {
  await target.addScriptTag({
    content: `${reference}\nwindow.contractRenderer = createCanvasArtRenderer; window.contractCore = createArtCore;`,
  })
}
// Compare independently transpiled production Canvas code against actual downloaded media.
async function compare(target, data, png, edge, transparent = false, motion = 'none') {
  await installReference(target)
  return target.evaluate(
    async ({ data, png, edge, transparent, motion }) => {
      const glyphs = await Promise.all(
        data.frame.glyphs.map(async (g) => {
          const image = new Image()
          image.src = g.png
          await image.decode()
          const tile = document.createElement('canvas')
          tile.width = image.width
          tile.height = image.height
          tile.getContext('2d').drawImage(image, 0, 0)
          return { char: g.char, coverage: g.coverage, tile }
        }),
      )
      const frame = {
        ...data.frame,
        glyphs,
        indices: new Uint16Array(data.frame.indices),
        alpha: new Float32Array(data.frame.alpha),
        colors: new Uint8ClampedArray(data.frame.colors),
      }
      const canvas = document.createElement('canvas')
      const renderer = window.contractRenderer(canvas)
      renderer.render(frame, { longEdge: edge, transparent, motion, time: 0 })
      const actual = document.createElement('canvas')
      const image = new Image()
      image.src = png
      await image.decode()
      actual.width = image.width
      actual.height = image.height
      actual.getContext('2d').drawImage(image, 0, 0)
      const a = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      const b = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data
      let error = 0,
        changed = 0,
        clear = 0,
        ink = 0
      for (let i = 0; i < a.length; i++) {
        const delta = Math.abs(a[i] - b[i])
        error += delta
        if (delta) changed++
      }
      for (let i = 3; i < b.length; i += 4) {
        if (b[i] === 0) clear++
        if (b[i] > 0) ink++
      }
      renderer.destroy()
      return {
        width: actual.width,
        height: actual.height,
        expected: [canvas.width, canvas.height],
        mae: error / (a.length * 255),
        changed,
        clear,
        ink,
      }
    },
    { data, png, edge, transparent, motion },
  )
}
async function offline(file, { motion = false, video = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 900 },
    reducedMotion: motion ? 'no-preference' : 'reduce',
    acceptDownloads: true,
    offline: true,
  })
  const tab = await ctx.newPage()
  const remote = [],
    exceptions = []
  tab.on('request', (req) => {
    if (/^https?:/.test(req.url())) remote.push(req.url())
  })
  tab.on('pageerror', (e) => exceptions.push(e.message))
  try {
    await tab.goto(pathToFileURL(file).href)
    await tab.waitForFunction(
      () =>
        document.querySelector('canvas')?.dataset.ready === 'true' ||
        document.getElementById('art-status')?.textContent !== '正在准备作品…',
    )
    assert.equal(
      await tab.locator('canvas').getAttribute('data-ready'),
      'true',
      await tab.locator('#art-status').innerText(),
    )
    const data = await payloadOf(file)
    const qualitySuffix = data.frame.settings.softwareRaster
      ? '-faithful'
      : data.frame.settings.rasterQuality
        ? `-${data.frame.settings.rasterQuality}`
        : ''
    assert.equal(await tab.title(), data.title)
    assert.equal(await tab.evaluate(() => window.injected), undefined, 'title must stay text')
    const raster = await tab
      .locator('canvas')
      .evaluate((c) => ({ png: c.toDataURL(), edge: Math.max(c.width, c.height) }))
    const pixels = await compare(
      tab,
      data,
      raster.png,
      raster.edge,
      data.transparent,
      motion ? data.motion : 'none',
    )
    assert.equal(
      pixels.changed,
      0,
      'offline snapshot must preserve font atlas, layout, color and alpha',
    )
    const event = tab.waitForEvent('download')
    await tab.locator('#download-text').click()
    const txt = path.join(out, `offline-${data.frame.settings.mode}${qualitySuffix}.txt`)
    await (await event).saveAs(txt)
    assert.equal((await readFile(txt, 'utf8')).replace(/^\uFEFF/, ''), data.frame.text)
    if (motion || video) {
      await tab.locator('#play').click()
      await tab.waitForFunction(() => Number(document.querySelector('canvas').dataset.time) > 0.05)
      await tab.waitForTimeout(350)
      const animatedFrames = new Set([sha(raster.png)])
      for (let i = 0; i < 6; i++) {
        animatedFrames.add(sha(await tab.locator('canvas').evaluate((c) => c.toDataURL())))
        await tab.waitForTimeout(70)
      }
      assert(animatedFrames.size > 1, 'playing must change the artwork across sampled frames')
      await tab.locator('#play').click()
      await tab.waitForTimeout(200)
      const paused = await tab
        .locator('canvas')
        .evaluate((c) => ({ png: c.toDataURL(), time: c.dataset.time }))
      await tab.waitForTimeout(250)
      assert.deepEqual(
        await tab.locator('canvas').evaluate((c) => ({ png: c.toDataURL(), time: c.dataset.time })),
        paused,
        'pause must freeze the actual frame',
      )
      await tab.locator('#restart').click()
      await tab.waitForFunction(
        (start) => Math.abs(Number(document.querySelector('canvas').dataset.time) - start) < 0.08,
        video ? data.source.start : 0,
      )
      if (video) {
        await tab.locator('#play').click()
        let wrapped = false,
          previous = data.source.start
        for (let i = 0; i < 12; i++) {
          await tab.waitForTimeout(100)
          const current = Number(await tab.locator('canvas').getAttribute('data-time'))
          if (current < previous - 0.1) wrapped = true
          assert(
            current >= data.source.start - 0.01 && current <= data.source.end + 0.1,
            'HTML video must stay in the selected clip',
          )
          previous = current
        }
        assert(wrapped, 'selected video clip must loop')
        await tab.locator('#play').click()
      } else {
        await tab.emulateMedia({ reducedMotion: 'reduce' })
        await tab.waitForTimeout(100)
        await tab.locator('#play').click()
        const still = await tab.locator('canvas').evaluate((c) => c.toDataURL())
        await tab.waitForTimeout(250)
        assert.equal(
          await tab.locator('canvas').evaluate((c) => c.toDataURL()),
          still,
          'reduced motion must keep the artwork still',
        )
      }
    }
    assert.deepEqual(remote, [], 'offline HTML must never request network assets')
    assert.deepEqual(exceptions, [])
    await tab.screenshot({
      path: path.join(
        out,
        `offline-${video ? 'video' : data.frame.settings.mode}${qualitySuffix}.png`,
      ),
    })
    return { pixels, bytes: (await readFile(file)).length, remote, exceptions }
  } finally {
    await ctx.close()
  }
}
async function database(action, value) {
  return page.evaluate(
    ({ action, value }) =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('astra-art-projects', 1)
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction('projects', action === 'list' ? 'readonly' : 'readwrite')
          const store = tx.objectStore('projects'),
            request = action === 'list' ? store.getAll() : store.put(value)
          tx.oncomplete = async () => {
            db.close()
            if (action !== 'list') {
              resolve(true)
              return
            }
            resolve(
              await Promise.all(
                request.result.map(async (p) => ({
                  ...p,
                  source: { name: p.source.name, size: p.source.size, type: p.source.type },
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
          tx.onerror = () => reject(tx.error)
        }
        open.onerror = () => reject(open.error)
      }),
    { action, value },
  )
}

try {
  if (!process.argv.includes('--media-only')) {
    await page.goto(`${base}/ascii-art`)
    await page
      .locator('input[type="file"]')
      .setInputFiles(path.resolve('public/artwork/portrait.jpg'))
    await settle('density')
    const projects = []
    for (let i = 0; i < modes.length; i++) {
      const mode = modes[i],
        item = { mode }
      report.cases.push(item)
      await page.locator('.inspector-modes button').filter({ hasText: names[i] }).click()
      if (mode === 'phrase') {
        await page.locator('input[maxlength="64"]').fill('山河🌙👩‍💻')
        await page.locator('.advanced-card').evaluate((d) => {
          d.open = true
        })
        await page
          .locator('.adv-group')
          .filter({ hasText: '短语参数' })
          .evaluate((d) => {
            d.open = true
          })
        await page.getByRole('checkbox', { name: /铺满/ }).check()
      }
      await page
        .getByLabel('作品名称')
        .fill(i === 0 ? '</script><script>window.injected=1</script>' : `合同-${mode}`)
      await settle(mode)
      const html = await exportFile('动态网页', `${mode}.html`)
      const data = await payloadOf(html)
      assert.equal(data.frame.settings.mode, mode)
      assert(data.frame.statistics.nonEmpty > 0)
      if (mode === 'phrase')
        assert(
          data.frame.text.split('\n')[0].startsWith('山河🌙👩‍💻山河🌙👩‍💻'),
          'Chinese and emoji must follow the input sequence',
        )
      const png = await exportFile('PNG', `${mode}.png`)
      item.png = await compare(
        page,
        data,
        `data:image/png;base64,${(await readFile(png)).toString('base64')}`,
        1080,
      )
      assert.equal(item.png.changed, 0, `${mode}: exported PNG and portable renderer differ`)
      await page.getByRole('button', { name: '全屏 ↗', exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector('.fs-overlay canvas')?.dataset.engine === 'calibrated',
      )
      const full = await page.locator('.fs-overlay canvas').evaluate((c) => ({
        png: c.toDataURL(),
        edge: Math.max(c.width, c.height),
        width: c.clientWidth,
        height: c.clientHeight,
      }))
      item.fullscreen = await compare(page, data, full.png, full.edge)
      assert.equal(
        item.fullscreen.changed,
        0,
        'fullscreen must show the same frame at its actual fitted size',
      )
      assert(Math.abs(full.width / full.height - data.frame.width / data.frame.height) < 0.005)
      if (i === 0) {
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await page.locator('.fs-overlay canvas').hover()
        await page.waitForTimeout(200)
        assert(
          sha(await page.locator('.fs-overlay canvas').evaluate((c) => c.toDataURL())) !==
            sha(full.png),
          'fullscreen must receive pointer feedback',
        )
        await page.emulateMedia({ reducedMotion: 'reduce' })
      }
      await page.getByRole('button', { name: '退出全屏', exact: true }).click()
      item.offline = await offline(html)
      const text = await exportFile('文本', `${mode}.txt`)
      assert.equal((await readFile(text, 'utf8')).replace(/^\uFEFF/, ''), data.frame.text)
      await page.locator('.editor-save').click()
      await page.getByRole('status').filter({ hasText: '已保存到此浏览器' }).waitFor()
      const saved = (await database('list')).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      assert.equal(saved.settings.editorEngine, 'calibrated')
      assert.equal(saved.settings.artMode, mode)
      assert.equal(saved.source.name, 'portrait.jpg')
      assert.equal(saved.sourceHash, sha(await readFile('public/artwork/portrait.jpg')))
      item.thumbnail = await compare(page, data, saved.thumbnail, 420)
      assert(
        item.thumbnail.mae < 0.03,
        'JPEG thumbnail must preserve the artwork within its compression budget',
      )
      projects.push({ id: saved.id, settings: saved.settings })
      await page.screenshot({ path: path.join(out, `editor-${mode}.png`) })
      // Use a new project per mode so restoration checks all six saved states.
      if (i < modes.length - 1) {
        await page.goto(`${base}/ascii-art`)
        await page
          .locator('input[type="file"]')
          .setInputFiles(path.resolve('public/artwork/portrait.jpg'))
        await settle('density')
      }
    }
    for (const project of projects) {
      await page.goto(`${base}/ascii-art?project=${project.id}`)
      await page.getByRole('status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
      await settle(project.settings.artMode)
      const data = await payloadOf(
        await exportFile('动态网页', `restored-${project.settings.artMode}.html`),
      )
      assert.equal(data.frame.settings.fontFamily, project.settings.previewFontFamily)
      assert.equal(data.frame.settings.background, project.settings.backgroundColor)
      assert.equal(data.motion, project.settings.artMotion)
      assert.equal(data.hover, project.settings.artHover)
      assert.equal(data.frame.settings.charAspect, project.settings.previewAspect)
    }
    await page.reload()
    await page.getByRole('status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
    await settle('halftone')
    report.projects = { restored: projects.length, refresh: true }
    const transparent = await exportFile('PNG', 'transparent-4k.png', {
      edge: '4K',
      transparent: true,
    })
    const frame = await payloadOf(path.join(out, 'restored-halftone.html'))
    report.transparent4k = await compare(
      page,
      frame,
      `data:image/png;base64,${(await readFile(transparent)).toString('base64')}`,
      3840,
      true,
    )
    assert.equal(report.transparent4k.changed, 0)
    assert(report.transparent4k.clear > 0 && report.transparent4k.ink > 0)
    report.transparent4k.sha256 = sha(await readFile(transparent))
    report.quality = []
    for (const [quality, rasterQuality, mode] of [
      ['detailed', 'high', 'density'],
      ['smooth', 'supersampled', 'density'],
      ['faithful', undefined, 'density'],
      ['faithful', undefined, 'color'],
    ]) {
      const qualityId = `${mode}-${quality}`
      await page.goto(`${base}/ascii-art`)
      await page
        .locator('input[type="file"]')
        .setInputFiles(path.resolve('public/artwork/portrait.jpg'))
      await settle('density')
      if (mode === 'color') {
        await page.locator('.inspector-modes button').filter({ hasText: '原色字符' }).click()
        await settle('color')
      }
      await page.locator(`button[data-quality="${quality}"]`).click()
      await page.waitForFunction(
        (quality) => document.querySelector('.ascii-canvas')?.dataset.quality === quality,
        quality,
      )
      await page.getByLabel('作品名称').fill(`品质-${qualityId}`)
      const html = await exportFile('动态网页', `quality-${qualityId}.html`)
      const data = await payloadOf(html)
      assert.equal(data.frame.settings.fontWeight, 600)
      assert.equal(data.frame.settings.rasterQuality, rasterQuality)
      assert.equal(data.frame.settings.mode, mode)
      if (quality === 'faithful') {
        assert.equal(data.frame.settings.softwareRaster, true)
        assert.equal(data.frame.settings.colorFidelity, true)
      }
      const png = await exportFile('PNG', `quality-${qualityId}-4k.png`, {
        edge: '4K',
        transparent: true,
      })
      const comparison = await compare(
        page,
        data,
        `data:image/png;base64,${(await readFile(png)).toString('base64')}`,
        3840,
        true,
      )
      assert.equal(comparison.changed, 0)
      assert(comparison.clear > 0 && comparison.ink > 0)
      const standalone = await offline(html)
      await page.screenshot({ path: path.join(out, `quality-${qualityId}-desktop.png`) })
      await page.getByRole('button', { name: '全屏 ↗', exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector('.fs-overlay canvas')?.dataset.quality !== undefined,
      )
      const full = await page
        .locator('.fs-overlay canvas')
        .evaluate((c) => ({ png: c.toDataURL(), edge: Math.max(c.width, c.height) }))
      const fullscreen = await compare(page, data, full.png, full.edge)
      assert.equal(fullscreen.changed, 0)
      await page.getByRole('button', { name: '退出全屏', exact: true }).click()
      await page.locator('.editor-save').click()
      await page.getByRole('status').filter({ hasText: '已保存到此浏览器' }).waitFor()
      const saved = (await database('list')).sort((a, b) => b.updatedAt - a.updatedAt)[0]
      assert.equal(saved.settings.artQuality, quality)
      await page.goto(`${base}/ascii-art?project=${saved.id}`)
      await page.getByRole('status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
      await page.waitForFunction(
        (quality) => document.querySelector('.ascii-canvas')?.dataset.quality === quality,
        quality,
      )
      await page.reload()
      await page.getByRole('status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
      await page.waitForFunction(
        (quality) => document.querySelector('.ascii-canvas')?.dataset.quality === quality,
        quality,
      )
      const restored = await payloadOf(
        await exportFile('动态网页', `quality-restored-${qualityId}.html`),
      )
      assert.deepEqual(restored.frame.settings, data.frame.settings)
      await page
        .locator('.inspector-modes button')
        .filter({ hasText: quality === 'faithful' ? '中文铺字' : '原色字符' })
        .click()
      await settle(quality === 'faithful' ? 'phrase' : 'color')
      assert.equal(await page.locator('.ascii-canvas').getAttribute('data-quality'), 'classic')
      await page.locator('.inspector-modes button').filter({ hasText: '光影字符' }).click()
      await settle('density')
      if (await page.locator(`button[data-quality="${quality}"]`).isDisabled()) {
        await page.getByRole('button', { name: '彩色', exact: true }).click()
      }
      await page.locator(`button[data-quality="${quality}"]`).click()
      await page.waitForFunction(
        (quality) => document.querySelector('.ascii-canvas')?.dataset.quality === quality,
        quality,
      )
      if (mode === 'color') {
        await page.locator('.inspector-modes button').filter({ hasText: '原色字符' }).click()
        await settle('color')
        assert.equal(await page.locator('.ascii-canvas').getAttribute('data-quality'), quality)
      }
      await page.setViewportSize({ width: 390, height: 844 })
      await page.getByRole('button', { name: '调整效果', exact: true }).click()
      assert(await page.locator(`button[data-quality="${quality}"]`).isVisible())
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.screenshot({ path: path.join(out, `quality-${qualityId}-mobile.png`) })
      await page.setViewportSize({ width: 1440, height: 960 })
      report.quality.push({
        quality,
        mode,
        png: comparison,
        fullscreen,
        offline: standalone,
        restored: true,
        refresh: true,
        excludedColor: quality !== 'faithful',
        excludedPhrase: quality === 'faithful',
        mobile: true,
      })
    }
    // Old projects without an engine discriminator must retain their original entry.
    const legacyId = await page.evaluate(async () => {
      const open = indexedDB.open('astra-art-projects', 1)
      const db = await new Promise((resolve, reject) => {
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => reject(open.error)
      })
      const tx = db.transaction('projects', 'readwrite'),
        store = tx.objectStore('projects')
      const req = store.getAll()
      const id = 'legacy-contract'
      req.onsuccess = () => {
        const old = req.result[0]
        delete old.settings.editorEngine
        old.id = id
        store.put(old)
      }
      await new Promise((resolve, reject) => {
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
      })
      db.close()
      return id
    })
    await page.goto(`${base}/ascii-art?project=${legacyId}`)
    await page.getByRole('status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
    await page.locator('.legacy-project-note').waitFor()
    await page.locator('.inspector-modes.six-modes button').filter({ hasText: '光影字符' }).click()
    await settle('density')
    report.legacy = { preserved: true, explicitUpgrade: true }
    await page
      .locator('details')
      .filter({ hasText: '动态效果' })
      .evaluate((d) => {
        d.open = true
      })
    await page.getByRole('button', { name: '流动', exact: true }).click()
    const moving = await exportFile('动态网页', 'motion.html')
    report.motion = await offline(moving, { motion: true })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.waitForFunction(
      () => Number(document.querySelector('.ascii-canvas').dataset.time) > 0.2,
    )
    const sizeBefore = await page.locator('.ascii-canvas').boundingBox()
    await page.getByRole('button', { name: '暂停动效', exact: true }).click()
    await page.waitForTimeout(100)
    const freeze = await page
      .locator('.ascii-canvas')
      .evaluate((c) => ({ png: c.toDataURL(), time: c.dataset.time }))
    await page.waitForTimeout(250)
    assert.deepEqual(
      await page
        .locator('.ascii-canvas')
        .evaluate((c) => ({ png: c.toDataURL(), time: c.dataset.time })),
      freeze,
    )
    assert.deepEqual(
      await page.locator('.ascii-canvas').boundingBox(),
      sizeBefore,
      'motion must preserve the layout',
    )
    await page.getByRole('button', { name: '继续动效', exact: true }).click()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    report.motion.editorPause = true
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '调整效果', exact: true }).click()
    for (let i = 0; i < modes.length; i++) {
      await page.locator('.inspector-modes button').filter({ hasText: names[i] }).click()
      await settle(modes[i])
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        'mobile mode overflow',
      )
    }
    await page.screenshot({ path: path.join(out, 'editor-mobile.png') })
    report.mobile = { width: 390, modes: 6, noOverflow: true }
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(`${base}/ascii-art`)
  await page
    .locator('input[type="file"]')
    .setInputFiles(path.resolve('test-results/editor-contract-source.mp4'))
  await settle('density')
  assert(
    await page.locator('button[data-quality="detailed"]').isDisabled(),
    'video keeps the validated classic profile',
  )
  assert(
    await page.locator('button[data-quality="faithful"]').isDisabled(),
    'software image profile must not be applied to video',
  )
  if (await page.getByRole('button', { name: '暂停', exact: true }).isVisible())
    await page.getByRole('button', { name: '暂停', exact: true }).click()
  await page.getByRole('button', { name: /^低清/ }).click()
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  const returnedTime = await page.locator('.video-thumb.show').evaluate((v) => v.currentTime)
  await page.getByRole('button', { name: /^超清/ }).click()
  await page.getByRole('button', { name: /解析并播放/ }).click()
  await page.getByRole('button', { name: '暂停', exact: true }).waitFor()
  await page.getByRole('button', { name: '暂停', exact: true }).click()
  report.video = { live: true, prerender: true, returnedTime }
  await page.locator('.advanced-card').evaluate((d) => {
    d.open = true
  })
  await page
    .locator('.adv-group')
    .filter({ hasText: '预览字体' })
    .evaluate((d) => {
      d.open = true
    })
  await page.getByRole('button', { name: '微软雅黑', exact: true }).click()
  await page.getByRole('button', { name: /解析并播放/ }).waitFor()
  report.video.fontInvalidation = true
  const cancelTime = await page.locator('.video-thumb.show').evaluate((v) => v.currentTime)
  await page.getByRole('button', { name: /解析并播放/ }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).waitFor({ state: 'hidden' })
  assert(
    Math.abs(
      (await page.locator('.video-thumb.show').evaluate((v) => v.currentTime)) - cancelTime,
    ) < 0.01,
    'cancel must return to the source frame',
  )
  report.video.cancelRestoresTime = true
  await page.locator('.inspector-modes button').filter({ hasText: '轮廓线稿' }).click()
  await settle('contour')
  // A mode change invalidates parsed frames and asks to parse the new settings again.
  assert(await page.getByRole('button', { name: /解析并播放/ }).isVisible())
  report.video.cacheInvalidation = true
  await page.locator('.clip-panel').getByRole('button', { name: '自定义', exact: true }).click()
  await page.locator('.clip-custom-field input').first().fill('0.5')
  await page.locator('.clip-custom-field input').first().dispatchEvent('change')
  await page.getByLabel('片段起点').evaluate((input) => {
    input.value = '0.2'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.getByRole('button', { name: /^低清/ }).click()
  const movie = await exportFile('视频')
  const probe = JSON.parse(
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', movie],
      { encoding: 'utf8' },
    ),
  )
  const stream = probe.streams.find((s) => s.codec_type === 'video')
  assert(stream && stream.width > 0 && stream.height > 0 && Number(probe.format.duration) > 0.3)
  assert(
    Math.abs(Number(probe.format.duration) - 0.5) < 0.08,
    'encoded movie must use the selected half-second clip',
  )
  report.video.export = {
    name: path.basename(movie),
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    duration: probe.format.duration,
    sha256: sha(await readFile(movie)),
  }
  execFileSync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    movie,
    '-frames:v',
    '1',
    path.join(out, 'video-decoded.png'),
  ])
  const videoHtml = await exportFile('动态网页', 'video.html')
  const videoData = await payloadOf(videoHtml)
  assert.equal(videoData.source.start, 0.2)
  assert.equal(videoData.source.end, 0.7)
  await installReference(page)
  const decoded = `data:image/png;base64,${(await readFile(path.join(out, 'video-decoded.png'))).toString('base64')}`
  report.video.decodedFrame = await page.evaluate(
    async ({ data, decoded }) => {
      const glyphs = await Promise.all(
        data.frame.glyphs.map(async (g) => {
          const image = new Image()
          image.src = g.png
          await image.decode()
          const tile = document.createElement('canvas')
          tile.width = image.width
          tile.height = image.height
          tile.getContext('2d').drawImage(image, 0, 0)
          return { char: g.char, coverage: g.coverage, tile }
        }),
      )
      const core = window.contractCore(data.frame.settings, data.frame.version)
      core.primeAtlas({ ...data.frame, glyphs })
      const video = document.createElement('video')
      video.muted = true
      video.preload = 'auto'
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve
        video.onerror = reject
        video.src = data.source.dataUrl
      })
      await new Promise((resolve) => {
        video.onseeked = resolve
        video.currentTime = data.source.start
      })
      const frame = core.prepareArtFrame(
        video,
        video.videoWidth,
        video.videoHeight,
        data.frame.settings,
      )
      const canvas = document.createElement('canvas'),
        renderer = window.contractRenderer(canvas)
      renderer.render(frame, { longEdge: 1280, motion: data.motion, time: 0 })
      const image = new Image()
      image.src = decoded
      await image.decode()
      const actual = document.createElement('canvas')
      actual.width = image.width
      actual.height = image.height
      actual.getContext('2d').drawImage(image, 0, 0)
      const a = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      const b = actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data
      let error = 0
      for (let i = 0; i < a.length; i++) error += Math.abs(a[i] - b[i])
      renderer.destroy()
      video.removeAttribute('src')
      video.load()
      return {
        mae: error / (a.length * 255),
        actual: [actual.width, actual.height],
        expected: [canvas.width, canvas.height],
      }
    },
    { data: videoData, decoded },
  )
  assert.deepEqual(report.video.decodedFrame.actual, report.video.decodedFrame.expected)
  assert(
    report.video.decodedFrame.mae < 0.035,
    'lossy decoded video must preserve the selected native raster frame',
  )
  report.video.offline = await offline(videoHtml, { video: true })
  assert.deepEqual(errors, [])
  report.passed = true
  console.log(
    JSON.stringify({
      passed: true,
      modes: 6,
      projects: report.projects,
      video: report.video.export,
      output: out,
    }),
  )
} catch (error) {
  report.passed = false
  report.failure = error.stack
  await page.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  report.engineHashes = Object.fromEntries(
    await Promise.all(
      ['core', 'canvas', 'embed'].map(async (name) => [
        name,
        sha(await readFile(`src/lib/art-engine/${name}.ts`)),
      ]),
    ),
  )
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
