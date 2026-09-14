<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import FxButton from '@/components/ui/FxButton.vue'
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
const advancedOpen = ref(false)
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
    mode.value === 'phrase' ||
    Math.abs(exposure.value) > 0.01 ||
    invert.value ||
    resolutionKey.value === 'custom' ||
    customCharset.value.trim().length > 0 ||
    charsetKey.value !== 'dense' ||
    fontSize.value !== 9 ||
    previewFontKey.value !== 'consolas' ||
    exportFontKey.value !== 'yahei' ||
    Math.abs(previewAspect.value - ASCII_ASPECT_PRESETS.consolas.value) >
      0.02 ||
    Math.abs(exportAspect.value - EXPORT_CHAR_ASPECT) > 0.02,
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
    <header class="intro">
      <div class="intro-text">
        <p class="eyebrow">工具 · 纯前端</p>
        <h1>图片转字符画</h1>
        <p class="lead">
          本地转换，不上传服务器。支持灰度字符与指定文字铺底两种模式。
        </p>
      </div>

      <el-popover
        v-model:visible="advancedOpen"
        placement="bottom-end"
        :width="360"
        trigger="click"
        popper-class="ascii-advanced-popper"
      >
        <template #reference>
          <button
            type="button"
            class="gear-btn"
            :class="{ on: advancedOpen || advancedActive }"
            aria-label="高级设置"
            title="高级设置"
          >
            <span class="gear" aria-hidden="true">⚙</span>
            <span class="gear-label">高级</span>
            <span v-if="advancedActive" class="gear-dot" />
          </button>
        </template>

        <div class="advanced">
          <p class="advanced-title">高级设置</p>

          <label class="adv-field">
            <span>列宽采样 {{ columns }}</span>
            <el-slider
              :model-value="columns"
              :min="40"
              :max="400"
              :step="2"
              @update:model-value="onColumnsChange"
            />
          </label>

          <label class="adv-field">
            <span>基础字号 {{ fontSize }}px</span>
            <el-slider v-model="fontSize" :min="4" :max="16" :step="1" />
          </label>

          <fieldset class="adv-field">
            <legend>预览字体</legend>
            <div class="chips">
              <button
                v-for="opt in fontOptions"
                :key="`preview-${opt.key}`"
                type="button"
                class="chip"
                :class="{ on: previewFontKey === opt.key }"
                :title="opt.hint"
                @click="selectPreviewFont(opt.key)"
              >
                {{ opt.label }}
              </button>
            </div>
            <label class="adv-field tight">
              <span>预览字格 {{ previewAspect.toFixed(2) }}</span>
              <el-slider
                :model-value="previewAspect"
                :min="0.4"
                :max="1.1"
                :step="0.01"
                @update:model-value="onPreviewAspectChange"
              />
            </label>
            <p class="adv-hint">
              页面预览默认 Consolas（字格≈0.55），只影响屏幕显示与采样。
            </p>
          </fieldset>

          <fieldset class="adv-field">
            <legend>下载 / 记事本字体</legend>
            <div class="chips">
              <button
                v-for="opt in fontOptions"
                :key="`export-${opt.key}`"
                type="button"
                class="chip"
                :class="{ on: exportFontKey === opt.key }"
                :title="opt.hint"
                @click="selectExportFont(opt.key)"
              >
                {{ opt.label }}
              </button>
            </div>
            <label class="adv-field tight">
              <span>导出字格 {{ exportAspect.toFixed(2) }}</span>
              <el-slider
                :model-value="exportAspect"
                :min="0.4"
                :max="1.1"
                :step="0.01"
                @update:model-value="onExportAspectChange"
              />
            </label>
            <p class="adv-hint">
              下载 TXT/PNG 默认微软雅黑（字格≈0.74），对齐本机记事本；与预览互不影响。
            </p>
          </fieldset>

          <label class="adv-field">
            <span>
              图片曝光
              {{ exposure >= 0 ? `+${exposure.toFixed(1)}` : exposure.toFixed(1) }} EV
            </span>
            <el-slider
              v-model="exposure"
              :min="-2"
              :max="2"
              :step="0.1"
            />
            <p class="adv-hint">调亮/压暗采样亮度，两种模式都生效。</p>
          </label>

          <label class="check">
            <input v-model="phraseColor" type="checkbox" />
            <span>彩色预览（按原图像素上色）</span>
          </label>
          <p class="adv-hint">灰度字符与文字铺底均可使用；关闭后为单色字，字格不变。</p>

          <fieldset v-if="mode === 'phrase'" class="adv-field">
            <legend>文字铺底</legend>
            <input
              v-model="phrase"
              type="text"
              maxlength="64"
              placeholder="自定义文案，例如：我爱你中国"
              spellcheck="false"
            />
            <label class="adv-field tight">
              <span>明暗阈值 {{ phraseThreshold.toFixed(2) }}</span>
              <el-slider
                v-model="phraseThreshold"
                :min="0.05"
                :max="0.95"
                :step="0.01"
              />
            </label>
            <label class="check">
              <input v-model="phraseFillAll" type="checkbox" />
              <span>铺满整图</span>
            </label>
            <p class="adv-hint">
              按曝光后的明暗把轮廓填成循环文案；阈值越低，保留的墨迹区域越少。
            </p>
          </fieldset>

          <fieldset v-if="mode === 'charset'" class="adv-field">
            <legend>字符集</legend>
            <div class="chips">
              <button
                v-for="opt in charsetOptions"
                :key="opt.key"
                type="button"
                class="chip"
                :class="{ on: charsetKey === opt.key && !customCharset.trim() }"
                @click="selectCharset(opt.key)"
              >
                {{ opt.label }}
              </button>
            </div>
            <input
              v-model="customCharset"
              type="text"
              placeholder="自定义（暗→亮）"
              spellcheck="false"
            />
          </fieldset>

          <label class="check">
            <input v-model="invert" type="checkbox" />
            <span>翻转预览正反向</span>
          </label>
          <p class="adv-hint">
            预览默认随主题：深色反相、浅色正向；勾选可对调。下载 TXT/PNG 固定正向（白底深字、采样不反相）。
          </p>

          <div class="adv-actions">
            <el-button
              size="small"
              :disabled="!hasImage || pending"
              @click="runConvert"
            >
              重新生成
            </el-button>
            <el-button size="small" plain @click="restoreDefaults">
              恢复默认
            </el-button>
            <el-button
              size="small"
              text
              :disabled="!previewUrl"
              @click="resetAll"
            >
              清空
            </el-button>
          </div>
        </div>
      </el-popover>
    </header>

    <!-- Common controls: eye-catching -->
    <section class="common-bar">
      <div class="res-block">
        <p class="res-label">模式</p>
        <div class="res-chips" role="group" aria-label="转换模式">
          <button
            type="button"
            class="res-chip"
            :class="{ on: mode === 'charset' }"
            title="按亮度映射字符集"
            @click="selectMode('charset')"
          >
            <span class="res-name">灰度字符</span>
            <span class="res-cols">经典</span>
          </button>
          <button
            type="button"
            class="res-chip"
            :class="{ on: mode === 'phrase' }"
            title="按明暗铺指定文字，类似「我爱你中国」字符画"
            @click="selectMode('phrase')"
          >
            <span class="res-name">文字铺底</span>
            <span class="res-cols">指定文案</span>
          </button>
        </div>
      </div>

      <div class="res-block">
        <p class="res-label">采样清晰度</p>
        <div class="res-chips" role="group" aria-label="采样清晰度">
          <button
            v-for="opt in resolutionOptions"
            :key="opt.key"
            type="button"
            class="res-chip"
            :class="{ on: resolutionKey === opt.key }"
            :title="`${opt.columns} 列 · ${opt.hint}`"
            @click="selectResolution(opt.key)"
          >
            <span class="res-name">{{ opt.label }}</span>
            <span class="res-cols">{{ opt.columns }}列</span>
          </button>
          <span v-if="resolutionKey === 'custom'" class="res-chip on muted">
            自定义 {{ columns }}
          </span>
        </div>
      </div>

      <div class="zoom-block">
        <p class="res-label">
          放大 {{ zoom }}%
          <span v-if="autoZoom" class="auto-tag">自适应</span>
        </p>
        <div class="zoom-row">
          <el-button size="small" :disabled="zoom <= 10" @click="zoomOut">
            −
          </el-button>
          <el-slider
            :model-value="zoom"
            :min="10"
            :max="300"
            :step="5"
            :show-tooltip="true"
            @update:model-value="onZoomSlider"
          />
          <el-button size="small" :disabled="zoom >= 300" @click="zoomIn">
            +
          </el-button>
          <el-button size="small" text @click="resetZoom">自适应</el-button>
        </div>
      </div>

      <div class="common-actions">
        <FxButton
          variant="ghost"
          type="button"
          :disabled="!hasResult"
          @click="copyAscii"
        >
          {{ copied ? '已复制' : '复制' }}
        </FxButton>
        <el-dropdown
          :disabled="!hasResult || downloading"
          trigger="click"
          @command="onDownloadCommand"
        >
          <el-button type="primary" plain :disabled="!hasResult || downloading">
            {{ downloading ? '导出中…' : '下载' }}
            <span class="caret">▾</span>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="txt">下载 TXT</el-dropdown-item>
              <el-dropdown-item command="png">下载 PNG</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </section>

    <p v-if="error" class="error banner">{{ error }}</p>
    <p v-else-if="meta" class="meta banner">{{ meta }}</p>

    <div class="layout">
      <section
        class="panel drop-panel"
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
            {{ previewUrl ? '点击或拖拽换图' : '点击或拖拽上传' }}
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
      </section>

      <section ref="previewFrame" class="panel output">
        <div class="out-head">
          <h2>字符画预览</h2>
          <div v-if="hasResult" class="out-tools">
            <el-button size="small" text @click="zoomOut">缩小</el-button>
            <el-button size="small" text @click="zoomIn">放大</el-button>
            <el-button size="small" text @click="openFullscreen">全屏</el-button>
          </div>
        </div>

        <div
          v-if="hasResult"
          ref="previewScroll"
          class="ascii-scroll"
          title="Ctrl + 滚轮缩放"
        >
          <div class="ascii-scroll-inner">
            <canvas ref="previewCanvas" class="ascii-canvas" />
          </div>
        </div>
        <div v-else class="empty">
          {{ pending ? '处理中…' : '上传图片后，字符画显示在这里' }}
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
            <el-button size="small" @click="zoomOut">缩小</el-button>
            <el-button size="small" @click="zoomIn">放大</el-button>
            <el-button size="small" @click="resetZoom">自适应</el-button>
            <el-button size="small" type="primary" @click="closeFullscreen">
              退出全屏
            </el-button>
          </div>
        </div>
        <div
          ref="fullscreenScroll"
          class="fs-scroll"
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
  max-width: 1480px;
  margin: 0 auto;
  padding: 5.25rem 1.25rem 3rem;
  color: var(--text);
}

.intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.1rem;
}

.eyebrow {
  margin: 0 0 0.35rem;
  color: var(--text-faint);
  font-size: 0.78rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.intro h1 {
  margin: 0 0 0.3rem;
  font-family: Syne, var(--font);
  font-size: clamp(1.55rem, 3vw, 1.9rem);
  letter-spacing: -0.03em;
}

.lead {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.92rem;
}

.gear-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--bg-soft);
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.86rem;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;
}

.gear-btn:hover,
.gear-btn.on {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-soft));
  color: var(--text);
}

.gear {
  font-size: 1.05rem;
  line-height: 1;
}

.gear-dot {
  position: absolute;
  top: 0.35rem;
  right: 0.4rem;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px var(--bg);
}

.common-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem 1.25rem;
  align-items: end;
  margin-bottom: 0.85rem;
  padding: 1rem 1.1rem;
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: var(--radius-lg);
  background:
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 14%, transparent),
      color-mix(in srgb, var(--accent-2) 8%, transparent) 42%,
      var(--bg-elevated)
    );
  box-shadow: 0 12px 40px color-mix(in srgb, var(--accent) 10%, transparent);
}

.phrase-checks {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.res-label {
  margin: 0 0 0.45rem;
  color: var(--text);
  font-size: 0.82rem;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.auto-tag {
  margin-left: 0.4rem;
  padding: 0.1rem 0.45rem;
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  color: var(--accent);
  font-size: 0.7rem;
  font-weight: 600;
}

.res-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.res-chip {
  display: inline-flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.1rem;
  min-width: 4.6rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid transparent;
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  transition:
    transform 0.12s ease,
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease,
    box-shadow 0.15s ease;
}

.res-chip:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.res-chip.on {
  color: var(--text);
  border-color: color-mix(in srgb, var(--accent) 65%, transparent);
  background: color-mix(in srgb, var(--accent) 22%, var(--bg));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
  transform: translateY(-1px);
}

.res-chip.muted {
  pointer-events: none;
}

.res-name {
  font-size: 0.92rem;
  font-weight: 700;
}

.res-cols {
  font-size: 0.72rem;
  color: var(--text-faint);
}

.res-chip.on .res-cols {
  color: color-mix(in srgb, var(--accent) 75%, var(--text-faint));
}

.zoom-block .zoom-row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  gap: 0.4rem;
  align-items: center;
  min-width: 200px;
}

.common-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
  justify-content: flex-end;
  align-items: center;
}

.caret {
  margin-left: 0.25rem;
  font-size: 0.75em;
  opacity: 0.8;
}

.banner {
  margin: 0 0 0.75rem;
  font-size: 0.84rem;
}

.error {
  color: var(--danger);
}

.meta {
  color: var(--text-faint);
}

.layout {
  display: grid;
  grid-template-columns: minmax(200px, 240px) minmax(0, 1fr);
  gap: 1.15rem;
  align-items: stretch;
}

.panel {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  backdrop-filter: blur(12px);
}

.drop-panel {
  display: grid;
  align-content: start;
  justify-items: center;
  gap: 0.75rem;
  padding: 1rem 0.85rem;
  text-align: center;
  border-style: dashed;
  background: var(--bg-soft);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;
}

.drop-panel:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
  background: color-mix(in srgb, var(--accent) 8%, var(--bg-soft));
}

.drop-panel.active {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-soft));
}

.drop-panel.filled {
  border-style: solid;
}

.thumb {
  width: 100%;
  max-height: 220px;
  object-fit: contain;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.2);
}

.drop-title {
  margin: 0;
  font-weight: 600;
  font-size: 0.9rem;
}

.drop-hint {
  margin: 0.25rem 0 0;
  color: var(--text-faint);
  font-size: 0.78rem;
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

.advanced {
  display: grid;
  gap: 0.9rem;
}

.advanced-title {
  margin: 0;
  font-weight: 650;
  font-size: 0.92rem;
}

.adv-field {
  display: grid;
  gap: 0.35rem;
  margin: 0;
  padding: 0;
  border: 0;
}

.adv-field > span,
.adv-field legend {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.chip {
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--bg-soft);
  color: var(--text-muted);
  padding: 0.28rem 0.7rem;
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.chip.on {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
  background: color-mix(in srgb, var(--accent) 16%, var(--bg-soft));
  color: var(--text);
}

.adv-field.tight {
  gap: 0.2rem;
}

.adv-hint {
  margin: 0;
  color: var(--text-faint);
  font-size: 0.75rem;
  line-height: 1.4;
}

.chip.muted {
  pointer-events: none;
}

.advanced input[type='text'] {
  width: 100%;
  min-height: 2.3rem;
  padding: 0 0.7rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 0.86rem;
  outline: none;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--text-muted);
  font-size: 0.86rem;
}

.adv-actions {
  display: flex;
  gap: 0.35rem;
}

.output {
  min-width: 0;
  min-height: 560px;
  padding: 1.1rem 1.15rem 1.15rem;
  display: grid;
  grid-template-rows: auto 1fr;
  gap: 0.75rem;
}

.out-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.out-head h2 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 650;
}

.out-tools {
  display: flex;
  align-items: center;
  gap: 0.15rem;
}

.empty {
  display: grid;
  place-items: center;
  min-height: min(70vh, 720px);
  border: 1px dashed var(--border);
  border-radius: var(--radius-md);
  color: var(--text-faint);
  font-size: 0.9rem;
}

.ascii-scroll {
  overflow: auto;
  max-width: 100%;
  max-height: min(82vh, 920px);
  height: min(82vh, 920px);
  border-radius: var(--radius-md);
  background: rgba(0, 0, 0, 0.28);
  overscroll-behavior: contain;
}

.ascii-scroll-inner {
  display: inline-block;
  min-width: 100%;
  min-height: 100%;
  padding: 0;
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
  transform: none;
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
  .common-bar {
    grid-template-columns: 1fr;
  }

  .common-actions {
    justify-content: flex-start;
  }

  .layout {
    grid-template-columns: 1fr;
  }

  .drop-panel {
    grid-template-columns: auto 1fr;
    justify-items: start;
    text-align: left;
    align-items: center;
  }

  .thumb {
    width: 120px;
    max-height: 120px;
  }
}

@media (max-width: 860px) {
  .page {
    padding-top: 4.75rem;
  }
}
</style>
