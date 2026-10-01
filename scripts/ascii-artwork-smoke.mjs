import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5173'
const output = path.resolve('test-results/ascii-artwork')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

async function pixels() {
  return page.locator('.hero-art .character-art').evaluate((host) => {
    const canvas = host.querySelector('canvas')
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
    let hash = 2166136261
    for (let i = 0; i < data.length; i += 37) hash = Math.imul(hash ^ data[i], 16777619)
    return { hash, width: canvas.width, height: canvas.height }
  })
}

try {
  await page.goto(base)
  await page.locator('.hero-art .ready').waitFor()
  await page.locator('.hero-art .live-active').waitFor()
  const tone = await page.evaluate(async () => {
    const { imageDataToAscii, imageDataToPhraseAscii } = await import('/src/lib/ascii/convert.ts')
    const { paintAsciiToCanvas } = await import('/src/lib/ascii/paint.ts')
    const transparent = new ImageData(new Uint8ClampedArray([255, 255, 255, 0]), 1, 1)
    const flat = new ImageData(new Uint8ClampedArray([128, 128, 128, 255]), 1, 1)
    const black = new ImageData(new Uint8ClampedArray([0, 0, 0, 255]), 1, 1)
    const gradient = new ImageData(
      new Uint8ClampedArray(Array.from({ length: 256 }, (_, i) => [i, i, i, 255]).flat()),
      256,
      1,
    )
    const canvas = document.createElement('canvas')
    const size = paintAsciiToCanvas(canvas, '👩‍💻👩‍💻', {
      fontSize: 10,
      background: '#111615',
      foreground: '#eeeae2',
      padding: 0,
    })
    return {
      transparent: [false, true].map(
        (invert) => imageDataToAscii(transparent, '@. ', { invert }).text,
      ),
      transparentPhrase: imageDataToPhraseAscii(transparent, { phrase: '光', fillAll: true }).text,
      flatNormalized: imageDataToAscii(flat, '@%#*+=-:. ', { normalize: true }).text,
      flatOriginal: imageDataToAscii(flat, '@%#*+=-:. ').text,
      blackDithered: imageDataToAscii(black, '@80GCLft1i;:,. ', {
        invert: true,
        normalize: true,
        ditherStrength: 0.25,
      }).text,
      gradient: imageDataToAscii(gradient, '@%#*+=-:. ').text,
      phrase: imageDataToPhraseAscii(flat, { phrase: '👩‍💻', fillAll: true }).text,
      graphemeColumns: size.cssWidth / size.charWidth,
    }
  })
  assert.deepEqual(tone.transparent, [' ', ' '])
  assert.equal(tone.transparentPhrase, ' ')
  assert.equal(tone.flatNormalized, tone.flatOriginal)
  assert.equal(tone.blackDithered, ' ', 'dither must not add dots to black backgrounds')
  assert.equal(new Set(tone.gradient).size, 10)
  assert.equal(tone.gradient[0], '@')
  assert.equal(tone.gradient.at(-1), ' ')
  assert.equal(tone.phrase, '👩‍💻')
  assert(tone.graphemeColumns >= 2 && tone.graphemeColumns < 2.2)

  const initial = await pixels()
  assert.equal(
    await page.locator('.hero-art canvas').count(),
    1,
    'still and motion must share one canvas',
  )
  await page.waitForTimeout(250)
  const animated = await pixels()
  assert.notEqual(initial.hash, animated.hash, 'ambient motion must change pixels')
  assert.equal(initial.width, animated.width)
  assert.equal(initial.height, animated.height)
  // The transparent comparison slider covers the canvas: real mouse movement
  // must still reach the original Studio trail listener.
  await page.locator('.hero-art .character-art').evaluate((host) => {
    const canvas = host.querySelector('.art-live')
    window.__artTrailEvents = 0
    canvas.addEventListener('pointermove', () => {
      window.__artTrailEvents++
    })
  })
  const hero = await page.locator('.hero-art').boundingBox()
  await page.mouse.move(hero.x + hero.width * 0.48, hero.y + hero.height * 0.4)
  await page.mouse.move(hero.x + hero.width * 0.72, hero.y + hero.height * 0.6, { steps: 20 })
  assert(
    await page.evaluate(() => window.__artTrailEvents >= 20),
    'slider must forward pointer movement to Studio',
  )
  await page.waitForTimeout(100)
  await page.screenshot({ path: path.join(output, 'desktop-hover.png') })

  await page.locator('.hero-art').getByRole('button', { name: '暂停字符动效' }).click()
  await page.waitForTimeout(100)
  const paused = await pixels()
  await page.waitForTimeout(250)
  assert.deepEqual(await pixels(), paused, 'pause restores a stable original grid')
  await page.getByRole('slider', { name: '拖动对比原图与字符作品' }).fill('55')
  assert.equal(
    await page
      .locator('.hero-art .character-art')
      .evaluate((el) => el.style.getPropertyValue('--split')),
    '55%',
  )
  await page.locator('.hero-art').getByRole('button', { name: '播放字符动效' }).click()

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(100)
  const reduced = await pixels()
  await page.waitForTimeout(250)
  assert.deepEqual(await pixels(), reduced, 'reduced motion keeps a static grid')
  assert.equal(await page.locator('.hero-art .motion-control').count(), 0)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('slider', { name: '拖动对比原图与字符作品' }).fill('0')
  await page.waitForTimeout(200)
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true })

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(150)
  const offscreen = await pixels()
  await page.waitForTimeout(250)
  assert.deepEqual(await pixels(), offscreen, 'offscreen artwork stops animating')
  await page.goto(`${base}/gallery`)
  await page.locator('.character-art.ready').first().waitFor()
  assert.deepEqual(errors, [])
  console.log(
    'PASS: transparency, flat tone, ramp coverage, Unicode cells, Studio motion, trail pointer forwarding, pause, compare, reduced motion, mobile layout, offscreen suspension, gallery.',
  )
  console.log(`Screenshots: ${output}`)
} finally {
  await browser.close()
}
