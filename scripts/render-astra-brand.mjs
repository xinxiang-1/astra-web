import { chromium } from 'playwright'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import path from 'node:path'

// Rasterize the actual SVG assets, then photograph the implemented site.
const output = path.resolve('output/astra-brand-v1')
const brand = path.resolve('public/brand')
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
await mkdir(output, { recursive: true })
const names = ['astra-symbol', 'astra-symbol-light', 'astra-lockup-dark', 'astra-lockup-light', 'astra-monochrome', 'favicon']
const svg = Object.fromEntries(await Promise.all(names.map(async name => [name, await readFile(path.join(brand, `${name}.svg`), 'utf8')])))
const source = name => `data:image/svg+xml;base64,${Buffer.from(svg[name]).toString('base64')}`
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  async function raster(name, width, height, destination) {
    await page.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${width}px;height:${height}px}</style><img src="${source(name)}" alt="Astra"/>`)
    await page.locator('img').evaluate(image => image.decode())
    await page.locator('img').screenshot({ path: destination, omitBackground: true })
  }
  for (const name of names) {
    await copyFile(path.join(brand, `${name}.svg`), path.join(output, `${name}.svg`))
    await raster(name, name.includes('lockup') ? 1400 : 512, name.includes('lockup') ? 320 : 512, path.join(output, `${name}.png`))
  }
  for (const [size, filename] of [[16, 'favicon-16.png'], [32, 'favicon-32.png'], [180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]) {
    await raster('favicon', size, size, path.join(brand, filename))
    await copyFile(path.join(brand, filename), path.join(output, filename))
  }
  await page.setViewportSize({ width: 1600, height: 1080 })
  await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"/><style>
    *{box-sizing:border-box}body{margin:0;background:#f5f3ef;color:#151918;font-family:"Microsoft YaHei",sans-serif}
    .board{width:1600px;height:1080px;padding:48px 60px}.meta{display:flex;justify-content:space-between;font:11px Consolas,monospace;letter-spacing:3px;margin-bottom:32px}
    .hero{height:400px;position:relative;background:#111615;color:#eeeae2;padding:52px 62px;overflow:hidden}
    .hero:before{content:"";position:absolute;inset:0;opacity:.15;background-image:linear-gradient(#58e8ed22 1px,transparent 1px),linear-gradient(90deg,#58e8ed22 1px,transparent 1px);background-size:60px 60px}
    .orbit{position:absolute;width:480px;height:480px;border:1px solid #58e8ed33;border-radius:50%;right:72px;top:-40px}.orbit:before{content:"";position:absolute;inset:60px;border:1px solid #58e8ed22;border-radius:50%}
    .lockup{position:relative;width:360px;height:auto}.hero h1{position:relative;font:400 39px/1.5 Georgia,"SimSun",serif;letter-spacing:3px;margin:32px 0 15px}.hero p{position:relative;font:11px Consolas,monospace;letter-spacing:3px;color:#82a59d}
    .hero-symbol{position:absolute;width:228px;height:228px;right:196px;top:84px}.hero-index{position:absolute;right:32px;bottom:26px;font:9px Consolas,monospace;letter-spacing:2px;color:#698b82}
    .variants{display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;margin-top:24px}.variant{height:238px;border:1px solid #dddcd5;position:relative;display:flex;align-items:center;justify-content:center}.variant.dark{background:#151918;border-color:#151918}.variant img{width:305px}.variant.mono img{width:126px}.label{position:absolute;left:24px;bottom:19px;font:10px Consolas,monospace;letter-spacing:2px;color:#747570}.dark .label{color:#a2a59f}
    .bottom{display:grid;grid-template-columns:1.2fr 1fr;gap:48px;margin-top:32px}.caption{font:10px Consolas,monospace;letter-spacing:2px;color:#747570;margin:0 0 18px}.palette{display:flex;gap:14px}.swatch{flex:1;display:flex;align-items:center;gap:12px}.dot{width:38px;height:38px;border-radius:50%;border:1px solid #15191815;flex-shrink:0}.swatch span{font:11px Consolas,monospace;line-height:1.7}.scale{display:flex;align-items:center;gap:24px;height:48px}.scale img{display:block}.scale .size{display:flex;align-items:center;gap:12px;font:10px Consolas,monospace;color:#747570}.notes{display:flex;justify-content:space-between;margin-top:24px;padding-top:18px;border-top:1px solid #dddcd5;font-size:11px;letter-spacing:1px;color:#747570}
    </style><div class="board"><div class="meta"><span>ASTRA / VISUAL IDENTITY</span><span>01 — LIGHT, WRITTEN.</span></div>
    <section class="hero"><div class="orbit"></div><img class="lockup" src="${source('astra-lockup-dark')}"/><h1>让每一束光，<br/>都有自己的形状。</h1><p>MADE OF CHARACTERS. OPEN TO IMAGINATION.</p><img class="hero-symbol" src="${source('astra-symbol')}"/><span class="hero-index">A / BEAM / STAR</span></section>
    <div class="variants"><section class="variant"><img src="${source('astra-lockup-light')}"/><span class="label">01 / ON PAPER</span></section><section class="variant dark"><img src="${source('astra-lockup-dark')}"/><span class="label">02 / AFTER DARK</span></section><section class="variant mono"><img src="${source('astra-monochrome')}"/><span class="label">03 / ONE INK</span></section></div>
    <div class="bottom"><div><p class="caption">BRAND PALETTE</p><div class="palette"><div class="swatch"><i class="dot" style="background:#111615"></i><span>INK<br/>#111615</span></div><div class="swatch"><i class="dot" style="background:#f5f3ef"></i><span>PAPER<br/>#F5F3EF</span></div><div class="swatch"><i class="dot" style="background:#58e8ed"></i><span>LIGHT<br/>#58E8ED</span></div></div></div><div><p class="caption">RECOGNIZABLE AT EVERY SCALE</p><div class="scale">${[16,24,32,48].map(size => `<div class="size"><img width="${size}" height="${size}" src="${source('favicon')}"/><span>${size}</span></div>`).join('')}</div></div></div>
    <div class="notes"><span>A 光束 × 星芒 · 为文字与光影而生</span><span>原创矢量 / 深浅背景 / 单色 / 网站图标</span></div></div></html>`)
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())))
  await page.screenshot({ path: path.join(output, 'brand-preview.png') })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(base)
  await page.locator('.hero-art .ready').waitFor()
  // Remove the development overlay from delivery screenshots only.
  await page.addStyleTag({ content: '[id*="vue-devtools"], vite-plugin-vue-devtools { visibility: hidden !important; }' })
  await page.screenshot({ path: path.join(output, 'website-desktop.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(output, 'website-mobile.png') })
  await writeFile(path.join(output, 'README.md'), '# Astra Logo v1\n\n原创 A 光束、青色横梁与星芒，全部 SVG 为手写几何路径。\n\n- astra-lockup-dark：深色背景横向标志。\n- astra-lockup-light：浅色背景横向标志。\n- astra-symbol / astra-symbol-light：独立符号。\n- astra-monochrome：单色印刷。\n- favicon / icon / apple-touch-icon：浏览器与收藏图标。\n- PNG 采用真实 SVG 光栅化，横向标志 1400×320，符号 512×512。\n- brand-preview.png：品牌展示板；website-desktop/mobile.png：实际官网截图。\n\n源文件和使用规范：docs/plans/brand-identity.md。复现：node scripts/render-astra-brand.mjs。\n')
  console.log(`Brand assets and actual website previews: ${output}`)
} finally { await browser.close() }
