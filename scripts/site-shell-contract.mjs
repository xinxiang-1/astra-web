import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(process.env.ASTRA_SHELL_OUTPUT || `test-results/site-shell-${Date.now()}`)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
})
const report = { browser: browser.version(), routes: [], navigation: {}, controls: {}, errors: [] }
report.scope = process.env.ASTRA_SHELL_NAV_ONLY ? 'navigation-only' : 'routes-and-navigation'
const pages = [
  '/',
  '/gallery',
  '/templates',
  '/help',
  '/projects',
  '/tools',
  '/studio',
  '/signature-portrait',
  '/ascii-live',
  '/ascii-loop',
  '/file-upload',
  '/file-preview',
  '/login',
  '/register',
  '/forgot',
  '/login/wechat',
  '/prism',
  '/black-hole',
  '/fluid',
  '/webgl-fluid',
  '/ascii-art',
  '/art-lab',
]
const snapshots = new Set([
  '/',
  '/tools',
  '/studio',
  '/login',
  '/signature-portrait',
  '/file-upload',
  '/file-preview',
  '/prism',
  '/webgl-fluid',
])
const page = await context.newPage()
page.on('pageerror', (error) => report.errors.push({ url: page.url(), message: error.message }))
page.setDefaultTimeout(25000)
function name(route) {
  return route === '/' ? 'home' : route.slice(1).replaceAll('/', '-')
}
try {
  await page.goto(base + '/tools')
  // Main-site matrix: real routes, real CSS, desktop/mobile, both themes.
  for (const theme of ['light', 'dark'])
    for (const width of process.env.ASTRA_SHELL_NAV_ONLY ? [] : [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
      await page.evaluate((theme) => localStorage.setItem('astra-theme', theme), theme)
      for (const route of pages) {
        await page.goto(base + route)
        await page.locator('#main-content > *').waitFor()
        if (route === '/' || route === '/tools')
          await page.locator('.character-art.ready').first().waitFor()
        await page.waitForTimeout(100)
        const metrics = await page.evaluate(() => {
          const main = document.querySelector('#main-content'),
            header = document.querySelector('.art-header,.editor-header')
          const h1 = main.querySelector('h1')
          const style = (el) =>
            el
              ? {
                  font: getComputedStyle(el).fontFamily,
                  color: getComputedStyle(el).color,
                  background: getComputedStyle(el).backgroundColor,
                }
              : null
          const box = (el) =>
            el
              ? {
                  x: el.getBoundingClientRect().x,
                  y: el.getBoundingClientRect().y,
                  width: el.getBoundingClientRect().width,
                  height: el.getBoundingClientRect().height,
                }
              : null
          const panel = main.querySelector('.page > aside.panel')
          return {
            title: document.title,
            width: innerWidth,
            scrollWidth: document.documentElement.scrollWidth,
            body: style(document.body),
            heading: style(h1),
            header: style(header),
            headerCount: document.querySelectorAll('.art-header,.editor-header').length,
            headerBox: box(header),
            effectPanelBox: box(panel),
            rootTheme: document.documentElement.dataset.theme,
            sharedFooter: document.querySelectorAll('.art-footer').length,
            focusTarget: main.getAttribute('tabindex'),
          }
        })
        report.routes.push({ route, theme, width, ...metrics })
        assert(
          metrics.scrollWidth <= width + 1,
          `Overflow ${route} ${theme} ${width}: ${metrics.scrollWidth}`,
        )
        assert.equal(metrics.headerCount, 1, `One header ${route}`)
        assert.equal(metrics.rootTheme, theme)
        assert.equal(metrics.focusTarget, '-1')
        assert(metrics.title.endsWith('· Astra'))
        if (!['/ascii-art', '/art-lab'].includes(route)) {
          const expectedHeaderBackground = await page.evaluate(({ theme, immersive }) => {
            const reference = document.createElement('div')
            const color = theme === 'light' ? 'rgb(245, 243, 239)' : 'rgb(17, 22, 21)'
            reference.style.backgroundColor = immersive ? `color-mix(in srgb, ${color} 92%, transparent)` : color
            document.body.appendChild(reference)
            const result = getComputedStyle(reference).backgroundColor
            reference.remove()
            return result
          }, { theme, immersive: ['/prism', '/black-hole', '/fluid', '/webgl-fluid'].includes(route) })
          assert.equal(
            metrics.header.background,
            expectedHeaderBackground,
          )
        }
        if (metrics.effectPanelBox)
          assert(
            metrics.effectPanelBox.y >= metrics.headerBox.height + 12,
            `Effect controls must clear header ${route}`,
          )
        if (snapshots.has(route))
          await page.screenshot({
            path: path.join(out, `${name(route)}-${theme}-${width}.png`),
            fullPage: route !== '/signature-portrait',
          })
        console.log(JSON.stringify({ route, theme, width, overflow: false }))
      }
    }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(base + '/tools')
  const menu = page.locator('.menu-button')
  assert.equal(await menu.getAttribute('aria-label'), '切换导航菜单')
  await menu.focus()
  await page.keyboard.press('Enter')
  assert.equal(await menu.getAttribute('aria-expanded'), 'true')
  await page.keyboard.press('Tab')
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent.trim()),
    '作品',
    'Open disclosure must lead to first link on Tab',
  )
  await page.keyboard.press('Escape')
  assert.equal(await menu.getAttribute('aria-expanded'), 'false')
  assert(await menu.evaluate((el) => el === document.activeElement))
  await menu.click()
  await page.mouse.click(10, 800)
  assert.equal(await menu.getAttribute('aria-expanded'), 'false')
  await menu.click()
  await page.locator('#site-navigation').getByRole('link', { name: '模板', exact: true }).click()
  await page.waitForURL(base + '/templates')
  assert.equal(
    await page
      .getByRole('button', { name: '切换导航菜单', exact: true })
      .getAttribute('aria-expanded'),
    'false',
  )
  assert.equal(
    await page.evaluate(() => document.activeElement.id),
    'main-content',
    'Route navigation must focus the new main region',
  )
  assert.equal(await page.locator('#site-navigation a[aria-current=page]').textContent(), '模板')
  await page.goBack()
  await page.waitForURL(base + '/tools')
  await menu.click()
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.waitForFunction(
    () => document.querySelector('.menu-button')?.getAttribute('aria-expanded') === 'false',
  )
  assert.equal(
    await menu.getAttribute('aria-expanded'),
    'false',
    'Resize to desktop must reset disclosure state',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await menu.getAttribute('aria-expanded'), 'false')
  await menu.click()
  await page
    .locator('#site-navigation')
    .getByRole('link', { name: '免费制作', exact: true })
    .click()
  await page.waitForURL(base + '/ascii-art')
  assert.equal(await page.locator('.editor-header').count(), 1)
  assert.equal(await page.locator('.art-header').count(), 0)
  await page.goto(base + '/tools')
  await page.locator('.skip-link').focus()
  const originalUrl = page.url()
  await page.keyboard.press('Enter')
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content')
  assert.equal(page.url(), originalUrl)
  report.navigation = {
    keyboardDisclosure: true,
    escapeFocus: true,
    outsideClose: true,
    routeFocus: true,
    currentLink: true,
    history: true,
    resizeReset: true,
    mobileCreate: true,
    skipLink: true,
  }

  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(base)
  assert.equal(
    await page.locator('#site-navigation a[aria-current]').count(),
    0,
    'Home section link must not falsely identify itself as the current page',
  )
  await page
    .locator('#site-navigation')
    .getByRole('link', { name: '如何创作', exact: true })
    .click()
  await page.waitForURL(base + '/#how-it-works')
  assert.equal(
    await page.locator('#site-navigation a[aria-current=location]').textContent(),
    '如何创作',
  )
  await page.goto(base + '/tools')
  const darkBefore = await page.evaluate(() => document.documentElement.dataset.theme)
  await page
    .getByRole('button', { name: darkBefore === 'dark' ? '切换到亮色' : '切换到暗色', exact: true })
    .click()
  const toggled = await page.evaluate(() => document.documentElement.dataset.theme)
  assert.notEqual(toggled, darkBefore)
  await page.reload()
  const persisted = await page.evaluate(() => localStorage.getItem('astra-theme'))
  assert.equal(persisted, toggled)
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), toggled)
  report.navigation.themeChanged = true
  report.navigation.themePersisted = true

  // Header overlap at the desktop/mobile threshold and small phones.
  for (const width of [320, 700, 701, 1180, 1181, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    const positions = await page.locator('.art-header').evaluate((header) => {
      const links = Array.from(
        header.querySelectorAll('.art-wordmark,.header-actions,.menu-button,nav'),
      ).filter((el) => getComputedStyle(el).display !== 'none')
      return {
        scroll: document.documentElement.scrollWidth,
        items: links.map((el) => {
          const r = el.getBoundingClientRect()
          return { class: el.className, left: r.left, right: r.right, top: r.top, bottom: r.bottom }
        }),
      }
    })
    assert(positions.scroll <= width + 1, `Header threshold overflow ${width}`)
    for (let i = 0; i < positions.items.length; i++)
      for (let j = i + 1; j < positions.items.length; j++) {
        const a = positions.items[i],
          b = positions.items[j]
        assert(
          !(
            a.left < b.right - 1 &&
            a.right > b.left + 1 &&
            a.top < b.bottom - 1 &&
            a.bottom > b.top + 1
          ),
          `Header overlap ${width}: ${JSON.stringify([a, b])}`,
        )
      }
  }
  report.navigation.thresholds = [320, 700, 701, 1180, 1181, 1280]
  // No motion-driven target displacement when the user requests reduced motion.
  await page.setViewportSize({ width: 1440, height: 960 })
  const row = page.locator('.catalog-row').first(),
    button = page.getByRole('link', { name: '开始做字符画', exact: false })
  await row.hover()
  assert.equal(
    await row.locator('.row-go').evaluate((el) => getComputedStyle(el).transform),
    'none',
  )
  await button.hover()
  assert.equal(await button.evaluate((el) => getComputedStyle(el).transform), 'none')
  report.controls.reducedMotionNoDisplacement = true
  assert.deepEqual(report.errors, [])
  const protectedFiles = [
    'src/views/ArtHomeView.vue',
    'src/components/CharacterArtwork.vue',
    'src/lib/ascii/studio-preview.ts',
  ]
  report.protectedHashes = Object.fromEntries(
    await Promise.all(
      protectedFiles.map(async (file) => {
        const digest = (data) => createHash('sha256').update(data).digest('hex')
        // Git's index normalization avoids Windows checkout line-ending differences.
        const baseline = digest(execFileSync('git', ['show', `62c09d07052fec0993e4f252bb0c2b6c5febf328:${file}`]))
        const current = digest(execFileSync('git', ['show', `:${file}`]))
        assert.equal(current, baseline, `Protected source changed: ${file}`)
        assert.equal(
          execFileSync('git', ['diff', '--', file]).length,
          0,
          `Protected working tree changed: ${file}`,
        )
        return [file, { baseline, current, unchanged: true }]
      }),
    ),
  )
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify(
      {
        out,
        routeCases: report.routes.length,
        navigation: report.navigation,
        errors: report.errors,
      },
      null,
      2,
    ),
  )
} catch (error) {
  await writeFile(
    path.join(out, 'failure.json'),
    JSON.stringify({ ...report, error: error.stack }, null, 2),
  )
  throw error
} finally {
  await browser.close()
}
