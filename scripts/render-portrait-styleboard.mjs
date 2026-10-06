import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(
  process.env.ASTRA_STYLE_OUTPUT || `test-results/portrait-styles-${Date.now()}`,
)
const original = await readFile(process.env.ASTRA_STYLE_SOURCE || 'public/artwork/portrait.jpg')
const mime = original[0] === 0xff ? 'image/jpeg' : 'image/png'
const source = `data:${mime};base64,` + original.toString('base64')
await mkdir(out, { recursive: true })
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const profiles = [
  {
    id: 'classic',
    title: '经典黑白',
    note: '已有光影字符，适合简洁肖像。',
    mode: 'density',
    background: '#111615',
    ink: '#eeeae2',
    colored: false,
    invert: true,
    columns: 160,
  },
  {
    id: 'name',
    title: '彩色中文',
    note: '已有中文铺字，完整中文句序。',
    mode: 'phrase',
    background: '#111615',
    ink: '#eeeae2',
    colored: true,
    invert: true,
    columns: 150,
    phrase: '林晓晚，把名字写进光影。',
  },
  {
    id: 'duotone',
    title: '双色海报',
    note: '双色映射＋真实字符的算法样例，尚无正式预设。',
    transform: 'duotone',
    mode: 'color',
    background: '#f1bea3',
    ink: '#192c55',
    colored: true,
    invert: false,
    columns: 160,
    softwareRaster: true,
    colorFidelity: true,
    fontWeight: 600,
    rasterQuality: 'high',
  },
  {
    id: 'halftone',
    title: '复古网点',
    note: '已有网点引擎，未模拟实体印刷墨色。',
    mode: 'halftone',
    background: '#f5eddb',
    ink: '#173d38',
    colored: false,
    invert: false,
    columns: 110,
  },
  {
    id: 'outline',
    title: '极简线稿',
    note: '已有方向字符轮廓；重要人脸线条仍需精修。',
    mode: 'contour',
    background: '#f5f3ef',
    ink: '#192522',
    colored: false,
    invert: false,
    columns: 160,
  },
  {
    id: 'pixel',
    title: '像素游戏',
    note: '有限色板＋高覆盖字符的算法样例，尚无正式预设。',
    transform: 'pixel',
    mode: 'color',
    background: '#111615',
    ink: '#eeeae2',
    colored: true,
    invert: true,
    columns: 52,
    charset: ' ░▒▓█',
    softwareRaster: true,
    colorFidelity: true,
    fontWeight: 600,
    rasterQuality: 'high',
  },
]
const report = {
  browser: browser.version(),
  sourceSha256: createHash('sha256').update(original).digest('hex'),
  privateSource: Boolean(process.env.ASTRA_STYLE_SOURCE),
  cases: [],
}
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  })
  await page.goto((process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') + '/ascii-art')
  const samples = []
  for (const profile of profiles) {
    const result = await page.evaluate(
      async ({ profile, source }) => {
        const { prepareArtFrame, createArtRenderer } = await import('/src/lib/art-engine/index.ts')
        const im = new Image()
        im.src = source
        await im.decode()
        await document.fonts.ready
        const input = document.createElement('canvas')
        const fit = Math.min(1, 1024 / Math.max(im.naturalWidth, im.naturalHeight))
        input.width = Math.round(im.naturalWidth * fit)
        input.height = Math.round(im.naturalHeight * fit)
        const ctx = input.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(im, 0, 0, input.width, input.height)
        if (profile.transform) {
          const image = ctx.getImageData(0, 0, input.width, input.height)
          const palette = [
            [18, 22, 29],
            [57, 45, 55],
            [101, 65, 65],
            [157, 99, 82],
            [206, 141, 108],
            [238, 185, 139],
            [247, 218, 166],
            [45, 78, 92],
          ]
          for (let i = 0; i < image.data.length; i += 4) {
            const rgb = [image.data[i], image.data[i + 1], image.data[i + 2]]
            let mapped
            if (profile.transform === 'duotone') {
              const light = (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255
              const t = Math.max(0, Math.min(1, (light - 0.025) / 0.85))
              mapped = [25 + 216 * t, 44 + 146 * t, 85 + 78 * t]
            } else {
              mapped = palette.reduce((best, color) => {
                const distance = (c) =>
                  0.2126 * (c[0] - rgb[0]) ** 2 +
                  0.7152 * (c[1] - rgb[1]) ** 2 +
                  0.0722 * (c[2] - rgb[2]) ** 2
                return distance(color) < distance(best) ? color : best
              })
            }
            for (let channel = 0; channel < 3; channel++)
              image.data[i + channel] = Math.round(mapped[channel])
          }
          ctx.putImageData(image, 0, 0)
        }
        const { id, title, note, transform, ...settings } = profile
        const frame = prepareArtFrame(input, input.width, input.height, {
          ...settings,
          normalize: false,
          contrast: 0.08,
          exposure: 0,
          fillAll: true,
          fontFamily:
            profile.mode === 'phrase' ? 'Microsoft YaHei, monospace' : 'Consolas, monospace',
        })
        const canvas = document.createElement('canvas'),
          renderer = createArtRenderer(canvas)
        try {
          const dimensions = renderer.render(frame, {
            longEdge: 1024,
            hover: 'displace',
            motion: 'none',
          })
          return {
            id,
            title,
            note,
            transform,
            ...dimensions,
            columns: frame.columns,
            rows: frame.rows,
            nonEmpty: frame.statistics.nonEmpty,
            settings: frame.settings,
            backend: renderer.backend,
            png: canvas.toDataURL('image/png'),
          }
        } finally {
          renderer.destroy()
          input.width = input.height = 1
        }
      },
      { profile, source },
    )
    await writeFile(
      path.join(out, profile.id + '.png'),
      Buffer.from(result.png.split(',')[1], 'base64'),
    )
    samples.push({ id: result.id, title: result.title, note: result.note, png: result.png })
    delete result.png
    report.cases.push(result)
  }
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Astra · 同素材风格试选</title><style>
  *{box-sizing:border-box}body{margin:0;background:#111615;color:#eeeae2;font:15px/1.6 "Microsoft YaHei",sans-serif}main{max-width:1320px;margin:auto;padding:40px 32px}.eyebrow{color:#b5d989;letter-spacing:.18em;font-size:12px}h1{font-size:32px;font-weight:600;letter-spacing:-.03em;margin:10px 0}header p{max-width:840px;color:#afbbb1}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px;margin-top:30px}figure{margin:0;border:1px solid #354338;background:#18201c;border-radius:16px;overflow:hidden}figure button{display:block;width:100%;padding:0;border:0;background:none;cursor:zoom-in}img{display:block;width:100%;aspect-ratio:3/4;object-fit:contain}figcaption{padding:16px}strong{font-size:18px}small{display:block;color:#afbbb1;margin-top:5px}.foot{color:#afbbb1;margin-top:28px}dialog{padding:0;max-width:94vw;max-height:94vh;background:#111615;color:#eeeae2;border:1px solid #597050;border-radius:16px}dialog::backdrop{background:#000d}dialog img{width:auto;max-width:85vw;max-height:82vh;aspect-ratio:auto}dialog button{padding:10px 20px;margin:10px;cursor:pointer;background:#d6e5a9;border:0;border-radius:8px}@media(max-width:800px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}main{padding:24px 16px}}@media(max-width:480px){.grid{grid-template-columns:1fr}}@media(prefers-color-scheme:light){body{background:#f5f3ef;color:#192522}figure{background:#fff;border-color:#d5dccf}header p,small,.foot{color:#566459}}
  </style><main><header><div class="eyebrow">ASTRA / STYLE STUDY</div><h1>同一张照片，六种字符表达</h1><p>用于判断风格差异与人物识别度。点开可看原尺寸；双色和像素是算法样例，其余使用现有引擎能力。这些都是实际字符绘制，没有照片底图；不是六种已经上线的商业模板。</p></header><div class="grid">${samples.map((s) => `<figure><button aria-label="放大${s.title}" data-id="${s.id}"><img src="${s.png}" alt="${s.title}的真实字符结果"></button><figcaption><strong>${s.title}</strong><small>${s.note}</small></figcaption></figure>`).join('')}</div><p class="foot">私人上传素材仅用于本机试选，未加入网站素材或Git。现有名字画另有明确标注的浓彩融合选项。数字预览不能替代实体印刷打样。</p></main><dialog><button autofocus id="close">关闭 · Esc</button><img alt="当前风格原尺寸"></dialog><script>const dialog=document.querySelector('dialog');document.querySelectorAll('[data-id]').forEach(button=>button.onclick=()=>{dialog.querySelector('img').src=button.querySelector('img').src;dialog.showModal()});document.querySelector('#close').onclick=()=>dialog.close();</script></html>`
  await writeFile(path.join(out, 'styleboard.html'), html)
  await page.setContent(html)
  await page.locator('.grid img').evaluateAll((imgs) => Promise.all(imgs.map((im) => im.decode())))
  await page.screenshot({ path: path.join(out, 'styleboard.png'), fullPage: true })
  report.passed = true
} finally {
  await browser.close()
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ out, passed: report.passed, cases: report.cases.length }))
}
