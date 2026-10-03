import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(
  process.env.ASTRA_CREATIVE_AUDIT_OUTPUT || `test-results/creative-audit-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const report = { browser: '', signature: [], routes: [], errors: [] }
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  report.browser = browser.version()
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  page.setDefaultTimeout(30000)
  page.on('pageerror', (e) => report.errors.push({ url: page.url(), message: e.message }))
  await page.goto(base + '/docs/prototypes/v9-glyph-particles/index.html')
  await page.waitForFunction(() => window.astraParticlesPrototype?.ready)
  await page.evaluate(() => window.astraParticlesPrototype.setManual(true))
  report.signature = await page.evaluate(async () => {
    const { generateHandwritingVariants } = await import('/src/lib/signature-portrait/variants.ts')
    const output = []
    for (const name of ['Astra', '李云舟', '张思雨', 'Alexander Montgomery', '把名字写成光']) {
      const variants = await generateHandwritingVariants(name, { count: 40, seed: 20261004 })
      const coverages = variants
        .map((s) => {
          const data = s.canvas
            .getContext('2d', { willReadFrequently: true })
            .getImageData(0, 0, s.width, s.height).data
          let alpha = 0
          for (let i = 3; i < data.length; i += 4) alpha += data[i] / 255
          return alpha / (s.width * s.height)
        })
        .sort((a, b) => a - b)
      const averageAspect =
        variants.reduce((sum, s) => sum + s.width / s.height, 0) / variants.length
      const angle = ((12 * Math.PI) / 180) * 0.35,
        c = Math.cos(angle),
        s = Math.sin(angle)
      const capacities = variants
        .map((stamp) => {
          const scale =
            Math.min(
              averageAspect / (stamp.width * c + stamp.height * s),
              1 / (stamp.width * s + stamp.height * c),
            ) * 0.94
          const pixels = stamp.canvas
            .getContext('2d', { willReadFrequently: true })
            .getImageData(0, 0, stamp.width, stamp.height).data
          let alpha = 0
          for (let i = 3; i < pixels.length; i += 4) alpha += pixels[i] / 255
          return (alpha * scale * scale) / averageAspect
        })
        .sort((a, b) => a - b)
      output.push({
        name,
        count: variants.length,
        generatedTypography: true,
        coverageP10: coverages[3],
        coverageMedian: coverages[19],
        coverageP90: coverages[35],
        wovenCoverageP25: capacities[9],
        averageAspect,
        maxSide: Math.max(...variants.map((s) => Math.max(s.width, s.height))),
        note: 'Measured existing generated font variants, not real handwritten signatures; mean alpha in full bounding boxes and the woven geometric slot.',
      })
    }
    return output
  })
  for (const route of [
    '/',
    '/gallery',
    '/templates',
    '/help',
    '/projects',
    '/tools',
    '/studio',
    '/login',
    '/register',
    '/forgot',
    '/signature-portrait',
    '/ascii-art',
  ]) {
    await page.goto(base + route, { waitUntil: 'domcontentloaded' })
    await page.locator('h1').first().waitFor({ state: 'visible', timeout: 20000 })
    const styles = await page.evaluate(() => {
      const h = document.querySelector('h1'),
        header = document.querySelector('header')
      const css = (el) => {
        if (!el) return null
        const c = getComputedStyle(el)
        return {
          font: c.fontFamily,
          color: c.color,
          background: c.backgroundColor,
          fontSize: c.fontSize,
        }
      }
      return {
        title: h?.textContent?.trim(),
        body: css(document.body),
        heading: css(h),
        header: css(header),
        headerClass: header?.className,
        overflow: document.documentElement.scrollWidth > innerWidth,
        links: [...document.querySelectorAll('header a')].map((a) => a.textContent.trim()),
      }
    })
    const slug = route === '/' ? 'home' : route.slice(1)
    await page.screenshot({ path: path.join(out, slug + '-desktop.png'), fullPage: false })
    await page.setViewportSize({ width: 390, height: 844 })
    const mobile = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      h1: document.querySelector('h1')?.getBoundingClientRect().width,
      scrollWidth: document.documentElement.scrollWidth,
    }))
    await page.screenshot({ path: path.join(out, slug + '-mobile.png'), fullPage: false })
    report.routes.push({ route, desktop: styles, mobile })
    await page.setViewportSize({ width: 1440, height: 960 })
  }
} catch (error) {
  report.failure = String(error)
  throw error
} finally {
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(
    JSON.stringify({
      out,
      signature: report.signature,
      routes: report.routes.map((r) => ({
        route: r.route,
        header: r.desktop.headerClass,
        font: r.desktop.heading?.font,
        mobileOverflow: r.mobile.overflow,
      })),
      errors: report.errors,
      failure: report.failure,
    }),
  )
  await browser.close()
}
