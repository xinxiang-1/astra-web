import { makeAtlas } from './atlas'
import './controls.css'
import { defaultRecipe, styles, validateRecipe, type PrintRecipe, type PrintStats, type PrintStyle } from './model'

const root = document.querySelector<HTMLDivElement>('#app')!
root.innerHTML = `
<header><a class="brand" href="/art">ASTRA</a><div class="header-actions"><a href="/ascii-art">字符创作工具 ↗</a><button id="theme" type="button">切换主题</button></div></header>
<main><p class="eyebrow">STYLE LAB / 真实字符 · 同素材对照</p><h1>把一张照片，印成三种心情。</h1>
<p class="lead">双色的柔和光影、Riso 的叠墨纹理、波普的鲜明色面。选择同一素材和文字后一起比较，点开看原大，喜欢的可以下载。这是可操作研究候选，尚未加入正式风格预设。</p>
<section class="controls" aria-label="风格对照设置"><div class="basic">
<label>图片<select id="source"><option value="portrait">原创人像</option><option value="porcelain">原创瓷像</option><option value="upload">我的图片</option></select></label>
<label>配色<select id="palette"><option value="blue-coral">深蓝＋珊瑚红</option><option value="forest-rose">森林绿＋玫瑰粉</option><option value="violet-gold">紫罗兰＋金黄</option></select></label>
<label>文字网屏<select id="screen"><option value="ramp">明暗字符 · 更浓郁</option><option value="phrase">中文短句 · 字间留白</option></select></label>
<label>输出清晰度<select id="size"><option value="2048">2K · 最长边2048px</option><option value="1024">1K · 快速比较</option></select></label>
<label class="wide" id="upload-label" hidden>上传图片<input id="upload" type="file" accept="image/png,image/jpeg,image/webp,image/avif"><span class="secondary">在本机计算，不上传服务器；最多20MB。</span></label>
<label class="wide" id="phrase-label" hidden>中文短句<input id="phrase" type="text" value="林晓晚，把名字写进光影。" maxlength="128"><span class="secondary">按正向句序铺字；最多64个字符。这里是印刷字体，不是手写签名。</span></label>
</div><details class="advanced"><summary>更多调整 · 细节、曲线、纹理与套色</summary><div class="advanced-grid">
<label><span class="range-label">字符列数<output id="columns-value">160</output></span><input id="columns" type="range" min="64" max="240" step="8" value="160"></label>
<label><span class="range-label">曲线对比<output id="contrast-value">15%</output></span><input id="contrast" type="range" min="0" max="0.5" step="0.05" value="0.15"></label>
<label><span class="range-label">Riso 墨纹<output id="grain-value">40%</output></span><input id="grain" type="range" min="0" max="1" step="0.1" value="0.4"></label>
<label><span class="range-label">Riso 套色位移<output id="registration-value">0.8px / 1K</output></span><input id="registration" type="range" min="0" max="2" step="0.2" value="0.8"></label>
</div><p class="secondary">列数决定纹理尺度，分辨率决定输出像素。增加像素不会凭空增加原图细节。中文短句的留白限制墨量，深色区域可能比明暗字符更浅。</p></details>
<div class="actions"><button id="generate" class="primary" type="button">生成三种对照</button><button id="cancel" type="button" hidden>取消本次生成</button><span id="dirty" class="secondary"></span></div></section>
<div class="progress-row"><span class="spinner" hidden aria-hidden="true"></span><div class="progress-copy"><p id="status" role="status" aria-live="polite">准备研究样例…</p><progress id="progress" max="1" value="0" hidden aria-label="生成进度"></progress></div></div>
<section id="grid" aria-label="同素材三风格对照">${styles.map(s => `<figure class="card" data-style="${s.id}"><div class="canvas-host"></div><figcaption><h2>${s.title}</h2><p>${s.description}</p><p class="stats"></p><p class="inks"></p><div class="card-actions"><button type="button" data-view="${s.id}" disabled>原大与缩放</button><button type="button" data-save="${s.id}" disabled>免费下载 PNG</button></div></figcaption></figure>`).join('')}</section>
<p class="footnote">三幅都由真实正向字形墨层构成，原图只用于采样，没有照片底图。中文字逐字保留句序，不冒充完整手写签名。Riso 为数字近似，纸张和实墨色准需要实体打样。<br><a href="https://helpx.adobe.com/photoshop/using/duotones.html">双色曲线原理 ↗</a><a href="https://intranet.mcad.edu/kb/risograph-printing">Riso 分色参考 ↗</a></p>
</main><dialog id="dialog"><div class="viewer-toolbar"><strong id="viewer-title"></strong><div class="zoom-actions"><button id="fit" type="button">适应</button><button data-zoom="0.5" type="button">50%</button><button data-zoom="1" type="button">100%</button><button data-zoom="2" type="button">200%</button><button id="close" type="button" autofocus>关闭 · Esc</button></div></div><div class="viewer"></div><p class="viewer-note">缩放查看已经生成的像素，不重复计算；100%每个图像像素对应一个CSS像素。</p></dialog>`

// The independent preview hosts only this lab; route its tool links to the running app.
if (import.meta.env.PROD) {
  const appOrigin = import.meta.env.VITE_ASTRA_APP_URL || 'http://127.0.0.1:5180'
  root.querySelectorAll<HTMLAnchorElement>('header a[href^="/"]').forEach(a => { a.href = new URL(a.getAttribute('href')!, appOrigin).href })
}

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const value = (id: string) => element<HTMLInputElement | HTMLSelectElement>(id).value
const status = element<HTMLParagraphElement>('status'), progress = element<HTMLProgressElement>('progress')
const generate = element<HTMLButtonElement>('generate'), cancel = element<HTMLButtonElement>('cancel')
const dirty = element<HTMLSpanElement>('dirty'), spinner = document.querySelector<HTMLElement>('.spinner')!
const dialog = element<HTMLDialogElement>('dialog'), viewer = document.querySelector<HTMLDivElement>('.viewer')!
type Result = { canvas: HTMLCanvasElement; stats: PrintStats }
let results = new Map<PrintStyle, Result>(), worker: Worker | null = null, controller: AbortController | null = null
let generation = 0, completed = 0, busy = false, revision = 0, snapshot: PrintRecipe | null = null
let candidates = new Map<PrintStyle, Result>(), zoomCanvas: HTMLCanvasElement | null = null
const release = (map: Map<PrintStyle, Result>) => { map.forEach(r => { r.canvas.width = r.canvas.height = 1 }); map.clear() }
function setBusy(active: boolean) {
  busy = active; generate.disabled = active; cancel.hidden = !active; spinner.hidden = !active; progress.hidden = !active
  element('grid').setAttribute('aria-busy', String(active))
}
function stop(message = '本次生成已取消；已完成的作品仍可查看和下载。') {
  generation++; worker?.terminate(); worker = null; controller?.abort(); controller = null
  release(candidates); setBusy(false); status.textContent = message
}
function inputs(): PrintRecipe {
  return validateRecipe({ ...defaultRecipe, palette: value('palette'), screen: value('screen'), phrase: value('phrase'),
    longEdge: Number(value('size')), columns: Number(value('columns')), contrast: Number(value('contrast')),
    grain: Number(value('grain')), registration: Number(value('registration')) })
}
function controlsChanged() {
  revision++
  element('upload-label').hidden = value('source') !== 'upload'
  element('phrase-label').hidden = value('screen') !== 'phrase'
  element('columns-value').textContent = value('columns')
  element('contrast-value').textContent = `${Math.round(Number(value('contrast')) * 100)}%`
  element('grain-value').textContent = `${Math.round(Number(value('grain')) * 100)}%`
  element('registration-value').textContent = `${Number(value('registration')).toFixed(1)}px / 1K`
  dirty.textContent = '参数待应用，点击生成后更新对照。'
}
async function run() {
  stop('准备图片与真实字形…')
  const id = generation, startedRevision = revision; setBusy(true); progress.value = 0
  let recipe: PrintRecipe
  try {
    recipe = inputs(); controller = new AbortController()
    const source = value('source') === 'upload' ? element<HTMLInputElement>('upload').files?.[0] : await fetch(value('source') === 'porcelain' ? '/artwork/porcelain-study-v1.png' : '/artwork/portrait-reference.png', { signal: controller.signal }).then(r => { if (!r.ok) throw new Error('示例图片加载失败，请重试或上传图片'); return r.blob() })
    if (!source) throw new Error('先选择一张图片，再生成对照')
    if (source.size > 20 * 1024 * 1024) throw new Error('请使用小于20MB的图片')
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('此浏览器不支持后台绘制，请使用新版Chrome或Edge')
    const atlas = await makeAtlas(recipe)
    if (generation !== id) return
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    const failed = (message: string) => { if (generation === id) stop(`${message}。原来的作品保留，可以调整后重试。`) }
    worker.onerror = () => failed('后台绘制未能完成')
    worker.onmessage = (event: MessageEvent<{ type: string; id: number; fraction: number; label: string; bitmap: ImageBitmap; stats: PrintStats; message: string }>) => {
      const data = event.data
      if (id !== generation || data.id !== id) { data.bitmap?.close(); return }
      if (data.type === 'progress') {
        progress.value = data.fraction
        status.textContent = `${data.label} · ${Math.round(data.fraction * 100)}%${results.size ? '；当前仍显示上次作品' : ''}`
      } else if (data.type === 'result') {
        const canvas = document.createElement('canvas'); canvas.width = data.bitmap.width; canvas.height = data.bitmap.height
        canvas.getContext('2d', { willReadFrequently: true })!.drawImage(data.bitmap, 0, 0); data.bitmap.close()
        canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', `${styles.find(s => s.id === data.stats.style)!.title}的真实字符画像`)
        candidates.set(data.stats.style, { canvas, stats: data.stats })
      } else if (data.type === 'done') {
        if (candidates.size !== styles.length) { failed('对照结果不完整'); return }
        dialog.close(); releaseZoom(); const old = results; results = candidates; candidates = new Map(); snapshot = recipe
        for (const s of styles) {
          const result = results.get(s.id)!, card = document.querySelector<HTMLElement>(`[data-style="${s.id}"]`)!
          card.querySelector('.canvas-host')!.replaceChildren(result.canvas)
          card.querySelector('.stats')!.textContent = `${result.stats.width} × ${result.stats.height} · ${result.stats.columns}列 · ${result.stats.glyphs.toLocaleString()}次字形叠印`
          const inkHost = card.querySelector('.inks')!; inkHost.replaceChildren()
          result.stats.inks.forEach(ink => { const span = document.createElement('span'); span.className = 'swatch'; span.style.backgroundColor = ink; inkHost.append(span) })
          inkHost.append(document.createTextNode(recipe.screen === 'phrase' ? '中文短句 · 字间留白' : '明暗字符 · 独立墨层'))
          card.querySelectorAll<HTMLButtonElement>('button').forEach(b => { b.disabled = false })
        }
        release(old); completed++; worker?.terminate(); worker = null; controller = null; setBusy(false); progress.value = 1
        const elapsed = [...results.values()].reduce((a, r) => a + r.stats.elapsedMs, 0)
        status.textContent = `三幅对照已完成 · 后台印制${(elapsed / 1000).toFixed(1)}秒 · 点开查看原大细节。`
        // User may have changed inputs during the background job; the visible snapshot remains explicit.
        dirty.textContent = revision === startedRevision ? '' : '画面使用本次生成时的参数；改动后可再次生成。'
      } else if (data.type === 'error') failed(data.message)
    }
    worker.postMessage({ type: 'run', id, recipe, source, atlas }, atlas.glyphs.map(g => g.alpha.buffer))
  } catch (error) { if (id === generation) stop(`${error instanceof Error ? error.message : '生成失败'}。已完成作品保留。`) }
}
function releaseZoom() { if (zoomCanvas) zoomCanvas.width = zoomCanvas.height = 1; zoomCanvas = null; viewer.replaceChildren() }
function zoom(factor?: number) {
  if (!zoomCanvas) return
  const width = factor ? zoomCanvas.width * factor : Math.min(zoomCanvas.width, viewer.clientWidth)
  zoomCanvas.style.width = `${Math.round(width)}px`; zoomCanvas.style.height = `${Math.round(width * zoomCanvas.height / zoomCanvas.width)}px`
}
function show(style: PrintStyle) {
  const r = results.get(style); if (!r) return
  releaseZoom(); zoomCanvas = document.createElement('canvas'); zoomCanvas.width = r.canvas.width; zoomCanvas.height = r.canvas.height
  zoomCanvas.getContext('2d')!.drawImage(r.canvas, 0, 0); zoomCanvas.setAttribute('role', 'img'); zoomCanvas.setAttribute('aria-label', `${styles.find(s => s.id === style)!.title}原大细节`)
  viewer.append(zoomCanvas); element('viewer-title').textContent = styles.find(s => s.id === style)!.title
  dialog.showModal(); zoom(); viewer.scrollTo(0, 0)
}
async function save(style: PrintStyle) {
  const result = results.get(style); if (!result || !snapshot) return
  const recipe = snapshot, canvas = result.canvas, filename = `astra-${style}-${recipe.palette}-${canvas.width}x${canvas.height}.png`
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
  if (!blob) { status.textContent = 'PNG编码失败，请重试'; return }
  const url = URL.createObjectURL(blob), a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}
generate.onclick = () => { void run() }; cancel.onclick = () => stop()
root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('.controls input,.controls select').forEach(c => c.addEventListener('input', controlsChanged))
root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b => { b.onclick = () => show(b.dataset.view as PrintStyle) })
root.querySelectorAll<HTMLButtonElement>('[data-save]').forEach(b => { b.onclick = () => { void save(b.dataset.save as PrintStyle) } })
root.querySelectorAll<HTMLButtonElement>('[data-zoom]').forEach(b => { b.onclick = () => zoom(Number(b.dataset.zoom)) })
element('fit').onclick = () => zoom(); element('close').onclick = () => dialog.close(); dialog.addEventListener('close', releaseZoom)
function applyTheme(theme: 'light' | 'dark') {
  document.documentElement.dataset.theme = theme
  element('theme').textContent = theme === 'dark' ? '切换亮色' : '切换暗色'
}
let initialTheme: 'light' | 'dark' = 'light'
try { if (localStorage.getItem('astra-theme') === 'dark') initialTheme = 'dark' } catch { /* Private storage may be unavailable. */ }
applyTheme(initialTheme)
element('theme').onclick = () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  applyTheme(next)
  try { localStorage.setItem('astra-theme', next) } catch { /* Theme remains usable for this page. */ }
}
window.addEventListener('pagehide', event => { stop(); if (!event.persisted) { release(results); releaseZoom() } })
// Read-only research instrumentation; no hidden auto-generation loop.
Object.assign(window, { __astraPrintStudy: { get state() { return { busy, generation, completed, candidateCount: candidates.size, snapshot, stats: [...results.values()].map(r => r.stats) } } } })
void run()
