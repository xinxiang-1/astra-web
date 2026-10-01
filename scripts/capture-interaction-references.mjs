import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve('docs/research/2026-09-30-interactions')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true })
const references = [
  ['lusion', 'https://lusion.co/'],
  ['linear', 'https://linear.app/'],
  ['awwwards', 'https://www.awwwards.com/websites/animation/'],
]
try {
  const results = await Promise.allSettled(references.map(async ([name, url]) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await page.waitForTimeout(2500)
      await page.screenshot({ path: path.join(out, `${name}-top.png`) })
      const snapshot = await page.evaluate(() => ({
        title: document.title,
        text: document.body.innerText.slice(0, 9000),
        links: [...document.querySelectorAll('a[href]')].map(a => ({ text: a.textContent.trim().slice(0, 90), url: a.href })).filter(a => /scroll|animat|lusion|theory|motion/i.test(a.text + a.url)).slice(0, 25),
        canvasCount: document.querySelectorAll('canvas').length,
      }))
      await page.mouse.wheel(0, 780)
      await page.waitForTimeout(1500)
      await page.screenshot({ path: path.join(out, `${name}-scroll.png`) })
      return { name, url, observedAt: new Date().toISOString(), ...snapshot }
    } catch (error) { return { name, url, error: String(error) } }
    finally { await page.close() }
  }))
  const records = results.map(item => item.status === 'fulfilled' ? item.value : { error: String(item.reason) })
  await writeFile(path.join(out, 'browser-observations.json'), JSON.stringify(records, null, 2))
  console.log(JSON.stringify(records.map(({ name, title, canvasCount, links, error }) => ({ name, title, canvasCount, links, error })), null, 2))
} finally { await browser.close() }
