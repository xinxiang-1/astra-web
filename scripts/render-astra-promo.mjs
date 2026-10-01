import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const output = resolve(process.env.ASTRA_PROMO_OUTPUT || 'output/astra-promo-v2')
await mkdir(output, { recursive: true })
const fps = 24, seconds = 24, width = 1920, height = 1080
// Original synthesized ambient track: no downloaded music or third-party samples.
const sampleRate = 48000, samples = sampleRate * seconds
const sound = Buffer.alloc(44 + samples * 4)
sound.write('RIFF', 0); sound.writeUInt32LE(sound.length - 8, 4); sound.write('WAVEfmt ', 8)
sound.writeUInt32LE(16, 16); sound.writeUInt16LE(1, 20); sound.writeUInt16LE(2, 22)
sound.writeUInt32LE(sampleRate, 24); sound.writeUInt32LE(sampleRate * 4, 28); sound.writeUInt16LE(4, 32); sound.writeUInt16LE(16, 34)
sound.write('data', 36); sound.writeUInt32LE(samples * 4, 40)
const notes = [130.81, 164.81, 196, 261.63]
for (let i = 0; i < samples; i++) {
  const t = i / sampleRate, envelope = Math.min(1, t / 2, (seconds - t) / 2)
  const pad = notes.reduce((sum, frequency, n) => sum + Math.sin(t * frequency * Math.PI * 2) * (.025 + .012 * Math.sin(t * .25 + n)), 0)
  const pulse = Math.sin(t * 65.405 * Math.PI * 2) * Math.exp(-(t % .75) * 11) * .07
  const value = Math.round((pad + pulse) * envelope * 32767)
  sound.writeInt16LE(value, 44 + i * 4); sound.writeInt16LE(value, 46 + i * 4)
}
await writeFile(resolve(output, 'original-ambient.wav'), sound)
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
await page.goto(`${base}/art-lab`)
await page.getByRole('status').filter({ hasText: '作品已生成' }).waitFor()
const encoder = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', 'pipe:0', '-i', resolve(output, 'original-ambient.wav'), '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', resolve(output, 'astra-character-film.mp4')], { windowsHide: true })
let encoderError = ''
encoder.stderr.on('data', chunk => { encoderError += chunk.toString() })
encoder.on('error', error => { encoderError += error.message })
const completion = new Promise((resolveResult, reject) => encoder.on('close', code => code === 0 ? resolveResult() : reject(new Error(encoderError || `ffmpeg exited ${code}`))))
// Handle rejection immediately while frames are being streamed.
completion.catch(() => {})
try {
  const engine = await page.evaluate(async ({ width, height }) => {
    const { prepareArtFrame, createArtRenderer, ART_ENGINE_VERSION } = await import('/src/lib/art-engine/index.ts')
    const logo = new Image(); logo.src = '/brand/astra-lockup-dark.svg'; await logo.decode()
    const portrait = new Image(); portrait.src = '/artwork/portrait-reference.png'; await portrait.decode()
    const landscape = new Image(); landscape.src = '/artwork/landscape.jpg'; await landscape.decode()
    await document.fonts.ready
    const scenes = [
      { mode: 'density', title: ['把光影，', '写成作品。'], subtitle: 'ASTRA / A NEW WAY TO SEE', source: portrait },
      { mode: 'density', title: ['由字符，', '留下光的形状。'], subtitle: '01 / 光影字符', source: portrait },
      { mode: 'color', title: ['让颜色，', '停在每个字符里。'], subtitle: '02 / 原色字符', source: portrait },
      { mode: 'phrase', title: ['写下你', '想说的话。'], subtitle: '03 / 中文铺字', source: landscape },
      { mode: 'braille', title: ['八个点，', '描绘更多细节。'], subtitle: '04 / 点阵细节', source: portrait },
      { mode: 'contour', title: ['让轮廓，', '成为新的语言。'], subtitle: '05 / 轮廓线稿', source: portrait },
      { mode: 'halftone', title: ['像印刷，', '也像艺术。'], subtitle: '06 / 印刷网点', source: portrait },
      { mode: 'color', title: ['免费开始，', '你的第一幅作品。'], subtitle: 'LOCAL. PRIVATE. CREATIVE.', source: portrait },
    ]
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
    const art = document.createElement('canvas'), renderer = createArtRenderer(art)
    const ctx = canvas.getContext('2d')
    for (const scene of scenes) scene.frame = prepareArtFrame(scene.source, scene.source.naturalWidth, scene.source.naturalHeight, { mode: scene.mode, columns: 150, phrase: '山河万里，光与影', colored: scene.mode === 'phrase', contrast: .08 })
    const smooth = x => x * x * (3 - 2 * x)
    window.__promoRender = time => {
      const index = Math.min(7, Math.floor(time / 3)), scene = scenes[index], local = time - index * 3
      const entrance = smooth(Math.min(1, local / .65))
      ctx.fillStyle = '#101817'; ctx.fillRect(0, 0, width, height)
      ctx.strokeStyle = '#26403a'; ctx.lineWidth = 1
      for (let x = 40; x < width; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke() }
      for (let y = 40; y < height; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke() }
      ctx.strokeStyle = '#284e47'; ctx.beginPath();ctx.arc(1480,540,380+Math.sin(time*.15)*30,0,Math.PI*2);ctx.stroke()
      ctx.drawImage(logo, 88, 50, 280, 64)
      ctx.fillStyle = '#58e8ed';ctx.font = '16px Consolas';ctx.fillText('CHARACTER ART / ENGINE 02',90,150)
      renderer.render(scene.frame,{longEdge:1000,time:local,motion:index===0?'assemble':index===7?'breathe':'wave'})
      const fit = Math.min(900/art.width,880/art.height), aw=art.width*fit, ah=art.height*fit, ax=960+(900-aw)/2, ay=150+(800-ah)/2
      ctx.save();ctx.globalAlpha=.2+.8*entrance;ctx.drawImage(art,ax+40*(1-entrance),ay,aw,ah)
      if(index===0 && local<1.8){const fraction=1-smooth(Math.min(1,local/1.8));ctx.save();ctx.beginPath();ctx.rect(ax,ay,aw*fraction,ah);ctx.clip();ctx.drawImage(scene.source,ax,ay,aw,ah);ctx.restore()}
      ctx.restore()
      ctx.save();ctx.globalAlpha=entrance
      ctx.fillStyle='#58e8ed';ctx.font='18px "Microsoft YaHei"';ctx.fillText(scene.subtitle,90,320)
      ctx.fillStyle='#f0ede5';ctx.font='64px "Microsoft YaHei"';scene.title.forEach((line,i)=>ctx.fillText(line,90,440+i*92+28*(1-entrance)))
      ctx.fillStyle='#9eb8ae';ctx.font='23px "Microsoft YaHei"';ctx.fillText('图片与文字，在你的浏览器中成为艺术。',90,690)
      ctx.font='18px "Microsoft YaHei"';ctx.fillText('本地处理 / 六种表达 / 4K 图片',90,735)
      if(index===7){ctx.fillStyle='#58e8ed';ctx.fillRect(90,810,295,64);ctx.fillStyle='#102020';ctx.font='24px "Microsoft YaHei"';ctx.fillText('探索你的文字艺术 →',110,852)}
      ctx.restore()
      ctx.strokeStyle='#5ee4e6';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(90,1000);ctx.lineTo(90+1740*(time/24),1000);ctx.stroke()
      ctx.fillStyle='#91aaa0';ctx.font='14px Consolas';ctx.fillText(`${String(index+1).padStart(2,'0')} / 08`,90,960);ctx.fillText('GENERATED WITH ASTRA',1550,960)
      const fade = time > 23.4 ? (time-23.4)/.6 : 0
      if(fade){ctx.fillStyle=`rgba(16,24,23,${Math.min(1,fade)})`;ctx.fillRect(0,0,width,height)}
      return canvas.toDataURL('image/png').split(',')[1]
    }
    return ART_ENGINE_VERSION
  }, { width, height })
  for (let index = 0; index < fps * seconds; index++) {
    const data = await page.evaluate(time => window.__promoRender(time), index / fps)
    const frame = Buffer.from(data, 'base64')
    if (index === fps * 7) await writeFile(resolve(output, 'cover.png'), frame)
    if (index === fps * 10 || index === fps * 22) await writeFile(resolve(output, `review-${index / fps}s.png`), frame)
    if (!encoder.stdin.write(frame)) await once(encoder.stdin, 'drain')
    if (index % (fps * 3) === 0) console.log(`Promo ${index}/${fps * seconds} frames`)
  }
  encoder.stdin.end(); await completion
  const sources = ['public/artwork/portrait-reference.png', 'public/artwork/landscape.jpg', 'public/brand/astra-lockup-dark.svg']
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async filename => [filename, createHash('sha256').update(await readFile(filename)).digest('hex')])))
  await writeFile(resolve(output, 'manifest.json'), JSON.stringify({ version: 2, date: '2026-09-30', file: 'astra-character-film.mp4', width, height, fps, seconds, frames: fps * seconds, engine, sources, sourceHashes, browser: await browser.version(), dpr: 1, music: 'Original synthesis generated by this script', claims: 'Only implemented six modes and image export; no subscription, cloud sync or signature quality claims', regenerate: 'node scripts/render-astra-promo.mjs' }, null, 2))
  await writeFile(resolve(output, 'README.md'), '# Astra 宣传片 v2\n\n24 秒 / 1920×1080 / 24 fps / H.264 + AAC。由真实六模式候选引擎画面和原创合成音轨组成，加入新版原创 SVG Logo。\n\n0–3 秒原图过渡与品牌；3–6 光影字符；6–9 原色字符；9–12 中文铺字；12–15 点阵；15–18 轮廓；18–21 网点；21–24 免费开始行动。\n\n`manifest.json` 保存引擎版本、输入哈希和浏览器环境；`review-10s.png` / `review-22s.png` 用于画面检查。\n\n重生成：启动 5180 服务，运行 `node scripts/render-astra-promo.mjs`，需要本机 ffmpeg。没有付费、云同步或签名商业画质承诺。公开宣传前仍需完成全部源素材许可核验。\n')
  console.log(`Promo ready: ${output}`)
} finally { if (!encoder.stdin.destroyed) encoder.stdin.end(); await browser.close() }
