import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'
import { createHash } from 'node:crypto'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_EFFECTS_OUTPUT || 'sandbox/art-effects/2026-10-01-v2/development',
)
await mkdir(path.dirname(out), { recursive: true })
await mkdir(out, { recursive: false })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'no-preference',
  acceptDownloads: true,
  hasTouch: true,
})
const page = await context.newPage()
page.setDefaultTimeout(30000)
page.setDefaultNavigationTimeout(60000)
const report = {
  base,
  browser: browser.version(),
  scope: 'Chromium desktop/touch emulation; no real-device or universal frame-rate certification',
  api: null,
  ui: [],
  errors: [],
  passed: false,
}
page.on('pageerror', (e) => report.errors.push(e.message))
const oldSource = await readFile('scripts/fixtures/classic-art-renderer.ts', 'utf8')
const oldRenderer = ts.transpileModule(oldSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
const sha = (b) => createHash('sha256').update(b).digest('hex')
async function ready(mode) {
  await page.waitForFunction((mode) => {
    const c = document.querySelector('.ascii-scroll canvas')
    return (
      c?.width > 100 &&
      (!mode || c.dataset.mode === mode) &&
      !document.querySelector('.editor-package')?.disabled
    )
  }, mode)
}
async function effects() {
  await page.locator('details.calibrated-effects').evaluate((d) => {
    d.open = true
  })
}
const snapshot = (target = page, selector = '.ascii-scroll canvas') =>
  target.locator(selector).evaluate((c) => c.toDataURL())
async function hoverCheck(name, selector = '.ascii-scroll canvas') {
  await page.mouse.move(0, 0)
  await page.waitForTimeout(1600)
  const before = await snapshot(page, selector)
  const box = await page.locator(selector).boundingBox()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4)
  await page.waitForTimeout(650)
  const after = await snapshot(page, selector)
  assert.notEqual(after, before, `${name}: actual hover pixels must change`)
  report.ui.push({ name, hoverChanged: true })
  return { before, after }
}
async function download(action, name) {
  const pending = page.waitForEvent('download', { timeout: 120000 })
  await action()
  const file = await pending
  assert.equal(await file.failure(), null)
  const dest = path.join(out, name)
  await file.saveAs(dest)
  return dest
}
async function exportFile(format, name) {
  const dest = await download(async () => {
    await page.locator('.editor-header-actions .art-button').click()
    await page.locator('.format-grid button').filter({ hasText: format }).click()
    await page.getByRole('button', { name: '免费下载作品', exact: true }).click()
  }, name)
  await page.keyboard.press('Escape')
  return dest
}
try {
  await page.goto(`${base}/ascii-art`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  if (!process.env.ASTRA_EFFECTS_SKIP_API) {
    report.api = await page.evaluate(async (oldCode) => {
      await document.fonts.ready
      const { prepareArtFrame, createCanvasArtRenderer, createArtRenderer } =
        await import('/src/lib/art-engine/index.ts')
      const oldMake = new Function('exports', oldCode + ';return exports.createCanvasArtRenderer')(
        {},
      )
      const image = await createImageBitmap(await (await fetch('/artwork/portrait.jpg')).blob())
      const source = document.createElement('canvas')
      source.width = image.width
      source.height = image.height
      source.getContext('2d').drawImage(image, 0, 0)
      image.close()
      const cases = [],
        hovers = [],
        motions = [],
        performanceSamples = []
      const pixels = (c) =>
        new Uint8ClampedArray(c.getContext('2d').getImageData(0, 0, c.width, c.height).data)
      const delta = (a, b) => {
        let count = 0,
          sum = 0
        for (let i = 0; i < a.length; i++) {
          const d = Math.abs(a[i] - b[i])
          if (d) count++
          sum += d
        }
        return { channels: count, mean: sum / a.length }
      }
      const checks = [
        ['density', 'classic'],
        ['color', 'classic'],
        ['phrase', 'classic'],
        ['contour', 'classic'],
        ['braille', 'classic'],
        ['halftone', 'classic'],
        ['density', 'detailed'],
        ['density', 'smooth'],
        ['density', 'faithful'],
        ['color', 'faithful'],
      ]
      let density
      for (const [mode, quality] of checks) {
        const frame = prepareArtFrame(source, source.width, source.height, {
          mode,
          columns: 120,
          phrase: '山河光与你FJRq',
          invert: true,
          fontFamily: mode === 'phrase' ? 'serif' : 'Consolas,monospace',
          ...(quality === 'faithful'
            ? { softwareRaster: true, colorFidelity: true, fontWeight: 600 }
            : quality === 'classic'
              ? {}
              : {
                  fontWeight: 600,
                  rasterQuality: quality === 'detailed' ? 'high' : 'supersampled',
                }),
        })
        if (mode === 'density' && quality === 'classic') density = frame
        const c = document.createElement('canvas'),
          old = document.createElement('canvas'),
          r = createCanvasArtRenderer(c),
          previous = oldMake(old)
        const options = { longEdge: 720, motion: 'none' }
        previous.render(frame, options)
        r.render(frame, options)
        const base = pixels(c),
          legacyDelta = delta(base, pixels(old))
        r.render(frame, { ...options, effectProfile: 'expressive' })
        const staticDelta = delta(base, pixels(c))
        r.render(frame, { ...options, hover: 'light', pointer: { x: 0.5, y: 0.4, strength: 1 } })
        const classic = delta(base, pixels(c))
        const lightOptions = {
          ...options,
          effectProfile: 'expressive',
          hover: 'light',
          hoverRadius: 0.38,
          pointer: { x: 0.5, y: 0.4, strength: 1 },
        }
        let duration
        for (let i = 0; i < 12; i++)
          duration = r.render(frame, { ...lightOptions, hoverTime: i / 30 }).renderMs
        const light = delta(base, pixels(c))
        const stats = r.cacheStats
        cases.push({
          mode,
          quality,
          legacyDelta,
          staticDelta,
          classic,
          light,
          duration,
          glowBytes: stats.glowBytes,
        })
        previous.destroy()
        r.destroy()
      }
      const c = document.createElement('canvas'),
        r = createCanvasArtRenderer(c)
      const common = {
        longEdge: 720,
        effectProfile: 'expressive',
        hoverRadius: 0.38,
        motion: 'none',
      }
      r.render(density, common)
      const still = pixels(c)
      for (const hover of [
        'light',
        'ripple',
        'displace',
        'trail',
        'water',
        'silk',
        'vortex',
        'contour',
        'dissolve',
      ]) {
        r.render(density, {
          ...common,
          hover,
          hoverTime: 0.4,
          pointer: { x: 0.3, y: 0.35, strength: 1 },
        })
        r.render(density, {
          ...common,
          hover,
          hoverTime: 0.5,
          pointer: { x: 0.5, y: 0.4, strength: 1 },
        })
        const first = pixels(c)
        r.render(density, {
          ...common,
          hover,
          hoverTime: 1.4,
          pointer: { x: 0.6, y: 0.45, strength: 1 },
        })
        const next = pixels(c)
        r.render(density, {
          ...common,
          hover,
          hoverTime: 3,
          pointer: { x: 0.5, y: 0.4, strength: 0 },
        })
        const zero = delta(still, pixels(c))
        hovers.push({
          hover,
          changed: delta(still, first),
          moved: delta(first, next),
          zero,
          fingerprint: [...first.filter((_, i) => i % 997 === 0)],
        })
      }
      const local = { ...common, hover: 'light', pointer: { x: 0.5, y: 0.4, strength: 1 } }
      r.render(density, { ...local, hoverRadius: 0.12 })
      const narrow = delta(still, pixels(c))
      r.render(density, { ...local, hoverRadius: 0.6 })
      const wide = delta(still, pixels(c))
      for (const motion of ['breathe', 'wave', 'assemble', 'current', 'reform', 'caustics']) {
        const opt = { ...common, motion, motionStrength: 0.8, time: 0.5 }
        r.render(density, opt)
        const first = pixels(c)
        r.render(density, { ...opt, time: 1.1 })
        const next = pixels(c)
        r.render(density, { ...opt, motionStrength: 0 })
        const zero = delta(still, pixels(c))
        r.render(density, { ...opt, motionSpeed: 0.5, time: 1 })
        const speed = delta(first, pixels(c))
        motions.push({
          motion,
          changed: delta(still, first),
          phase: delta(first, next),
          zero,
          speed,
        })
      }
      const full = { ...density, alpha: new Float32Array(density.alpha.length).fill(1) }
      r.render(full, common)
      const fullBase = pixels(c)
      r.render(full, local)
      const fullInk = delta(fullBase, pixels(c))
      r.render(density, { ...local, longEdge: 2048 })
      const highResolutionGlowBytes = r.cacheStats.glowBytes
      for (let i = 0; i < 20; i++)
        r.render(density, {
          ...common,
          hover: 'trail',
          hoverTime: i * 0.04,
          pointer: { x: 0.2 + i * 0.02, y: 0.4, strength: 1 },
        })
      const nativeFieldCells = r.cacheStats.interactionCells
      const nativeFieldBytes = r.cacheStats.interactionBytes
      for (let i = 0; i < 12; i++)
        performanceSamples.push(
          r.render(density, {
            ...common,
            hover: 'water',
            hoverTime: i * 0.1,
            pointer: { x: 0.5, y: 0.4, strength: 0.65 },
          }).renderMs,
        )
      const routed = createArtRenderer(document.createElement('canvas'))
      routed.render(density, local)
      const backend = routed.backend
      routed.destroy()
      r.destroy()
      return {
        cases,
        hovers,
        motions,
        narrow,
        wide,
        fullInk,
        highResolutionGlowBytes,
        nativeFieldCells,
        nativeFieldBytes,
        performanceSamples,
        backend,
      }
    }, oldRenderer)
    for (const c of report.api.cases) {
      assert.equal(c.legacyDelta.channels, 0, `${c.mode}/${c.quality} classic regression`)
      assert.equal(c.staticDelta.channels, 0, `${c.mode}/${c.quality} static regression`)
      assert(
        c.light.mean > c.classic.mean * 3 && c.light.mean > 0.15,
        'new light must visibly improve actual pixels',
      )
    }
    for (const c of report.api.hovers) {
      assert(c.changed.channels > 0 && c.moved.channels > 0)
      assert.equal(c.zero.channels, 0)
    }
    assert.equal(new Set(report.api.hovers.map((h) => JSON.stringify(h.fingerprint))).size, 9)
    for (const c of report.api.motions) {
      assert(c.changed.channels > 0 && c.phase.channels > 0)
      assert.equal(c.zero.channels, 0)
      assert.equal(c.speed.channels, 0)
    }
    assert(report.api.wide.channels > report.api.narrow.channels * 2)
    assert(report.api.fullInk.mean > 0.15)
    assert(report.api.highResolutionGlowBytes <= 1536 * 1536 * 4)
    assert(report.api.nativeFieldCells <= 128 * 128)
    assert(report.api.nativeFieldBytes <= 2 * 1024 * 1024)
    assert.equal(report.api.backend, 'canvas2d')
    console.log('PASS API: 10 static/quality cases, 9 hovers, 6 motions, limits and controls')
  }
  await page.locator('input[type=file]').setInputFiles(path.resolve('public/artwork/portrait.jpg'))
  await ready()
  await effects()
  assert.equal(
    await page.getByRole('group', { name: '六模式悬停', exact: true }).locator('button').count(),
    10,
  )
  assert.equal(
    await page.getByRole('group', { name: '六模式微动', exact: true }).locator('button').count(),
    7,
  )
  await page.getByRole('button', { name: '暂停动效', exact: true }).click()
  for (const [mode, label] of [
    ['density', '光影字符'],
    ['color', '原色字符'],
    ['phrase', '中文铺字'],
    ['contour', '轮廓线稿'],
    ['braille', '点阵细节'],
    ['halftone', '印刷网点'],
  ]) {
    await page.locator('.six-modes button').filter({ hasText: label }).click()
    await ready(mode)
    await hoverCheck(`${mode}-paused-light`)
  }
  await page.locator('.six-modes button').filter({ hasText: '光影字符' }).click()
  await ready('density')
  const colorToggle = page.getByRole('button', { name: '彩色', exact: true })
  if (await colorToggle.evaluate((b) => b.classList.contains('on'))) await colorToggle.click()
  for (const quality of ['detailed', 'smooth', 'faithful']) {
    await page.locator(`button[data-quality="${quality}"]`).click()
    await page.waitForFunction(
      (q) => document.querySelector('.ascii-scroll canvas')?.dataset.quality === q,
      quality,
    )
    await hoverCheck(`${quality}-paused-light`)
  }
  await page.screenshot({ path: path.join(out, 'paused-light-editor.png') })
  await page.mouse.move(0, 0)
  await page.waitForTimeout(1600)
  const still = await snapshot()
  await page.waitForTimeout(350)
  await page.waitForFunction(
    () =>
      document.querySelector('.ascii-scroll canvas')?.dataset.pointerStrength === '0' &&
      document.querySelector('.ascii-scroll canvas')?.dataset.interactionActive === 'false',
    undefined,
    { timeout: 10000 },
  )
  const settled = await snapshot()
  await page.waitForTimeout(250)
  assert((await snapshot()) === settled, 'leave must settle to static image')
  await page.getByRole('button', { name: '全屏 ↗', exact: true }).click()
  await hoverCheck('fullscreen-paused', '.fs-scroll canvas')
  await page.getByRole('button', { name: '退出全屏', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(250)
  const reduced = await snapshot()
  const box = await page.locator('.ascii-scroll canvas').boundingBox()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5)
  await page.waitForTimeout(350)
  assert((await snapshot()) === reduced, 'reduced motion must suppress decorative hover')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await effects()
  await page
    .getByRole('group', { name: '六模式微动', exact: true })
    .getByRole('button', { name: '慢流', exact: true })
    .click()
  for (const [id, value] of [
    ['art-hover-strength', '0.82'],
    ['art-hover-radius', '0.46'],
    ['art-motion-speed', '0.6'],
    ['art-motion-strength', '0.73'],
  ]) {
    await page.locator(`#${id}`).evaluate((input, value) => {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }, value)
  }
  const packed = await download(
    () => page.getByRole('button', { name: '下载作品包', exact: true }).click(),
    'effects.astra',
  )
  const bytes = await readFile(packed),
    manifest = JSON.parse(bytes.subarray(44, 44 + bytes.readUInt32LE(8)))
  const settings = manifest.project.settings
  assert.equal(settings.artEffectProfile, 'expressive')
  assert.equal(settings.artMotionSpeed, 0.6)
  assert.equal(settings.artMotionStrength, 0.73)
  assert.equal(settings.hoverStrength, 0.82)
  assert.equal(settings.hoverRadius, 0.46)
  await page.locator('.editor-save').click()
  await page.locator('.save-status').filter({ hasText: '已保存到此浏览器' }).waitFor()
  const savedId = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('astra-art-projects', 1)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction('projects', 'readonly'),
            q = tx.objectStore('projects').getAll()
          tx.oncomplete = () => {
            db.close()
            resolve(q.result[0].id)
          }
        }
      }),
  )
  const url = `${base}/ascii-art?project=${savedId}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.locator('.save-status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
  await ready()
  await effects()
  assert.equal(await page.locator('#art-motion-speed').inputValue(), '0.6')
  const htmlFile = await exportFile('动态网页', 'effects.html')
  const html = await readFile(htmlFile, 'utf8'),
    payload = JSON.parse(
      html.match(/<script id="art-data" type="application\/json">([\s\S]*?)<\/script>/)[1],
    )
  assert.equal(payload.effectProfile, 'expressive')
  assert.equal(payload.motionSpeed, 0.6)
  assert.equal(payload.motionStrength, 0.73)
  assert.equal(payload.hoverStrength, 0.82)
  assert.equal(payload.hoverRadius, 0.46)
  const offlineContext = await browser.newContext({
    offline: true,
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'no-preference',
  })
  const offline = await offlineContext.newPage(),
    requests = [],
    offlineErrors = []
  offline.on('request', (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url())
  })
  offline.on('pageerror', (e) => offlineErrors.push(e.message))
  await offline.goto('file:///' + htmlFile.replaceAll('\\', '/'))
  await offline.locator('canvas[data-ready=true]').waitFor()
  const before = await snapshot(offline, 'canvas'),
    ob = await offline.locator('canvas').boundingBox()
  await offline.mouse.move(ob.x + ob.width * 0.5, ob.y + ob.height * 0.4)
  await offline.waitForTimeout(500)
  assert.notEqual(await snapshot(offline, 'canvas'), before, 'offline paused hover')
  await offline.mouse.move(0, 0)
  await offline.waitForTimeout(1600)
  await offline.locator('#play').click()
  await offline.waitForTimeout(300)
  const active = await snapshot(offline, 'canvas')
  await offline.waitForTimeout(400)
  assert.notEqual(await snapshot(offline, 'canvas'), active, 'offline ambient motion')
  assert.deepEqual(requests, [])
  assert.deepEqual(offlineErrors, [])
  await offlineContext.close()
  report.portable = {
    url,
    settings,
    html: payload.motion,
    noNetworkRequests: true,
    packageSha: sha(bytes),
    offlineHover: true,
    offlineMotion: true,
  }
  // An old project with no effect profile stays classic; fresh-context package import keeps the new values.
  const fresh = await browser.newContext({ reducedMotion: 'reduce' }),
    restored = await fresh.newPage()
  await restored.goto(`${base}/projects`, { waitUntil: 'domcontentloaded' })
  await restored.locator('input[type=file]').setInputFiles(packed)
  await restored.locator('.project-card').first().waitFor()
  await restored.locator('.project-card .project-open').first().click()
  await restored.locator('.save-status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
  await restored.locator('details.calibrated-effects').evaluate((d) => {
    d.open = true
  })
  assert.equal(await restored.locator('#art-motion-speed').inputValue(), '0.6')
  const legacyId = await restored.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('astra-art-projects', 1)
        req.onerror = () => reject(req.error)
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction('projects', 'readwrite'),
            store = tx.objectStore('projects'),
            q = store.getAll()
          let id
          q.onsuccess = () => {
            const p = q.result[0]
            id = p.id
            delete p.settings.artEffectProfile
            delete p.settings.artMotionSpeed
            delete p.settings.artMotionStrength
            store.put(p)
          }
          tx.oncomplete = () => {
            db.close()
            resolve(id)
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )
  await restored.goto(`${base}/ascii-art?project=${legacyId}`, { waitUntil: 'domcontentloaded' })
  await restored.locator('.save-status').filter({ hasText: '已从此浏览器恢复' }).waitFor()
  await restored.locator('details.calibrated-effects').evaluate((d) => {
    d.open = true
  })
  assert(
    await restored
      .getByRole('button', { name: '经典光影', exact: true })
      .evaluate((b) => b.classList.contains('on')),
  )
  await fresh.close()
  // Touch held inside the actual canvas lights glyphs; release fades to the frozen ambient frame.
  await page.getByRole('button', { name: '暂停动效', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(500)
  await page.locator('.ascii-scroll canvas').scrollIntoViewIfNeeded()
  await page.mouse.move(0, 0)
  await page.waitForTimeout(1700)
  const touchBefore = await snapshot(),
    tb = await page.locator('.ascii-scroll canvas').boundingBox()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: tb.x + tb.width * 0.5, y: tb.y + tb.height * 0.4 }],
  })
  await page.waitForTimeout(500)
  assert.notEqual(await snapshot(), touchBefore)
  await page.screenshot({ path: path.join(out, 'touch-light-editor.png') })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await page.waitForTimeout(1700)
  await page.waitForFunction(
    () => document.querySelector('.ascii-scroll canvas')?.dataset.pointerStrength === '0',
  )
  assert((await snapshot()) === touchBefore, 'touch release must restore the frozen frame')
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  report.touch = { width: 390, heldGlow: true, releaseFade: true, noHorizontalOverflow: true }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {})
  report.failure = error.stack
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' })
  await browser.close()
  console.log(
    JSON.stringify({
      passed: report.passed,
      cases: report.api?.cases.length,
      ui: report.ui.length,
      errors: report.errors,
      output: out,
    }),
  )
}
