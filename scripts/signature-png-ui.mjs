import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { createHash } from 'node:crypto'

const out = path.resolve(
  process.env.ASTRA_PNG_OUTPUT || `test-results/signature-png-ui-${Date.now()}`,
)
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5188'
const dev = process.env.ASTRA_DEV_URL || 'http://127.0.0.1:5180'
const parent = '70de56c100e6ca056e0f447d0c62744a25f5d54c'
const frozenHashes = {}
await mkdir(out, { recursive: true })
const url = (name) =>
  '/' + path.relative(process.cwd(), path.join(out, name)).split(path.sep).join('/')
for (const file of ['layout', 'trace', 'vector-ink']) {
  const original = execFileSync(
    'git',
    ['show', `${parent}:src/lib/signature-portrait/${file}.ts`],
    { encoding: 'utf8' },
  )
  frozenHashes[file] = createHash('sha256').update(original).digest('hex')
  const code = original.replace(
    /'\.\/([^']+)'/g,
    (_, dep) =>
      `'${['trace', 'vector-ink'].includes(dep) ? url(`frozen-${dep}.ts`) : `/src/lib/signature-portrait/${dep}`}'`,
  )
  await writeFile(path.join(out, `frozen-${file}.ts`), code)
}
const finishing = process.argv.includes('--finish')
let prior
if (finishing) {
  prior = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'))
  assert.equal(prior.parent, parent)
  for (const [file, hash] of Object.entries(prior.sourceHashes))
    assert.equal(
      createHash('sha256')
        .update(await readFile(file))
        .digest('hex'),
      hash,
      'Unchanged product source for resumed evidence',
    )
  await writeFile(path.join(out, 'prior-failed-report.json'), JSON.stringify(prior, null, 2))
}
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
  recordVideo: process.argv.includes('--record')
    ? { dir: path.join(out, 'video'), size: { width: 1440, height: 960 } }
    : undefined,
})
const report = {
  browser: browser.version(),
  production: base,
  parent,
  frozenHashes,
  recording: process.argv.includes('--record'),
  cases: [],
  errors: [],
}
if (prior) {
  assert.equal(prior.browser, report.browser)
  report.cases = prior.cases
  report.resumedFromFailure = prior.failure
}
let page
try {
  page = await context.newPage()
  page.on('crash', () => {
    report.crashed = true
  })
  page.on('close', () => {
    report.pageClosedAt = report.cases.length
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  let downloads = 0
  page.on('download', () => downloads++)
  await page.addInitScript(() => {
    const NativeWorker = window.Worker
    window.__pngWorkers = []
    window.Worker = class extends NativeWorker {
      constructor(url, settings) {
        const raster = String(url).includes('raster.worker')
        if (raster && window.__failNextRaster) {
          window.__failNextRaster = false
          throw new Error('QA PNG Worker unavailable')
        }
        super(url, settings)
        this.record = {
          raster,
          terminated: false,
          png: false,
          encoded: 0,
          fullPixels: 0,
          packed: false,
          stages: [],
        }
        window.__pngWorkers.push(this.record)
        this.addEventListener('message', (e) => {
          if (!this.record.png) return
          if (e.data.type === 'encoded') {
            this.record.encoded++
            this.record.durationMs = performance.now() - this.record.start
          }
          if (e.data.type === 'complete') this.record.fullPixels++
          if (e.data.type === 'progress') {
            const stage = e.data.stage || 'render'
            if (!this.record.stages.includes(stage)) this.record.stages.push(stage)
          }
        })
      }
      postMessage(message, transfer) {
        if (message.type === 'scene')
          this.record.packed = message.scene.placements instanceof Float64Array
        if (message.type === 'png') {
          this.record.png = true
          this.record.start = performance.now()
        }
        return super.postMessage(message, transfer)
      }
      terminate() {
        this.record.terminated = true
        return super.terminate()
      }
    }
  })
  await page.goto(base + '/signature-portrait')
  const ready = async () => {
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('button')).some(
          (b) => b.textContent.trim() === '生成预览' && !b.disabled,
        ),
      undefined,
      { timeout: 180000 },
    )
    assert.equal(await page.locator('.error').count(), 0)
  }
  const download = async (label, filename) => {
    const event = page.waitForEvent('download', { timeout: 180000 })
    await page.getByRole('button', { name: label, exact: true }).click()
    await (await event).saveAs(path.join(out, filename))
    await ready()
  }
  const startMeter = () =>
    page.evaluate(() => {
      const m = {
        active: true,
        start: performance.now(),
        previous: performance.now(),
        frames: [],
        longTasks: [],
        feedback: [],
      }
      const tick = (now) => {
        if (!m.active) return
        m.frames.push(now - m.previous)
        m.previous = now
        const title = document.querySelector('.render-feedback strong')?.textContent
        if (title && m.feedback.at(-1) !== title) m.feedback.push(title)
        requestAnimationFrame(tick)
      }
      m.observer = new PerformanceObserver((list) =>
        m.longTasks.push(
          ...list
            .getEntries()
            .map((e) => ({ startMs: e.startTime - m.start, duration: e.duration })),
        ),
      )
      m.observer.observe({ type: 'longtask', buffered: false })
      window.__pngMeter = m
      requestAnimationFrame(tick)
    })
  const stopMeter = () =>
    page.evaluate(() => {
      const m = window.__pngMeter
      m.active = false
      m.observer.disconnect()
      const sorted = m.frames.slice().sort((a, b) => a - b)
      return {
        durationMs: performance.now() - m.start,
        rafCount: sorted.length,
        rafP95: sorted[Math.floor((sorted.length - 1) * 0.95)] || 0,
        rafMax: sorted.at(-1) || 0,
        longTasks: m.longTasks,
        feedback: m.feedback,
      }
    })
  const snapshot = () => page.locator('.result-canvas').evaluate((c) => c.toDataURL())
  const scene = async (id, interact = false) => {
    await download('保存作品文件', `${id}.astra-signature`)
    const before = await snapshot()
    await startMeter()
    const event = page.waitForEvent('download', { timeout: 180000 })
    await page.getByRole('button', { name: '下载 PNG', exact: true }).click()
    await page.getByRole('button', { name: '取消PNG导出', exact: true }).waitFor()
    assert(await page.getByRole('button', { name: '导出PNG中…', exact: true }).isDisabled())
    if (interact) {
      await page
        .locator('.render-feedback')
        .filter({ hasText: '正在绘制高清PNG' })
        .waitFor({ timeout: 90000 })
      await page.getByRole('button', { name: '放大', exact: true }).click()
      await page.getByRole('button', { name: '缩小', exact: true }).click()
      await page.getByRole('button', { name: '适应', exact: true }).click()
      await page.locator('.preview').screenshot({ path: path.join(out, `${id}-loading.png`) })
    }
    await (await event).saveAs(path.join(out, `${id}.png`))
    await ready()
    const response = await stopMeter()
    assert.equal(await snapshot(), before, 'PNG export keeps the existing preview')
    const workers = await page.evaluate(() => window.__pngWorkers.filter((w) => w.png))
    const last = workers.at(-1)
    assert(last.terminated && last.encoded === 1 && last.fullPixels === 0 && last.packed)
    assert(last.stages.includes('render') && last.stages.includes('encode'))
    report.cases.push({ id, worker: last, response })
    console.log(JSON.stringify({ stage: 'scene', id, response }))
  }
  const generate = async () => {
    await page.getByRole('button', { name: '生成预览', exact: true }).click()
    await ready()
  }
  if (!finishing) {
    await page.getByLabel('名字', { exact: true }).fill('林晓晚')
    await page.getByLabel('目标遍数', { exact: true }).fill('10')
    await page.getByRole('button', { name: '一键生成 10 种写法', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.bank-grid li').length === 10)
    await page.getByRole('button', { name: '2K', exact: true }).click()
    await page.getByLabel('笔迹浓度', { exact: true }).fill('3')
    await page
      .locator('.creation-bar input[accept="image/*"]')
      .setInputFiles('public/artwork/portrait-reference.png')
    await ready()
    await scene('pure-2k')
    await page.getByLabel('画面风格', { exact: true }).selectOption('fusion')
    await generate()
    await scene('source-2k')
    await page.getByLabel('底色配色', { exact: true }).selectOption('duotone-v1')
    await page.getByLabel('彩绘色板', { exact: true }).selectOption('forest-rose')
    await generate()
    await scene('duotone-2k')
    await page.getByLabel('底色配色', { exact: true }).selectOption('pop-v1')
    await page.getByLabel('彩绘色板', { exact: true }).selectOption('blue-coral')
    await generate()
    await scene('pop-2k')
    await page.getByLabel('彩绘色板', { exact: true }).selectOption('violet-gold')
    await download('下载 PNG', 'unapplied.png')
    // A real unavailable Worker still preserves the scene and explains the fallback.
    await page.evaluate(() => (window.__failNextRaster = true))
    const fallbackEvent = page.waitForEvent('download', { timeout: 180000 })
    await page.getByRole('button', { name: '下载 PNG', exact: true }).click()
    await page.locator('.render-feedback').filter({ hasText: '兼容绘制' }).waitFor()
    await (await fallbackEvent).saveAs(path.join(out, 'fallback.png'))
    await ready()
    const previewBeforeFailure = await snapshot(),
      downloadsBeforeFailure = downloads
    await page.evaluate(() => {
      window.__failNextRaster = true
      const native = HTMLCanvasElement.prototype.toBlob
      window.__pngNativeToBlob = native
      HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
        if (window.__failNextPng) {
          window.__failNextPng = false
          setTimeout(() => callback(null), 0)
          return
        }
        return native.call(this, callback, ...args)
      }
      window.__failNextPng = true
    })
    await page.getByRole('button', { name: '下载 PNG', exact: true }).click()
    await page.locator('.error').waitFor({ timeout: 180000 })
    assert.match(await page.locator('.error').textContent(), /PNG/)
    assert.equal(downloads, downloadsBeforeFailure)
    assert.equal(await snapshot(), previewBeforeFailure)
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = window.__pngNativeToBlob
    })
    await download('下载 PNG', 'retry.png')
    report.cases.push({ id: 'failed-png-keeps-scene-and-retries', preserved: true })
    await page.getByLabel('签名风格', { exact: true }).selectOption('cutout')
    await generate()
    await scene('cutout-2k')
    await page.getByLabel('签名风格', { exact: true }).selectOption('ink')
    await page.getByRole('button', { name: '4K', exact: true }).click()
    await generate()
    await scene('pop-4k', true)
    const beforeCancel = await snapshot()
    for (const stage of ['prepare', 'render', 'encode']) {
      const count = downloads
      await page.getByRole('button', { name: '下载 PNG', exact: true }).click()
      if (stage === 'encode')
        await page.getByRole('button', { name: '取消PNG导出', exact: true }).focus()
      if (stage !== 'prepare')
        await page
          .locator('.render-feedback')
          .filter({ hasText: stage === 'render' ? '正在绘制高清PNG' : '正在编码PNG' })
          .waitFor({ timeout: 90000 })
      const started = Date.now()
      if (stage === 'encode')
        await page.getByRole('button', { name: '取消PNG导出', exact: true }).press('Enter')
      else await page.getByRole('button', { name: '取消PNG导出', exact: true }).click()
      await ready()
      assert.equal(downloads, count, 'Cancelled export never downloads')
      assert.equal(await snapshot(), beforeCancel)
      assert.equal(await page.getByRole('button', { name: '取消PNG导出', exact: true }).count(), 0)
      report.cases.push({ id: `cancel-${stage}`, responseMs: Date.now() - started })
    }
    await page.getByRole('button', { name: '8K', exact: true }).click()
    await generate()
    await scene('pop-8k', true)
    await page
      .locator('input[accept=".astra-signature"]')
      .setInputFiles(path.join(out, 'pop-4k.astra-signature'))
    await page.waitForFunction(() => document.body.textContent.includes('作品已恢复'), undefined, {
      timeout: 180000,
    })
    await ready()
    await download('下载 PNG', 'restored.png')
    for (const theme of ['light', 'dark']) {
      await page.evaluate((mode) => {
        document.documentElement.dataset.theme = mode
        document.documentElement.style.colorScheme = mode
      }, theme)
      await page.setViewportSize({ width: 390, height: 844 })
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      await page.getByRole('button', { name: '下载 PNG', exact: true }).click()
      await page
        .locator('.render-feedback')
        .filter({ hasText: '正在绘制高清PNG' })
        .waitFor({ timeout: 90000 })
      await page
        .locator('.render-feedback')
        .screenshot({ path: path.join(out, `loading-${theme}-mobile.png`) })
      await page.getByRole('button', { name: '取消PNG导出', exact: true }).click()
      await ready()
    }
  } else {
    await page
      .locator('input[accept=".astra-signature"]')
      .setInputFiles(path.join(out, 'pop-4k.astra-signature'))
    await page.waitForFunction(() => document.body.textContent.includes('作品已恢复'), undefined, {
      timeout: 180000,
    })
    await ready()
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  const countBeforeLeave = downloads
  await page.getByRole('button', { name: '下载 PNG', exact: true }).click()
  await page
    .locator('.render-feedback')
    .filter({ hasText: '正在绘制高清PNG' })
    .waitFor({ timeout: 90000 })
  await page.getByRole('link', { name: 'Astra 首页', exact: true }).first().click()
  await page.waitForURL(base + '/')
  await page.waitForFunction(() =>
    window.__pngWorkers.filter((w) => w.png).every((w) => w.terminated),
  )
  assert.equal(downloads, countBeforeLeave)
  report.cases.push({
    id: 'snapshot-fallback-reopen-themes-unmount',
    scenePreserved: true,
    noDownloadAfterLeave: true,
  })
  // Independently render the saved production scenes with the frozen parent painter.
  const verifier = await context.newPage()
  verifier.on('pageerror', (e) => report.errors.push(e.message))
  await verifier.goto(dev + '/signature-portrait')
  for (const id of [
    'pure-2k',
    'source-2k',
    'duotone-2k',
    'pop-2k',
    'cutout-2k',
    'pop-4k',
    'pop-8k',
  ]) {
    const event = verifier.waitForEvent('download', { timeout: 180000 })
    const dimensions = await verifier.evaluate(
      async ({ projectUrl, frozenUrl }) => {
        const { readSignatureProject } = await import('/src/lib/signature-portrait/project.ts')
        const { prepareSignatureWash } = await import('/src/lib/signature-portrait/styled-wash.ts')
        const frozen = await import(frozenUrl)
        const loaded = await readSignatureProject(await (await fetch(projectUrl)).blob())
        try {
          const p = loaded.project,
            wash = p.options.underlay
              ? await prepareSignatureWash(p.portrait, p.options)
              : undefined
          const canvas = await frozen.paintPlacementsTiled(
            p.placements,
            p.stamps,
            p.width,
            p.height,
            p.width,
            p.height,
            { ...p.options, portrait: wash, tileSize: 384 },
          )
          const blob = await frozen.canvasToPngBlob(canvas),
            href = URL.createObjectURL(blob),
            a = document.createElement('a')
          a.href = href
          a.download = 'frozen.png'
          a.click()
          setTimeout(() => URL.revokeObjectURL(href), 1000)
          canvas.width = canvas.height = 1
          return {
            width: p.width,
            height: p.height,
            placements: p.placements.length,
            templates: p.stamps.length,
          }
        } finally {
          loaded.dispose()
        }
      },
      { projectUrl: url(`${id}.astra-signature`), frozenUrl: url('frozen-layout.ts') },
    )
    await (await event).saveAs(path.join(out, `${id}-frozen.png`))
    Object.assign(
      report.cases.find((c) => c.id === id),
      dimensions,
    )
    console.log(JSON.stringify({ stage: 'frozen', id, ...dimensions }))
  }
  await verifier.close()
  const compareScript = `import json,sys\nfrom pathlib import Path\nfrom PIL import Image\nimport numpy as np\np=Path(sys.argv[1]); cases=[]\nids=['pure-2k','source-2k','duotone-2k','pop-2k','cutout-2k','pop-4k','pop-8k']\npairs=[(i+'-frozen.png',i+'.png') for i in ids]+[('pop-2k.png','unapplied.png'),('pop-2k.png','fallback.png'),('pop-4k.png','restored.png')]\nif (p/'retry.png').exists(): pairs.append(('pop-2k.png','retry.png'))
for old,new in pairs:\n a=Image.open(p/old).convert('RGBA');b=Image.open(p/new).convert('RGBA');assert a.size==b.size\n changed=0;maximum=0\n for y in range(0,a.height,256):\n  aa=np.asarray(a.crop((0,y,a.width,min(a.height,y+256))));bb=np.asarray(b.crop((0,y,b.width,min(b.height,y+256))));d=np.abs(aa.astype(np.int16)-bb.astype(np.int16));changed+=int(np.count_nonzero(d));maximum=max(maximum,int(d.max()))\n cases.append(dict(old=old,new=new,width=a.width,height=a.height,changed=changed,max=maximum,channels=a.width*a.height*4))\n if new=='pop-8k.png':\n  x=int(a.width*.4);y=int(a.height*.38);b.crop((x,y,x+768,y+768)).save(p/'8k-native-crop.png');b.thumbnail((960,1200));b.save(p/'8k-overview.png')\n a.close();b.close()\nprint(json.dumps(cases))\nassert all(c['changed']==0 for c in cases),'Frozen decoded PNG differences'\n`
  await writeFile(path.join(out, 'compare.py'), compareScript)
  try {
    report.pixels = JSON.parse(
      execFileSync('python', [path.join(out, 'compare.py'), out], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      }),
    )
  } catch (error) {
    if (error.stdout) report.pixels = JSON.parse(String(error.stdout))
    throw error
  }
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  process.exitCode = 1
} finally {
  await page?.screenshot({ path: path.join(out, 'final-page.png') }).catch(() => {})
  await context.close()
  await browser.close()
  report.sourceHashes = Object.fromEntries(
    await Promise.all(
      [
        'src/lib/signature-portrait/png-export.ts',
        'src/lib/signature-portrait/raster-worker-client.ts',
        'src/lib/signature-portrait/raster.worker.ts',
        'src/lib/signature-portrait/layout.ts',
        'src/lib/signature-portrait/raster-placement-wire.ts',
        'src/lib/signature-portrait/vector-ink-geometry.ts',
        'src/views/SignaturePortraitView.vue',
        'public/artwork/portrait-reference.png',
      ].map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      ]),
    ),
  )
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({
      out,
      passed: report.passed,
      cases: report.cases.length,
      failure: report.failure,
    }),
  )
}
