import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5210'
const production = process.env.ASTRA_UI_URL
const coreOnly = process.env.ASTRA_SUBSET_PHASE === 'core'
const out = path.resolve(process.env.ASTRA_SUBSET_OUTPUT || `test-results/signature-font-subsets-${Date.now()}`)
assert.equal(new URL(base).hostname, '127.0.0.1')
if (!coreOnly) assert.equal(new URL(production).hostname, '127.0.0.1')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const report = { passed: false, browser: browser.version(), phase: coreOnly ? 'core' : 'all', fonts: [], rejections: [], faults: [], cancellations: [], weakNetwork: [], ui: null, errors: [] }
async function bare() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.route(`${base}/__signature_subset_contract`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto(`${base}/__signature_subset_contract`)
  return { context, page }
}
const fontPath = '**/fonts/signature/**'
try {
  const { context, page } = await bare()
  const core = await page.evaluate(async () => {
    const { SIGNATURE_FONTS, loadSignatureFont, readTrueTypeCoverage } = await import('/src/lib/signature-portrait/fonts.ts')
    const { SIGNATURE_FONT_SUBSETS } = await import('/src/lib/signature-portrait/font-subsets.ts')
    const { readSubsetManifest, isSubsetName } = await import('/src/lib/signature-portrait/font-subset-loader.ts')
    const { renderSignatureVariant } = await import('/src/lib/signature-portrait/variants.ts')
    const names = ['李云舟', '张思雨', '林晓晚', '欧阳修', '一丁七', '左右天地']
    const fallback = ['AV ff fi', '李云舟 Astra', 'Alexander Montgomery']
    const styles = [
      { fontSize: 18, skewX: 0, skewY: 0, scaleX: 1, scaleY: 1, rotation: 0, tracking: 0, stroke: 0.2 },
      { fontSize: 72, skewX: 0, skewY: 0, scaleX: 1, scaleY: 1, rotation: 0, tracking: 0, stroke: 0.5 },
      { fontSize: 240, skewX: 0, skewY: 0, scaleX: 1, scaleY: 1, rotation: 0, tracking: 0.4, stroke: 0.8 },
      { fontSize: 75, skewX: 0.065, skewY: 0.017, scaleX: 1.1, scaleY: 0.94, rotation: 16 * Math.PI / 180, tracking: 0.6, stroke: 0.5 },
      { fontSize: 58, skewX: -0.065, skewY: -0.017, scaleX: 0.92, scaleY: 1.06, rotation: -16 * Math.PI / 180, tracking: -0.2, stroke: 0.4 },
    ]
    const check = (value, label) => { if (!value) throw Error(label) }
    check(names.every(isSubsetName) && isSubsetName('李'.repeat(32)), 'pure CJK eligibility')
    check([...fallback, '', '李 '.trimEnd() + ' ', '𠮷', '㐀', '李'.repeat(33)].every((n) => !isSubsetName(n)), 'fallback eligibility')
    const hash = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) => v.toString(16).padStart(2, '0')).join('')
    const sheet = document.createElement('canvas'); sheet.width = 960; sheet.height = 6 * 174
    const sctx = sheet.getContext('2d'); sctx.fillStyle = '#f6f4ef'; sctx.fillRect(0, 0, sheet.width, sheet.height)
    const rows = [], rejections = []
    for (const [index, descriptor] of SIGNATURE_FONTS.entries()) {
      const source = await (await fetch('/fonts/signature/' + descriptor.file)).arrayBuffer()
      check(await hash(source) === descriptor.sha256, 'Pinned TTF source changed')
      const transport = SIGNATURE_FONT_SUBSETS[descriptor.id]
      const encoded = await (await fetch('/fonts/signature/cjk/' + transport.file)).arrayBuffer()
      check(await hash(encoded) === transport.sha256 && encoded.byteLength === transport.bytes, 'Pinned manifest changed')
      const raw = JSON.parse(new TextDecoder().decode(encoded))
      const manifest = readSubsetManifest(raw, descriptor.sha256), originalCoverage = readTrueTypeCoverage(source)
      let supported = 0, missing
      for (let cp = 0x4e00; cp <= 0x9fff; cp++) {
        const present = Boolean(manifest.coverage[(cp - 0x4e00) >> 3] & (1 << ((cp - 0x4e00) & 7)))
        check(present === originalCoverage(cp), 'CJK manifest coverage changed at ' + cp)
        if (present) supported++; else missing ??= String.fromCodePoint(cp)
      }
      if (index === 0) {
        const mutations = [
          ['null', () => null], ['version', (v) => ({ ...v, version: 2 })],
          ['source', (v) => ({ ...v, sourceSha256: '0'.repeat(64) })],
          ['domain', (v) => ({ ...v, start: 0x4d00 })], ['block', (v) => ({ ...v, block: 128 })],
          ['short-coverage', (v) => ({ ...v, coverage: v.coverage.slice(4) })],
          ['bad-base64', (v) => ({ ...v, coverage: '!' + v.coverage.slice(1) })],
          ['empty-shards', (v) => ({ ...v, shards: [] })],
          ['duplicate-shard', (v) => ({ ...v, shards: [...v.shards, v.shards[0]] })],
          ['missing-covered-shard', (v) => ({ ...v, shards: v.shards.slice(1) })],
          ['unaligned-range', (v) => { v.shards[0].first++; return v }],
          ['bad-last', (v) => { v.shards[0].last--; return v }],
          ['traversal-path', (v) => { v.shards[0].file = '../font.woff2'; return v }],
          ['wrong-block-file', (v) => { v.shards[0].file = 'ffff-000000000000.woff2'; return v }],
          ['bad-bytes', (v) => { v.shards[0].bytes = 1; return v }],
          ['bad-hash', (v) => { v.shards[0].sha256 = 'no'; return v }],
        ]
        for (const [label, mutate] of mutations) {
          let rejected = false
          try { readSubsetManifest(mutate(structuredClone(raw)), descriptor.sha256) } catch { rejected = true }
          check(rejected, 'Malformed manifest accepted: ' + label); rejections.push(label)
        }
      }
      let unsupported
      const before = performance.getEntriesByType('resource').filter((r) => r.name.includes('/cjk/') && r.name.endsWith('.woff2')).length
      try { await loadSignatureFont(descriptor.id, missing) } catch (e) { unsupported = e.message }
      check(unsupported?.includes('不支持'), 'Missing CJK glyph must reject')
      check(before === performance.getEntriesByType('resource').filter((r) => r.name.includes('/cjk/') && r.name.endsWith('.woff2')).length, 'Missing CJK downloaded a shard')
      const originalFamily = 'Astra Canonical CJK ' + descriptor.id
      document.fonts.add(await new FontFace(originalFamily, source, { style: 'normal', weight: '400' }).load())
      const cases = []
      async function compare(name, scope) {
        const family = await loadSignatureFont(descriptor.id, name)
        for (const [i, style] of styles.entries()) {
          const original = renderSignatureVariant(name, originalFamily, style, 420), current = renderSignatureVariant(name, family, style, 420)
          check(original.width === current.width && original.height === current.height, 'Name bounds changed: ' + descriptor.id + '/' + name)
          const a = original.getContext('2d').getImageData(0, 0, original.width, original.height).data
          const b = current.getContext('2d').getImageData(0, 0, current.width, current.height).data
          check(a.length === b.length && !a.some((v, at) => v !== b[at]), 'Canonical pixels changed: ' + descriptor.id + '/' + name + '/' + i)
          cases.push({ scope, name, style: i, width: current.width, height: current.height, rgbaSha256: await hash(b), differingBytes: 0 })
          if (scope === 'cjk-shards' && (name === '李云舟' || name === '欧阳修') && i === 1) {
            const x = name === '李云舟' ? 20 : 500, y = index * 174
            sctx.fillStyle = '#203029'; sctx.font = '15px sans-serif'; sctx.fillText(descriptor.name + ' · ' + name, x, y + 24)
            sctx.drawImage(current, x, y + 40)
          }
          await new Promise((resolve) => setTimeout(resolve, 0))
        }
      }
      for (const name of names) await compare(name, 'cjk-shards')
      const shardRequests = performance.getEntriesByType('resource').filter((r) => r.name.includes('/cjk/' + descriptor.id + '/') && r.name.endsWith('.woff2')).length
      check(shardRequests > 0 && !performance.getEntriesByType('resource').some((r) => r.name.endsWith('/' + descriptor.file.replace('.ttf', '.woff2'))), 'CJK must use shards before full fallback')
      for (const name of fallback) await compare(name, 'full-fallback-after-shards')
      const beforeFullCjk = performance.getEntriesByType('resource').filter((r) => r.name.includes('/cjk/') && r.name.endsWith('.woff2')).length
      await compare('陈明华', 'full-font-reused-for-cjk')
      check(beforeFullCjk === performance.getEntriesByType('resource').filter((r) => r.name.includes('/cjk/') && r.name.endsWith('.woff2')).length, 'Loaded full font should cover later CJK')
      rows.push({ id: descriptor.id, family: descriptor.family, cjkCodepointsCompared: 20992, supportedMappings: supported, missing, missingRejectedBeforeShards: true, shardRequests, pixelCases: cases })
    }
    return { rows, rejections, sheet: sheet.toDataURL('image/png').split(',')[1] }
  })
  report.fonts = core.rows; report.rejections = core.rejections
  assert.equal(core.rows.length, 6)
  assert.equal(core.rows.flatMap((r) => r.pixelCases).filter((c) => c.scope === 'cjk-shards').length, 180)
  assert.equal(core.rows.flatMap((r) => r.pixelCases).length, 300)
  await writeFile(path.join(out, 'six-cjk-fonts-lossless.png'), Buffer.from(core.sheet, 'base64'))
  await context.close()

  for (const [target, fault] of [['manifest', 'http503'], ['manifest', 'same-size-checksum'], ['shard', 'http503'], ['shard', 'same-size-checksum'], ['shard', 'truncated']]) {
    const { context, page } = await bare()
    let hit = 0
    const pattern = target === 'manifest' ? '**/cjk/mashanzheng/*.json' : '**/cjk/mashanzheng/*.woff2'
    await page.route(pattern, async (route) => {
      hit++
      if (fault === 'http503') { await route.fulfill({ status: 503, body: 'unavailable' }); return }
      const response = await route.fetch(), bytes = await response.body()
      if (fault === 'same-size-checksum') bytes[bytes.length - 1] ^= 1
      await route.fulfill({ response, body: fault === 'truncated' ? bytes.subarray(0, bytes.length - 1) : bytes })
    })
    const message = await page.evaluate(async () => {
      try { await (await import('/src/lib/signature-portrait/fonts.ts')).loadSignatureFont('mashanzheng', '李云舟'); return 'unexpected-success' }
      catch (e) { return e.message }
    })
    assert.ok(hit > 0); assert.notEqual(message, 'unexpected-success')
    if (fault === 'same-size-checksum') assert.match(message, /校验失败/)
    if (fault === 'truncated') assert.match(message, /不完整/)
    // All sibling shard requests must settle before retrying their shared failed promises.
    await page.unrouteAll({ behavior: 'wait' })
    const recovered = await page.evaluate(async () => (await import('/src/lib/signature-portrait/fonts.ts')).loadSignatureFont('mashanzheng', '李云舟'))
    assert.equal(recovered, 'Astra Signature Ma Shan Zheng')
    report.faults.push({ target, fault, hit, message, retry: true }); await context.close()
  }
  const single = await bare(), requests = new Map()
  await single.page.route(fontPath, async (route) => {
    const pathname = new URL(route.request().url()).pathname
    requests.set(pathname, (requests.get(pathname) || 0) + 1)
    await new Promise((r) => setTimeout(r, 450)); await route.continue()
  })
  const shared = await single.page.evaluate(async () => {
    const { loadSignatureFont } = await import('/src/lib/signature-portrait/fonts.ts')
    const pre = new AbortController(); pre.abort()
    let preabort
    try { await loadSignatureFont('mashanzheng', '李云舟', pre.signal) } catch (e) { preabort = e.name }
    const resourceCountAfterPreabort = performance.getEntriesByType('resource').filter((r) => r.name.includes('/fonts/signature/')).length
    const controller = new AbortController(), start = performance.now()
    setTimeout(() => controller.abort(), 30)
    const canceled = loadSignatureFont('longcang', '李云舟', controller.signal).catch((e) => ({ name: e.name, elapsedMs: performance.now() - start }))
    const [a, b] = await Promise.all([canceled, loadSignatureFont('longcang', '李云舟')])
    return { preabort, resourceCountAfterPreabort, canceled: a, kept: b }
  })
  assert.equal(shared.preabort, 'AbortError'); assert.equal(shared.resourceCountAfterPreabort, 0)
  assert.equal(shared.canceled.name, 'AbortError'); assert.ok(shared.canceled.elapsedMs < 250)
  assert.equal(shared.kept, 'Astra Signature Long Cang')
  assert.equal(requests.size, 4); assert.ok([...requests.values()].every((n) => n === 1))
  report.cancellations.push({ ...shared, requests: Object.fromEntries(requests) }); await single.context.close()

  if (!coreOnly) {
    // Serial, uncached CDP measurements of one font/name at 4 MiBit/s and 80ms.
    for (const format of ['complete-woff2', 'cjk-shards']) {
      const { context, page } = await bare()
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
      await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 524288, uploadThroughput: 1048576 })
      const measured = await page.evaluate(async (format) => {
        const { loadSignatureFont } = await import('/src/lib/signature-portrait/fonts.ts')
        const frames = [], tasks = []; let last = performance.now(), running = true
        const tick = (now) => { frames.push(now - last); last = now; if (running) requestAnimationFrame(tick) }; requestAnimationFrame(tick)
        const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) tasks.push(entry.duration) })
        observer.observe({ type: 'longtask', buffered: false })
        const start = performance.now()
        await loadSignatureFont('mashanzheng', format === 'complete-woff2' ? 'Astra' : '李云舟')
        const elapsedMs = performance.now() - start
        await new Promise((r) => setTimeout(r, 100)); running = false; observer.disconnect()
        const sorted = frames.slice(1).sort((a, b) => a - b)
        const resources = performance.getEntriesByType('resource').filter((r) => r.name.includes('/fonts/signature/')).map((r) => ({ path: new URL(r.name).pathname, bodyBytes: r.encodedBodySize, decodedBodyBytes: r.decodedBodySize, transferBytes: r.transferSize }))
        return { elapsedMs, resources, bodyBytes: resources.reduce((n, r) => n + r.bodyBytes, 0), transferBytes: resources.reduce((n, r) => n + r.transferBytes, 0), frames: sorted.length, rafP95: sorted[Math.floor(sorted.length * .95)], rafMax: sorted.at(-1), mainThreadLongTasks: tasks }
      }, format)
      report.weakNetwork.push({ format, downloadBytesPerSecond: 524288, latencyMs: 80, cacheDisabled: true, ...measured }); await context.close()
    }
    assert.equal(report.weakNetwork[0].resources.length, 1); assert.equal(report.weakNetwork[1].resources.length, 4)
    assert.ok(report.weakNetwork[1].bodyBytes < report.weakNetwork[0].bodyBytes)

    const uiContext = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
    const ui = await uiContext.newPage(), fontRequests = []
    let failFont = true
    ui.on('pageerror', (e) => report.errors.push(e.message))
    await ui.route(fontPath, async (route) => {
      const pathname = new URL(route.request().url()).pathname
      assert.ok(pathname.endsWith('.json') || pathname.endsWith('.woff2'), 'Production downloaded canonical TTF')
      assert.ok(pathname.includes('/cjk/'), 'Pure CJK preview downloaded complete font')
      fontRequests.push(pathname)
      if (failFont) { await route.fulfill({ status: 503, body: 'owned subset failure' }); return }
      await new Promise((r) => setTimeout(r, 450)); await route.continue()
    })
    await ui.goto(production + '/signature-portrait')
    await ui.getByRole('button', { name: '重新加载字体', exact: true }).waitFor()
    failFont = false
    await ui.getByRole('button', { name: '重新加载字体', exact: true }).click()
    await ui.locator('.font-preview').getByText('正在加载字体…', { exact: true }).waitFor()
    for (const { id, family } of report.fonts) {
      await ui.getByLabel('名字', { exact: true }).fill('李云舟')
      await ui.getByLabel('书写字体', { exact: true }).selectOption(id)
      await ui.waitForFunction(({ family, text }) => {
        const sample = document.querySelector('.font-preview .sample')
        return sample?.textContent === text && getComputedStyle(sample).fontFamily.includes(family) && document.fonts.check(`400 32px "${family}"`, text)
      }, { family, text: '李云舟' })
    }
    const beforeNewName = fontRequests.length
    await ui.getByLabel('名字', { exact: true }).fill('陈明华')
    await ui.waitForFunction(() => document.querySelector('.font-preview .sample')?.textContent === '陈明华')
    assert.ok(fontRequests.length > beforeNewName, 'New CJK blocks must load after editing name')
    const panel = ui.locator('.source-panel')
    for (const theme of ['light', 'dark']) {
      await ui.setViewportSize({ width: 1440, height: 960 })
      if (await ui.locator('html').getAttribute('data-theme') !== theme) await ui.getByRole('button', { name: theme === 'dark' ? '切换到暗色' : '切换到亮色', exact: true }).click()
      await panel.screenshot({ path: path.join(out, `cjk-subsets-${theme}-desktop.png`) })
      await ui.setViewportSize({ width: 390, height: 844 })
      assert.ok(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await panel.screenshot({ path: path.join(out, `cjk-subsets-${theme}-mobile.png`) })
    }
    report.ui = { retryConfirmed: true, delayedFontMs: 450, sixFontSwitches: true, newNameLoadsNewBlocks: true, onlyCjkShardsAndManifests: true, fontRequests, bothThemes: true, mobileWidth: 390 }
    await uiContext.close()
  }
  assert.deepEqual(report.errors, []); report.passed = true
} catch (e) { report.failure = String(e); process.exitCode = 1 }
finally { await browser.close(); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n') }
console.log(JSON.stringify({ out, passed: report.passed, failure: report.failure, fonts: report.fonts.length, pixelCases: report.fonts.flatMap((r) => r.pixelCases).length, rejections: report.rejections.length, faults: report.faults.length, weakNetwork: report.weakNetwork }))
