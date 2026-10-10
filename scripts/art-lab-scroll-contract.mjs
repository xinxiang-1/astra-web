import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const base = process.env.ASTRA_PREVIEW_URL || 'http://localhost:5173'
const browser = await chromium.launch({ channel: 'msedge' })
const records = []
try {
  for (const viewport of [{ width: 1440, height: 700 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' })
    await page.goto(`${base}/art-lab`)
    await page.locator('.engine-actions').waitFor()
    const before = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, viewport: innerHeight, headers: document.querySelectorAll('.art-header').length }))
    assert(before.height > before.viewport)
    await page.mouse.wheel(0, 1600)
    await page.waitForTimeout(400)
    const after = await page.evaluate(() => ({ scrollY, lastBottom: document.querySelector('.engine-note').getBoundingClientRect().bottom, bodyOverflow: getComputedStyle(document.body).overflowY }))
    assert(after.scrollY > 100 && after.bodyOverflow === 'auto', JSON.stringify(after))
    const output = path.resolve(process.env.ASTRA_SCROLL_OUTPUT || 'output/playwright/art-lab-scroll-r1')
    await mkdir(output, { recursive: true })
    await page.screenshot({ path: path.join(output, `scroll-${viewport.width}.png`) })
    records.push({ viewport, before, after })
    await page.close()
  }
} finally { await browser.close() }
const output = path.resolve(process.env.ASTRA_SCROLL_OUTPUT || 'output/playwright/art-lab-scroll-r1')
await writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, records }, null, 2))
console.log('PASS: art-lab scrolls on desktop and mobile.')
