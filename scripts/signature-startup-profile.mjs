import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_STARTUP_OUTPUT || `test-results/signature-startup-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  const errors = [],
    stages = [],
    requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    if (/fonts\/signature|aristotle|layout\.worker/.test(response.url()))
      requests.push({ url: response.url(), status: response.status() })
  })
  await page.goto(base + '/signature-portrait')
  await page.getByRole('button', { name: '2K', exact: true }).click()
  const profiler = await page.context().newCDPSession(page)
  await profiler.send('Profiler.enable')
  await profiler.send('Profiler.setSamplingInterval', { interval: 2000 })
  await profiler.send('Profiler.start')
  const started = Date.now()
  await page.getByRole('button', { name: '一键试用示例', exact: true }).click()
  let lastStage = '',
    settled = false,
    uiError = ''
  while (Date.now() - started < 180000) {
    const state = await page.evaluate(() => {
      const preview = Array.from(document.querySelectorAll('button')).find(
        (el) => el.textContent.trim() === '生成预览',
      )
      const generating = Array.from(document.querySelectorAll('button')).some(
        (el) => el.textContent.trim() === '生成中…',
      )
      return {
        settled: !!preview && !preview.disabled && !generating,
        progress: document.querySelector('.preview-head .meta')?.textContent.trim(),
        error: document.querySelector('.error')?.textContent.trim(),
      }
    })
    const stage = state.progress || (state.settled ? 'settled' : 'working')
    if (stage !== lastStage) {
      const entry = { ms: Date.now() - started, stage, error: state.error }
      stages.push(entry)
      console.log(JSON.stringify(entry))
      lastStage = stage
    }
    if (state.settled) {
      uiError = state.error || ''
      settled = true
      break
    }
    await page.waitForTimeout(500)
  }
  const operationMs = Date.now() - started
  const { profile } = await profiler.send('Profiler.stop')
  await writeFile(path.join(out, 'main-thread.cpuprofile'), JSON.stringify(profile))
  const counts = new Map()
  for (const id of profile.samples || []) counts.set(id, (counts.get(id) || 0) + 1)
  const hottest = profile.nodes
    .map((node) => ({
      name: node.callFrame.functionName,
      url: node.callFrame.url,
      line: node.callFrame.lineNumber + 1,
      selfSamples: counts.get(node.id) || 0,
    }))
    .sort((a, b) => b.selfSamples - a.selfSamples)
    .slice(0, 24)
  const ui = await page.locator('main').innerText()
  await page.screenshot({ path: path.join(out, 'settled.png') })
  const report = {
    out,
    browser: browser.version(),
    profilerIntervalUs: 2000,
    operationMs,
    elapsedMs: Date.now() - started,
    settled,
    uiError,
    stages,
    requests,
    errors,
    hottest,
    ui,
  }
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify(
      {
        out,
        settled,
        operationMs,
        elapsedMs: report.elapsedMs,
        hottest: hottest.slice(0, 12),
        errors,
        uiError,
      },
      null,
      2,
    ),
  )
  if (!settled) throw new Error('Generation did not settle within 180 seconds')
  if (uiError || errors.length)
    throw new Error('Generation failed: ' + (uiError || errors.join('; ')))
} finally {
  await browser.close()
}
