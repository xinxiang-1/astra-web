<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  ASCII_ASPECT_PRESETS,
  ASCII_CHARSETS,
  ASCII_FONT_PRESETS,
  ASCII_RESOLUTIONS,
  asciiToPngBlob,
  convertBitmapToAscii,
  convertBitmapToPhraseAscii,
  EXPORT_CHAR_ASPECT,
  EXPORT_MONO_FONT,
  fileToImageBitmap,
  hasCjkText,
  measureMonoCellAspect,
  paintAsciiToCanvas,
  pickMetricGlyph,
  PREVIEW_MONO_FONT,
  suggestFitZoom,
  triggerDownload,
  type AsciiCharsetKey,
  type AsciiFontPresetKey,
  type AsciiMode,
  type AsciiResolutionKey,
} from '@/utils/ascii-art'
import { useThemeStore } from '@/stores/theme'

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
const theme = useThemeStore()

const fileInput = ref<HTMLInputElement | null>(null)
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const fullscreenCanvas = ref<HTMLCanvasElement | null>(null)
const previewScroll = ref<HTMLElement | null>(null)
const fullscreenScroll = ref<HTMLElement | null>(null)
const previewFrame = ref<HTMLElement | null>(null)
const dragging = ref(false)
const error = ref('')
const previewUrl = ref('')
const ascii = ref('')
const asciiColors = ref<Uint8ClampedArray | null>(null)
const rows = ref(0)
const columnsOut = ref(0)
const imageAspect = ref(0)
const pending = ref(false)
const copied = ref(false)
const hasImage = ref(false)
const downloading = ref(false)
const autoZoom = ref(true)
const fullscreen = ref(false)

/** charset = classic ASCII; phrase = 指定文字铺底 (我爱你中国 style). */
const mode = ref<AsciiMode>('charset')
const phrase = ref('我爱你中国')
const phraseThreshold = ref(0.55)
const phraseFillAll = ref(false)
const phraseColor = ref(true) // kept name; applies to both modes as 彩色预览
/** Exposure bias in EV stops (-2 … +2). */
const exposure = ref(0)

/** Default to higher sampling. */
const resolutionKey = ref<AsciiResolutionKey | 'custom'>('high')
const columns = ref(ASCII_RESOLUTIONS.high.columns)
const charsetKey = ref<AsciiCharsetKey>('dense')
const customCharset = ref('')
const invert = ref(false)
const fontSize = ref(9)
/** Preview zoom — auto-picked after upload to fit the preview frame. */
const zoom = ref(100)

/** Page preview: original Consolas stack + ~0.55 cell. */
const previewFontKey = ref<AsciiFontPresetKey>('consolas')
const previewFontFamily = ref(PREVIEW_MONO_FONT)
const previewAspect = ref(
  measureMonoCellAspect(12, PREVIEW_MONO_FONT) ||
    ASCII_ASPECT_PRESETS.consolas.value,
)

/** Download / Notepad: Microsoft YaHei + ~0.74 cell. */
const exportFontKey = ref<AsciiFontPresetKey>('yahei')
const exportFontFamily = ref(EXPORT_MONO_FONT)
const exportAspect = ref(EXPORT_CHAR_ASPECT)

let bitmap: ImageBitmap | null = null
let copyTimer = 0
let paintRaf = 0
/** Remember charset-mode fonts when switching to phrase. */
let savedCharsetPreview: {
  key: AsciiFontPresetKey
  family: string
  aspect: number
} | null = null

const charset = computed(() => {
  const custom = customCharset.value.trim()
  return custom.length > 0 ? custom : ASCII_CHARSETS[charsetKey.value]
})

const metricGlyph = computed(() =>
  mode.value === 'phrase' ? pickMetricGlyph(phrase.value) : 'M',
)

const displayFontSize = computed(
  () => Math.max(0.5, (fontSize.value * zoom.value) / 100),
)

const hasResult = computed(() => ascii.value.length > 0)
const meta = computed(() => {
  if (!hasResult.value) return ''
  const parts = [`${columnsOut.value} × ${rows.value} 字符`]
  if (mode.value === 'phrase') parts.push('文字铺底')
  if (imageAspect.value > 0) {
    parts.push(`原图 ${imageAspect.value.toFixed(2)}:1`)
  }
  if (autoZoom.value) parts.push(`自适应 ${zoom.value}%`)
  return parts.join(' · ')
})

const previewColors = computed(() =>
  theme.isDark
    ? { background: '#070a12', foreground: '#d8e0ff' }
    : { background: '#f4f6fb', foreground: '#1a2238' },
)

/** Preview sampling polarity follows theme; checkbox flips relative to that. */
const previewInvert = computed(() => invert.value !== theme.isDark)

/** Notepad / PNG paper look — always 正向, independent of theme. */
const exportColors = {
  background: '#ffffff',
  foreground: '#111111',
} as const

const advancedActive = computed(
  () =>
    resolutionKey.value === 'custom' ||
    customCharset.value.trim().length > 0 ||
    fontSize.value !== 9 ||
    previewFontKey.value !== 'consolas' ||
    exportFontKey.value !== 'yahei' ||
    Math.abs(previewAspect.value - ASCII_ASPECT_PRESETS.consolas.value) >
      0.02 ||
    Math.abs(exportAspect.value - EXPORT_CHAR_ASPECT) > 0.02 ||
    (mode.value === 'phrase' &&
      (Math.abs(phraseThreshold.value - 0.55) > 0.01 || phraseFillAll.value)),
)

const resolutionOptions = (
  Object.entries(ASCII_RESOLUTIONS) as [
    AsciiResolutionKey,
    (typeof ASCII_RESOLUTIONS)[AsciiResolutionKey],
  ][]
).map(([key, value]) => ({ key, ...value }))

const fontOptions = (
  Object.entries(ASCII_FONT_PRESETS) as [
    AsciiFontPresetKey,
    (typeof ASCII_FONT_PRESETS)[AsciiFontPresetKey],
  ][]
).map(([key, value]) => ({ key, ...value }))

const charsetOptions: { key: AsciiCharsetKey; label: string }[] = [
  { key: 'dense', label: '密集' },
  { key: 'blocks', label: '色块' },
  { key: 'simple', label: '简洁' },
  { key: 'binary', label: '二进制' },
]

function syncResolutionFromColumns(value: number) {
  const match = (
    Object.entries(ASCII_RESOLUTIONS) as [
      AsciiResolutionKey,
      (typeof ASCII_RESOLUTIONS)[AsciiResolutionKey],
    ][]
  ).find(([, preset]) => preset.columns === value)
  resolutionKey.value = match ? match[0] : 'custom'
}

function selectResolution(key: AsciiResolutionKey) {
  resolutionKey.value = key
  columns.value = ASCII_RESOLUTIONS[key].columns
}

function onColumnsChange(value: number | number[]) {
  const next = Array.isArray(value) ? (value[0] ?? columns.value) : value
  columns.value = next
  syncResolutionFromColumns(next)
}

function onColumnsRange(event: Event) {
  onColumnsChange(Number((event.target as HTMLInputElement).value))
}

function onZoomRange(event: Event) {
  onZoomSlider(Number((event.target as HTMLInputElement).value))
}

function onPreviewAspectRange(event: Event) {
  onPreviewAspectChange(Number((event.target as HTMLInputElement).value))
}

function onExportAspectRange(event: Event) {
  onExportAspectChange(Number((event.target as HTMLInputElement).value))
}

function revokePreview() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
}

function clearResult() {
  ascii.value = ''
  asciiColors.value = null
  rows.value = 0
  columnsOut.value = 0
}

function resetAll() {
  clearResult()
  revokePreview()
  bitmap?.close()
  bitmap = null
  hasImage.value = false
  imageAspect.value = 0
  error.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function applyPhraseFontDefaults() {
  if (!savedCharsetPreview) {
    savedCharsetPreview = {
      key: previewFontKey.value,
      family: previewFontFamily.value,
      aspect: previewAspect.value,
    }
  }
  selectPreviewFont('yahei')
  selectExportFont('yahei')
  // CJK cells are closer to square than Latin mono / 0.74 notepad Latin cell.
  if (hasCjkText(phrase.value)) {
    const cjkAspect = Math.min(
      1.05,
      Math.max(
        0.85,
        measureMonoCellAspect(12, previewFontFamily.value, '中') || 1,
      ),
    )
    previewAspect.value = cjkAspect
    exportAspect.value = cjkAspect
  }
}

function restoreCharsetFontDefaults() {
  if (!savedCharsetPreview) return
  previewFontKey.value = savedCharsetPreview.key
  previewFontFamily.value = savedCharsetPreview.family
  previewAspect.value = savedCharsetPreview.aspect
  savedCharsetPreview = null
}

function restoreDefaults() {
  mode.value = 'charset'
  phrase.value = '我爱你中国'
  phraseThreshold.value = 0.55
  phraseFillAll.value = false
  phraseColor.value = true
  exposure.value = 0
  resolutionKey.value = 'high'
  columns.value = ASCII_RESOLUTIONS.high.columns
  charsetKey.value = 'dense'
  customCharset.value = ''
  invert.value = false
  fontSize.value = 9
  autoZoom.value = true
  zoom.value = 100
  previewFontKey.value = 'consolas'
  previewFontFamily.value = PREVIEW_MONO_FONT
  previewAspect.value =
    measureMonoCellAspect(12, PREVIEW_MONO_FONT) ||
    ASCII_ASPECT_PRESETS.consolas.value
  exportFontKey.value = 'yahei'
  exportFontFamily.value = EXPORT_MONO_FONT
  exportAspect.value = EXPORT_CHAR_ASPECT
  savedCharsetPreview = null
  error.value = ''
  if (bitmap) void runConvert({ fitZoom: true })
}

function selectMode(next: AsciiMode) {
  if (mode.value === next) return
  mode.value = next
  if (next === 'phrase') applyPhraseFontDefaults()
  else restoreCharsetFontDefaults()
  autoZoom.value = true
}

function readPreviewFrameSize() {
  const el = previewScroll.value ?? previewFrame.value
  if (!el) {
    return {
      width: Math.min(920, Math.max(320, window.innerWidth - 360)),
      height: Math.min(820, Math.max(280, window.innerHeight * 0.7)),
    }
  }
  const rect = el.getBoundingClientRect()
  if (previewScroll.value) {
    return {
      width: Math.max(160, rect.width - 8),
      height: Math.max(200, rect.height - 8),
    }
  }
  const head = previewFrame.value?.querySelector('.out-head')
  const headH = head?.getBoundingClientRect().height ?? 48
  return {
    width: Math.max(160, rect.width - 28),
    height: Math.max(
      200,
      Math.min(window.innerHeight * 0.82, 920) - headH,
    ),
  }
}

/** Fit ASCII into the preview frame using image-derived cols/rows + font size. */
function applyAutoZoom() {
  if (!autoZoom.value || columnsOut.value <= 0 || rows.value <= 0) return
  const frame = readPreviewFrameSize()
  zoom.value = suggestFitZoom({
    columns: columnsOut.value,
    rows: rows.value,
    fontSize: fontSize.value,
    frameWidth: frame.width,
    frameHeight: frame.height,
    fontFamily: previewFontFamily.value,
    charAspect: previewAspect.value,
    metricGlyph: metricGlyph.value,
  })
}

async function runConvert(options?: { fitZoom?: boolean }) {
  if (!bitmap) return
  pending.value = true
  error.value = ''
  try {
    imageAspect.value = bitmap.width / Math.max(1, bitmap.height)
    const result =
      mode.value === 'phrase'
        ? convertBitmapToPhraseAscii(bitmap, {
            columns: columns.value,
            phrase: phrase.value.trim() || '我爱你中国',
            threshold: phraseThreshold.value,
            invert: previewInvert.value,
            fillAll: phraseFillAll.value,
            charAspect: previewAspect.value,
            withColors: phraseColor.value,
            exposure: exposure.value,
          })
        : convertBitmapToAscii(bitmap, {
            columns: columns.value,
            charset: charset.value,
            invert: previewInvert.value,
            charAspect: previewAspect.value,
            exposure: exposure.value,
            withColors: phraseColor.value,
          })
    ascii.value = result.text
    asciiColors.value = result.colors ?? null
    rows.value = result.rows
    columnsOut.value = result.columns
    if (options?.fitZoom) {
      await nextTick()
      await nextTick()
      applyAutoZoom()
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '转换失败'
    clearResult()
  } finally {
    pending.value = false
  }
}

/** Rebuild ASCII for download — always 正向 (invert=false). */
function buildExportAscii(): {
  text: string
  colors?: Uint8ClampedArray
} {
  if (!bitmap) return { text: ascii.value, colors: asciiColors.value ?? undefined }
  if (mode.value === 'phrase') {
    const result = convertBitmapToPhraseAscii(bitmap, {
      columns: columns.value,
      phrase: phrase.value.trim() || '我爱你中国',
      threshold: phraseThreshold.value,
      invert: false,
      fillAll: phraseFillAll.value,
      // Match preview grid so TXT silhouette matches what you tuned on screen,
      // while staying 正向 (no theme invert).
      charAspect: previewAspect.value,
      withColors: phraseColor.value,
      exposure: exposure.value,
    })
    return { text: result.text, colors: result.colors }
  }
  const result = convertBitmapToAscii(bitmap, {
    columns: columns.value,
    charset: charset.value,
    invert: false,
    charAspect: previewAspect.value,
    exposure: exposure.value,
    withColors: phraseColor.value,
  })
  return { text: result.text, colors: result.colors }
}

async function loadFile(file: File | undefined) {
  if (!file) return
  error.value = ''
  pending.value = true
  try {
    const next = await fileToImageBitmap(file)
    bitmap?.close()
    bitmap = next
    hasImage.value = true
    imageAspect.value = next.width / Math.max(1, next.height)
    revokePreview()
    previewUrl.value = URL.createObjectURL(file)
    autoZoom.value = true
    await runConvert({ fitZoom: true })
  } catch (e) {
    error.value = e instanceof Error ? e.message : '无法读取图片'
    resetAll()
  } finally {
    pending.value = false
  }
}

function selectPreviewFont(key: AsciiFontPresetKey) {
  previewFontKey.value = key
  const preset = ASCII_FONT_PRESETS[key]
  previewFontFamily.value = preset.family
  previewAspect.value =
    measureMonoCellAspect(12, preset.family, metricGlyph.value) ||
    preset.aspect
}

function selectExportFont(key: AsciiFontPresetKey) {
  exportFontKey.value = key
  const preset = ASCII_FONT_PRESETS[key]
  exportFontFamily.value = preset.family
  exportAspect.value =
    measureMonoCellAspect(12, preset.family, metricGlyph.value) ||
    preset.aspect
}

function onPreviewAspectChange(value: number | number[]) {
  previewAspect.value = Array.isArray(value)
    ? (value[0] ?? previewAspect.value)
    : value
}

function onExportAspectChange(value: number | number[]) {
  exportAspect.value = Array.isArray(value)
    ? (value[0] ?? exportAspect.value)
    : value
}

function selectCharset(key: AsciiCharsetKey) {
  charsetKey.value = key
  customCharset.value = ''
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  void loadFile(input.files?.[0])
}

function onDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  void loadFile(file)
}

async function copyAscii() {
  if (!ascii.value) return
  try {
    await navigator.clipboard.writeText(ascii.value)
    copied.value = true
    window.clearTimeout(copyTimer)
    copyTimer = window.setTimeout(() => {
      copied.value = false
    }, 1600)
  } catch {
    error.value = '复制失败，请手动选择文本'
  }
}

function downloadTxt() {
  if (!ascii.value && !bitmap) return
  // Always 正向 sampling for download (not theme-inverted preview text).
  const { text } = buildExportAscii()
  if (!text) return
  const blob = new Blob(['\uFEFF', text], {
    type: 'text/plain;charset=utf-8',
  })
  triggerDownload(blob, 'ascii-art.txt')
}

async function downloadPng() {
  if (!ascii.value && !bitmap) return
  downloading.value = true
  error.value = ''
  try {
    const { text, colors } = buildExportAscii()
    const blob = await asciiToPngBlob(text, {
      fontSize: Math.max(8, fontSize.value),
      background: exportColors.background,
      foreground: exportColors.foreground,
      fontFamily: exportFontFamily.value,
      charAspect: exportAspect.value,
      metricGlyph: metricGlyph.value,
      colors: phraseColor.value ? colors : undefined,
    })
    triggerDownload(blob, 'ascii-art.png')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'PNG 下载失败'
  } finally {
    downloading.value = false
  }
}

function onDownloadCommand(command: string | number | object) {
  if (command === 'txt') downloadTxt()
  else if (command === 'png') void downloadPng()
}

const ZOOM_MIN = 10
const ZOOM_MAX = 300
const ZOOM_WHEEL_STEP = 10

function zoomIn() {
  autoZoom.value = false
  zoom.value = Math.min(ZOOM_MAX, zoom.value + 25)
}

function zoomOut() {
  autoZoom.value = false
  zoom.value = Math.max(ZOOM_MIN, zoom.value - 25)
}

function nudgeZoom(delta: number) {
  if (!hasResult.value) return
  autoZoom.value = false
  zoom.value = Math.min(
    ZOOM_MAX,
    Math.max(ZOOM_MIN, Math.round(zoom.value + delta)),
  )
}

/** Ctrl/⌘ + wheel zooms preview; blocks browser page zoom over the art. */
function onPreviewWheel(event: WheelEvent) {
  if (!(event.ctrlKey || event.metaKey)) return
  if (!hasResult.value) return
  event.preventDefault()
  const dir = event.deltaY === 0 ? 0 : event.deltaY > 0 ? -1 : 1
  if (dir === 0) return
  nudgeZoom(dir * ZOOM_WHEEL_STEP)
}

function resetZoom() {
  autoZoom.value = true
  applyAutoZoom()
}

function onZoomSlider(value: number | number[]) {
  autoZoom.value = false
  zoom.value = Array.isArray(value) ? (value[0] ?? zoom.value) : value
}

function paintTo(canvas: HTMLCanvasElement | null) {
  if (!canvas || !ascii.value) return
  paintAsciiToCanvas(canvas, ascii.value, {
    fontSize: displayFontSize.value,
    background: previewColors.value.background,
    foreground: previewColors.value.foreground,
    fontFamily: previewFontFamily.value,
    charAspect: previewAspect.value,
    metricGlyph: metricGlyph.value,
    colors: phraseColor.value ? (asciiColors.value ?? undefined) : undefined,
    devicePixelRatio: window.devicePixelRatio || 1,
  })
}

function paintPreview() {
  paintTo(previewCanvas.value)
  if (fullscreen.value) paintTo(fullscreenCanvas.value)
}

function schedulePaint() {
  if (paintRaf) cancelAnimationFrame(paintRaf)
  paintRaf = requestAnimationFrame(() => {
    paintRaf = 0
    paintPreview()
  })
}

async function openFullscreen() {
  if (!hasResult.value) return
  fullscreen.value = true
  await nextTick()
  schedulePaint()
}

function closeFullscreen() {
  fullscreen.value = false
}

function onFullscreenKey(event: KeyboardEvent) {
  if (event.key === 'Escape' && fullscreen.value) closeFullscreen()
}

watch(
  [
    columns,
    charsetKey,
    customCharset,
    invert,
    previewInvert,
    previewAspect,
    mode,
    phrase,
    phraseThreshold,
    phraseFillAll,
    phraseColor,
    exposure,
  ],
  () => {
    if (bitmap) void runConvert({ fitZoom: autoZoom.value })
  },
)

watch(previewFontFamily, () => {
  if (bitmap && autoZoom.value) applyAutoZoom()
  schedulePaint()
})

watch(fontSize, () => {
  if (bitmap && autoZoom.value) applyAutoZoom()
})

watch([ascii, displayFontSize, previewColors, phraseColor, asciiColors], async () => {
  if (!ascii.value) return
  await nextTick()
  schedulePaint()
})

watch(previewScroll, (el, _prev, onCleanup) => {
  if (!el) return
  const handler = (event: WheelEvent) => onPreviewWheel(event)
  el.addEventListener('wheel', handler, { passive: false })
  onCleanup(() => el.removeEventListener('wheel', handler))
})

watch(fullscreenScroll, (el, _prev, onCleanup) => {
  if (!el) return
  const handler = (event: WheelEvent) => onPreviewWheel(event)
  el.addEventListener('wheel', handler, { passive: false })
  onCleanup(() => el.removeEventListener('wheel', handler))
})

watch(previewCanvas, (el) => {
  if (el && ascii.value) schedulePaint()
})

watch(fullscreenCanvas, (el) => {
  if (el && ascii.value) schedulePaint()
})

watch(fullscreen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

onMounted(() => {
  window.addEventListener('keydown', onFullscreenKey)
})

onBeforeUnmount(() => {
  resetAll()
  window.clearTimeout(copyTimer)
  if (paintRaf) cancelAnimationFrame(paintRaf)
  window.removeEventListener('keydown', onFullscreenKey)
  document.body.style.overflow = ''
})
</script>
<template>
  <div class="page">
    <header class="page-head">
      <div class="page-title">
        <h1>图片转字符画</h1>
        <p class="sub">本地实时渲染 · 不上传服务器</p>
      </div>
      <div class="export-actions">
        <button
          type="button"
          class="btn"
          :disabled="!hasResult"
          @click="copyAscii"
        >
          {{ copied ? '已复制' : '复制文本' }}
        </button>
        <el-dropdown
          :disabled="!hasResult || downloading"
          trigger="click"
          @command="onDownloadCommand"
        >
          <button
            type="button"
            class="btn primary"
            :disabled="!hasResult || downloading"
          >
            {{ downloading ? '导出中…' : '导出' }}
            <span class="caret">▾</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="txt">下载 TXT</el-dropdown-item>
              <el-dropdown-item command="png">下载 PNG</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <!-- Mode switch — outside sidebar, like Image/Text tabs on pro converters -->
    <nav class="mode-switch" role="tablist" aria-label="转换模式">
      <button
        type="button"
        role="tab"
        class="mode-card"
        :class="{ on: mode === 'charset' }"
        :aria-selected="mode === 'charset'"
        @click="selectMode('charset')"
      >
        <span class="mode-kicker">Charset</span>
        <span class="mode-name">灰度字符</span>
        <span class="mode-desc">按亮度映射字符集，适合照片与图标</span>
      </button>
      <button
        type="button"
        role="tab"
        class="mode-card"
        :class="{ on: mode === 'phrase' }"
        :aria-selected="mode === 'phrase'"
        @click="selectMode('phrase')"
      >
        <span class="mode-kicker">Phrase</span>
        <span class="mode-name">文字铺底</span>
        <span class="mode-desc">用指定文案铺满明暗轮廓</span>
      </button>
    </nav>

    <div class="workspace">
      <aside class="side fx-scroll">
        <section class="card">
          <header class="card-head">
            <h2>源文件</h2>
            <span class="card-meta">Source</span>
          </header>
          <div
            class="drop"
            :class="{ active: dragging, filled: Boolean(previewUrl) }"
            role="button"
            tabindex="0"
            :aria-label="previewUrl ? '点击更换图片' : '点击上传图片'"
            @dragenter.prevent="dragging = true"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
            @click="fileInput?.click()"
            @keydown.enter.prevent="fileInput?.click()"
            @keydown.space.prevent="fileInput?.click()"
          >
            <img
              v-if="previewUrl"
              class="thumb"
              :src="previewUrl"
              alt="上传预览"
            />
            <div class="drop-copy">
              <p class="drop-title">
                {{ previewUrl ? '点击或拖拽换图' : '拖拽或点击上传' }}
              </p>
              <p class="drop-hint">PNG / JPG / WebP / GIF</p>
            </div>
            <input
              ref="fileInput"
              class="sr-only"
              type="file"
              :accept="ACCEPT"
              @change="onFileChange"
              @click.stop
            />
          </div>
        </section>

        <section class="card">
          <header class="card-head">
            <h2>外观</h2>
            <span class="card-meta">Appearance</span>
          </header>

          <div class="field">
            <div class="field-label">
              <span>清晰度</span>
              <span class="field-val">{{ columns }} 列</span>
            </div>
            <div class="seg fx-scroll" role="group" aria-label="采样清晰度">
              <button
                v-for="opt in resolutionOptions"
                :key="opt.key"
                type="button"
                class="seg-item"
                :class="{ on: resolutionKey === opt.key }"
                :title="`${opt.columns} 列 · ${opt.hint}`"
                @click="selectResolution(opt.key)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div v-if="mode === 'phrase'" class="field">
            <div class="field-label"><span>铺底文案</span></div>
            <input
              v-model="phrase"
              class="text-input"
              type="text"
              maxlength="64"
              placeholder="我爱你中国"
              spellcheck="false"
            />
          </div>
          <div v-else class="field">
            <div class="field-label"><span>字符集</span></div>
            <div class="seg wrap" role="group">
              <button
                v-for="opt in charsetOptions"
                :key="opt.key"
                type="button"
                class="seg-item"
                :class="{ on: charsetKey === opt.key && !customCharset.trim() }"
                @click="selectCharset(opt.key)"
              >
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div class="field">
            <div class="field-label">
              <span>曝光</span>
              <span class="field-val">
                {{ exposure >= 0 ? `+${exposure.toFixed(1)}` : exposure.toFixed(1) }} EV
              </span>
            </div>
            <input
              v-model.number="exposure"
              class="range"
              type="range"
              min="-2"
              max="2"
              step="0.1"
            />
          </div>

          <div class="field">
            <div class="field-label">
              <span>预览缩放</span>
              <span class="field-val">
                {{ zoom }}%
                <button
                  v-if="!autoZoom"
                  type="button"
                  class="text-link"
                  @click="resetZoom"
                >
                  自适应
                </button>
                <em v-else>自适应</em>
              </span>
            </div>
            <div class="zoom-row">
              <button
                type="button"
                class="icon-btn"
                :disabled="zoom <= 10"
                @click="zoomOut"
              >
                −
              </button>
              <input
                :value="zoom"
                class="range"
                type="range"
                min="10"
                max="300"
                step="5"
                @input="onZoomRange"
              />
              <button
                type="button"
                class="icon-btn"
                :disabled="zoom >= 300"
                @click="zoomIn"
              >
                +
              </button>
            </div>
          </div>

          <div class="toggle-row">
            <button
              type="button"
              class="chip-toggle"
              :class="{ on: phraseColor }"
              @click="phraseColor = !phraseColor"
            >
              彩色
            </button>
            <button
              type="button"
              class="chip-toggle"
              :class="{ on: invert }"
              @click="invert = !invert"
            >
              反相
            </button>
          </div>
        </section>

        <details class="card advanced-card">
          <summary class="card-head summary">
            <h2>高级</h2>
            <span class="card-meta">
              {{ advancedActive ? '已调整' : 'Advanced' }}
              <span v-if="advancedActive" class="dot" />
            </span>
          </summary>

          <div class="advanced-body">
            <div class="field">
              <div class="field-label">
                <span>列宽采样</span>
                <span class="field-val">{{ columns }}</span>
              </div>
              <input
                :value="columns"
                class="range"
                type="range"
                min="40"
                max="400"
                step="2"
                @input="onColumnsRange"
              />
            </div>

            <div class="field">
              <div class="field-label">
                <span>基础字号</span>
                <span class="field-val">{{ fontSize }}px</span>
              </div>
              <input
                v-model.number="fontSize"
                class="range"
                type="range"
                min="4"
                max="16"
                step="1"
              />
            </div>

            <div class="field">
              <div class="field-label"><span>预览字体</span></div>
              <div class="seg wrap">
                <button
                  v-for="opt in fontOptions"
                  :key="`preview-${opt.key}`"
                  type="button"
                  class="seg-item"
                  :class="{ on: previewFontKey === opt.key }"
                  :title="opt.hint"
                  @click="selectPreviewFont(opt.key)"
                >
                  {{ opt.label }}
                </button>
              </div>
              <div class="field-label tight">
                <span>预览字格</span>
                <span class="field-val">{{ previewAspect.toFixed(2) }}</span>
              </div>
              <input
                :value="previewAspect"
                class="range"
                type="range"
                min="0.4"
                max="1.1"
                step="0.01"
                @input="onPreviewAspectRange"
              />
            </div>

            <div class="field">
              <div class="field-label"><span>下载字体</span></div>
              <div class="seg wrap">
                <button
                  v-for="opt in fontOptions"
                  :key="`export-${opt.key}`"
                  type="button"
                  class="seg-item"
                  :class="{ on: exportFontKey === opt.key }"
                  :title="opt.hint"
                  @click="selectExportFont(opt.key)"
                >
                  {{ opt.label }}
                </button>
              </div>
              <div class="field-label tight">
                <span>导出字格</span>
                <span class="field-val">{{ exportAspect.toFixed(2) }}</span>
              </div>
              <input
                :value="exportAspect"
                class="range"
                type="range"
                min="0.4"
                max="1.1"
                step="0.01"
                @input="onExportAspectRange"
              />
            </div>

            <template v-if="mode === 'phrase'">
              <div class="field">
                <div class="field-label">
                  <span>明暗阈值</span>
                  <span class="field-val">{{ phraseThreshold.toFixed(2) }}</span>
                </div>
                <input
                  v-model.number="phraseThreshold"
                  class="range"
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.01"
                />
              </div>
              <label class="check">
                <input v-model="phraseFillAll" type="checkbox" />
                <span>铺满整图</span>
              </label>
            </template>

            <div v-if="mode === 'charset'" class="field">
              <div class="field-label"><span>自定义字符（暗→亮）</span></div>
              <input
                v-model="customCharset"
                class="text-input"
                type="text"
                placeholder="覆盖上方字符集"
                spellcheck="false"
              />
            </div>

            <div class="adv-actions">
              <button
                type="button"
                class="btn"
                :disabled="!hasImage || pending"
                @click="runConvert"
              >
                重新生成
              </button>
              <button type="button" class="btn ghost" @click="restoreDefaults">
                恢复默认
              </button>
              <button
                type="button"
                class="text-link"
                :disabled="!previewUrl"
                @click="resetAll"
              >
                清空
              </button>
            </div>
          </div>
        </details>
      </aside>

      <section ref="previewFrame" class="stage">
        <header class="stage-head">
          <div>
            <h2>预览</h2>
            <p v-if="error" class="status error">{{ error }}</p>
            <p v-else-if="meta" class="status">{{ meta }}</p>
            <p v-else class="status">上传图片后实时显示结果</p>
          </div>
          <button
            v-if="hasResult"
            type="button"
            class="btn ghost"
            @click="openFullscreen"
          >
            全屏
          </button>
        </header>

        <div
          v-if="hasResult"
          ref="previewScroll"
          class="ascii-scroll fx-scroll"
          title="Ctrl + 滚轮缩放"
        >
          <div class="ascii-scroll-inner">
            <canvas ref="previewCanvas" class="ascii-canvas" />
          </div>
        </div>
        <div v-else class="empty">
          {{ pending ? '处理中…' : '将图片拖到左侧，或点击上传开始' }}
        </div>
      </section>
    </div>

    <Teleport to="body">
      <div
        v-if="fullscreen && hasResult"
        class="fs-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="字符画全屏预览"
      >
        <div class="fs-bar">
          <p class="fs-title">全屏预览 · {{ zoom }}% · Ctrl+滚轮</p>
          <div class="fs-tools">
            <button type="button" class="btn ghost" @click="zoomOut">缩小</button>
            <button type="button" class="btn ghost" @click="zoomIn">放大</button>
            <button type="button" class="btn ghost" @click="resetZoom">
              自适应
            </button>
            <button type="button" class="btn primary" @click="closeFullscreen">
              退出全屏
            </button>
          </div>
        </div>
        <div
          ref="fullscreenScroll"
          class="fs-scroll fx-scroll"
          title="Ctrl + 滚轮缩放"
        >
          <div class="ascii-scroll-inner">
            <canvas ref="fullscreenCanvas" class="ascii-canvas" />
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.page {
  --panel: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
  --line: var(--border);
  --soft: var(--bg-soft);
  max-width: 1440px;
  margin: 0 auto;
  padding: 4.5rem 1.15rem 2.5rem;
  color: var(--text);
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.page-title h1 {
  margin: 0;
  font-family: Syne, var(--font);
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.sub {
  margin: 0.25rem 0 0;
  color: var(--text-faint);
  font-size: 0.8rem;
}

.export-actions {
  display: flex;
  gap: 0.45rem;
  flex-shrink: 0;
}

.mode-switch {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.65rem;
  margin-bottom: 1rem;
}

.mode-card {
  appearance: none;
  text-align: left;
  cursor: pointer;
  padding: 0.9rem 1rem;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  color: inherit;
  font: inherit;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease,
    transform 0.15s ease;
}

.mode-card:hover {
  border-color: var(--border-strong);
  transform: translateY(-1px);
}

.mode-card.on {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--line));
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 12%, transparent),
      var(--panel)
    );
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
}

.mode-kicker {
  display: block;
  margin-bottom: 0.2rem;
  color: var(--text-faint);
  font-size: 0.68rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.mode-name {
  display: block;
  font-size: 1rem;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.mode-desc {
  display: block;
  margin-top: 0.25rem;
  color: var(--text-muted);
  font-size: 0.78rem;
  line-height: 1.4;
}

.workspace {
  /* Photopea-style equal-height shell: both columns share one track height */
  display: grid;
  grid-template-columns: minmax(260px, 300px) minmax(0, 1fr);
  gap: 0.9rem;
  align-items: stretch;
  height: calc(100dvh - 13.5rem);
  min-height: 560px;
}

.side {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
  height: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 2px;
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
  gap: 0.5rem;
  margin-bottom: 0.7rem;
}

.card-head h2 {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 650;
}

.card-meta {
  position: relative;
  color: var(--text-faint);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.summary {
  list-style: none;
  cursor: pointer;
  margin-bottom: 0;
  user-select: none;
}

.summary::-webkit-details-marker {
  display: none;
}

.advanced-card[open] .summary {
  margin-bottom: 0.7rem;
}

.dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 0.3rem;
  border-radius: 50%;
  background: var(--accent);
  vertical-align: middle;
}

.advanced-body {
  display: grid;
  gap: 0.75rem;
}

.drop {
  display: grid;
  gap: 0.55rem;
  justify-items: center;
  padding: 0.75rem;
  border: 1px dashed var(--line);
  border-radius: 10px;
  background: var(--soft);
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.drop:hover,
.drop.active {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  background: color-mix(in srgb, var(--accent) 8%, var(--soft));
}

.drop.filled {
  border-style: solid;
}

.thumb {
  width: 100%;
  max-height: 140px;
  object-fit: contain;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.18);
}

.drop-title {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
}

.drop-hint {
  margin: 0.15rem 0 0;
  color: var(--text-faint);
  font-size: 0.7rem;
}

.field {
  display: grid;
  gap: 0.4rem;
  margin-bottom: 0.85rem;
}

.field:last-child {
  margin-bottom: 0;
}

.field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.74rem;
}

.field-label.tight {
  margin-top: 0.35rem;
}

.field-val {
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.field-val em {
  font-style: normal;
  color: var(--accent);
}

.seg {
  display: flex;
  flex-wrap: nowrap;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--soft);
  overflow-x: auto;
}

.seg.wrap {
  flex-wrap: wrap;
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
  white-space: nowrap;
}

.seg-item:hover {
  color: var(--text);
}

.seg-item.on {
  background: color-mix(in srgb, var(--bg-elevated) 90%, var(--accent));
  color: var(--text);
  font-weight: 600;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent);
}

.text-input {
  width: 100%;
  min-height: 2rem;
  padding: 0 0.65rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 0.82rem;
  outline: none;
}

.text-input:focus {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--line));
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.range {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 18px;
  background: transparent;
  margin: 0;
  cursor: pointer;
}

.range:focus {
  outline: none;
}

.range::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 999px;
  background: var(--soft);
}

.range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  margin-top: -5px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--accent) 70%, #fff);
  background: var(--bg-elevated);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--accent) 28%, transparent);
}

.range::-moz-range-track {
  height: 4px;
  border-radius: 999px;
  background: var(--soft);
  border: 0;
}

.range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--accent) 70%, #fff);
  background: var(--bg-elevated);
  box-shadow: 0 1px 4px color-mix(in srgb, var(--accent) 28%, transparent);
}

.zoom-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.35rem;
  align-items: center;
}

.icon-btn {
  width: 1.75rem;
  height: 1.75rem;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--soft);
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  line-height: 1;
}

.icon-btn:hover:not(:disabled) {
  color: var(--text);
  background: var(--bg-soft-hover);
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.toggle-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.chip-toggle {
  appearance: none;
  min-height: 1.75rem;
  padding: 0 0.7rem;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--soft);
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.74rem;
}

.chip-toggle.on {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  background: color-mix(in srgb, var(--accent) 14%, var(--soft));
  color: var(--text);
  font-weight: 600;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--text-muted);
  font-size: 0.78rem;
}

.adv-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
}

.btn {
  appearance: none;
  min-height: 2rem;
  padding: 0 0.8rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--soft);
  color: var(--text);
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
}

.btn:hover:not(:disabled) {
  background: var(--bg-soft-hover);
  border-color: var(--border-strong);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn.primary {
  border-color: transparent;
  background: linear-gradient(120deg, var(--accent), var(--accent-2));
  color: var(--accent-text);
  font-weight: 600;
}

.btn.ghost {
  background: transparent;
}

.text-link {
  appearance: none;
  border: 0;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.74rem;
  padding: 0;
}

.text-link:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.caret {
  margin-left: 0.15rem;
  font-size: 0.7em;
  opacity: 0.8;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  border: 0;
}

.stage {
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel);
  padding: 0.85rem 0.95rem 0.95rem;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0.65rem;
}

.stage-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.stage-head h2 {
  margin: 0;
  font-size: 0.82rem;
  font-weight: 650;
}

.status {
  margin: 0.2rem 0 0;
  color: var(--text-faint);
  font-size: 0.72rem;
}

.status.error {
  color: var(--danger);
}

.empty {
  display: grid;
  place-items: center;
  min-height: 0;
  height: 100%;
  border: 1px dashed var(--line);
  border-radius: 10px;
  color: var(--text-faint);
  font-size: 0.85rem;
}

.ascii-scroll {
  overflow: auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  max-height: none;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.28);
  overscroll-behavior: contain;
}

.ascii-scroll-inner {
  display: inline-block;
  min-width: 100%;
  min-height: 100%;
  vertical-align: top;
}

.ascii-canvas {
  display: block;
  margin: 0;
  max-width: none;
  width: auto;
  height: auto;
  vertical-align: top;
  object-fit: none;
}

[data-theme='light'] .ascii-scroll {
  background: rgba(255, 255, 255, 0.65);
}

.fs-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  flex-direction: column;
  background: rgba(4, 6, 12, 0.96);
}

.fs-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-shrink: 0;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  color: #e8ecff;
}

.fs-title {
  margin: 0;
  font-size: 0.9rem;
}

.fs-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.fs-tools .btn.ghost {
  color: #e8ecff;
  border-color: rgba(255, 255, 255, 0.18);
}

.fs-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  background: rgba(0, 0, 0, 0.35);
}

.fs-scroll .ascii-scroll-inner {
  padding: 1rem;
}

@media (max-width: 980px) {
  .workspace {
    grid-template-columns: 1fr;
    height: auto;
    min-height: 0;
  }

  .side {
    height: auto;
    overflow: visible;
  }

  .mode-switch {
    grid-template-columns: 1fr;
  }

  .stage {
    height: min(72dvh, 720px);
    min-height: 420px;
  }

  .drop {
    grid-template-columns: auto 1fr;
    justify-items: start;
    text-align: left;
    align-items: center;
  }

  .thumb {
    width: 96px;
    max-height: 96px;
  }
}

@media (max-width: 860px) {
  .page {
    padding-top: 4.15rem;
  }

  .page-head {
    flex-wrap: wrap;
    align-items: flex-start;
  }
}
</style>
