import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5196'
const production = process.env.ASTRA_UI_URL
const out = path.resolve(process.env.ASTRA_FONT_WEB_OUTPUT || `test-results/signature-font-web-${Date.now()}`)
assert.ok(production, 'A separately built production preview is required')
assert.equal(new URL(base).hostname, '127.0.0.1')
assert.equal(new URL(production).hostname, '127.0.0.1')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const report = { passed: false, browser: browser.version(), fonts: [], failures: [], readerRejections: [], weakNetwork: [], ui: null, errors: [] }
const bare = async () => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.route(`${base}/__signature_font_contract`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }))
  await page.goto(`${base}/__signature_font_contract`)
  return { context, page }
}
try {
  const { context, page } = await bare()
  const core = await page.evaluate(async () => {
    const { SIGNATURE_FONTS, loadSignatureFont, readTrueTypeCoverage, readWoff2Coverage } = await import('/src/lib/signature-portrait/fonts.ts')
    const { SIGNATURE_WEB_FONTS } = await import('/src/lib/signature-portrait/font-web.ts')
    const { renderSignatureVariant } = await import('/src/lib/signature-portrait/variants.ts')
    const rows = [], rejections = []
    const sheet = document.createElement('canvas'); sheet.width = 960; sheet.height = 6 * 174
    const sctx = sheet.getContext('2d'); sctx.fillStyle = '#f6f4ef'; sctx.fillRect(0, 0, sheet.width, sheet.height)
    const names = ['李云舟', '张思雨', '林晓晚', 'Astra', '李云舟 Astra', 'Alexander Montgomery']
    const styles = [
      { fontSize: 18, skewX: 0, skewY: 0, scaleX: 1, scaleY: 1, rotation: 0, tracking: 0, stroke: 0.2 },
      { fontSize: 72, skewX: 0, skewY: 0, scaleX: 1, scaleY: 1, rotation: 0, tracking: 0, stroke: 0.5 },
      { fontSize: 240, skewX: 0, skewY: 0, scaleX: 1, scaleY: 1, rotation: 0, tracking: 0.4, stroke: 0.8 },
      { fontSize: 75, skewX: 0.065, skewY: 0.017, scaleX: 1.1, scaleY: 0.94, rotation: 16 * Math.PI / 180, tracking: 0.6, stroke: 0.5 },
      { fontSize: 58, skewX: -0.065, skewY: -0.017, scaleX: 0.92, scaleY: 1.06, rotation: -16 * Math.PI / 180, tracking: -0.2, stroke: 0.4 },
    ]
    const hash = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) => v.toString(16).padStart(2, '0')).join('')
    for (const [index, descriptor] of SIGNATURE_FONTS.entries()) {
      const source = await (await fetch('/fonts/signature/' + descriptor.file)).arrayBuffer()
      const web = SIGNATURE_WEB_FONTS[descriptor.id]
      const encoded = await (await fetch('/fonts/signature/' + web.file)).arrayBuffer()
      if (await hash(source) !== descriptor.sha256 || await hash(encoded) !== web.sha256) throw Error('Pinned font changed')
      const originalCoverage = readTrueTypeCoverage(source), newCoverage = readWoff2Coverage(encoded)
      for (let cp = 0; cp <= 0x10ffff; cp++) if (originalCoverage(cp) !== newCoverage(cp)) throw Error('Unicode coverage differs at ' + cp)
      for (const cp of [-1, 1.5, NaN, Infinity, 0x110000]) if (newCoverage(cp)) throw Error('Invalid codepoint accepted')
      const originalFamily = 'Astra Canonical Comparison ' + descriptor.id
      document.fonts.add(await new FontFace(originalFamily, source, { style: 'normal', weight: '400' }).load())
      const family = await loadSignatureFont(descriptor.id, names.join(''))
      const cases = []
      for (const name of names) for (const [i, style] of styles.entries()) {
        const original = renderSignatureVariant(name, originalFamily, style, 420), current = renderSignatureVariant(name, family, style, 420)
        if (original.width !== current.width || original.height !== current.height) throw Error('Full name bounds changed')
        const a = original.getContext('2d').getImageData(0, 0, original.width, original.height).data
        const b = current.getContext('2d').getImageData(0, 0, current.width, current.height).data
        if (a.length !== b.length || a.some((v, at) => v !== b[at])) throw Error('Canonical font pixels changed: ' + descriptor.id + '/' + name + '/' + i)
        cases.push({ name, style: i, width: current.width, height: current.height, rgbaSha256: await hash(b), differingBytes: 0 })
        if ((name === '李云舟' || name === 'Alexander Montgomery') && i === 1) {
          const x = name === '李云舟' ? 20 : 500, y = index * 174
          sctx.fillStyle = '#203029'; sctx.font = '15px sans-serif'; sctx.fillText(descriptor.name + ' · ' + name, x, y + 24)
          sctx.drawImage(current, x, y + 40)
        }
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      rows.push({ id: descriptor.id, family: descriptor.family, unicodeCodepointsCompared: 0x110000, pixelCases: cases, sourceBytes: source.byteLength, webBytes: encoded.byteLength })
      if (index === 0) {
        const offset = new DataView(encoded).getUint32(40)
        const mutations = [
          ['short-header', (v) => v.slice(0, 40)],
          ['invalid-magic', (v) => { new DataView(v).setUint32(0, 0); return v }],
          ['incorrect-length', (v) => { new DataView(v).setUint32(8, v.byteLength - 1); return v }],
          ['misaligned-private-data', (v) => { new DataView(v).setUint32(40, offset + 1); return v }],
          ['missing-private-data', (v) => { new DataView(v).setUint32(44, 0); return v }],
          ['private-data-overflow', (v) => { new DataView(v).setUint32(44, v.byteLength); return v }],
          ['unknown-cmap-marker', (v) => { new DataView(v).setUint32(offset, 0); return v }],
          ['invalid-cmap-version', (v) => { new DataView(v).setUint16(offset + 4, 1); return v }],
          ['out-of-bounds-cmap-subtable', (v) => { new DataView(v).setUint32(offset + 12, 0xffffffff); return v }],
        ]
        for (const [name, mutate] of mutations) {
          let rejected = false
          try { readWoff2Coverage(mutate(encoded.slice(0))) } catch { rejected = true }
          if (!rejected) throw Error('Malformed font accepted: ' + name)
          rejections.push(name)
        }
      }
    }
    return { rows, rejections, sheet: sheet.toDataURL('image/png').split(',')[1] }
  })
  report.fonts = core.rows; report.readerRejections = core.rejections
  assert.equal(report.fonts.length, 6)
  assert.equal(report.fonts.reduce((sum, row) => sum + row.pixelCases.length, 0), 180)
  await writeFile(path.join(out, 'six-fonts-lossless.png'), Buffer.from(core.sheet, 'base64'))
  await context.close()

  for (const fault of ['http503', 'same-size-checksum', 'truncated']) {
    const { context, page } = await bare()
    await page.route('**/fonts/signature/*.woff2', async (route) => {
      if (fault === 'http503') { await route.fulfill({ status: 503, body: 'unavailable' }); return }
      const response = await route.fetch(), bytes = await response.body()
      if (fault === 'same-size-checksum') bytes[bytes.length - 1] ^= 1
      await route.fulfill({ response, body: fault === 'truncated' ? bytes.subarray(0, bytes.length - 1) : bytes })
    })
    const message = await page.evaluate(async () => {
      try { await (await import('/src/lib/signature-portrait/fonts.ts')).loadSignatureFont('mashanzheng', '李云舟'); return 'unexpected-success' }
      catch (e) { return e.message }
    })
    assert.notEqual(message, 'unexpected-success')
    if (fault === 'same-size-checksum') assert.match(message, /校验失败/)
    await page.unrouteAll({ behavior: 'wait' })
    const recovered = await page.evaluate(async () => (await import('/src/lib/signature-portrait/fonts.ts')).loadSignatureFont('mashanzheng', '李云舟'))
    assert.equal(recovered, 'Astra Signature Ma Shan Zheng')
    report.failures.push({ fault, message, retry: true })
    await context.close()
  }
  const single = await bare()
  let requests = 0
  await single.page.route('**/fonts/signature/*.woff2', async (route) => { requests++; await new Promise((r) => setTimeout(r, 450)); await route.continue() })
  const shared = await single.page.evaluate(async () => {
    const { loadSignatureFont } = await import('/src/lib/signature-portrait/fonts.ts')
    const controller = new AbortController(), start = performance.now()
    setTimeout(() => controller.abort(), 30)
    const canceled = loadSignatureFont('longcang', '李云舟', controller.signal).catch((e) => ({ name: e.name, elapsed: performance.now() - start }))
    const kept = loadSignatureFont('longcang', '张思雨')
    const [a, b] = await Promise.all([canceled, kept])
    let missing
    try { await loadSignatureFont('longcang', '𠮷·') } catch (e) { missing = e.message }
    return { canceled: a, kept: b, missing }
  })
  assert.equal(requests, 1); assert.equal(shared.canceled.name, 'AbortError'); assert.ok(shared.canceled.elapsed < 250)
  assert.equal(shared.kept, 'Astra Signature Long Cang'); assert.match(shared.missing, /不支持/)
  report.failures.push({ fault: 'canceled-concurrent-caller', requests, ...shared })
  await single.context.close()

  // Serial CDP network measurements: full uncached font transfers, 4 MiBit/s, 80ms latency.
  for (const format of ['canonical-ttf', 'woff2']) {
    const { context, page } = await bare()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 80, downloadThroughput: 512 * 1024, uploadThroughput: 1024 * 1024 })
    const measured = await page.evaluate(async (format) => {
      const { SIGNATURE_FONTS, loadSignatureFont, readTrueTypeCoverage } = await import('/src/lib/signature-portrait/fonts.ts')
      const descriptor = SIGNATURE_FONTS[0]
      const frames = [], tasks = []; let last = performance.now(), running = true
      const tick = (now) => { frames.push(now - last); last = now; if (running) requestAnimationFrame(tick) }; requestAnimationFrame(tick)
      const observer = new PerformanceObserver((list) => { for (const entry of list.getEntries()) tasks.push(entry.duration) })
      observer.observe({ type: 'longtask', buffered: false })
      const start = performance.now()
      if (format === 'canonical-ttf') {
        const bytes = await (await fetch('/fonts/signature/' + descriptor.file, { cache: 'no-store', signal: AbortSignal.timeout(15000) })).arrayBuffer()
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (v) => v.toString(16).padStart(2, '0')).join('')
        if (digest !== descriptor.sha256 || !readTrueTypeCoverage(bytes)(0x674e)) throw Error('Canonical baseline invalid')
        document.fonts.add(await new FontFace('Astra Serial Canonical', bytes, { style: 'normal', weight: '400' }).load())
      } else await loadSignatureFont(descriptor.id, '李云舟')
      const elapsedMs = performance.now() - start
      await new Promise((r) => setTimeout(r, 100)); running = false; observer.disconnect()
      const sorted = frames.slice(1).sort((a, b) => a - b)
      const resource = performance.getEntriesByType('resource').filter((r) => r.name.includes('/fonts/signature/')).at(-1)
      return { elapsedMs, bodyBytes: resource.encodedBodySize, decodedBodyBytes: resource.decodedBodySize, transferBytes: resource.transferSize,
        contentEncodingAlreadyApplied: resource.encodedBodySize !== resource.decodedBodySize, frames: sorted.length,
        rafP95: sorted[Math.floor(sorted.length * .95)], rafMax: sorted.at(-1), mainThreadLongTasks: tasks }
    }, format)
    report.weakNetwork.push({ format, downloadBytesPerSecond: 512 * 1024, latencyMs: 80, cacheDisabled: true, ...measured })
    await context.close()
  }
  assert.ok(report.weakNetwork[1].bodyBytes < report.weakNetwork[0].bodyBytes)
  report.weakNetworkImprovement = 1 - report.weakNetwork[1].elapsedMs / report.weakNetwork[0].elapsedMs

  const uiContext = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
  const ui = await uiContext.newPage(), fontRequests = []
  let failFont = true
  ui.on('pageerror', (e) => report.errors.push(e.message))
  await ui.route('**/fonts/signature/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname
    assert.ok(pathname.endsWith('.woff2'), 'Production must not download the canonical full TTF')
    fontRequests.push(pathname)
    if (failFont) { await route.fulfill({ status: 503, body: 'owned font failure' }); return }
    await new Promise((r) => setTimeout(r, 450)); await route.continue()
  })
  await ui.goto(production + '/signature-portrait')
  await ui.getByRole('button', { name: '重新加载字体', exact: true }).waitFor()
  failFont = false
  await ui.getByRole('button', { name: '重新加载字体', exact: true }).click()
  await ui.locator('.font-preview').getByText('正在加载字体…', { exact: true }).waitFor()
  await ui.waitForFunction(() => !document.querySelector('.font-preview [role=alert]') && document.querySelector('.font-preview .sample')?.textContent !== '正在加载字体…')
  await ui.getByLabel('名字', { exact: true }).fill('李云舟')
  for (const { id, family } of report.fonts) {
    await ui.getByLabel('书写字体', { exact: true }).selectOption(id)
    await ui.waitForFunction((family) => {
      const sample = document.querySelector('.font-preview .sample')
      return sample?.textContent === '李云舟' && getComputedStyle(sample).fontFamily.includes(family) && document.fonts.check(`400 32px "${family}"`)
    }, family)
  }
  const panel = ui.locator('.source-panel')
  for (const theme of ['light', 'dark']) {
    await ui.setViewportSize({ width: 1440, height: 960 })
    if (await ui.locator('html').getAttribute('data-theme') !== theme) await ui.getByRole('button', { name: theme === 'dark' ? '切换到暗色' : '切换到亮色', exact: true }).click()
    await panel.screenshot({ path: path.join(out, `font-web-${theme}-desktop.png`) })
    await ui.setViewportSize({ width: 390, height: 844 })
    assert.ok(await ui.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await panel.screenshot({ path: path.join(out, `font-web-${theme}-mobile.png`) })
  }
  report.ui = { retryConfirmed: true, sixFontSwitches: true, onlyWoff2: true, delayedFontMs: 450, fontRequests, bothThemes: true, mobileWidth: 390 }
  await uiContext.close()
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (e) { report.failure = String(e); process.exitCode = 1 }
finally { await browser.close(); await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n') }
console.log(JSON.stringify({ out, passed: report.passed, failure: report.failure, fonts: report.fonts.length, pixelCases: report.fonts.reduce((sum, row) => sum + row.pixelCases.length, 0), rejections: report.readerRejections.length, failures: report.failures.length, weakNetwork: report.weakNetwork }))
