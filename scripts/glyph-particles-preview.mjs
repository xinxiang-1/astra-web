import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve('test-results/glyph-particles-preview-' + Date.now())
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } })
  page.on('pageerror', (error) => console.error(error.message))
  await page.goto('http://127.0.0.1:5180/docs/prototypes/v9-glyph-particles/index.html')
  await page.waitForFunction(() => window.astraParticlesPrototype?.ready)
  if (await page.locator('.boards').evaluate((el) => el.classList.contains('focused')))
    await page.locator('#focus').click()
  await page.evaluate(() => window.astraParticlesPrototype.setManual(true))
  await page.screenshot({ path: path.join(out, 'rest.png'), fullPage: true })
  await page.evaluate(() => {
    const p = window.astraParticlesPrototype
    for (let i = 0; i < 30; i++)
      p.tick(1 / 60, [
        {
          x: 0.15 + (i / 29) * 0.7,
          y: 0.48 + Math.sin((i / 29) * Math.PI * 2) * 0.16,
          time: (p.state.clock + 1 / 60) * 1000,
          active: true,
        },
      ])
  })
  await page.screenshot({ path: path.join(out, 'swipe.png'), fullPage: true })
  console.log(
    JSON.stringify({ out, state: await page.evaluate(() => window.astraParticlesPrototype.state) }),
  )
  const settled = await page.evaluate(() => {
    const p = window.astraParticlesPrototype
    p.tick(1 / 60, [{ x: 0.85, y: 0.48, time: (p.state.clock + 1 / 60) * 1000, active: false }])
    let i = 0
    for (; i < 800; i++) {
      p.tick(1 / 30)
      if (p.state.stats.moving === 0 && i > 10) break
    }
    return { frames: i, state: p.state }
  })
  await writeFile(path.join(out, 'settled.json'), JSON.stringify(settled, null, 2))
  await page.screenshot({ path: path.join(out, 'settled.png'), fullPage: true })
  console.log(JSON.stringify({ settled }))
} finally {
  await browser.close()
}
