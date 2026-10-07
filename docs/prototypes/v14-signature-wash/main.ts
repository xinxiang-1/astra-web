import { generateHandwritingVariants, renderSignaturePortrait, paintPlacementsTiled, canvasToPngBlob, type Placement } from '../../../src/lib/signature-portrait'
import { createSignatureRasterWorker } from '../../../src/lib/signature-portrait/raster-worker-client'
import { prepareSignatureWash } from '../../../src/lib/signature-portrait/styled-wash'
import { SIGNATURE_WASH_PALETTES, type SignatureWashPalette, type SignatureWashRecipe } from '../../../src/lib/signature-portrait/wash-style'
import '../v13-portrait-styles/controls.css'

const profiles = [
  { id: 'source', name: '原色融合', description: '现有75%彩绘底色，完整签名保持原墨色。' },
  { id: 'duotone-v1', name: '双色绘影', description: '底色采用阴影/中间调双墨曲线，签名完整保留。' },
  { id: 'pop-v1', name: '波普彩绘', description: '底色形成保边色面与关键轮廓，签名完整保留。' },
] as const
const root = document.getElementById('app')!
root.innerHTML = `<header><a class="brand" href="http://127.0.0.1:5180/signature-portrait">ASTRA · 名字画</a><button id="theme" type="button">切换主题</button></header><h1>签名不变，画面换一种心情。</h1>
<p class="lead">同一照片、完整字体辅助签名、同一组方向和疏密，比较三种彩绘底色。它们明确包含图像底色，仍是签名融合候选。这里的字体写法不会标作真人手写。</p>
<section class="controls"><div class="fields"><label>画像<select id="source"><option value="portrait">原创人像</option><option value="porcelain">原创瓷像</option><option value="upload">我的图片</option></select></label><label>名字<input id="name" value="林晓晚" type="text" maxlength="32"></label>
<label>配色<select id="palette">${SIGNATURE_WASH_PALETTES.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label><label>输出<select id="size"><option value="1024">1K · 快速比较</option><option value="2048">2K · 完整输出</option></select></label>
<label>画面底色<select id="surface"><option value="paper">纸白</option><option value="night">深夜</option></select></label><label class="wide" id="upload-label" hidden>上传画像<input id="upload" type="file" accept="image/png,image/jpeg,image/webp"></label></div><div class="actions"><button id="generate" type="button">生成三种对照</button><button id="cancel" type="button" hidden>取消生成</button><span id="dirty" class="note"></span></div></section>
<div class="status"><span class="spin" hidden aria-hidden="true"></span><div><p id="status" role="status" aria-live="polite">准备完整签名…</p><progress id="progress" value="0" max="1" hidden aria-label="生成进度"></progress></div></div><section class="grid">${profiles.map(p => `<figure class="card" data-profile="${p.id}"><div class="host"></div><figcaption><h2>${p.name}</h2><p>${p.description}</p><p class="stats"></p><div class="crop"></div><div class="actions"><button data-view="${p.id}" type="button" disabled>原大与缩放</button><button data-save="${p.id}" type="button" disabled>免费下载 PNG</button></div></figcaption></figure>`).join('')}</section>
<p class="note">三幅使用同一份完整Placement，笔迹位置、方向、大小、透明度和墨色保持相同。风格只改变彩绘底色，不能宣传为全幅纯笔迹。下方裁片为320×190原生像素。</p><img id="sample" alt="本次使用的完整字体辅助签名" hidden><dialog aria-label="原大签名融合画像"><div class="toolbar"><button id="fit" type="button">适应</button><button data-zoom="0.5" type="button">50%</button><button data-zoom="1" type="button">100%</button><button data-zoom="2" type="button">200%</button><button id="close" type="button" autofocus>关闭 · Esc</button></div><div class="viewer"></div></dialog>`
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const value = (id: string) => el<HTMLInputElement | HTMLSelectElement>(id).value
const status = el('status'), progress = el<HTMLProgressElement>('progress'), button = el<HTMLButtonElement>('generate'), cancel = el<HTMLButtonElement>('cancel'), spinner = document.querySelector<HTMLElement>('.spin')!
const dialog = document.querySelector<HTMLDialogElement>('dialog')!, viewer = document.querySelector<HTMLDivElement>('.viewer')!
type Result = { canvas: HTMLCanvasElement; recipe: SignatureWashRecipe; width: number; height: number; elapsedMs: number }
let result = new Map<string, Result>(), pending = new Map<string, Result>(), busy = false, count = 0, sequence = 0, placements: Placement[] = [], zoomCanvas: HTMLCanvasElement | null = null
let abort = { cancelled: false }
const release = (map: Map<string, Result>) => { map.forEach(r => { r.canvas.width = r.canvas.height = 1 }); map.clear() }
function setBusy(active: boolean) {
  busy = active; button.disabled = active; cancel.hidden = !active; spinner.hidden = !active; progress.hidden = !active
}
function stop() { abort.cancelled = true; sequence++; release(pending); setBusy(false); status.textContent = '已取消；上一组完整作品保留。' }
async function run() {
  stop(); const seq = sequence, signal = { cancelled: false }; abort = signal; setBusy(true); progress.value = 0
  status.textContent = '准备照片与完整字体辅助签名…'
  try {
    const name = value('name').trim(), size = Number(value('size')), palette = value('palette') as SignatureWashPalette, night = value('surface') === 'night'
    if (!name || /[\p{C}]/u.test(name)) throw new Error('请填写有效名字')
    const file = value('source') === 'upload' ? el<HTMLInputElement>('upload').files?.[0] : new File([await fetch(value('source') === 'porcelain' ? '/artwork/porcelain-study-v1.png' : '/artwork/portrait-reference.png').then(r => r.blob())], 'sample.png', { type: 'image/png' })
    if (!file || file.size > 20 * 1024 * 1024) throw new Error('请选择小于20MB的图片')
    const image = new Image(), url = URL.createObjectURL(file)
    try {
      image.src = url; await image.decode()
      if (image.naturalWidth * image.naturalHeight > 32_000_000) throw new Error('请将图片缩至3200万像素以内')
      const stamps = await generateHandwritingVariants(name, { count: 10, seed: 20261007, maxSide: 420, font: 'mashanzheng' })
      if (signal.cancelled) return
      const options = { maxSide: size, density: 30, minSizeRatio: .014, maxSizeRatio: .04, angleRange: 12, orientationMode: 'flow' as const, orientationStrength: .8, toneGain: 3,
        background: night ? '#111615' : '#f5f3ef', ink: night ? { r: 238, g: 234, b: 226 } : undefined, invertDensity: night, seed: 42, colorize: true, underlay: .75, skipPaint: true }
      status.textContent = '后台排布完整签名…'
      const scene = await renderSignaturePortrait(image, image.naturalWidth, image.naturalHeight, stamps, options, signal)
      scene.canvas.width = scene.canvas.height = 1
      for (let at = 0; at < profiles.length; at++) {
        if (signal.cancelled) return
        const profile = profiles[at]!, recipe: SignatureWashRecipe = profile.id === 'source' ? {} : { washStyle: profile.id, washPalette: palette }
        status.textContent = `${profile.name} · 准备彩绘底色…`
        const started = performance.now(), wash = await prepareSignatureWash(image, recipe, { signal,
          onProgress: ratio => { if (!signal.cancelled) progress.value = (at + ratio * .08) / profiles.length },
        })
        const worker = await createSignatureRasterWorker(scene.placements, stamps, scene.width, scene.height, options, signal, wash)
        let canvas: HTMLCanvasElement
        const onProgress = (done: number, total: number) => {
          if (signal.cancelled) return
          progress.value = (at + done / Math.max(1, total)) / profiles.length
          status.textContent = `${profile.name} · 精绘完整笔迹 ${Math.round(progress.value * 100)}%`
        }
        try {
          canvas = worker ? await worker.paint(scene.width, scene.height, 1000, { tileSize: 320, signal, onProgress }) : await paintPlacementsTiled(scene.placements, stamps, scene.width, scene.height, scene.width, scene.height,
            { ...options, portrait: wash, tileSize: 320, signal, onTile: ({ done, total }) => onProgress(done, total) })
        } finally { worker?.dispose() }
        if (signal.cancelled || seq !== sequence) { canvas.width = canvas.height = 1; return }
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${profile.name}：${name}的完整签名融合画像`)
        pending.set(profile.id, { canvas, recipe, width: scene.width, height: scene.height, elapsedMs: performance.now() - started })
      }
      if (signal.cancelled || seq !== sequence) return
      const old = result; result = pending; pending = new Map(); placements = scene.placements; count++
      for (const profile of profiles) {
        const card = document.querySelector<HTMLElement>(`[data-profile="${profile.id}"]`)!, r = result.get(profile.id)!
        card.querySelector('.host')!.replaceChildren(r.canvas)
        const crop = document.createElement('canvas'); crop.width = 320; crop.height = 190
        crop.getContext('2d')!.drawImage(r.canvas, Math.max(0, r.width * .5 - 160), Math.max(0, r.height * .4 - 95), 320, 190, 0, 0, 320, 190)
        card.querySelector('.crop')!.replaceChildren(crop)
        card.querySelector('.stats')!.textContent = `${r.width} × ${r.height} · ${placements.length.toLocaleString()}枚完整签名 · ${(r.elapsedMs / 1000).toFixed(1)}秒精绘`
        card.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = false })
      }
      release(old); el<HTMLImageElement>('sample').src = stamps[0]!.previewUrl; el('sample').hidden = false
      status.textContent = '三幅完整对照已完成。点开看签名原大细节；缩放不会重新计算。'; el('dirty').textContent = ''; progress.value = 1
    } finally { URL.revokeObjectURL(url) }
  } catch (error) { if (!signal.cancelled) { release(pending); status.textContent = `${error instanceof Error ? error.message : '生成失败'}；上一组作品保留。` } }
  finally { if (seq === sequence) setBusy(false) }
}
function zoom(factor?: number) {
  if (!zoomCanvas) return
  const width = factor ? zoomCanvas.width * factor : Math.min(zoomCanvas.width, viewer.clientWidth)
  zoomCanvas.style.width = `${Math.round(width)}px`; zoomCanvas.style.height = `${Math.round(width * zoomCanvas.height / zoomCanvas.width)}px`
}
function clearZoom() { if (zoomCanvas) zoomCanvas.width = zoomCanvas.height = 1; zoomCanvas = null; viewer.replaceChildren() }
root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => { b.onclick = () => {
  const r = result.get(b.dataset.view!); if (!r) return
  clearZoom(); zoomCanvas = document.createElement('canvas'); zoomCanvas.width = r.width; zoomCanvas.height = r.height; zoomCanvas.getContext('2d')!.drawImage(r.canvas, 0, 0)
  zoomCanvas.setAttribute('role', 'img'); zoomCanvas.setAttribute('aria-label', r.canvas.getAttribute('aria-label')!)
  viewer.append(zoomCanvas); dialog.showModal(); zoom()
} })
root.querySelectorAll<HTMLButtonElement>('[data-save]').forEach(b => { b.onclick = async () => {
  const r = result.get(b.dataset.save!); if (!r) return
  const blob = await canvasToPngBlob(r.canvas), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `astra-signature-${b.dataset.save}-${r.width}x${r.height}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000)
} })
button.onclick = () => { void run() }; cancel.onclick = stop; el('fit').onclick = () => zoom(); el('close').onclick = () => dialog.close(); dialog.onclose = clearZoom
root.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach(b => { b.onclick = () => zoom(Number(b.dataset.zoom)) })
root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.controls input,.controls select').forEach(c => c.addEventListener('input', () => { el('upload-label').hidden = value('source') !== 'upload'; el('dirty').textContent = '参数待应用，点击生成更新。' }))
let initialTheme = 'light'
try { if (localStorage.getItem('astra-theme') === 'dark') initialTheme = 'dark' } catch { /* Theme still works without storage. */ }
document.documentElement.dataset.theme = initialTheme
el('theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'
  document.documentElement.dataset.theme = next
  try { localStorage.setItem('astra-theme', next) } catch { /* Keep the chosen theme for this page. */ }
}
window.addEventListener('pagehide', event => { stop(); if (!event.persisted) { release(result); clearZoom() } })
Object.assign(window, { __astraSignatureWashLab: { get state() { return { busy, count, candidateCount: pending.size, placements: placements.length, recipes: [...result.values()].map(r => r.recipe), elapsed: [...result.values()].map(r => r.elapsedMs) } } } })
void run()
