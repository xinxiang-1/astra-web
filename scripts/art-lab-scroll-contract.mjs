import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const base = process.env.ASTRA_PREVIEW_URL || 'http://localhost:5173'
const output = path.resolve(process.env.ASTRA_SCROLL_OUTPUT || 'output/playwright/art-lab-scroll-r1')
await mkdir(output, { recursive: true })
const records = []
for (const channel of ['msedge', 'chrome']) {
  const browser = await chromium.launch({ channel })
  try {
    for (const viewport of [{ width: 1440, height: 700 }, { width: 390, height: 844 }]) {
      for (const theme of ['light', 'dark']) {
        console.log(`CHECK: ${channel}, ${viewport.width}px, ${theme}`)
        const mobile = viewport.width < 800
        const context = await browser.newContext({ viewport, hasTouch: mobile, reducedMotion: 'reduce' })
        await context.addInitScript(theme => localStorage.setItem('astra-theme', theme), theme)
        const page = await context.newPage()
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        const entrance = theme === 'light' ? 'homepage' : 'direct'
        if (entrance === 'homepage') {
          await page.goto(base)
          await page.getByRole('link', { name: /探索六种表达/ }).click()
          await page.waitForURL('**/art-lab')
        } else await page.goto(`${base}/art-lab`)
        await page.getByRole('status').filter({ hasText: '作品已生成' }).waitFor()

        // Emulate a browser that ignores :has(); document scrolling must still work.
        const ignoredHasRules = await page.evaluate(() => {
          let removed = 0
          function strip(container) {
            for (let i = container.cssRules.length - 1; i >= 0; i--) {
              const rule = container.cssRules[i]
              if (rule.selectorText?.includes(':has(')) { container.deleteRule(i); removed++ }
              else if (rule.cssRules) strip(rule)
            }
          }
          for (const sheet of document.styleSheets) {
            try { strip(sheet) } catch { /* Cross-origin styles are not part of the app shell. */ }
          }
          return removed
        })
        const before = await page.evaluate(() => ({
          height: document.documentElement.scrollHeight, viewport: innerHeight,
          headers: document.querySelectorAll('.art-header').length,
          mains: document.querySelectorAll('main').length,
          bodyOverflow: getComputedStyle(document.body).overflowY,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          theme: document.documentElement.dataset.theme,
        }))
        assert(before.height > before.viewport && before.headers === 1 && before.mains === 1, JSON.stringify(before))
        assert(before.bodyOverflow === 'auto' && !before.horizontalOverflow && before.theme === theme, JSON.stringify(before))

        const canvas = await page.locator('.engine-canvas canvas').boundingBox()
        const x = Math.round(canvas.x + canvas.width / 2)
        const y = Math.round(Math.min(canvas.y + canvas.height - 50, viewport.height - 110))
        if (mobile) {
          const cdp = await context.newCDPSession(page)
          try {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
            for (let distance = 25; distance <= 400; distance += 25) {
              await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - distance }] })
              await page.waitForTimeout(20)
            }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
          } finally { await cdp.detach() }
        } else {
          await page.mouse.move(x, y)
          await page.mouse.wheel(0, 600)
        }
        await page.waitForFunction(() => scrollY > 100)
        const gestureScrollY = await page.evaluate(() => scrollY)
        await page.locator('#main-content').focus()
        await page.keyboard.press('Control+Home')
        await page.waitForFunction(() => scrollY === 0)
        await page.waitForTimeout(300) // Let the browser finish its native keyboard scroll.
        await page.keyboard.press('PageDown')
        await page.waitForFunction(() => scrollY > 100)
        const keyboardScrollY = await page.evaluate(() => scrollY)

        // Exercise all six modes, including the extra phrase field, before checking the bottom.
        const modes = page.locator('.engine-modes button')
        assert.equal(await modes.count(), 6)
        for (const button of await modes.all()) {
          await button.click()
          assert.equal(await button.getAttribute('aria-pressed'), 'true')
        }
        await modes.nth(2).click()
        await page.getByRole('textbox', { name: '铺写的文字' }).fill('探索六种表达')
        await page.getByRole('combobox', { name: '环境动效' }).selectOption('wave')
        const fullEditor = page.getByRole('link', { name: /进入支持短视频与本地项目的完整编辑器/ })
        await fullEditor.scrollIntoViewIfNeeded()
        const bottom = await page.evaluate(() => ({
          scrollY, viewport: innerHeight,
          noteBottom: document.querySelector('.engine-workspace .engine-note').getBoundingClientRect().bottom,
          bodyOverflow: getComputedStyle(document.body).overflowY,
        }))
        assert(bottom.scrollY > 100 && bottom.noteBottom <= bottom.viewport && bottom.bodyOverflow === 'auto', JSON.stringify(bottom))
        const screenshot = `${channel}-${viewport.width}-${theme}.png`
        // Capture from the top so offscreen fixed elements stay outside the full-page image.
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.waitForFunction(() => scrollY === 0)
        await page.screenshot({ path: path.join(output, screenshot), fullPage: true })

        await fullEditor.click()
        await page.waitForURL('**/ascii-art')
        await page.waitForFunction(() => getComputedStyle(document.body).overflowY === 'hidden')
        await page.goBack()
        await page.waitForURL('**/art-lab')
        await page.getByRole('status').filter({ hasText: '作品已生成' }).waitFor()
        await page.waitForFunction(() => getComputedStyle(document.body).overflowY === 'auto')
        await page.locator('#main-content').focus()
        await page.keyboard.press('Control+Home')
        await page.waitForFunction(() => scrollY === 0)
        await page.waitForTimeout(300)
        await page.keyboard.press('PageDown')
        await page.waitForFunction(() => scrollY > 100)
        const returnScrollY = await page.evaluate(() => scrollY)
        assert.deepEqual(errors, [], 'Browser runtime errors')
        records.push({ channel, viewport, theme, entrance, ignoredHasRules, before,
          input: mobile ? 'Chromium dispatched touch swipe over canvas' : 'mouse wheel over canvas',
          gestureScrollY, keyboardScrollY, bottom, returnScrollY, modes: 6, pageErrors: errors.length, screenshot })
        await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: false, records }, null, 2))
        await context.close()
      }
    }
  } finally { await browser.close() }
}
await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, base, records,
  limitations: ['Touch was dispatched through Chromium CDP; physical devices and Safari were not tested.'] }, null, 2))
console.log(`PASS: ${records.length} art-lab scroll scenarios in Edge and Chrome.`)
