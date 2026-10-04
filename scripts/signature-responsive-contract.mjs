import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_RESPONSIVE_OUTPUT || `test-results/signature-responsive-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const baselineCommit = 'a7f219000beb884e8cd5d682f1ba0bf4ac97028c'
const original = execFileSync(
  'git',
  ['show', `${baselineCommit}:src/lib/signature-portrait/layout.ts`],
  { encoding: 'utf8' },
)
await writeFile(
  path.join(out, 'baseline.ts'),
  original.replace(/'\.\/([^']+)'/g, "'/src/lib/signature-portrait/$1'"),
)
const frozenUrl =
  '/' + path.relative(process.cwd(), path.join(out, 'baseline.ts')).split(path.sep).join('/')
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = {
  browser: browser.version(),
  baselineCommit,
  errors: [],
  cases: [],
  baselineSha256: createHash('sha256').update(original).digest('hex'),
}
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.goto(base + '/signature-portrait')
  report.cases = await page.evaluate(async (frozenUrl) => {
    const baseline = await import(frozenUrl),
      updated = await import('/src/lib/signature-portrait/layout.ts')
    const { createTextStamp } = await import('/src/lib/signature-portrait/extract.ts')
    const { createSignatureRasterWorker } =
      await import('/src/lib/signature-portrait/raster-worker-client.ts')
    const stamps = ['李云舟', 'Astra'].map((text) => createTextStamp(text))
    const placements = Array.from({ length: 1600 }, (_, i) => ({
      x: (i * 37) % 320,
      y: (i * 29) % 400,
      angle: ((i % 5) - 2) * 0.04,
      targetSize: 18 + (i % 26),
      stampIndex: i % 2,
      strength: 0.08 + (i % 9) / 12,
      tint: { r: 17 + (i % 210), g: 25 + ((i * 7) % 185), b: 34 + ((i * 11) % 172) },
      blend: i % 3 ? 'ink' : 'soft',
      depth: (i % 7) / 7,
    }))
    const compare = (a, b) => {
      const aa = a.getContext('2d').getImageData(0, 0, a.width, a.height).data,
        bb = b.getContext('2d').getImageData(0, 0, b.width, b.height).data
      if (aa.length !== bb.length) throw new Error('dimensions')
      let changed = 0,
        maxDelta = 0
      for (let i = 0; i < aa.length; i++)
        if (aa[i] !== bb[i]) {
          changed++
          maxDelta = Math.max(maxDelta, Math.abs(aa[i] - bb[i]))
        }
      return { changed, maxDelta, channels: aa.length }
    }
    const dispose = (...surfaces) => {
      for (const c of surfaces) {
        c.width = 1
        c.height = 1
      }
    }
    const cases = []
    for (const inkStyle of ['ink', 'cutout'])
      for (const background of ['#f5f3ef', '#111615'])
        for (const colorize of [false, true])
          for (const coverFill of [false, true]) {
            const options = {
              inkStyle,
              background,
              colorize,
              coverFill,
              underlay: 0,
              stampMaxLong: 180,
            }
            const old = baseline.paintPlacementsScaled(
              placements,
              stamps,
              320,
              400,
              256,
              320,
              options,
            )
            const sync = updated.paintPlacementsScaled(
              placements,
              stamps,
              320,
              400,
              256,
              320,
              options,
            )
            const mapped = placements.map((p) => ({
              ...p,
              x: p.x * 0.8,
              y: p.y * 0.8,
              targetSize: p.targetSize * 0.8,
            }))
            const responsive = await updated.paintPlacementsResponsive(
              mapped,
              stamps,
              256,
              320,
              options,
            )
            const tileOld = await baseline.paintPlacementsTiled(
              placements,
              stamps,
              320,
              400,
              256,
              320,
              { ...options, tileSize: 128 },
            )
            const tileNew = await updated.paintPlacementsTiled(
              placements,
              stamps,
              320,
              400,
              256,
              320,
              { ...options, tileSize: 128 },
            )
            const region = { x: 63, y: 84, w: 144, h: 176 }
            const regionOld = baseline.paintPlacementsRegion(
              placements,
              stamps,
              region,
              192,
              235,
              options,
            )
            const regionNew = await updated.paintPlacementsRegionResponsive(
              placements,
              stamps,
              region,
              192,
              235,
              options,
            )
            const checks = {
              sync: compare(old, sync),
              responsive: compare(old, responsive),
              tiled: compare(tileOld, tileNew),
              region: compare(regionOld, regionNew),
            }
            if (inkStyle === 'ink') {
              const worker = await createSignatureRasterWorker(
                placements,
                stamps,
                320,
                400,
                options,
              )
              try {
                const workerTile = await worker.paint(256, 320, 180, { tileSize: 128 })
                const workerRegion = await worker.paint(192, 235, 180, { region })
                checks.workerTiled = compare(tileOld, workerTile)
                checks.workerRegion = compare(regionOld, workerRegion)
                dispose(workerTile, workerRegion)
              } finally {
                worker.dispose()
              }
            }
            if (Object.values(checks).some((c) => c.changed))
              throw new Error(JSON.stringify({ inkStyle, background, colorize, coverFill, checks }))
            cases.push({ inkStyle, background, colorize, coverFill, checks })
            dispose(old, sync, responsive, tileOld, tileNew, regionOld, regionNew)
          }
    const signal = { cancelled: false },
      cancelStart = performance.now()
    setTimeout(() => {
      signal.cancelled = true
    }, 20)
    let cancelled = false
    try {
      await updated.paintPlacementsResponsive(
        Array.from({ length: 10 }, () => placements).flat(),
        stamps,
        320,
        400,
        { signal, stampMaxLong: 180 },
      )
    } catch (e) {
      cancelled = e.message === '已取消'
    }
    if (!cancelled) throw new Error('Cancellation did not interrupt the renderer')
    cases.push({ cancellation: true, ms: performance.now() - cancelStart })
    return cases
  }, frozenUrl)
  assert.equal(report.cases.length, 17)
  if (process.argv.includes('--api-only')) {
    report.passed = true
  } else {
    await page.getByRole('button', { name: '2K', exact: true }).click()
    await page.evaluate(() => {
      window.__responsive = {
        last: performance.now(),
        gaps: [],
        phases: [],
        timerGaps: [],
        timerLast: performance.now(),
        busy: false,
        sawFeedback: false,
      }
      const phase = () => document.querySelector('.preview-head .meta')?.textContent.trim()
      setInterval(() => {
        const p = window.__responsive,
          now = performance.now()
        if (p.busy) {
          p.timerGaps.push(now - p.timerLast)
          if (now - p.timerLast > 100)
            p.phases.push({ kind: 'timer', gapMs: now - p.timerLast, stage: phase() })
        }
        p.timerLast = now
      }, 20)
      const tick = () => {
        const p = window.__responsive,
          now = performance.now()
        if (p.busy) {
          p.gaps.push(now - p.last)
          p.sawFeedback ||= !!document.querySelector('.render-feedback')
          if (now - p.last > 100)
            p.phases.push({ kind: 'frame', gapMs: now - p.last, stage: phase() })
        }
        p.last = now
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.evaluate(() => {
      window.__responsive.busy = true
    })
    await page.getByRole('button', { name: '一键试用示例', exact: true }).click()
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('button')).some(
          (b) => b.textContent.trim() === '生成预览' && !b.disabled,
        ) && !!document.querySelector('.preview-quality'),
      undefined,
      { timeout: 180000 },
    )
    report.realGeneration = await page.evaluate(() => {
      const p = window.__responsive
      p.busy = false
      const sorted = [...p.gaps].sort((a, b) => a - b)
      return {
        frames: sorted.length,
        p95GapMs: sorted[Math.floor((sorted.length - 1) * 0.95)],
        maxGapMs: sorted.at(-1),
        timerMaxGapMs: Math.max(...p.timerGaps),
        longGaps: p.phases,
        sawFeedback: p.sawFeedback,
        metadata: document.querySelector('.preview-head .meta')?.textContent.trim(),
      }
    })
    assert(report.realGeneration.sawFeedback)
    assert(report.realGeneration.frames > 30)
    await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true })
    for (const quality of ['clear', 'fast', 'detail']) {
      await page.getByLabel('缩放清晰度', { exact: true }).selectOption(quality)
      await page.getByRole('button', { name: '原大', exact: true }).click()
      await page.waitForFunction(
        () =>
          !!document.querySelector('.sharp-viewport-canvas') &&
          !document.querySelector('.render-feedback'),
        undefined,
        { timeout: 90000 },
      )
      const state = await page.evaluate(() => {
        const c = document.querySelector('.sharp-viewport-canvas')
        return {
          width: c.width,
          height: c.height,
          region: JSON.parse(c.dataset.region),
          overflow: document.documentElement.scrollWidth - innerWidth,
        }
      })
      assert(
        Math.max(state.width, state.height) <=
          (quality === 'detail' ? 3200 : quality === 'fast' ? 1280 : 2400),
      )
      assert.equal(state.overflow, 0)
      report.cases.push({ quality, ...state })
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '适应', exact: true }).click()
    await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0)
    assert.deepEqual(report.errors, [])
    report.passed = true
  }
} catch (error) {
  report.passed = false
  report.failure = error.stack
  throw error
} finally {
  for (const f of [
    'src/lib/signature-portrait/layout.ts',
    'src/lib/signature-portrait/vector-ink.ts',
    'src/lib/signature-portrait/variants.ts',
    'src/lib/signature-portrait/raster-cache.ts',
    'src/lib/signature-portrait/raster-worker-client.ts',
    'src/lib/signature-portrait/raster-worker-protocol.ts',
    'src/lib/signature-portrait/raster.worker.ts',
    'src/views/SignaturePortraitView.vue',
  ])
    (report.sourceHashes ??= {})[f] = createHash('sha256')
      .update(await readFile(f))
      .digest('hex')
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({
      out,
      passed: report.passed,
      cases: report.cases.length,
      realGeneration: report.realGeneration,
      failure: report.failure,
    }),
  )
  await browser.close()
}
