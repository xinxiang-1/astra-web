<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ART_DEFAULTS, ART_MODES, createArtRenderer, prepareArtFrame, type ArtFrame, type ArtMode, type ArtMotion } from '@/lib/art-engine'
import { triggerDownload } from '@/lib/ascii'
import ArtHeader from '@/components/ArtHeader.vue'

const canvas = ref<HTMLCanvasElement>()
const mode = ref<ArtMode>('density')
const phrase = ref('光与影，皆是你')
const columns = ref(180)
const motion = ref<ArtMotion>('none')
const colored = ref(false)
const running = ref(true)
const fileInput = ref<HTMLInputElement>()
const status = ref('正在准备示例')
const imageUrl = ref('/artwork/portrait-reference.png')
const exporting = ref(false)
const background = ref(ART_DEFAULTS.background)
const ink = ref(ART_DEFAULTS.ink)
const transparent = ref(false)
const lastFrame = ref({ columns: 0, rows: 0, preparationMs: 0 })
const currentMode = computed(() => ART_MODES.find(item => item.id === mode.value)!)
let image: HTMLImageElement | null = null
let frame: ArtFrame | null = null
let renderer: ReturnType<typeof createArtRenderer> | null = null
let objectUrl = ''
let revision = 0
let raf = 0
let last = 0
let started = 0
let pointer = { x: .5, y: .5, strength: 0 }
let media: MediaQueryList | null = null
function draw(time = 0) {
  if (frame) renderer?.render(frame, { time, motion: running.value && !media?.matches ? motion.value : 'none', hover: 'light', pointer: running.value && !media?.matches ? pointer : undefined, longEdge: 1200 })
}
function animate(timestamp: number) {
  if (timestamp - last > 33) { last = timestamp; draw((timestamp - started) / 1000) }
  raf = requestAnimationFrame(animate)
}
function sync() {
  cancelAnimationFrame(raf)
  raf = 0
  draw()
  if (frame && running.value && !document.hidden && !media?.matches && (motion.value !== 'none' || pointer.strength)) {
    started = performance.now(); raf = requestAnimationFrame(animate)
  }
}
function prepare() {
  if (!image || !canvas.value) return
  try {
    frame = prepareArtFrame(image, image.naturalWidth, image.naturalHeight, { mode: mode.value, phrase: phrase.value, columns: columns.value, colored: colored.value, background: background.value, ink: ink.value })
    lastFrame.value = { columns: frame.columns, rows: frame.rows, preparationMs: Math.round(frame.statistics.preparationMs) }
    status.value = '作品已生成 · 本地处理'
    sync()
  } catch (error) { status.value = error instanceof Error ? error.message : '生成失败' }
}
async function load() {
  const current = ++revision
  status.value = '正在读取素材'
  const next = new Image()
  next.src = imageUrl.value
  try {
    await next.decode(); await document.fonts.ready
    if (current !== revision) return
    image = next; prepare()
  } catch { if (current === revision) status.value = '无法读取图片，请使用 PNG / JPEG / WebP' }
}
function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (!file.type.startsWith('image/')) { status.value = '请选择图片'; return }
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(file); imageUrl.value = objectUrl
}
function move(event: PointerEvent) {
  if (!canvas.value || !frame || media?.matches) return
  const rect = canvas.value.getBoundingClientRect()
  const scale = Math.min(rect.width / frame.width, rect.height / frame.height)
  const width = frame.width * scale, height = frame.height * scale
  pointer = { x: (event.clientX - rect.left - (rect.width - width) / 2) / width, y: (event.clientY - rect.top - (rect.height - height) / 2) / height, strength: .7 }
  if (!raf) sync()
}
function leave() { pointer.strength = 0; sync() }
async function download(format: 'png' | 'txt') {
  if (!frame) return
  exporting.value = true
  try {
    const snapshot = frame
    if (format === 'txt') triggerDownload(new Blob([snapshot.text], { type: 'text/plain;charset=utf-8' }), 'astra-art.txt')
    else {
      const exportCanvas = document.createElement('canvas'), output = createArtRenderer(exportCanvas)
      output.render(snapshot, { longEdge: 3840, transparent: transparent.value })
      const blob = await new Promise<Blob>((resolve, reject) => exportCanvas.toBlob(value => value ? resolve(value) : reject(new Error('图片导出失败')), 'image/png'))
      output.destroy(); triggerDownload(blob, 'astra-art-4k.png')
    }
    status.value = '文件已准备下载'
  } catch (error) { status.value = error instanceof Error ? error.message : '导出失败' }
  finally { exporting.value = false }
}
onMounted(() => {
  if (canvas.value) renderer = createArtRenderer(canvas.value)
  media = matchMedia('(prefers-reduced-motion: reduce)')
  media.addEventListener('change', sync)
  document.addEventListener('visibilitychange', sync)
  void load()
})
watch(imageUrl, load)
watch([mode, phrase, columns, colored, background, ink], prepare)
watch([motion, running], sync)
onBeforeUnmount(() => {
  revision++; cancelAnimationFrame(raf); renderer?.destroy()
  media?.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync)
  if (objectUrl) URL.revokeObjectURL(objectUrl)
})
</script>

<template>
  <div class="engine-page">
    <ArtHeader />
    <header class="engine-intro"><span>ASTRA / CHARACTER ENGINE 02</span><h1>每一个字符，都是光的形状。</h1><p>六种表达，同一套图像与字形管线。上传你的照片，探索文字的更多可能。</p></header>
    <div class="engine-layout">
      <aside class="engine-controls">
        <h2>选择表达</h2>
        <div class="engine-modes"><button v-for="item in ART_MODES" :key="item.id" :class="{ selected: mode === item.id }" :aria-pressed="mode === item.id" @click="mode = item.id"><b>{{ item.name }}</b><span>{{ item.description }}</span></button></div>
        <label v-if="mode === 'phrase'" class="engine-field">铺写的文字<input v-model="phrase" maxlength="64" /></label>
        <label class="engine-field">细节 · {{ columns }} 列<input v-model.number="columns" type="range" min="60" max="360" step="10" /></label>
        <label class="engine-check"><input v-model="colored" type="checkbox" /> 使用原图色彩</label>
        <div class="engine-colors"><label>背景<input v-model="background" type="color" /></label><label>墨色<input v-model="ink" type="color" /></label></div>
        <label class="engine-field">环境动效<select v-model="motion"><option value="none">静态</option><option value="breathe">光息</option><option value="wave">流动</option><option value="assemble">聚合入场</option></select></label>
        <p class="engine-note">移动指针可扰动字符。系统减少动效时自动静止。</p>
      </aside>
      <section class="engine-workspace" :aria-label="`${currentMode.name}工作区`">
        <div class="engine-toolbar"><span>{{ currentMode.name }}</span><button @click="running = !running">{{ running ? '暂停动效' : '继续动效' }}</button></div>
        <div class="engine-canvas"><canvas ref="canvas" role="img" :aria-label="`${currentMode.name}作品预览`" @pointermove="move" @pointerleave="leave" /></div>
        <div class="engine-meta"><span role="status">{{ status }}</span><span>{{ lastFrame.columns }} × {{ lastFrame.rows }} 字格</span></div>
        <div class="engine-actions"><input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden @change="upload" /><button class="art-button primary" @click="fileInput?.click()">上传图片</button><button class="art-button" :disabled="exporting" @click="download('png')">下载 4K PNG</button><button class="art-button" :disabled="exporting" @click="download('txt')">下载文字</button><label class="engine-check"><input v-model="transparent" type="checkbox" /> 透明背景</label></div>
        <p class="engine-note">新引擎画质验证版 · 所有处理在本机完成。<RouterLink to="/ascii-art">进入支持短视频与本地项目的完整编辑器 →</RouterLink></p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.engine-page { min-height: 100dvh; background: var(--bg); color: var(--text); }
.engine-intro { max-width: 1440px; margin: auto; padding: 42px 48px 30px; }
.engine-intro > span { font: 10px monospace; letter-spacing: 3px; color: var(--art-cyan); }
.engine-intro h1 { font: 400 clamp(25px, 3vw, 40px)/1.4 var(--art-serif); margin: 16px 0; }
.engine-intro p { color: var(--text-muted); font-size: 13px; line-height: 1.8; }
.engine-layout { display: grid; grid-template-columns: 290px minmax(0, 1fr); max-width: 1440px; margin: auto; padding: 0 48px 48px; gap: 28px; }
.engine-controls { padding: 24px; border: 1px solid var(--border); background: var(--bg-elevated); }
.engine-controls h2 { margin: 0 0 18px; font-size: 15px; }
.engine-modes { display: grid; gap: 6px; }
.engine-modes button { text-align: left; padding: 11px; border: 1px solid transparent; background: transparent; color: var(--text-muted); cursor: pointer; }
.engine-modes b { display: block; font-size: 12px; font-weight: 500; }
.engine-modes span { display: block; font-size: 10px; margin-top: 6px; color: var(--text-muted); line-height: 1.5; }
.engine-modes .selected { border-color: #58e8ed70; background: #58e8ed0a; }
.engine-field { display: grid; gap: 9px; margin-top: 24px; font-size: 12px; }
.engine-field input:not([type=range]), .engine-field select { background: var(--bg); border: 1px solid var(--border); color: var(--text); padding: 9px; width: 100%; }
.engine-field input[type=range], .engine-check input { accent-color: var(--art-cyan); }
.engine-check { display: flex; gap: 6px; align-items: center; font-size: 11px; margin-top: 16px; }
.engine-colors { display: flex; gap: 20px; margin-top: 16px; font-size: 11px; }
.engine-colors label { display: flex; align-items: center; gap: 8px; }
.engine-colors input { width: 30px; height: 26px; border: 0; padding: 0; background: transparent; }
.engine-toolbar, .engine-meta { display: flex; justify-content: space-between; align-items: center; padding: 14px 0; font-size: 11px; color: var(--text-muted); }
.engine-toolbar button { border: 1px solid var(--border); background: none; color: var(--text); padding: 9px 14px; cursor: pointer; }
.engine-canvas { height: min(65dvh, 640px); background: #0b100f; border: 1px solid var(--border); display: flex; justify-content: center; align-items: center; overflow: hidden; }
.engine-canvas canvas { width: 100%; height: 100%; object-fit: contain; }
.engine-actions { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
.engine-actions .art-button { color: var(--text); font-size: 12px; }
.engine-actions .primary { color: #102020; }
.engine-actions .engine-check { margin: 0; }
.engine-note { color: var(--text-muted); font-size: 11px; line-height: 1.8; margin-top: 18px; }
.engine-note a { color: var(--art-cyan); }
button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--art-cyan); outline-offset: 3px; }
@media(max-width:800px) { .engine-intro { padding: 28px 22px; }.engine-layout { grid-template-columns: 1fr; padding: 0 22px 28px; }.engine-workspace { grid-row: 1; }.engine-canvas { height: 55dvh; }.engine-modes { grid-template-columns: 1fr 1fr; }.engine-controls { padding: 18px; }.engine-actions .art-button { padding: 10px 16px; min-height: 42px; } }
</style>
