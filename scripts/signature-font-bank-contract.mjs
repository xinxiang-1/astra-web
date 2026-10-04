import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const output = path.resolve(
  process.env.ASTRA_SIGNATURE_FONT_OUTPUT || `test-results/signature-font-bank-${Date.now()}`,
)
await mkdir(output, { recursive: true })
const browser = await chromium.launch({
  headless: true,
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
})
const report = {
  browser: browser.version(),
  fontLoading: [],
  geometry: [],
  banks: null,
  ui: null,
  errors: [],
}
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
})
async function newPage() {
  const page = await context.newPage()
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(`${base}/signature-portrait`)
  return page
}
try {
  const page = await newPage()
  let requests = 0
  await page.route('**/fonts/signature/*.ttf', async (route) => {
    requests++
    await new Promise((resolve) => setTimeout(resolve, 450))
    await route.continue()
  })
  const deterministic = await page.evaluate(async () => {
    const { generateHandwritingVariants } = await import('/src/lib/signature-portrait/variants.ts')
    const hash = async (canvas) =>
      Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data,
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    const start = performance.now()
    const [first, second] = await Promise.all([
      generateHandwritingVariants('李云舟', { count: 8, seed: 42 }),
      generateHandwritingVariants('李云舟', { count: 8, seed: 42 }),
    ])
    const elapsed = performance.now() - start
    const hashes = await Promise.all(first.map((s) => hash(s.canvas)))
    const repeated = await Promise.all(second.map((s) => hash(s.canvas)))
    const alternate = await generateHandwritingVariants('李云舟', { count: 8, seed: 43 })
    return {
      hashes,
      repeated,
      alternate: await hash(alternate[0].canvas),
      elapsed,
      loaded: document.fonts.check('400 72px "Astra Signature Ma Shan Zheng"'),
      source: first[0].source,
    }
  })
  assert.equal(requests, 1, 'Concurrent generators must share one font load')
  assert(deterministic.loaded && deterministic.elapsed >= 450)
  assert.deepEqual(deterministic.hashes, deterministic.repeated)
  assert.notEqual(deterministic.hashes[0], deterministic.alternate)
  report.fontLoading.push({
    case: 'cold-delayed-single-flight-determinism',
    requests,
    ...deterministic,
  })
  const coverage = await page.evaluate(async () => {
    const { loadSignatureFont, readTrueTypeCoverage } =
      await import('/src/lib/signature-portrait/fonts.ts')
    const { generateHandwritingVariants } = await import('/src/lib/signature-portrait/variants.ts')
    const failures = []
    for (const options of [{ count: NaN }, { count: 8.5 }, { seed: -1 }, { maxSide: 20 }]) {
      try {
        await generateHandwritingVariants('Astra', options)
        failures.push('unexpected-success')
      } catch (e) {
        failures.push(e.message)
      }
    }
    try {
      await loadSignatureFont('mashanzheng', '𠮷·')
      failures.push('unexpected-success')
    } catch (e) {
      failures.push(e.message)
    }
    try {
      readTrueTypeCoverage(new ArrayBuffer(12))
      failures.push('unexpected-success')
    } catch (e) {
      failures.push(e.message)
    }
    const controller = new AbortController()
    controller.abort()
    let abortName
    try {
      await generateHandwritingVariants('Astra', { signal: controller.signal })
      abortName = 'unexpected-success'
    } catch (e) {
      abortName = e.name
    }
    return { failures, abortName }
  })
  assert(!coverage.failures.includes('unexpected-success'))
  assert.equal(coverage.abortName, 'AbortError')
  report.fontLoading.push({ case: 'missing-glyph-invalid-input-preabort', ...coverage })

  for (const fault of ['http', 'checksum', 'cancel-loading', 'cancel-generation']) {
    const faultPage = await newPage()
    await faultPage.route('**/fonts/signature/*.ttf', async (route) => {
      if (fault === 'http') await route.fulfill({ status: 503, body: 'unavailable' })
      else if (fault === 'checksum') await route.fulfill({ status: 200, body: 'invalid-font' })
      else {
        await new Promise((resolve) => setTimeout(resolve, 300))
        await route.continue()
      }
    })
    const failure = await faultPage.evaluate(async (fault) => {
      const { generateHandwritingVariants } =
        await import('/src/lib/signature-portrait/variants.ts')
      const controller = new AbortController()
      const start = performance.now()
      if (fault === 'cancel-loading') setTimeout(() => controller.abort(), 30)
      try {
        await generateHandwritingVariants('张思雨', {
          count: 100,
          signal: controller.signal,
          onProgress: (r) => {
            if (fault === 'cancel-generation' && r > 0) controller.abort()
          },
        })
        return { name: 'unexpected-success' }
      } catch (e) {
        return { name: e.name, message: e.message, elapsed: performance.now() - start }
      }
    }, fault)
    assert.notEqual(failure.name, 'unexpected-success')
    if (fault.startsWith('cancel')) assert.equal(failure.name, 'AbortError')
    if (fault === 'cancel-loading') assert(failure.elapsed < 250)
    await faultPage.unrouteAll({ behavior: 'wait' })
    const retry = await faultPage.evaluate(
      async () =>
        (
          await (
            await import('/src/lib/signature-portrait/variants.ts')
          ).generateHandwritingVariants('张思雨', { count: 8 })
        ).length,
    )
    assert.equal(retry, 8, 'Failed or canceled caller must permit successful retry')
    report.fontLoading.push({ case: fault, ...failure, retry })
    await faultPage.close()
  }

  const geometry = await page.evaluate(async () => {
    const { generateHandwritingVariants, renderSignatureVariant } =
      await import('/src/lib/signature-portrait/variants.ts')
    const { generateHandwritingVariants: baseline } =
      await import('/scripts/fixtures/signature-variants-v1.ts')
    const { loadSignatureFont } = await import('/src/lib/signature-portrait/fonts.ts')
    const names = [
      'Astra',
      '李云舟',
      '张思雨',
      'Alexander Montgomery',
      '把名字写成光',
      '李-云舟 Astra',
    ]
    function traits(stamp) {
      const data = stamp.canvas.getContext('2d').getImageData(0, 0, stamp.width, stamp.height).data
      let mass = 0,
        edge = 0
      for (let y = 0; y < stamp.height; y++)
        for (let x = 0; x < stamp.width; x++) {
          const a = data[(y * stamp.width + x) * 4 + 3] / 255
          mass += a
          if (x < 4 || y < 4 || x >= stamp.width - 4 || y >= stamp.height - 4) edge += a
        }
      return { mass, edge, coverage: mass / (stamp.width * stamp.height) }
    }
    function capacity(stamps) {
      const angle = ((12 * Math.PI) / 180) * 0.35,
        c = Math.cos(angle),
        s = Math.sin(angle)
      const aspect = stamps.reduce((n, t) => n + t.width / t.height, 0) / stamps.length
      const values = stamps
        .map((t) => {
          const scale =
            Math.min(aspect / (t.width * c + t.height * s), 1 / (t.width * s + t.height * c)) * 0.94
          return (traits(t).mass * scale * scale) / aspect
        })
        .sort((a, b) => a - b)
      return values[Math.floor(values.length * 0.25)]
    }
    const rows = [],
      sheets = []
    for (const name of names) {
      const old = await baseline(name, { count: 40, seed: 20261004 })
      for (const font of ['mashanzheng', 'longcang']) {
        const stamps = await generateHandwritingVariants(name, { font, count: 40, seed: 20261004 })
        const metrics = stamps.map(traits)
        rows.push({
          name,
          font,
          count: stamps.length,
          oldCapacityP25: capacity(old),
          capacityP25: capacity(stamps),
          edgeAlpha: metrics.reduce((v, t) => v + t.edge, 0),
          maxSide: Math.max(...stamps.map((t) => Math.max(t.width, t.height))),
        })
        sheets.push({ name, font, stamps: stamps.slice(0, 5) })
      }
    }
    const sheet = document.createElement('canvas')
    sheet.width = 1200
    sheet.height = sheets.length * 102
    const sheetCtx = sheet.getContext('2d')
    sheetCtx.fillStyle = '#f5f3ef'
    sheetCtx.fillRect(0, 0, sheet.width, sheet.height)
    sheets.forEach((r, i) => {
      sheetCtx.fillStyle = '#34302b'
      sheetCtx.font = '16px sans-serif'
      sheetCtx.fillText(`${r.font} · ${r.name}`, 12, i * 102 + 19)
        r.stamps.forEach((t, j) => {
          const scale = Math.min(220 / t.width, 60 / t.height, 1)
          sheetCtx.drawImage(t.canvas, 20 + j * 235, i * 102 + 30, t.width * scale, t.height * scale)
        })
    })
    // Independent oversized canvas uses chained operations, not the allocator's corner formula.
    const references = []
    for (const font of ['mashanzheng', 'longcang']) {
      const name = 'Alexander Montgomery 李云舟'
      const family = await loadSignatureFont(font, name)
      for (const degrees of [-16, 16]) {
        const style = {
          fontSize: 75,
          skewX: 0.065,
          skewY: -0.0175,
          scaleX: 1.14,
          scaleY: 1.06,
          rotation: (degrees * Math.PI) / 180,
          tracking: 0.78,
          stroke: 0.8,
        }
        const created = [],
          original = document.createElement.bind(document)
        document.createElement = function (...args) {
          const e = original(...args)
          if (args[0] === 'canvas') created.push(e)
          return e
        }
        let cropped
        try {
          cropped = renderSignatureVariant(name, family, style, 1024)
        } finally {
          document.createElement = original
        }
        const raw = created[1],
          ref = original('canvas')
        ref.width = 4096
        ref.height = 2048
        const ctx = ref.getContext('2d')
        ctx.font = `400 75px "${family}"`
        ctx.textAlign = 'left'
        ctx.textBaseline = 'alphabetic'
        ctx.letterSpacing = '.78px'
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.lineWidth = 0.8
        ctx.strokeStyle = '#121018'
        ctx.fillStyle = '#121018'
        ctx.translate(512, 1024)
        ctx.rotate(style.rotation)
        ctx.transform(1, style.skewY, style.skewX, 1, 0, 0)
        ctx.scale(style.scaleX, style.scaleY)
        ctx.strokeText(name, 0, 0)
        ctx.fillText(name, 0, 0)
        function bounds(canvas) {
          const p = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
          let x0 = canvas.width,
            y0 = canvas.height,
            x1 = -1,
            y1 = -1,
            mass = 0
          for (let y = 0; y < canvas.height; y++)
            for (let x = 0; x < canvas.width; x++) {
              const a = p[(y * canvas.width + x) * 4 + 3]
              mass += a
              if (a) {
                x0 = Math.min(x0, x)
                y0 = Math.min(y0, y)
                x1 = Math.max(x1, x)
                y1 = Math.max(y1, y)
              }
            }
          return { width: x1 - x0 + 1, height: y1 - y0 + 1, mass }
        }
        const actual = bounds(raw),
          expected = bounds(ref)
        references.push({
          font,
          degrees,
          actual,
          expected,
          massError: Math.abs(actual.mass - expected.mass) / expected.mass,
          edgeAlpha: traits({ canvas: cropped, width: cropped.width, height: cropped.height }).edge,
        })
      }
    }
    return { rows, references, sheet: sheet.toDataURL('image/png').split(',')[1] }
  })
  for (const row of geometry.rows) {
    assert.equal(row.edgeAlpha, 0)
    assert(row.maxSide <= 420 && row.capacityP25 > 0)
  }
  for (const ref of geometry.references) {
    assert(
      Math.abs(ref.actual.width - ref.expected.width) <= 1 &&
        Math.abs(ref.actual.height - ref.expected.height) <= 1,
    )
    assert(ref.massError < 0.001, 'Allocated ink must match the oversized independent reference')
    assert.equal(ref.edgeAlpha, 0)
  }
  await writeFile(path.join(output, 'font-variations.png'), Buffer.from(geometry.sheet, 'base64'))
  delete geometry.sheet
  report.geometry = geometry

  report.banks = await page.evaluate(async () => {
    const bank = await import('/src/lib/signature-portrait/bank.ts')
    const { createTextStamp } = await import('/src/lib/signature-portrait/extract.ts')
    const { generateHandwritingVariants } = await import('/src/lib/signature-portrait/variants.ts')
    const label = 'contract-old-handwriting',
      otherLabel = 'contract-unrelated'
    const a = await bank.ensureBank(label),
      b = await bank.ensureBank(otherLabel)
    await bank.addStampToBank(a.id, createTextStamp('Astra', { id: 'legacy' }))
    await bank.addStampToBank(b.id, createTextStamp('Keep', { id: 'other' }))
    const variants = await generateHandwritingVariants('李云舟', { count: 8 })
    async function snapshot(id) {
      const database = await new Promise((resolve, reject) => {
        const r = indexedDB.open('astra-signature-bank', 1)
        r.onsuccess = () => resolve(r.result)
        r.onerror = () => reject(r.error)
      })
      try {
        const rows = await new Promise((resolve, reject) => {
          const r = database
            .transaction('entries', 'readonly')
            .objectStore('entries')
            .index('byBank')
            .getAll(id)
          r.onsuccess = () => resolve(r.result)
          r.onerror = () => reject(r.error)
        })
        const records = await Promise.all(
          rows.map(async ({ png, ...meta }) => {
            const digest = await crypto.subtle.digest('SHA-256', await png.arrayBuffer())
            return { ...meta, hash: Array.from(new Uint8Array(digest)).join(',') }
          }),
        )
        return { bank: await bank.getBank(id), rows: records }
      } finally {
        database.close()
      }
    }
    const before = await snapshot(a.id),
      other = await snapshot(b.id),
      checks = []
    async function preserved(name, run) {
      let error
      try {
        await run()
        error = 'unexpected-success'
      } catch (e) {
        error = e.message
      }
      const unchanged = JSON.stringify(await snapshot(a.id)) === JSON.stringify(before)
      checks.push({ name, error, unchanged })
    }
    const originalToBlob = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (cb) {
      cb(null)
    }
    try {
      await preserved('png-encode-failure', () =>
        bank.replaceBankStamps(label, variants, { expected: before.bank }),
      )
    } finally {
      HTMLCanvasElement.prototype.toBlob = originalToBlob
    }
    const originalAdd = IDBObjectStore.prototype.add
    let writes = 0
    IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'entries' && ++writes === 2)
        throw new DOMException('Injected storage failure', 'QuotaExceededError')
      return originalAdd.apply(this, args)
    }
    try {
      await preserved('transaction-rollback-after-first-add', () =>
        bank.replaceBankStamps(label, variants, { expected: before.bank }),
      )
    } finally {
      IDBObjectStore.prototype.add = originalAdd
    }
    const controller = new AbortController()
    await preserved('cancel-png-preparation', () =>
      bank.replaceBankStamps(label, variants, {
        expected: before.bank,
        signal: controller.signal,
        onProgress: (r) => {
          if (r > 0) controller.abort()
        },
      }),
    )
    const successful = await bank.replaceBankStamps(label, variants, {
      expected: before.bank,
      goal: 100,
    })
    const loaded = await bank.loadBankAsStamps(a.id)
    const after = await snapshot(a.id)
    let staleRejected = false
    try {
      await bank.replaceBankStamps(label, variants, { expected: before.bank })
    } catch (e) {
      staleRejected = /更新/.test(e.message)
    }
    const conflictPreserved = JSON.stringify(await snapshot(a.id)) === JSON.stringify(after)
    const added = await Promise.all([
      bank.addStampsToBank(a.id, variants.slice(0, 3)),
      bank.addStampsToBank(a.id, variants.slice(3, 6)),
    ])
    const append = await bank.listBankEntries(a.id)
    await bank.deleteBankEntry(append[1].id)
    await bank.addStampToBank(a.id, variants[0])
    const afterDelete = await bank.listBankEntries(a.id)
    const concurrent = await Promise.all([
      bank.ensureBank('contract-concurrent'),
      bank.ensureBank('contract-concurrent'),
    ])
    let newConflictRejected = false
    try {
      await bank.replaceBankStamps(otherLabel, variants, { expected: null })
    } catch (e) {
      newConflictRejected = /更新/.test(e.message)
    }
    const legacy = await bank.loadBankAsStamps(b.id)
    const result = {
      checks,
      successful: {
        id: successful.bank.id,
        oldId: a.id,
        createdAt: successful.bank.createdAt,
        oldCreatedAt: before.bank.createdAt,
        count: successful.bank.count,
        monotonic: successful.bank.updatedAt > before.bank.updatedAt,
      },
      sourcePreserved: loaded.every(
        (s, i) => JSON.stringify(s.source) === JSON.stringify(variants[i].source),
      ),
      staleRejected,
      conflictPreserved,
      appendCount: (await bank.getBank(a.id)).count,
      appendIndices: append.map((e) => e.index),
      returnedAppend: added.map((v) => v.length),
      deleteAppendIndices: afterDelete.map((e) => e.index),
      singleConcurrentBank: concurrent[0].id === concurrent[1].id,
      newConflictRejected,
      unrelatedUnchanged: JSON.stringify(await snapshot(b.id)) === JSON.stringify(other),
      legacySourceAbsent: !legacy[0].source,
    }
    bank.revokeEntryUrls(append)
    for (const s of [...loaded, ...legacy]) URL.revokeObjectURL(s.previewUrl)
    return result
  })
  for (const check of report.banks.checks) {
    assert.notEqual(check.error, 'unexpected-success')
    assert(check.unchanged, check.name)
  }
  const b = report.banks
  assert.equal(b.successful.id, b.successful.oldId)
  assert.equal(b.successful.createdAt, b.successful.oldCreatedAt)
  assert.equal(b.successful.count, 8)
  for (const key of [
    'sourcePreserved',
    'staleRejected',
    'conflictPreserved',
    'singleConcurrentBank',
    'newConflictRejected',
    'unrelatedUnchanged',
    'legacySourceAbsent',
  ])
    assert(b[key], key)
  assert(b.successful.monotonic)
  assert.equal(b.appendCount, 14)
  assert.deepEqual(
    b.appendIndices,
    Array.from({ length: 14 }, (_, i) => i + 1),
  )
  assert.deepEqual(b.returnedAppend, [3, 3])
  assert.equal(new Set(b.deleteAppendIndices).size, 14)
  assert.equal(b.deleteAppendIndices.at(-1), 15)
  await page.close()

  // UI uses isolated storage: no user's real name bank is changed.
  const uiContext = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  const ui = await uiContext.newPage()
  ui.on('pageerror', (e) => report.errors.push(e.message))
  await ui.goto(`${base}/signature-portrait`)
  await ui.locator('input[maxlength="32"]').fill('李云舟')
  await ui.locator('input[type=number]').first().fill('10')
  await ui.getByRole('button', { name: '一键生成 10 种写法', exact: true }).click()
  await ui.waitForFunction(() => document.querySelectorAll('.bank-grid li').length === 10)
  await ui
    .locator('.source-panel')
    .screenshot({ path: path.join(output, 'desktop-source-controls.png') })
  const old = await ui.evaluate(async () => {
    const m = await import('/src/lib/signature-portrait/bank.ts')
    return (await m.listBanks()).find((b) => b.label === '李云舟')
  })
  await ui.getByRole('combobox', { name: '书写字体' }).selectOption('longcang')
  await ui.route('**/fonts/signature/LongCang-Regular.ttf', (route) =>
    route.fulfill({ status: 503, body: 'temporary failure' }),
  )
  ui.on('dialog', (dialog) => dialog.accept())
  await ui.getByRole('button', { name: '一键生成 10 种写法', exact: true }).click()
  await ui.locator('.error').waitFor({ state: 'visible' })
  const preserved = await ui.evaluate(
    async (old) =>
      JSON.stringify(
        await (await import('/src/lib/signature-portrait/bank.ts')).getBank(old.id),
      ) === JSON.stringify(old),
    old,
  )
  assert(preserved)
  await ui.unroute('**/fonts/signature/LongCang-Regular.ttf')
  await ui.locator('input[maxlength="32"]').fill('张思雨')
  await ui.getByRole('button', { name: '一键生成 10 种写法', exact: true }).click()
  await ui.waitForFunction(
    () =>
      document.querySelector('.bank-progress')?.textContent.includes('张思雨') &&
      document.querySelectorAll('.bank-grid li').length === 10,
  )
  const firstUnchanged = await ui.evaluate(
    async (old) =>
      JSON.stringify(
        await (await import('/src/lib/signature-portrait/bank.ts')).getBank(old.id),
      ) === JSON.stringify(old),
    old,
  )
  assert(firstUnchanged, 'Changing typed name must not delete the selected old bank')
  await ui.reload()
  await ui.waitForFunction(() =>
    document.querySelector('.bank-progress')?.textContent.includes('张思雨'),
  )
  await ui.setViewportSize({ width: 390, height: 844 })
  await ui.screenshot({ path: path.join(output, 'mobile-source-controls.png'), fullPage: true })
  const mobile = await ui.evaluate(() => ({
    width: innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    count: document.querySelectorAll('.bank-grid li').length,
  }))
  assert(mobile.scrollWidth <= mobile.width + 1)
  assert.equal(mobile.count, 10)
  report.ui = {
    failurePreserved: preserved,
    typedNamePreservedOther: firstUnchanged,
    reloaded: true,
    mobile,
  }
  await uiContext.close()
  assert.deepEqual(report.errors, [])
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify(
      {
        output,
        fontCases: report.fontLoading.length,
        geometryCases: report.geometry.references.length,
        banks: report.banks,
        ui: report.ui,
      },
      null,
      2,
    ),
  )
} catch (error) {
  await writeFile(
    path.join(output, 'failure.json'),
    JSON.stringify({ ...report, error: error.stack }, null, 2),
  )
  throw error
} finally {
  await browser.close()
}
