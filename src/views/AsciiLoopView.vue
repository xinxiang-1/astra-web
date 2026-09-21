<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import {
  ASCII_CHARSETS,
  createPrerenderFrameLoop,
  DEFAULT_CHAR_ASPECT,
  isVideoFile,
  loadVideoElement,
  paintAsciiToCanvas,
  triggerDownload,
  type FrameLoopHandle,
  type PrerenderFrame,
} from '@/lib/ascii'
import {
  buildLoopHtmlSnippet,
  captureLoopAsciiFrames,
  captureLoopAsciiFromBitmaps,
  decodeAnimatedImageBitmaps,
  LOOP_ACCEPT,
  LOOP_DEFAULT_COLUMNS,
  LOOP_DEFAULT_FPS,
  LOOP_FLOW_PATTERNS,
  LOOP_MAX_COLUMNS,
  LOOP_MAX_DURATION_SEC,
  LOOP_MAX_FPS,
  loopHtmlToBlob,
  type DominantColor,
  type LoopFlowPattern,
} from '@/lib/ascii/loop'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
const fileInput = ref<HTMLInputElement | null>(null)
const sourceVideo = ref<HTMLVideoElement | null>(null)
const stageCanvas = ref<HTMLCanvasElement | null>(null)

const error = ref('')
const pending = ref(false)
const progress = ref('')
const playing = ref(false)
const columns = ref(LOOP_DEFAULT_COLUMNS)
const fps = ref(LOOP_DEFAULT_FPS)
const flowPattern = ref<LoopFlowPattern>('rain')
const matteThreshold = ref(0.14)
const colorOn = ref(true)

const frames = ref<PrerenderFrame[]>([])
const dominant = ref<DominantColor | null>(null)
const playIndex = ref(0)
const lastFile = ref<File | null>(null)

let objectUrl = ''
let loopHandle: FrameLoopHandle | null = null
let gifBitmaps: ImageBitmap[] = []
let abortCapture = false

const flowOptions = (
  Object.entries(LOOP_FLOW_PATTERNS) as [
    LoopFlowPattern,
    (typeof LOOP_FLOW_PATTERNS)[LoopFlowPattern],
  ][]
).map(([key, value]) => ({ key, ...value }))

const hasResult = computed(() => frames.value.length > 0)

const previewColors = computed(() =>
  theme.isDark
    ? { background: '#070a12', foreground: '#e8eeff' }
    : { background: '#f4f6fb', foreground: '#10182a' },
)

function clearGifBitmaps() {
  for (const b of gifBitmaps) b.close()
  gifBitmaps = []
}

function stopLoop() {
  loopHandle?.stop()
  loopHandle = null
  playing.value = false
}

function revokeUrl() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }
}

function resetMedia() {
  stopLoop()
  clearGifBitmaps()
  revokeUrl()
  frames.value = []
  dominant.value = null
  playIndex.value = 0
  progress.value = ''
  const video = sourceVideo.value
  if (video) {
    video.removeAttribute('src')
    video.load()
  }
}

function paintFrame(index: number) {
  const canvas = stageCanvas.value
  const frame = frames.value[index]
  if (!canvas || !frame) return
  paintAsciiToCanvas(canvas, frame.text, {
    fontSize: 10,
    padding: 14,
    background: previewColors.value.background,
    foreground: previewColors.value.foreground,
    charAspect: DEFAULT_CHAR_ASPECT,
    colors: colorOn.value ? (frame.colors ?? undefined) : undefined,
    devicePixelRatio: window.devicePixelRatio || 1,
  })
}

function startLoop() {
  stopLoop()
  if (frames.value.length === 0) return
  playing.value = true
  playIndex.value = 0
  paintFrame(0)
  loopHandle = createPrerenderFrameLoop({
    fps: fps.value,
    frameCount: frames.value.length,
    shouldTick: () => playing.value,
    getIndex: () => playIndex.value,
    setIndex: (i) => {
      playIndex.value = i
    },
    onFrame: (i) => {
      paintFrame(i)
    },
  })
}

async function runCapture(file: File) {
  error.value = ''
  pending.value = true
  abortCapture = false
  progress.value = '解析主体并抠背景…'
  stopLoop()
  frames.value = []
  dominant.value = null
  clearGifBitmaps()
  lastFile.value = file

  const shared = {
    columns: columns.value,
    fps: fps.value,
    charset: ASCII_CHARSETS.dense,
    withColors: colorOn.value,
    charAspect: DEFAULT_CHAR_ASPECT,
    flowPattern: flowPattern.value,
    matteThreshold: matteThreshold.value,
    shouldAbort: () => abortCapture,
    onProgress: ({ done, total }: { done: number; total: number }) => {
      progress.value = `处理帧 ${done}/${total}`
    },
  }

  try {
    let result
    if (isVideoFile(file)) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      const video = sourceVideo.value
      if (!video) throw new Error('视频组件未就绪')
      revokeUrl()
      objectUrl = await loadVideoElement(file, video)
      video.loop = true
      result = await captureLoopAsciiFrames({ video, ...shared })
    } else if (
      file.type === 'image/gif' ||
      /\.gif$/i.test(file.name) ||
      file.type === 'image/webp'
    ) {
      const decoded = await decodeAnimatedImageBitmaps(file)
      gifBitmaps = decoded.bitmaps
      result = await captureLoopAsciiFromBitmaps(gifBitmaps, shared)
    } else {
      throw new Error('请上传循环 GIF / WebP 或短视频 MP4 / WebM')
    }

    frames.value = result.frames
    dominant.value = result.color
    fps.value = result.fps
    progress.value = `${result.frames.length} 帧 · 背景已替换为流动字符`
    startLoop()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '解析失败'
    resetMedia()
    lastFile.value = null
  } finally {
    pending.value = false
  }
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await runCapture(file)
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (file) void runCapture(file)
}

function reparseIfPossible() {
  if (lastFile.value && !pending.value) void runCapture(lastFile.value)
}

function exportHtml() {
  if (!hasResult.value || !dominant.value) return
  const html = buildLoopHtmlSnippet({
    frames: frames.value.map((f) => ({ text: f.text })),
    fps: fps.value,
    color: dominant.value,
    foreground: previewColors.value.foreground,
    background: previewColors.value.background,
    title: 'ascii-loop',
  })
  triggerDownload(loopHtmlToBlob(html), 'ascii-loop.html')
}

function cancelPending() {
  abortCapture = true
}

watch(flowPattern, () => {
  if (lastFile.value && !pending.value) reparseIfPossible()
})

watch(
  () => theme.mode,
  () => {
    if (hasResult.value) paintFrame(playIndex.value)
  },
)

onBeforeUnmount(() => {
  abortCapture = true
  resetMedia()
})
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <p class="eyebrow">字符画 · 实验</p>
        <h1>循环字符 · 背景流动</h1>
        <p class="sub">
          把循环 GIF / 短视频转成字符画，抠出背景格，换成随帧变化的字符——播起来就是流动特效。仍是纯字符画。列数 ≤
          {{ LOOP_MAX_COLUMNS }}，帧率 ≤ {{ LOOP_MAX_FPS }}，约
          {{ LOOP_MAX_DURATION_SEC }}s。
        </p>
      </div>
      <button
        type="button"
        class="btn primary"
        :disabled="!hasResult"
        @click="exportHtml"
      >
        导出 HTML
      </button>
    </header>

    <div class="layout">
      <aside class="side">
        <section class="card">
          <header class="card-head"><h2>素材</h2></header>
          <div
            class="drop"
            @click="fileInput?.click()"
            @dragover.prevent
            @drop="onDrop"
          >
            <p class="drop-title">拖拽或点击上传</p>
            <p class="drop-hint">GIF / WebP / MP4 / WebM</p>
            <input
              ref="fileInput"
              class="sr-only"
              type="file"
              :accept="LOOP_ACCEPT"
              @change="onFileChange"
            />
          </div>
          <video ref="sourceVideo" class="hidden-video" muted playsinline />
          <p v-if="progress" class="status">{{ progress }}</p>
          <p v-if="error" class="status error">{{ error }}</p>
          <div v-if="pending" class="row-actions">
            <button type="button" class="btn ghost" @click="cancelPending">
              取消
            </button>
          </div>
        </section>

        <section class="card">
          <header class="card-head"><h2>参数</h2></header>
          <label class="field">
            <span>列数 {{ columns }}</span>
            <input
              v-model.number="columns"
              class="range"
              type="range"
              min="48"
              :max="LOOP_MAX_COLUMNS"
              step="4"
              :disabled="pending"
              @change="reparseIfPossible"
            />
          </label>
          <label class="field">
            <span>帧率 {{ fps }}</span>
            <input
              v-model.number="fps"
              class="range"
              type="range"
              min="6"
              :max="LOOP_MAX_FPS"
              step="1"
              :disabled="pending"
              @change="reparseIfPossible"
            />
          </label>
          <label class="field">
            <span>抠图宽容 {{ matteThreshold.toFixed(2) }}</span>
            <input
              v-model.number="matteThreshold"
              class="range"
              type="range"
              min="0.06"
              max="0.28"
              step="0.01"
              :disabled="pending"
              @change="reparseIfPossible"
            />
          </label>
          <label class="check">
            <input
              v-model="colorOn"
              type="checkbox"
              :disabled="pending"
              @change="reparseIfPossible"
            />
            <span>彩色主体</span>
          </label>
        </section>

        <section class="card">
          <header class="card-head"><h2>背景流动</h2></header>
          <div class="seg wrap">
            <button
              v-for="opt in flowOptions"
              :key="opt.key"
              type="button"
              class="seg-item"
              :class="{ on: flowPattern === opt.key }"
              :title="opt.hint"
              :disabled="pending"
              @click="flowPattern = opt.key"
            >
              {{ opt.label }}
            </button>
          </div>
          <p class="hint">
            只替换背景格；主体保留。含矩阵雨、螺旋、漩涡、涟漪、等离子、隧道、扫描、噪点。换模式会重新解析。
          </p>
        </section>
      </aside>

      <section class="stage card">
        <header class="card-head">
          <h2>预览</h2>
          <span class="meta">{{
            hasResult ? `${frames.length} 帧循环` : '等待素材'
          }}</span>
        </header>
        <div class="stage-body">
          <canvas v-show="hasResult" ref="stageCanvas" class="stage-canvas" />
          <p v-if="!hasResult" class="empty">
            上传循环画面：主体保留，背景变成流动字符
          </p>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page {
  --panel: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
  --line: var(--border);
  --soft: var(--bg-soft);
  max-width: 1200px;
  margin: 0 auto;
  padding: 4.5rem 1.15rem 2.5rem;
  color: var(--text);
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.eyebrow {
  margin: 0 0 0.25rem;
  color: var(--text-faint);
  font-size: 0.68rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1 {
  margin: 0;
  font-family: Syne, var(--font);
  font-size: 1.35rem;
  font-weight: 700;
}

.sub {
  margin: 0.35rem 0 0;
  max-width: 42rem;
  color: var(--text-faint);
  font-size: 0.8rem;
  line-height: 1.45;
}

.layout {
  display: grid;
  grid-template-columns: minmax(240px, 280px) minmax(0, 1fr);
  gap: 0.9rem;
  align-items: start;
}

.side {
  display: grid;
  gap: 0.75rem;
}

.card {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  padding: 0.85rem 0.9rem;
}

.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 0.65rem;
}

.card-head h2 {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 650;
}

.meta {
  color: var(--text-faint);
  font-size: 0.7rem;
}

.drop {
  display: grid;
  gap: 0.25rem;
  justify-items: center;
  padding: 1rem 0.75rem;
  border: 1px dashed var(--line);
  border-radius: 10px;
  background: var(--soft);
  cursor: pointer;
  text-align: center;
}

.drop-title {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
}

.drop-hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 0.7rem;
}

.field {
  display: grid;
  gap: 0.35rem;
  margin-bottom: 0.7rem;
  color: var(--text-muted);
  font-size: 0.74rem;
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-muted);
  font-size: 0.74rem;
}

.hint {
  margin: 0.55rem 0 0;
  color: var(--text-faint);
  font-size: 0.68rem;
  line-height: 1.4;
}

.seg {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--soft);
}

.seg-item {
  appearance: none;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.74rem;
  min-height: 1.75rem;
  padding: 0 0.55rem;
}

.seg-item.on {
  background: color-mix(in srgb, var(--bg-elevated) 90%, var(--accent));
  color: var(--text);
  font-weight: 600;
}

.seg-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.stage-body {
  min-height: 320px;
  display: grid;
  place-items: center;
  overflow: auto;
  border-radius: 10px;
  background: var(--soft);
}

.stage-canvas {
  display: block;
  max-width: 100%;
  height: auto;
}

.empty {
  margin: 0;
  color: var(--text-faint);
  font-size: 0.8rem;
}

.status {
  margin: 0.55rem 0 0;
  color: var(--text-muted);
  font-size: 0.72rem;
}

.status.error {
  color: var(--danger);
}

.btn {
  appearance: none;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--soft);
  color: var(--text);
  cursor: pointer;
  font: inherit;
  font-size: 0.78rem;
  min-height: 2rem;
  padding: 0 0.8rem;
}

.btn.primary {
  border: 0;
  background: linear-gradient(120deg, var(--accent), var(--accent-2));
  color: var(--accent-text);
}

.btn.ghost {
  background: transparent;
}

.range {
  width: 100%;
}

.hidden-video,
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

@media (max-width: 860px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
