import { generateHandwritingVariants, renderSignaturePortrait, paintPlacementsScaled, type SignatureStamp } from '../../../src/lib/signature-portrait'
import { historicalStamp, measure, paint, partition, palettes, type Palette } from './engine'
import { quality } from '../v10-signature-capacity/metrics'

const root = document.querySelector<HTMLDivElement>('#app')!
root.innerHTML = `
  <header><a class="brand" href="/art">ASTRA <span>名字画研究</span></a><a href="/signature-portrait">打开创作工具 ↗</a></header>
  <main><p class="eyebrow">完整笔迹 · 明暗容量 · 原生比较</p><h1>近看完整笔迹，远看更细的光影。</h1>
  <p class="lead">比较笔迹织排与正负笔迹拼贴。后者以完整签名镂空块面，探索更清晰的肖像；这次比较2K与4K实际输出，仍是研究候选。</p>
  <section class="controls" aria-label="比较设置">
    <label>画像<select id="source"><option value="porcelain">原创瓷像</option><option value="portrait">原创人像</option></select></label>
    <label>笔迹<select id="template"><option value="beethoven">贝多芬 · 历史矢量重绘</option><option value="chinese">李云舟 · 行楷辅助</option><option value="english">Alexander Montgomery · 草书辅助</option></select></label>
    <label>底色<select id="palette"><option value="paper">纸白</option><option value="night">夜光</option></select></label>
    <label>排布<select id="profile"><option value="candidate">正负笔迹拼贴 · R2研究</option><option value="ink">现有笔迹织排</option><option value="cutout">现有镂空排印</option></select></label>
    <label>输出<select id="size"><option value="4096">4K · 4096px</option><option value="2048">2K · 2048px</option></select></label>
  </section>
  <p id="status" role="status" aria-live="polite">准备画面…</p>
  <section class="workspace"><figure class="artwork"><div id="canvas-host"></div><figcaption id="caption"></figcaption></figure>
  <aside><h2>远看肖像，近看笔迹</h2><div id="crop"></div><div id="stamp"></div><p id="capacity"></p>
  <button id="download" type="button" disabled>免费下载研究 PNG</button><p class="note">拼贴含负笔迹墨版，纯笔迹肖像仍需继续研发。数值一致不代表商业审美通过；完整笔迹原生高度至少16px；输出放大不增加原图细节，也不保证印刷可读性。</p>
  <a href="https://commons.wikimedia.org/wiki/File:Signature_Van_Beethoven.svg">历史签名来源与公有领域标记 ↗</a></aside></section>
  <footer>真实算法生成 · 原图仅用于计算 · 完整签名 · 研究输出保持免费</footer></main>`
const select = (id: string) => document.querySelector<HTMLSelectElement>(`#${id}`)!
const status = document.querySelector<HTMLElement>('#status')!
const button = document.querySelector<HTMLButtonElement>('#download')!
const cache = new Map<string, SignatureStamp[]>()
let result: HTMLCanvasElement | null = null
let pending = false
async function update() {
  if (pending) return
  pending = true; button.disabled = true
  const controls = [...document.querySelectorAll<HTMLSelectElement>('select')]
  controls.forEach(control => { control.disabled = true })
  status.textContent = '准备完整笔迹与画像…'
  try {
    const size = Number(select('size').value) as 2048 | 4096
    const template = select('template').value, palette = select('palette').value as Palette, profile = select('profile').value
    let stamps = cache.get(template)
    if (!stamps) {
      stamps = template === 'beethoven' ? await historicalStamp() : await generateHandwritingVariants(template === 'chinese' ? '李云舟' : 'Alexander Montgomery', { count: 8, maxSide: 420, seed: 20261004, font: template === 'chinese' ? 'mashanzheng' : 'longcang' })
      cache.set(template, stamps)
    }
    const image = new Image()
    image.src = select('source').value === 'porcelain' ? '/artwork/porcelain-study-v1.png' : '/artwork/portrait-reference.png'
    await image.decode()
    status.textContent = '排布完整签名…'
    await new Promise(resolve => setTimeout(resolve, 0))
    let output: HTMLCanvasElement
    let count: number, cutouts = 0
    const started = performance.now()
    if (profile === 'candidate') {
      const scene = partition(image, stamps, palette, size)
      output = paint(scene, stamps); count = scene.cells.length
      cutouts = scene.cells.filter(cell => cell.polarity === 'cutout').length
    } else {
      const generated = await renderSignaturePortrait(image, image.naturalWidth, image.naturalHeight, stamps, { maxSide: size, density: 30, minSizeRatio: .014, maxSizeRatio: .04, angleRange: 12, seed: 42, skipPaint: true, inkStyle: profile === 'ink' ? 'ink' : 'cutout', background: palettes[palette].background, ink: palette === 'night' ? { r: 238, g: 234, b: 226 } : undefined, invertDensity: palette === 'night', colorize: false, coverFill: false, underlay: 0 })
      output = paintPlacementsScaled(generated.placements, stamps, generated.width, generated.height, generated.width, generated.height, { background: palettes[palette].background, inkStyle: profile === 'ink' ? 'ink' : 'cutout', colorize: false, coverFill: false, underlay: 0 })
      count = generated.placements.length
    }
    const elapsed = performance.now() - started
    const metric = quality(image, output, palette)
    const old = result
    document.querySelector('#canvas-host')!.replaceChildren(output)
    result = output
    if (old) { old.width = 1; old.height = 1 }
    output.setAttribute('role', 'img'); output.setAttribute('aria-label', '完整签名构成的研究肖像')
    const crop = document.createElement('canvas'); crop.width = 280; crop.height = 180
    crop.getContext('2d')!.drawImage(output, Math.round(output.width * .5 - 140), Math.round(output.height * .36 - 90), 280, 180, 0, 0, 280, 180)
    document.querySelector('#crop')!.replaceChildren(crop)
    const sample = new Image(); sample.src = stamps[0]!.previewUrl; sample.alt = '完整签名模板'
    document.querySelector('#stamp')!.replaceChildren(sample)
    document.querySelector('#caption')!.textContent = `${output.width} × ${output.height} · ${count}枚完整签名${profile === 'candidate' ? ` · ${cutouts}枚负笔迹墨版` : ''}`
    document.querySelector('#capacity')!.textContent = `模板实际墨量 ${(measure(stamps[0]!).coverage * 100).toFixed(1)}% · 此次生成 ${(elapsed / 1000).toFixed(2)}秒。原生局部按1:1显示。`
    status.textContent = `比较已生成。结构相关 ${metric.structure.toFixed(3)} · 明暗幅度比 ${metric.rangeRatio.toFixed(3)} · 明暗误差 ${metric.toneMAE.toFixed(3)}。仅用于研发诊断。`
    button.disabled = false
    root.dataset.ready = 'true'; root.dataset.profile = profile
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : '研究画面生成失败，可重试'
    button.disabled = !result
  } finally { pending = false; controls.forEach(control => { control.disabled = false }) }
}
for (const element of document.querySelectorAll('select')) element.addEventListener('change', () => { root.dataset.ready = 'false'; void update() })
button.addEventListener('click', () => result?.toBlob(blob => {
  if (!blob) { status.textContent = 'PNG生成失败，请重试'; return }
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = `astra-signature-print-research-${select('profile').value}-${select('template').value}.png`; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}, 'image/png'))
void update()
