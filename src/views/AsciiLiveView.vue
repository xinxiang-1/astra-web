<script setup lang="ts">
/**
 * Match asciify.org “The living image” sculpture study:
 * Studio renderer + trail hover (not core mountHover).
 * Site defaults: cellSize 4, ink #cccac5, aspect 3:4,
 * hover trail strength 0.65 / radius 0.38.
 * Stage ~780×1040 matches the homepage marble study; same cellSize 4.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  mountStudio,
  normalizeStudioSettings,
  STUDIO_CHARACTER_SETS,
  type StudioInput,
  type StudioSettings,
} from 'asciify-engine/studio'
import { useThemeStore } from '@/stores/theme'
import { asciiLivePage } from '@/lib/ascii-live-page'

const theme = useThemeStore()

/** Homepage “A study in marble” bust (asciify.org / Antony Hyson Seltran). */
const ARISTOTLE_IMAGE = `${import.meta.env.BASE_URL}demos/ascii-live/aristotle-bust.webp`

/** Warm marble ink from the living-image section (not brand yellow). */
const MARBLE_INK = '#cccac5'
const MARBLE_INK_ALT = '#d5d3ce'

type StudioHandle = Awaited<ReturnType<typeof mountStudio>>

const stageEl = ref<HTMLElement | null>(null)
const stageCanvas = ref<HTMLCanvasElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const status = ref('加载大理石胸像…')
const error = ref('')

/** Site living-image default. */
const cellSize = ref(4)
const brightness = ref(0.08)
const contrast = ref(1.35)
/** Site: strength 0.65, radius 0.38 */
const hoverStrength = ref(0.65)
const hoverRadius = ref(0.38)
const colorMode = ref<'accent' | 'gray' | 'source'>('accent')
const hoverEffect = ref<
  'trail' | 'water' | 'silk' | 'vortex' | 'contour' | 'dissolve' | 'none'
>('trail')
const motion = ref<'none' | 'current' | 'reform' | 'caustics'>('none')
const charsetKey = ref<'asciify' | 'standard' | 'detailed' | 'letters'>('standard')
const finish = ref<'clean' | 'prism' | 'soft' | 'grain'>('clean')

const hoverOptions = [
  { key: 'trail' as const, label: '拖尾' },
  { key: 'water' as const, label: '水面' },
  { key: 'silk' as const, label: '丝绸' },
  { key: 'vortex' as const, label: '漩涡' },
  { key: 'contour' as const, label: '等高' },
  { key: 'dissolve' as const, label: '溶解' },
  { key: 'none' as const, label: '关闭' },
]

const charsetOptions = [
  { key: 'standard' as const, label: '经典' },
  { key: 'asciify' as const, label: '主页字符' },
  { key: 'letters' as const, label: '字母' },
  { key: 'detailed' as const, label: '精细' },
]

const motionOptions = [
  { key: 'current' as const, label: '慢流' },
  { key: 'reform' as const, label: '重组' },
  { key: 'caustics' as const, label: '光斑' },
  { key: 'none' as const, label: '关闭微动' },
]

const finishOptions = [
  { key: 'clean' as const, label: '干净' },
  { key: 'prism' as const, label: '棱镜' },
  { key: 'soft' as const, label: '柔焦' },
  { key: 'grain' as const, label: '胶片' },
]

const colorOptions = [
  { key: 'accent' as const, label: '主题色' },
  { key: 'gray' as const, label: '灰度' },
  { key: 'source' as const, label: '原色' },
]

type RatioMode = 'auto' | '3:4' | '16:9' | '4:3' | '1:1' | '9:16' | 'custom'

const RATIO_VALUES: Record<Exclude<RatioMode, 'auto' | 'custom'>, number> = {
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '1:1': 1,
  '9:16': 9 / 16,
}

const ratioOptions = [
  { key: 'auto' as const, label: '自动' },
  { key: '3:4' as const, label: '3:4' },
  { key: '16:9' as const, label: '16:9' },
  { key: '4:3' as const, label: '4:3' },
  { key: '1:1' as const, label: '1:1' },
  { key: '9:16' as const, label: '9:16' },
  { key: 'custom' as const, label: '自定义' },
]

/** Living image sculpture uses 3:4 */
const ratioMode = ref<RatioMode>('3:4')
const customW = ref(3)
const customH = ref(4)
const sourceRatio = ref(3 / 4)
let frameObserver: ResizeObserver | null = null

const stageRatio = computed(() => {
  if (ratioMode.value === 'auto') return sourceRatio.value || 3 / 4
  if (ratioMode.value === 'custom') {
    const w = Math.max(1, Number(customW.value) || 1)
    const h = Math.max(1, Number(customH.value) || 1)
    return Math.min(4, Math.max(0.25, w / h))
  }
  return RATIO_VALUES[ratioMode.value]
})

/** Slider points right for a finer grid. cellSize 2 = finest, 8 = coarsest. */
const resolution = computed(() => 10 - cellSize.value)
const resolutionLabel = computed(() => {
  const n = cellSize.value
  if (n <= 2) return '超清'
  if (n <= 3) return '精细'
  if (n <= 4) return '清晰'
  if (n <= 6) return '标准'
  return '粗'
})

function setResolution(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  cellSize.value = 10 - value
  patchLive()
}

let studio: StudioHandle | null = null
let mediaSource: File | string = ARISTOTLE_IMAGE
let mediaLabel = '大理石胸像 · 亚里士多德'
let settings: StudioSettings
let abort: AbortController | null = null
let disposed = false
let objectUrl = ''

const hasVideo = ref(false)
const videoPlaying = ref(false)
const videoDuration = ref(0)
const videoCurrentTime = ref(0)
const videoScrubbing = ref(false)
let videoEl: HTMLVideoElement | null = null
let seekQueue: number | null = null
let seekBusy = false

const videoTimeLabel = computed(
  () => `${formatClock(videoCurrentTime.value)} / ${formatClock(videoDuration.value)}`,
)

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const remain = whole % 60
  return `${minutes}:${remain.toString().padStart(2, '0')}`
}

function themeAccent() {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent')
    .trim()
  return value || (theme.isDark ? '#8eabff' : '#3d5fe8')
}

function isAristotle() {
  return mediaSource === ARISTOTLE_IMAGE
}

function sampledBrightness() {
  // A fine grid averages a smaller patch of the photo, so midtones fall
  // into blank glyphs and the picture looks darker. Lift back toward
  // the cellSize-4 baseline; the brightness slider stays an extra offset.
  const lift = Math.max(0, 4 - cellSize.value) * 0.08
  return Math.min(1, brightness.value + lift)
}

function inkColor() {
  // Living-image sculpture: accent ink is warm marble gray (#cccac5), not brand yellow.
  if (colorMode.value === 'accent') {
    return isAristotle() ? MARBLE_INK : themeAccent()
  }
  if (colorMode.value === 'gray') return MARBLE_INK_ALT
  return themeAccent()
}

function aspectSetting(): StudioSettings['aspectRatio'] {
  if (ratioMode.value === 'auto') return 'original'
  if (ratioMode.value === 'custom') return 'original'
  return ratioMode.value
}

function finishEffects(): StudioInput['effects'] {
  if (finish.value === 'prism') return { prism: 0.85, characterBloom: 0.15 }
  if (finish.value === 'soft') return { blur: 0.8, blurType: 'progressive' }
  if (finish.value === 'grain') return { grain: 0.45 }
  return {
    bloom: 0,
    characterBloom: 0,
    grain: 0,
    dust: 0,
    scanlines: 0,
    crt: 0,
    prism: 0,
    vignette: 0,
    glitch: 0,
    pixelate: 0,
    blur: 0,
    blurType: 'gaussian',
    angle: 0,
    focus: 0.5,
    halftone: 0,
  }
}

/** Exact living-image memo from asciify.org home bundle (function i_). */
function livingImageSettings(): StudioSettings {
  const mobile =
    typeof window !== 'undefined' &&
    window.matchMedia('(max-width: 760px)').matches
  return normalizeStudioSettings({
    version: 1,
    aspectRatio: aspectSetting(),
    style: 'ascii',
    cellSize: cellSize.value,
    charset: STUDIO_CHARACTER_SETS[charsetKey.value].chars,
    colorMode: colorMode.value,
    ink: inkColor(),
    crop: {
      x: 0.5,
      y: mobile ? 0.3 : 0.35,
      zoom: 1,
      rotation: 0,
    },
    backdrop: { mode: 'solid', color: '#0a0a0a', opacity: 1 },
    color: {
      brightness: sampledBrightness(),
      contrast: contrast.value,
      saturation: 1,
      grayscale: 0,
      tint: inkColor(),
      amount: 0,
      blend: 'source-over',
    },
    dither: {
      algorithm: 'none',
      palette: 'mono',
      colors: ['#080808', inkColor()],
      amount: 1,
      scale: 2,
      threshold: 0.5,
      motion: 'none',
      speed: 1,
    },
    motion: { type: motion.value, speed: 0.45 },
    hover: {
      effect: hoverEffect.value,
      strength: hoverStrength.value,
      radius: hoverRadius.value,
      edgeSafe: false,
    },
    effects: finishEffects(),
  })
}

function studioPatch(): StudioInput {
  return {
    aspectRatio: aspectSetting(),
    cellSize: cellSize.value,
    charset: STUDIO_CHARACTER_SETS[charsetKey.value].chars,
    colorMode: colorMode.value,
    ink: inkColor(),
    color: {
      brightness: sampledBrightness(),
      contrast: contrast.value,
      tint: inkColor(),
    },
    motion: { type: motion.value, speed: 0.45 },
    hover: {
      effect: hoverEffect.value,
      strength: hoverStrength.value,
      radius: hoverRadius.value,
      edgeSafe: false,
    },
    effects: finishEffects(),
  }
}

function applySettings() {
  settings = livingImageSettings()
  studio?.update({
    ...studioPatch(),
    crop: settings.crop,
    backdrop: settings.backdrop,
    color: settings.color,
    dither: settings.dither,
    effects: settings.effects,
  })
}

/**
 * Homepage paints at CSS size × pixelRatio, then setPixelRatio(dpr).
 * Passing CSS pixels while also setting dpr grows each cell without growing
 * the bitmap, so the grid gets coarser and a HiDPI screen upscales it.
 */
function resizeStudio() {
  const stage = stageEl.value
  if (!stage || !studio) return
  const rect = stage.getBoundingClientRect()
  const cssW = Math.max(2, rect.width)
  const cssH = Math.max(2, rect.height)
  const dpr = Math.min(
    devicePixelRatio || 1,
    2,
    1920 / Math.max(cssW, cssH),
  )
  studio.resize(Math.round(cssW * dpr), Math.round(cssH * dpr), dpr)
}

function destroyStudio() {
  detachVideo()
  abort?.abort()
  abort = null
  studio?.destroy()
  studio = null
}

function onVideoTime() {
  if (videoScrubbing.value || !videoEl) return
  videoCurrentTime.value = videoEl.currentTime
}

function onVideoPlay() {
  videoPlaying.value = true
}

function onVideoPause() {
  videoPlaying.value = false
}

function onVideoMeta() {
  if (!videoEl || !Number.isFinite(videoEl.duration)) return
  videoDuration.value = videoEl.duration
}

function detachVideo() {
  videoEl?.removeEventListener('timeupdate', onVideoTime)
  videoEl?.removeEventListener('play', onVideoPlay)
  videoEl?.removeEventListener('pause', onVideoPause)
  videoEl?.removeEventListener('loadedmetadata', onVideoMeta)
  videoEl = null
  hasVideo.value = false
  videoPlaying.value = false
  videoDuration.value = 0
  videoCurrentTime.value = 0
  videoScrubbing.value = false
  seekQueue = null
}

function attachVideo(source: unknown) {
  detachVideo()
  if (!(source instanceof HTMLVideoElement)) return
  videoEl = source
  hasVideo.value = true
  videoDuration.value = Number.isFinite(source.duration) ? source.duration : 0
  videoCurrentTime.value = source.currentTime || 0
  videoPlaying.value = !source.paused
  source.addEventListener('timeupdate', onVideoTime)
  source.addEventListener('play', onVideoPlay)
  source.addEventListener('pause', onVideoPause)
  source.addEventListener('loadedmetadata', onVideoMeta)
}

async function flushSeek() {
  if (seekBusy || !studio) return
  seekBusy = true
  try {
    while (seekQueue != null && studio) {
      const time = seekQueue
      seekQueue = null
      await studio.seek(time)
    }
  } finally {
    seekBusy = false
    if (seekQueue != null) void flushSeek()
  }
}

function onVideoSeekInput(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value)) return
  videoScrubbing.value = true
  videoCurrentTime.value = value
  seekQueue = value
  void flushSeek()
}

function onVideoSeekEnd() {
  videoScrubbing.value = false
}

function toggleVideoPlayback() {
  if (!studio || !hasVideo.value) return
  const nextPaused = videoPlaying.value
  studio.pause(nextPaused)
  videoPlaying.value = !nextPaused
}

async function mountSource(source: File | string, label: string) {
  const canvas = stageCanvas.value
  if (!canvas) return
  destroyStudio()
  error.value = ''
  status.value = `加载 ${label}…`
  mediaSource = source
  mediaLabel = label
  settings = livingImageSettings()
  abort = new AbortController()
  const signal = abort.signal

  try {
    const handle = await mountStudio(canvas, source, {
      settings,
      // Honor the requested cell size. mountStudio's adaptive budget
      // otherwise shrinks the grid whenever a frame runs past 13ms.
      adaptive: false,
      maxDimension: 1920,
      // ~780×1040 @ dpr2 / cellSize2 ≈ 400k; keep headroom for finer grids.
      maxCells: 420_000,
      signal,
      onError: (err) => {
        if (!disposed) {
          error.value = err.message
          status.value = '失败'
        }
      },
    })
    if (disposed || signal.aborted) {
      handle.destroy()
      return
    }
    studio = handle
    const media = handle.media
    attachVideo(media.source)
    if (media.width && media.height) {
      sourceRatio.value = media.width / media.height
    }
    await nextTick()
    resizeStudio()
    const effect =
      hoverOptions.find((opt) => opt.key === hoverEffect.value)?.label ?? '悬停'
    status.value = `${label} · ${effect} · 在画面上移动鼠标`
  } catch (e) {
    if (signal.aborted) return
    error.value = e instanceof Error ? e.message : '启动失败'
    status.value = '失败'
  }
}

async function playAristotleDemo() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = ''
  }
  charsetKey.value = 'standard'
  hoverEffect.value = 'trail'
  hoverStrength.value = 0.65
  hoverRadius.value = 0.38
  cellSize.value = 4
  brightness.value = 0.08
  contrast.value = 1.35
  colorMode.value = 'accent'
  motion.value = 'none'
  finish.value = 'clean'
  ratioMode.value = '3:4'
  await mountSource(ARISTOTLE_IMAGE, '大理石胸像 · 亚里士多德')
}

async function reload() {
  await mountSource(mediaSource, mediaLabel)
}

function patchLive() {
  if (!studio) {
    void reload()
    return
  }
  applySettings()
  resizeStudio()
}

async function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = ''
  // Pass File directly — studio loadStudioMedia owns decoding (avoids blob CORS).
  if (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
    motion.value = 'none'
  }
  ratioMode.value = 'auto'
  await mountSource(file, file.name)
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  const file = event.dataTransfer?.files?.[0]
  if (!file || !fileInput.value) return
  const dt = new DataTransfer()
  dt.items.add(file)
  fileInput.value.files = dt.files
  fileInput.value.dispatchEvent(new Event('change'))
}

function downloadPage() {
  const blob = new Blob([asciiLivePage(livingImageSettings(), stageRatio.value)], {
    type: 'text/html;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'ascii-live.html'
  link.click()
  URL.revokeObjectURL(url)
  status.value = '已下载 ascii-live.html，用浏览器打开后选择图片或视频'
}

onMounted(async () => {
  await nextTick()
  if (stageEl.value) {
    frameObserver = new ResizeObserver(() => resizeStudio())
    frameObserver.observe(stageEl.value)
  }
  await playAristotleDemo()
})

watch([ratioMode, customW, customH], async () => {
  await nextTick()
  patchLive()
  resizeStudio()
})

watch(
  () => theme.mode,
  () => {
    if (!disposed && mediaSource) patchLive()
  },
)

onBeforeUnmount(() => {
  disposed = true
  frameObserver?.disconnect()
  frameObserver = null
  destroyStudio()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
})
</script>

<template>
  <div class="page">
    <header class="head">
      <div>
        <p class="eyebrow">字符画 · 实验</p>
        <h1>动态字符</h1>
        <p class="sub">
          按 asciify.org「The living image」大理石胸像：Studio 渲染 + 拖尾悬停。可换成自己的图片或视频。
        </p>
      </div>
      <div class="head-actions">
        <button type="button" class="btn" @click="playAristotleDemo">
          亚里士多德
        </button>
        <button type="button" class="btn" @click="downloadPage">
          下载网页代码
        </button>
        <button type="button" class="btn primary" @click="fileInput?.click()">
          上传图片 / 视频
        </button>
        <input
          ref="fileInput"
          class="sr-only"
          type="file"
          accept="image/*,video/mp4,video/webm,video/quicktime,.gif"
          @change="onFileChange"
        />
      </div>
    </header>

    <section
      ref="stageEl"
      class="stage"
      :style="{ '--stage-ratio': String(stageRatio) }"
      @dragover.prevent
      @drop="onDrop"
    >
      <canvas ref="stageCanvas" class="stage-canvas" />
    </section>

    <div v-if="hasVideo" class="video-bar">
      <button type="button" class="btn" @click="toggleVideoPlayback">
        {{ videoPlaying ? '暂停' : '播放' }}
      </button>
      <input
        class="range video-seek"
        type="range"
        min="0"
        :max="Math.max(0.1, videoDuration)"
        step="0.05"
        :value="videoCurrentTime"
        :disabled="videoDuration <= 0"
        @input="onVideoSeekInput"
        @change="onVideoSeekEnd"
      />
      <span class="video-clock">{{ videoTimeLabel }}</span>
    </div>

    <p class="status" :class="{ error: !!error }">{{ error || status }}</p>

    <div class="controls">
      <section class="card wide">
        <h2>画面比例</h2>
        <div class="seg wrap">
          <button
            v-for="opt in ratioOptions"
            :key="opt.key"
            type="button"
            class="seg-item"
            :class="{ on: ratioMode === opt.key }"
            @click="ratioMode = opt.key"
          >
            {{ opt.label }}
          </button>
        </div>
        <div v-if="ratioMode === 'custom'" class="ratio-custom">
          <label class="field">
            <span>宽</span>
            <input v-model.number="customW" class="num" type="number" min="1" max="32" step="1" />
          </label>
          <span class="ratio-colon">:</span>
          <label class="field">
            <span>高</span>
            <input v-model.number="customH" class="num" type="number" min="1" max="32" step="1" />
          </label>
        </div>
        <p class="hint">
          上传图片或视频会改成「自动」，画面宽高跟素材一致。亚里士多德示例仍是官网的 3:4。
        </p>
      </section>

      <section class="card">
        <h2>字符</h2>
        <div class="seg wrap">
          <button
            v-for="opt in colorOptions"
            :key="opt.key"
            type="button"
            class="seg-item"
            :class="{ on: colorMode === opt.key }"
            @click="
              colorMode = opt.key;
              patchLive()
            "
          >
            {{ opt.label }}
          </button>
        </div>
        <div class="seg wrap">
          <button
            v-for="opt in charsetOptions"
            :key="opt.key"
            type="button"
            class="seg-item"
            :class="{ on: charsetKey === opt.key }"
            @click="
              charsetKey = opt.key;
              patchLive()
            "
          >
            {{ opt.label }}
          </button>
        </div>
        <label class="field">
          <span>分辨率 {{ resolutionLabel }}</span>
          <input
            class="range"
            type="range"
            min="2"
            max="8"
            step="1"
            :value="resolution"
            @input="setResolution"
          />
        </label>
        <label class="field">
          <span>亮度 {{ brightness.toFixed(2) }}</span>
          <input
            v-model.number="brightness"
            class="range"
            type="range"
            min="-0.2"
            max="0.4"
            step="0.02"
            @input="patchLive"
          />
        </label>
        <label class="field">
          <span>对比 {{ contrast.toFixed(2) }}</span>
          <input
            v-model.number="contrast"
            class="range"
            type="range"
            min="0.6"
            max="2"
            step="0.05"
            @input="patchLive"
          />
        </label>
        <div class="seg wrap">
          <button
            v-for="opt in motionOptions"
            :key="opt.key"
            type="button"
            class="seg-item"
            :class="{ on: motion === opt.key }"
            @click="
              motion = opt.key;
              patchLive()
            "
          >
            {{ opt.label }}
          </button>
        </div>
        <div class="seg wrap">
          <button
            v-for="opt in finishOptions"
            :key="opt.key"
            type="button"
            class="seg-item"
            :class="{ on: finish === opt.key }"
            @click="
              finish = opt.key;
              patchLive()
            "
          >
            {{ opt.label }}
          </button>
        </div>
        <p class="hint">分辨率越高字符越密，暗部会变稀，已自动补亮度。微动与悬停相互独立；视频建议关掉微动。</p>
      </section>

      <section class="card">
        <h2>悬停</h2>
        <div class="seg wrap">
          <button
            v-for="opt in hoverOptions"
            :key="opt.key"
            type="button"
            class="seg-item"
            :class="{ on: hoverEffect === opt.key }"
            @click="
              hoverEffect = opt.key;
              patchLive()
            "
          >
            {{ opt.label }}
          </button>
        </div>
        <label class="field">
          <span>强度 {{ Math.round(hoverStrength * 100) }}%</span>
          <input
            v-model.number="hoverStrength"
            class="range"
            type="range"
            min="0.15"
            max="0.85"
            step="0.05"
            @input="patchLive"
          />
        </label>
        <label class="field">
          <span>范围 {{ Math.round(hoverRadius * 100) }}%</span>
          <input
            v-model.number="hoverRadius"
            class="range"
            type="range"
            min="0.1"
            max="0.55"
            step="0.02"
            @input="patchLive"
          />
        </label>
        <p class="hint">
          官网默认拖尾强度 65%、范围 38%（Studio 内置悬停，不是 core/mountHover）。
        </p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page {
  --panel: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
  --line: var(--border);
  --soft: var(--bg-soft);
  /* Room for ~780×1040 living-image stage (asciify.org marble study). */
  max-width: 1440px;
  margin: 0 auto;
  padding: 4.25rem 1rem 2.5rem;
  color: var(--text);
}

.head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.85rem;
}

.head-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.45rem;
}

.eyebrow {
  margin: 0 0 0.25rem;
  color: var(--text-faint);
  font-size: 0.68rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.head h1 {
  margin: 0;
  font-family: Syne, var(--font);
  font-size: 1.35rem;
  font-weight: 700;
}

.sub {
  margin: 0.35rem 0 0;
  max-width: 44rem;
  color: var(--text-faint);
  font-size: 0.8rem;
  line-height: 1.45;
}

.stage {
  /* Match asciify.org living image (~771x1028): fixed art size, not
     clamped to leftover viewport — short windows scroll instead of shrink. */
  --stage-ratio: 0.75;
  --stage-max-h: 1040px;
  position: relative;
  display: grid;
  place-items: center;
  width: min(100%, calc(var(--stage-max-h) * var(--stage-ratio)));
  max-height: var(--stage-max-h);
  aspect-ratio: var(--stage-ratio);
  margin-inline: auto;
  border-radius: 0;
  background: #0a0a0a;
  overflow: hidden;
}

.stage-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.video-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-top: 0.55rem;
}

.video-seek {
  flex: 1;
}

.video-clock {
  min-width: 6.5rem;
  color: var(--text-muted);
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
}

.status {
  margin: 0.55rem 0 0.85rem;
  color: var(--text-muted);
  font-size: 0.74rem;
}

.status.error {
  color: var(--danger);
}

.controls {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.card.wide {
  grid-column: 1 / -1;
}

.ratio-custom {
  display: flex;
  align-items: end;
  gap: 0.45rem;
  max-width: 16rem;
}

.ratio-custom .field {
  flex: 1;
  margin: 0;
}

.ratio-colon {
  padding-bottom: 0.35rem;
  color: var(--text-muted);
}

.num {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--soft);
  color: var(--text);
  font: inherit;
  font-size: 0.78rem;
  min-height: 2rem;
  padding: 0 0.55rem;
}

.card {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  padding: 0.85rem 0.9rem;
}

.card h2 {
  margin: 0 0 0.55rem;
  font-size: 0.8rem;
  font-weight: 650;
}

.field {
  display: grid;
  gap: 0.3rem;
  margin-bottom: 0.55rem;
  color: var(--text-muted);
  font-size: 0.72rem;
}

.hint {
  margin: 0.4rem 0 0;
  color: var(--text-faint);
  font-size: 0.66rem;
  line-height: 1.4;
}

.seg {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  margin-bottom: 0.5rem;
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
  font-size: 0.72rem;
  min-height: 1.7rem;
  padding: 0 0.5rem;
}

.seg-item.on {
  background: color-mix(in srgb, var(--bg-elevated) 90%, var(--accent));
  color: var(--text);
  font-weight: 600;
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

.range {
  width: 100%;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

@media (max-width: 800px) {
  .controls {
    grid-template-columns: 1fr;
  }
  .head {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
