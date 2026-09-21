<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import {
  ASCII_ASPECT_PRESETS,
  ASCII_CHARSETS,
  ASCII_FONT_PRESETS,
  ASCII_RESOLUTIONS,
  asciiToPngBlob,
  buildPrerenderCacheKey,
  convertSourceToAscii,
  convertSourceToPhraseAscii,
  createLiveFrameLoop,
  createPrerenderFrameLoop,
  EXPORT_CHAR_ASPECT,
  EXPORT_MONO_FONT,
  exportAsciiVideo,
  fileToImageBitmap,
  hasCjkText,
  isImageFile,
  isVideoFile,
  loadVideoElement,
  measureMonoCellAspect,
  MEDIA_ACCEPT,
  nearestPrerenderIndex,
  needsVideoPrerender,
  paintAsciiToCanvas,
  pickMetricGlyph,
  planVideoExportFrames,
  PREVIEW_MONO_FONT,
  prerenderVideoFrames,
  resolveAsciiColumns,
  seekVideoTo,
  suggestFitZoom,
  triggerDownload,
  videoLiveColumnCap,
  VIDEO_PRERENDER_MAX_DURATION_SEC,
  VIDEO_TARGET_FPS,
  type AsciiCharsetKey,
  type AsciiFontPresetKey,
  type AsciiFrameSource,
  type AsciiMediaKind,
  type AsciiMode,
  type AsciiResolutionKey,
  type FrameLoopHandle,
  type PrerenderFrame,
} from '@/lib/ascii'
import { WarningFilled } from '@element-plus/icons-vue'
import { useThemeStore } from '@/stores/theme'

const ACCEPT = MEDIA_ACCEPT
const theme = useThemeStore()

const fileInput = ref<HTMLInputElement | null>(null)
const sourceVideo = ref<HTMLVideoElement | null>(null)
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
const mediaKind = ref<AsciiMediaKind | null>(null)
const videoPlaying = ref(false)
const videoDuration = ref(0)
const videoCurrentTime = ref(0)
const videoFps = ref(VIDEO_TARGET_FPS)
const clipStart = ref(0)
const clipEnd = ref(0)
const downloading = ref(false)
const downloadProgress = ref('')
const autoZoom = ref(true)
const fullscreen = ref(false)
/** live = realtime convert; prerender = play cached full-quality frames. */
const videoPlaybackMode = ref<'idle' | 'live' | 'prerender'>('idle')
const videoPrerendering = ref(false)
const videoPrerenderDone = ref(0)
const videoPrerenderTotal = ref(0)
const videoPrerenderReady = ref(false)

/** charset = classic ASCII; phrase = 指定文字铺底 (我爱你中国 style). */
const mode = ref<AsciiMode>('charset')
const phrase = ref('我爱你中国')
const phraseThreshold = ref(0.55)
const phraseFillAll = ref(false)
const phraseColor = ref(true) // kept name; applies to both modes as 彩色预览
/** Exposure bias in EV stops (-2 … +2). */
const exposure = ref(0)
/** Soft midtone boost — asciify-style contrast (0 = flat). */
const contrast = ref(0.2)
/** Stretch luminance to full charset range. */
const normalizeTone = ref(true)
/** Bayer dither 0–1; soft default reduces banding. */
const ditherStrength = ref(0.25)

/** Default to higher sampling. */
const resolutionKey = ref<AsciiResolutionKey | 'custom'>('high')
const columns = ref<number>(ASCII_RESOLUTIONS.high.columns)
const charsetKey = ref<AsciiCharsetKey>('dense')
const customCharset = ref('')
const invert = ref(false)
const fontSize = ref(9)
/** Preview zoom — auto-picked after upload to fit the preview frame. */
const zoom = ref(100)

/** Page preview: original Consolas stack + ~0.55 cell. */
const previewFontKey = ref<AsciiFontPresetKey>('consolas')
const previewFontFamily = ref(PREVIEW_MONO_FONT)
const previewAspect = ref<number>(
  measureMonoCellAspect(12, PREVIEW_MONO_FONT) ||
    ASCII_ASPECT_PRESETS.consolas.value,
)

/** Download / Notepad: Microsoft YaHei + ~0.74 cell. */
const exportFontKey = ref<AsciiFontPresetKey>('yahei')
const exportFontFamily = ref(EXPORT_MONO_FONT)
const exportAspect = ref<number>(EXPORT_CHAR_ASPECT)

let bitmap: ImageBitmap | null = null
let copyTimer = 0
let paintRaf = 0
let videoLoop: FrameLoopHandle | null = null
let frameBusy = false
let convertQueued: { fitZoom?: boolean } | false = false
let videoObjectUrl = ''
/** Last presented grid — used to refit zoom when live-cap toggles. */
let lastPreviewCols = 0
let lastPreviewRows = 0
let prerenderFrames: PrerenderFrame[] = []
let prerenderCacheKey = ''
let prerenderAbort = false
let prerenderPlayIndex = 0
/** Remember charset-mode fonts when switching to phrase. */
let savedCharsetPreview: {
  key: AsciiFontPresetKey
  family: string
  aspect: number
} | null = null

const hasMedia = computed(() => hasImage.value || mediaKind.value === 'video')
const hasVideo = computed(() => mediaKind.value === 'video')

/** Realtime playback uses a lighter column cap; prerender / pause use full clarity. */
const videoLivePreview = computed(
  () =>
    hasVideo.value &&
    videoPlaying.value &&
    videoPlaybackMode.value === 'live',
)

const liveColumnCap = computed(() => videoLiveColumnCap(mode.value))

const usePrerenderPath = computed(() =>
  needsVideoPrerender(columns.value, mode.value),
)

const effectiveColumns = computed(() =>
  resolveAsciiColumns({
    columns: columns.value,
    kind: mediaKind.value,
    mode: mode.value,
    livePreview: videoLivePreview.value,
  }),
)

const columnsCapped = computed(
  () =>
    hasVideo.value &&
    videoLivePreview.value &&
    columns.value > liveColumnCap.value,
)

const prerenderProgressLabel = computed(() => {
  if (!videoPrerendering.value) return ''
  const { done, total } = {
    done: videoPrerenderDone.value,
    total: videoPrerenderTotal.value,
  }
  if (total <= 0) return '正在解析字符视频…'
  const pct = Math.round((done / total) * 100)
  return `正在解析字符视频 ${done}/${total}（${pct}%）`
})

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
  if (hasVideo.value) {
    if (videoPrerendering.value) {
      parts.push(prerenderProgressLabel.value)
    } else if (videoPlaying.value && videoPlaybackMode.value === 'prerender') {
      parts.push(`预渲染播放 ${videoFps.value} fps · ${columns.value} 列`)
    } else if (videoLivePreview.value) {
      parts.push(`实时播放 ${videoFps.value} fps`)
      if (columnsCapped.value) {
        parts.push(`预览 ${effectiveColumns.value} 列`)
      }
    } else if (videoPrerenderReady.value && usePrerenderPath.value) {
      parts.push(`预渲染就绪 · ${prerenderFrames.length} 帧`)
    } else {
      parts.push('已暂停')
    }
  }
  if (mode.value === 'phrase') parts.push('文字铺底')
  if (imageAspect.value > 0) {
    parts.push(`原画 ${imageAspect.value.toFixed(2)}:1`)
  }
  if (autoZoom.value) parts.push(`自适应 ${zoom.value}%`)
  return parts.join(' · ')
})

function formatClock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const videoTimeLabel = computed(
  () =>
    `${formatClock(videoCurrentTime.value)} / ${formatClock(videoDuration.value)}`,
)

const CLIP_MIN_SPAN = 0.2
const CLIP_LENGTH_OPTIONS = [5, 10, 15, 20] as const

const clipLength = ref(VIDEO_PRERENDER_MAX_DURATION_SEC)
const clipLengthCustom = ref(false)

const clipSpan = computed(() => Math.max(0, clipEnd.value - clipStart.value))

const clipFrameCount = computed(() =>
  Math.max(1, Math.floor(clipSpan.value * videoFps.value) + 1),
)

const clipMaxFrames = computed(() => {
  const span = Math.min(
    VIDEO_PRERENDER_MAX_DURATION_SEC,
    videoDuration.value > 0 ? videoDuration.value : VIDEO_PRERENDER_MAX_DURATION_SEC,
  )
  return Math.max(2, Math.floor(span * videoFps.value) + 1)
})

const clipOverLimit = computed(
  () => clipSpan.value > VIDEO_PRERENDER_MAX_DURATION_SEC + 0.05,
)

const clipStartPct = computed(() => {
  const d = videoDuration.value
  if (d <= 0) return 0
  return Math.min(100, Math.max(0, (clipStart.value / d) * 100))
})

const clipSpanPct = computed(() => {
  const d = videoDuration.value
  if (d <= 0) return 0
  return Math.min(100 - clipStartPct.value, Math.max(0, (clipSpan.value / d) * 100))
})

const playheadPct = computed(() => {
  const d = videoDuration.value
  if (d <= 0) return 0
  return Math.min(100, Math.max(0, (videoCurrentTime.value / d) * 100))
})

const videoHint = computed(() => {
  if (!usePrerenderPath.value) {
    if (columnsCapped.value) {
      return `实时预览限 ${liveColumnCap.value} 列；暂停看全清晰度`
    }
    return ''
  }
  if (videoPrerendering.value) {
    return `解析中…最多 ${VIDEO_PRERENDER_MAX_DURATION_SEC}s`
  }
  if (!videoPrerenderReady.value) {
    return '选好片段后点「解析并播放」'
  }
  if (clipOverLimit.value) {
    return `片段不能超过 ${VIDEO_PRERENDER_MAX_DURATION_SEC} 秒`
  }
  return ''
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
  { key: 'dense', label: '细腻' },
  { key: 'standard', label: '经典' },
  { key: 'blocks', label: '色块' },
  { key: 'simple', label: '简洁' },
  { key: 'letters', label: '字母' },
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
  const next = ASCII_RESOLUTIONS[key].columns
  // High clarity on video: pause first so full columns apply (not live cap).
  pauseVideoIfNeedsFullQuality(next)
  resolutionKey.value = key
  columns.value = next
}

function onColumnsChange(value: number | number[]) {
  const next = Array.isArray(value) ? (value[0] ?? columns.value) : value
  pauseVideoIfNeedsFullQuality(next)
  columns.value = next
  syncResolutionFromColumns(next)
}

function pauseVideoIfNeedsFullQuality(nextColumns: number) {
  if (!hasVideo.value) return
  if (nextColumns <= videoLiveColumnCap(mode.value)) return
  const wasLive =
    videoPlaying.value || Boolean(sourceVideo.value && !sourceVideo.value.paused)
  pauseVideoPlayback()
  // Column watch will convert; if columns unchanged, convert here.
  if (wasLive && nextColumns === columns.value) {
    void runConvert({ fitZoom: autoZoom.value })
  }
}

function selectMode(next: AsciiMode) {
  if (mode.value === next) return
  if (
    hasVideo.value &&
    videoPlaying.value &&
    columns.value > videoLiveColumnCap(next)
  ) {
    pauseVideoPlayback()
  }
  mode.value = next
  if (next === 'phrase') applyPhraseFontDefaults()
  else restoreCharsetFontDefaults()
  autoZoom.value = true
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
  if (videoObjectUrl) {
    URL.revokeObjectURL(videoObjectUrl)
    videoObjectUrl = ''
  }
}

function stopVideoLoop() {
  videoLoop?.stop()
  videoLoop = null
}

function pauseVideoPlayback() {
  stopVideoLoop()
  videoPlaying.value = false
  videoPlaybackMode.value = 'idle'
  sourceVideo.value?.pause()
}

function clearVideoElement() {
  pauseVideoPlayback()
  cancelVideoPrerender()
  clearPrerenderCache()
  const video = sourceVideo.value
  if (video) {
    video.removeAttribute('src')
    video.load()
  }
  videoDuration.value = 0
  videoCurrentTime.value = 0
  clipStart.value = 0
  clipEnd.value = 0
  clipLength.value = VIDEO_PRERENDER_MAX_DURATION_SEC
  clipLengthCustom.value = false
  mediaKind.value = null
}

function clearResult() {
  ascii.value = ''
  asciiColors.value = null
  rows.value = 0
  columnsOut.value = 0
  lastPreviewCols = 0
  lastPreviewRows = 0
}

function clearPrerenderCache() {
  prerenderFrames = []
  prerenderCacheKey = ''
  prerenderPlayIndex = 0
  videoPrerenderReady.value = false
  videoPrerenderDone.value = 0
  videoPrerenderTotal.value = 0
}

function cancelVideoPrerender() {
  prerenderAbort = true
  videoPrerendering.value = false
}

function currentPrerenderCacheKey() {
  return buildPrerenderCacheKey({
    videoObjectUrl,
    columns: columns.value,
    mode: mode.value,
    phrase: phrase.value,
    charset: charset.value,
    previewInvert: previewInvert.value,
    exposure: exposure.value,
    contrast: contrast.value,
    normalize: normalizeTone.value,
    ditherStrength: ditherStrength.value,
    previewAspect: previewAspect.value,
    phraseColor: phraseColor.value,
    phraseThreshold: phraseThreshold.value,
    phraseFillAll: phraseFillAll.value,
    videoFps: videoFps.value,
    clipStart: clipStart.value,
    clipEnd: clipEnd.value,
  })
}

function invalidatePrerenderIfStale() {
  if (!videoPrerenderReady.value) return
  if (prerenderCacheKey !== currentPrerenderCacheKey()) {
    clearPrerenderCache()
  }
}

function resetAll() {
  clearResult()
  pauseVideoPlayback()
  revokePreview()
  clearVideoElement()
  bitmap?.close()
  bitmap = null
  hasImage.value = false
  imageAspect.value = 0
  error.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function getFrameSource(): AsciiFrameSource | null {
  if (bitmap) {
    return { source: bitmap, width: bitmap.width, height: bitmap.height }
  }
  const video = sourceVideo.value
  if (
    mediaKind.value === 'video' &&
    video &&
    video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
    video.videoWidth > 0
  ) {
    return {
      source: video,
      width: video.videoWidth,
      height: video.videoHeight,
    }
  }
  return null
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
  contrast.value = 0.2
  normalizeTone.value = true
  ditherStrength.value = 0.25
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
  clearPrerenderCache()
  if (getFrameSource()) void runConvert({ fitZoom: true })
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
function applyAutoZoom(force = false) {
  if ((!force && !autoZoom.value) || columnsOut.value <= 0 || rows.value <= 0) {
    return
  }
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

/**
 * Keep on-screen scale consistent when effective columns change
 * (e.g. 超清/极清 pause = full cols, play = live cap).
 */
function syncZoomForGrid(
  nextCols: number,
  nextRows: number,
  options?: { forceFit?: boolean },
) {
  if (nextCols <= 0 || nextRows <= 0) return
  const gridChanged =
    nextCols !== lastPreviewCols || nextRows !== lastPreviewRows
  if (!gridChanged && !options?.forceFit) return

  columnsOut.value = nextCols
  rows.value = nextRows

  if (autoZoom.value || options?.forceFit) {
    applyAutoZoom(true)
  } else if (gridChanged && lastPreviewCols > 0) {
    // Manual zoom: preserve approximate preview width across live-cap toggles.
    const scaled = Math.round(zoom.value * (lastPreviewCols / nextCols))
    zoom.value = Math.min(300, Math.max(10, scaled))
  }

  lastPreviewCols = nextCols
  lastPreviewRows = nextRows
}

function convertFrame(
  frame: AsciiFrameSource,
  options?: { fitZoom?: boolean; forExport?: boolean },
) {
  const invertFlag = options?.forExport ? false : previewInvert.value
  const cols = resolveAsciiColumns({
    columns: columns.value,
    kind: mediaKind.value,
    mode: mode.value,
    livePreview: options?.forExport ? false : videoLivePreview.value,
    forExport: options?.forExport,
  })
  const result =
    mode.value === 'phrase'
      ? convertSourceToPhraseAscii(frame, {
          columns: cols,
          phrase: phrase.value.trim() || '我爱你中国',
          threshold: phraseThreshold.value,
          invert: invertFlag,
          fillAll: phraseFillAll.value,
          charAspect: previewAspect.value,
          withColors: phraseColor.value,
          exposure: exposure.value,
          contrast: contrast.value,
          normalize: normalizeTone.value,
        })
      : convertSourceToAscii(frame, {
          columns: cols,
          charset: charset.value,
          invert: invertFlag,
          charAspect: previewAspect.value,
          exposure: exposure.value,
          contrast: contrast.value,
          normalize: normalizeTone.value,
          ditherStrength: ditherStrength.value,
          withColors: phraseColor.value,
        })
  return result
}

async function runConvert(options?: { fitZoom?: boolean }) {
  const frame = getFrameSource()
  if (!frame) return
  if (frameBusy) {
    const prevFit =
      typeof convertQueued === 'object' ? Boolean(convertQueued.fitZoom) : false
    convertQueued = { fitZoom: Boolean(options?.fitZoom) || prevFit }
    return
  }
  frameBusy = true
  const targetCols = resolveAsciiColumns({
    columns: columns.value,
    kind: mediaKind.value,
    mode: mode.value,
    livePreview: videoLivePreview.value,
  })
  const heavy =
    targetCols >= 240 || (mode.value === 'phrase' && targetCols >= 180)
  const showPending =
    heavy || !hasVideo.value || !hasResult.value || !videoLivePreview.value
  if (showPending) pending.value = true
  error.value = ''
  try {
    if (heavy) await new Promise<void>((r) => setTimeout(r, 0))
    const latest = getFrameSource()
    if (!latest) {
      clearResult()
      return
    }
    imageAspect.value = latest.width / Math.max(1, latest.height)

    const result = convertFrame(latest, options)
    ascii.value = result.text
    asciiColors.value = result.colors ?? null
    rows.value = result.rows
    columnsOut.value = result.columns
    syncZoomForGrid(result.columns, result.rows, {
      forceFit: options?.fitZoom,
    })

    await nextTick()
    if (options?.fitZoom || autoZoom.value) await nextTick()
    schedulePaint()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '转换失败'
    clearResult()
  } finally {
    frameBusy = false
    pending.value = false
    if (convertQueued) {
      const queued = convertQueued
      convertQueued = false
      void runConvert(queued)
    }
  }
}

/** Rebuild ASCII for download — always 正向 (invert=false). */
function buildExportAscii(): {
  text: string
  colors?: Uint8ClampedArray
} {
  const frame = getFrameSource()
  if (!frame) {
    return { text: ascii.value, colors: asciiColors.value ?? undefined }
  }
  const result = convertFrame(frame, { forExport: true })
  return { text: result.text, colors: result.colors }
}

function onVideoTimeUpdate() {
  const video = sourceVideo.value
  if (!video) return
  if (videoPlaybackMode.value === 'prerender') return
  videoCurrentTime.value = video.currentTime
  if (Number.isFinite(video.duration)) videoDuration.value = video.duration
}

function onSourceVideoPlay() {
  if (videoPlaybackMode.value === 'prerender' || videoPrerendering.value) return
  videoPlaying.value = true
}

function onSourceVideoPause() {
  if (videoPlaybackMode.value === 'prerender' || videoPrerendering.value) return
  videoPlaying.value = false
}

function onVideoSeeked() {
  if (!hasVideo.value) return
  if (downloading.value || videoPrerendering.value) return
  if (videoPlaybackMode.value === 'prerender' && videoPlaying.value) return
  if (videoPrerenderReady.value && usePrerenderPath.value && !videoPlaying.value) {
    applyPrerenderFrame(nearestPrerenderIndex(prerenderFrames, videoCurrentTime.value))
    return
  }
  void runConvert()
}

function applyPrerenderFrame(
  index: number,
  options?: { fitZoom?: boolean },
) {
  const frame = prerenderFrames[index]
  if (!frame) return
  prerenderPlayIndex = index
  ascii.value = frame.text
  asciiColors.value = frame.colors
  columnsOut.value = frame.columns
  rows.value = frame.rows
  videoCurrentTime.value = frame.time
  syncZoomForGrid(frame.columns, frame.rows, { forceFit: options?.fitZoom })
  schedulePaint()
}

async function runPrerenderVideoFrames(): Promise<boolean> {
  const video = sourceVideo.value
  if (!video || !hasVideo.value) return false

  prerenderAbort = false
  pauseVideoPlayback()
  clearPrerenderCache()
  videoPrerendering.value = true
  videoPrerenderDone.value = 0
  videoPrerenderTotal.value = 0
  error.value = ''

  try {
    const result = await prerenderVideoFrames({
      video,
      fps: videoFps.value,
      startTime: clipStart.value,
      endTime: clipEnd.value,
      shouldAbort: () => prerenderAbort,
      getFrameSource,
      convertFrame: (source) => convertFrame(source),
      onPlan: ({ total }) => {
        videoPrerenderTotal.value = total
      },
      onProgress: ({ done, total, frame, index }) => {
        videoPrerenderDone.value = done
        videoPrerenderTotal.value = total
        if (index === 0) {
          ascii.value = frame.text
          asciiColors.value = frame.colors
          columnsOut.value = frame.columns
          rows.value = frame.rows
          syncZoomForGrid(frame.columns, frame.rows, { forceFit: true })
          schedulePaint()
        }
      },
    })

    if (!result.ok) {
      clearPrerenderCache()
      error.value = result.error
      return false
    }

    prerenderFrames = result.frames
    prerenderCacheKey = currentPrerenderCacheKey()
    videoPrerenderReady.value = true
    applyPrerenderFrame(0, { fitZoom: true })
    videoCurrentTime.value = result.resumeTime
    return true
  } finally {
    videoPrerendering.value = false
  }
}

function startVideoLoop() {
  stopVideoLoop()
  const video = sourceVideo.value
  if (!video || mediaKind.value !== 'video') return
  videoPlaybackMode.value = 'live'

  videoLoop = createLiveFrameLoop({
    fps: videoFps.value,
    getVideo: () => sourceVideo.value,
    isActive: () => mediaKind.value === 'video',
    getRange: () =>
      usePrerenderPath.value && clipEnd.value > clipStart.value
        ? { start: clipStart.value, end: clipEnd.value }
        : null,
    onPaused: () => {
      videoPlaying.value = false
      videoPlaybackMode.value = 'idle'
    },
    onFrame: (currentTime) => {
      videoPlaying.value = true
      videoCurrentTime.value = currentTime
      void runConvert()
    },
  })
}

function startPrerenderLoop() {
  stopVideoLoop()
  if (prerenderFrames.length === 0) return
  videoPlaybackMode.value = 'prerender'
  videoPlaying.value = true
  sourceVideo.value?.pause()

  videoLoop = createPrerenderFrameLoop({
    fps: videoFps.value,
    frameCount: prerenderFrames.length,
    shouldTick: () =>
      videoPlaying.value && videoPlaybackMode.value === 'prerender',
    getIndex: () => prerenderPlayIndex,
    setIndex: (index) => {
      prerenderPlayIndex = index
    },
    onFrame: (index) => {
      applyPrerenderFrame(index)
    },
  })
}

async function playVideo() {
  const video = sourceVideo.value
  if (!video || !hasVideo.value || videoPrerendering.value) return

  if (usePrerenderPath.value) {
    invalidatePrerenderIfStale()
    if (!videoPrerenderReady.value) {
      const ok = await runPrerenderVideoFrames()
      if (!ok) return
    }
    const playAt =
      videoCurrentTime.value < clipStart.value ||
      videoCurrentTime.value >= clipEnd.value
        ? clipStart.value
        : videoCurrentTime.value
    prerenderPlayIndex = nearestPrerenderIndex(prerenderFrames, playAt)
    startPrerenderLoop()
    return
  }

  clearPrerenderCache()
  seekPlaybackIntoClip(video)
  try {
    await video.play()
    videoPlaying.value = true
    startVideoLoop()
    void runConvert({ fitZoom: autoZoom.value })
  } catch {
    error.value = '无法自动播放，请点击播放'
  }
}

function pauseVideo() {
  const wasLive =
    videoPlaying.value || Boolean(sourceVideo.value && !sourceVideo.value.paused)
  const modeWas = videoPlaybackMode.value
  pauseVideoPlayback()
  if (wasLive && modeWas === 'live') {
    void runConvert({ fitZoom: autoZoom.value })
  } else if (modeWas === 'prerender' && prerenderFrames.length > 0) {
    applyPrerenderFrame(prerenderPlayIndex, { fitZoom: autoZoom.value })
  }
}

function toggleVideoPlayback() {
  if (!hasVideo.value || videoPrerendering.value) return
  if (videoPlaying.value || (sourceVideo.value && !sourceVideo.value.paused)) {
    pauseVideo()
  } else {
    void playVideo()
  }
}

function resetClipBounds(duration: number) {
  const safe = Number.isFinite(duration) && duration > 0 ? duration : 0
  clipStart.value = 0
  clipLengthCustom.value = false
  clipLength.value = Math.min(
    VIDEO_PRERENDER_MAX_DURATION_SEC,
    Math.max(CLIP_MIN_SPAN, safe || VIDEO_PRERENDER_MAX_DURATION_SEC),
  )
  syncClipEnd()
}

function syncClipEnd() {
  const safeDuration =
    Number.isFinite(videoDuration.value) && videoDuration.value > 0
      ? videoDuration.value
      : 0
  if (safeDuration <= 0) {
    clipEnd.value = clipStart.value
    return
  }
  const span = Math.min(
    Math.max(CLIP_MIN_SPAN, clipLength.value),
    VIDEO_PRERENDER_MAX_DURATION_SEC,
    safeDuration,
  )
  const maxStart = Math.max(0, safeDuration - span)
  clipStart.value = Math.min(Math.max(0, clipStart.value), maxStart)
  clipEnd.value = Math.min(safeDuration, clipStart.value + span)
  clipLength.value = Math.max(CLIP_MIN_SPAN, clipEnd.value - clipStart.value)
}

function onClipEdited() {
  clearPrerenderCache()
  const video = sourceVideo.value
  if (!video || videoPlaybackMode.value !== 'live' || video.paused) return
  if (
    video.currentTime < clipStart.value ||
    video.currentTime >= clipEnd.value - 0.04
  ) {
    video.currentTime = clipStart.value
    videoCurrentTime.value = clipStart.value
  }
}

function seekPlaybackIntoClip(video: HTMLVideoElement) {
  if (
    video.currentTime < clipStart.value ||
    video.currentTime >= clipEnd.value - 0.05
  ) {
    video.currentTime = clipStart.value
    videoCurrentTime.value = clipStart.value
  }
}

function onClipStartInput(event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  clipStart.value = Math.max(0, raw)
  syncClipEnd()
  onClipEdited()
}

function setClipLength(seconds: number, custom = false) {
  clipLengthCustom.value = custom
  clipLength.value = Math.min(
    VIDEO_PRERENDER_MAX_DURATION_SEC,
    Math.max(CLIP_MIN_SPAN, seconds),
  )
  syncClipEnd()
  onClipEdited()
}

function enableClipCustom() {
  clipLengthCustom.value = true
}

function onCustomSecondsInput(event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  setClipLength(raw, true)
}

function onCustomFramesInput(event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  const frames = Math.min(
    clipMaxFrames.value,
    Math.max(2, Math.round(raw)),
  )
  const seconds = Math.max(CLIP_MIN_SPAN, (frames - 1) / videoFps.value)
  setClipLength(seconds, true)
}

function startClipHere() {
  clipStart.value = Math.min(
    Math.max(0, videoCurrentTime.value),
    videoDuration.value,
  )
  syncClipEnd()
  onClipEdited()
}

function onVideoSeekInput(event: Event) {
  const video = sourceVideo.value
  if (!video || !hasVideo.value || videoPrerendering.value) return
  const value = Number((event.target as HTMLInputElement).value)
  videoCurrentTime.value = value

  if (videoPrerenderReady.value && usePrerenderPath.value) {
    const idx = nearestPrerenderIndex(prerenderFrames, value)
    if (videoPlaying.value && videoPlaybackMode.value === 'prerender') {
      prerenderPlayIndex = idx
      applyPrerenderFrame(idx)
    } else {
      applyPrerenderFrame(idx)
    }
    return
  }

  video.currentTime = value
}

function clearImageBitmap() {
  bitmap?.close()
  bitmap = null
  hasImage.value = false
}

async function loadImageFile(file: File) {
  pauseVideoPlayback()
  clearVideoElement()
  const next = await fileToImageBitmap(file)
  clearImageBitmap()
  bitmap = next
  hasImage.value = true
  mediaKind.value = 'image'
  imageAspect.value = next.width / Math.max(1, next.height)
  revokePreview()
  previewUrl.value = URL.createObjectURL(file)
  autoZoom.value = true
  await nextTick()
  await runConvert({ fitZoom: true })
}

async function loadVideoFile(file: File) {
  clearImageBitmap()
  pauseVideoPlayback()
  revokePreview()

  await nextTick()
  const video = sourceVideo.value
  if (!video) throw new Error('视频预览组件未就绪')

  if (videoObjectUrl) {
    URL.revokeObjectURL(videoObjectUrl)
    videoObjectUrl = ''
  }

  const url = await loadVideoElement(file, video)
  videoObjectUrl = url
  mediaKind.value = 'video'
  hasImage.value = false
  videoDuration.value = Number.isFinite(video.duration) ? video.duration : 0
  videoCurrentTime.value = 0
  video.loop = false
  resetClipBounds(videoDuration.value)
  imageAspect.value = video.videoWidth / Math.max(1, video.videoHeight)

  autoZoom.value = true
  await nextTick()
  await runConvert({ fitZoom: true })
  // 超清/极清先停在第一帧，等用户选好选段再解析播放。
  if (!needsVideoPrerender(columns.value, mode.value)) {
    await playVideo()
  }
}

async function loadFile(file: File | undefined) {
  if (!file) return
  error.value = ''
  pending.value = true
  try {
    if (isVideoFile(file)) {
      await loadVideoFile(file)
    } else if (isImageFile(file)) {
      await loadImageFile(file)
    } else {
      throw new Error('请选择图片或视频（MP4 / WebM）')
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '无法读取文件'
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
  if (!ascii.value) {
    const frame = getFrameSource()
    if (!frame) return
    await runConvert()
  }
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
  if (!ascii.value && !getFrameSource()) return
  const { text } = buildExportAscii()
  if (!text) return
  const blob = new Blob(['\uFEFF', text], {
    type: 'text/plain;charset=utf-8',
  })
  triggerDownload(blob, hasVideo.value ? 'ascii-frame.txt' : 'ascii-art.txt')
}

async function downloadPng() {
  if (!ascii.value && !getFrameSource()) return
  downloading.value = true
  downloadProgress.value = ''
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
    triggerDownload(blob, hasVideo.value ? 'ascii-frame.png' : 'ascii-art.png')
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'PNG 下载失败'
  } finally {
    downloading.value = false
    downloadProgress.value = ''
  }
}

async function downloadVideo() {
  const video = sourceVideo.value
  if (!video || !hasVideo.value) return

  const plan = planVideoExportFrames(clipSpan.value, videoFps.value)
  if (!plan.ok) {
    error.value = plan.error
    return
  }

  downloading.value = true
  downloadProgress.value = `0/${plan.total}`
  error.value = ''
  const resumeTime = video.currentTime
  pauseVideoPlayback()

  try {
    const result = await exportAsciiVideo({
      frameCount: plan.total,
      fps: plan.fps,
      fontSize: Math.max(8, fontSize.value),
      background: exportColors.background,
      foreground: exportColors.foreground,
      fontFamily: exportFontFamily.value,
      charAspect: exportAspect.value,
      metricGlyph: metricGlyph.value,
      onProgress: ({ done, total }) => {
        downloadProgress.value = `${done}/${total}`
      },
      getFrame: async (index) => {
        const t = Math.min(clipEnd.value, clipStart.value + index * plan.step)
        await seekVideoTo(video, t)
        const frame = getFrameSource()
        if (!frame) return null
        const converted = convertFrame(frame, { forExport: true })
        return {
          text: converted.text,
          colors: phraseColor.value ? converted.colors : null,
        }
      },
    })

    triggerDownload(result.blob, `ascii-art.${result.extension}`)
    if (result.extension !== 'mp4') {
      error.value =
        '当前浏览器不支持直接录制 MP4，已导出为 WebM。Chrome / Edge / Safari 通常可导出 MP4。'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '视频导出失败'
  } finally {
    downloading.value = false
    downloadProgress.value = ''
    try {
      await seekVideoTo(video, resumeTime)
      videoCurrentTime.value = resumeTime
      void runConvert()
    } catch {
      // ignore seek restore failures
    }
  }
}

function onDownloadCommand(command: string | number | object) {
  if (command === 'txt') downloadTxt()
  else if (command === 'png') void downloadPng()
  else if (command === 'mp4') void downloadVideo()
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

function fullscreenPaintColors() {
  const style = getComputedStyle(document.documentElement)
  const background = style.getPropertyValue('--bg').trim()
  const foreground = style.getPropertyValue('--text').trim()
  return {
    background: background || previewColors.value.background,
    foreground: foreground || previewColors.value.foreground,
  }
}

function paintTo(canvas: HTMLCanvasElement | null) {
  if (!canvas || !ascii.value) return
  const colors =
    canvas === fullscreenCanvas.value
      ? fullscreenPaintColors()
      : previewColors.value
  paintAsciiToCanvas(canvas, ascii.value, {
    fontSize: displayFontSize.value,
    background: colors.background,
    foreground: colors.foreground,
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
  if (!ascii.value && getFrameSource()) {
    const playing =
      videoPlaying.value || Boolean(sourceVideo.value && !sourceVideo.value.paused)
    if (playing) pauseVideoPlayback()
    await runConvert()
  }
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
    contrast,
    normalizeTone,
    ditherStrength,
  ],
  () => {
    if (hasVideo.value) {
      const parsingPlayback =
        videoPlaybackMode.value === 'prerender' ||
        (usePrerenderPath.value && videoPlaybackMode.value === 'live')
      if (videoPlaying.value && parsingPlayback) {
        pauseVideoPlayback()
      }
      clearPrerenderCache()
    }
    if (getFrameSource() && !videoPrerendering.value) {
      void runConvert({ fitZoom: autoZoom.value })
    }
  },
)

watch(previewFontFamily, () => {
  if (getFrameSource() && autoZoom.value) applyAutoZoom()
  schedulePaint()
})

watch(fontSize, () => {
  if (getFrameSource() && autoZoom.value) applyAutoZoom()
})

watch(videoFps, () => {
  if (!hasVideo.value) return
  clearPrerenderCache()
  if (!videoPlaying.value) return
  if (videoPlaybackMode.value === 'prerender') {
    pauseVideoPlayback()
  } else if (videoPlaybackMode.value === 'live') {
    startVideoLoop()
  }
})

watch([ascii, displayFontSize, previewColors, phraseColor, asciiColors, zoom], async () => {
  if (!hasResult.value) return
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
  stopVideoLoop()
  window.removeEventListener('keydown', onFullscreenKey)
  document.body.style.overflow = ''
})
</script>
<template>
  <div class="page">
    <header class="page-head">
      <div class="page-title">
        <h1>图片 / 视频转字符画</h1>
        <p class="sub">本地实时渲染 · 支持短视频按帧解析 · 不上传服务器</p>
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
            {{
              downloading
                ? downloadProgress
                  ? `导出中 ${downloadProgress}`
                  : '导出中…'
                : '导出'
            }}
            <span class="caret">▾</span>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="txt">
                {{ hasVideo ? '下载当前帧 TXT' : '下载 TXT' }}
              </el-dropdown-item>
              <el-dropdown-item command="png">
                {{ hasVideo ? '下载当前帧 PNG' : '下载 PNG' }}
              </el-dropdown-item>
              <el-dropdown-item v-if="hasVideo" command="mp4">
                下载视频 MP4
              </el-dropdown-item>
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
            :class="{
              active: dragging,
              filled: Boolean(previewUrl) || hasVideo,
            }"
            role="button"
            tabindex="0"
            :aria-label="
              previewUrl || hasVideo ? '点击更换文件' : '点击上传图片或视频'
            "
            @dragenter.prevent="dragging = true"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
            @click="fileInput?.click()"
            @keydown.enter.prevent="fileInput?.click()"
            @keydown.space.prevent="fileInput?.click()"
          >
            <video
              ref="sourceVideo"
              class="thumb video-thumb"
              :class="{ show: hasVideo }"
              muted
              playsinline
              loop
              @click.stop
              @timeupdate="onVideoTimeUpdate"
              @seeked="onVideoSeeked"
              @play="onSourceVideoPlay"
              @pause="onSourceVideoPause"
            />
            <img
              v-if="previewUrl && !hasVideo"
              class="thumb"
              :src="previewUrl"
              alt="上传预览"
            />
            <div class="drop-copy">
              <p class="drop-title">
                {{
                  previewUrl || hasVideo
                    ? '点击或拖拽更换'
                    : '拖拽或点击上传'
                }}
              </p>
              <p class="drop-hint">PNG / JPG / WebP / GIF · MP4 / WebM</p>
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
          <div v-if="hasVideo" class="video-controls" @click.stop>
            <button
              type="button"
              class="btn"
              :disabled="pending || videoPrerendering || clipOverLimit"
              @click="toggleVideoPlayback"
            >
              {{
                videoPrerendering
                  ? '解析中…'
                  : videoPlaying
                    ? '暂停'
                    : usePrerenderPath && !videoPrerenderReady
                      ? '解析并播放'
                      : '播放'
              }}
            </button>
            <button
              v-if="videoPrerendering"
              type="button"
              class="btn ghost"
              @click="cancelVideoPrerender"
            >
              取消
            </button>
            <input
              class="range video-seek"
              type="range"
              min="0"
              :max="Math.max(0.1, videoDuration)"
              step="0.05"
              :value="videoCurrentTime"
              :disabled="videoDuration <= 0 || videoPrerendering"
              @input="onVideoSeekInput"
            />
            <span class="video-clock">{{ videoTimeLabel }}</span>
            <select
              v-if="usePrerenderPath"
              v-model.number="videoFps"
              class="fps-select"
              :disabled="videoPrerendering"
              title="解析帧率"
            >
              <option :value="12">12fps</option>
              <option :value="15">15fps</option>
              <option :value="20">20fps</option>
              <option :value="24">24fps</option>
            </select>
          </div>

          <div
            v-if="hasVideo && usePrerenderPath"
            class="clip-panel"
            @click.stop
          >
            <div class="clip-top">
              <strong :class="{ warn: clipOverLimit }">
                {{ formatClock(clipStart) }}–{{ formatClock(clipEnd) }}
                · {{ clipSpan.toFixed(1) }}s · {{ clipFrameCount }}帧
              </strong>
              <button
                type="button"
                class="text-link"
                :disabled="videoPrerendering || downloading"
                @click="startClipHere"
              >
                从这开始
              </button>
            </div>
            <div class="clip-rail">
              <div class="clip-map" aria-hidden="true">
                <div
                  class="clip-map-range"
                  :style="{
                    left: `${clipStartPct}%`,
                    width: `${clipSpanPct}%`,
                  }"
                />
                <div
                  class="clip-map-playhead"
                  :style="{ left: `${playheadPct}%` }"
                />
              </div>
              <input
                class="range clip-rail-input"
                type="range"
                min="0"
                :max="Math.max(0.1, videoDuration)"
                step="0.1"
                :value="clipStart"
                :disabled="
                  videoDuration <= 0 || videoPrerendering || downloading
                "
                aria-label="片段起点"
                @input="onClipStartInput"
              />
            </div>
            <div class="seg wrap clip-chips" role="group" aria-label="片段时长">
              <button
                v-for="sec in CLIP_LENGTH_OPTIONS"
                :key="sec"
                type="button"
                class="seg-item"
                :class="{
                  on: !clipLengthCustom && Math.abs(clipLength - sec) < 0.2,
                }"
                :disabled="videoPrerendering || downloading"
                @click="setClipLength(Math.min(sec, videoDuration || sec))"
              >
                {{ sec }}s
              </button>
              <button
                type="button"
                class="seg-item"
                :class="{ on: clipLengthCustom }"
                :disabled="videoPrerendering || downloading"
                @click="enableClipCustom"
              >
                自定义
              </button>
            </div>
            <div v-if="clipLengthCustom" class="clip-custom">
              <label class="clip-custom-field">
                <span>秒</span>
                <input
                  class="num-input"
                  type="number"
                  min="0.2"
                  :max="VIDEO_PRERENDER_MAX_DURATION_SEC"
                  step="0.1"
                  :value="Number(clipSpan.toFixed(1))"
                  :disabled="videoPrerendering || downloading"
                  @change="onCustomSecondsInput"
                />
              </label>
              <label class="clip-custom-field">
                <span>帧</span>
                <input
                  class="num-input"
                  type="number"
                  min="2"
                  :max="clipMaxFrames"
                  step="1"
                  :value="clipFrameCount"
                  :disabled="videoPrerendering || downloading"
                  @change="onCustomFramesInput"
                />
              </label>
            </div>
          </div>

          <div v-if="videoPrerendering" class="prerender-bar" @click.stop>
            <div class="prerender-track">
              <div
                class="prerender-fill"
                :style="{
                  width: `${
                    videoPrerenderTotal
                      ? (videoPrerenderDone / videoPrerenderTotal) * 100
                      : 0
                  }%`,
                }"
              />
            </div>
            <p class="prerender-label">{{ prerenderProgressLabel }}</p>
          </div>
          <p v-if="hasVideo && videoHint" class="video-note">{{ videoHint }}</p>
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
                :class="{
                  on: resolutionKey === opt.key,
                  'has-warn':
                    hasVideo && needsVideoPrerender(opt.columns, mode),
                }"
                :title="
                  hasVideo && needsVideoPrerender(opt.columns, mode)
                    ? undefined
                    : `${opt.columns} 列 · ${opt.hint}`
                "
                @click="selectResolution(opt.key)"
              >
                {{ opt.label }}
                <el-tooltip
                  v-if="hasVideo && needsVideoPrerender(opt.columns, mode)"
                  effect="dark"
                  placement="top"
                  :show-after="120"
                  content="视频需先选片段再解析播放，最长 20 秒"
                >
                  <span
                    class="res-warn"
                    role="img"
                    aria-label="需解析播放"
                    @click.stop
                  >
                    <el-icon :size="12"><WarningFilled /></el-icon>
                  </span>
                </el-tooltip>
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
              <span>对比度</span>
              <span class="field-val">{{ contrast.toFixed(2) }}</span>
            </div>
            <input
              v-model.number="contrast"
              class="range"
              type="range"
              min="-0.4"
              max="0.8"
              step="0.05"
            />
          </div>

          <div class="field">
            <div class="field-label">
              <span>抖动</span>
              <span class="field-val">{{ Math.round(ditherStrength * 100) }}%</span>
            </div>
            <input
              v-model.number="ditherStrength"
              class="range"
              type="range"
              min="0"
              max="1"
              step="0.05"
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
              :class="{ on: normalizeTone }"
              @click="normalizeTone = !normalizeTone"
            >
              归一化
            </button>
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
            <details class="adv-group" open>
              <summary class="adv-group-summary">采样与字号</summary>
              <div class="adv-group-body">
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
              </div>
            </details>

            <details class="adv-group">
              <summary class="adv-group-summary">预览字体</summary>
              <div class="adv-group-body">
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
              </div>
            </details>

            <details class="adv-group">
              <summary class="adv-group-summary">导出字体</summary>
              <div class="adv-group-body">
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
              </div>
            </details>

            <details class="adv-group">
              <summary class="adv-group-summary">
                {{ mode === 'phrase' ? '短语参数' : '字符集' }}
              </summary>
              <div class="adv-group-body">
                <template v-if="mode === 'phrase'">
                  <div class="field">
                    <div class="field-label">
                      <span>明暗阈值</span>
                      <span class="field-val">{{
                        phraseThreshold.toFixed(2)
                      }}</span>
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

                <div v-else class="field">
                  <div class="field-label">
                    <span>自定义字符（暗→亮）</span>
                  </div>
                  <input
                    v-model="customCharset"
                    class="text-input"
                    type="text"
                    placeholder="覆盖上方字符集"
                    spellcheck="false"
                  />
                </div>
              </div>
            </details>

            <div class="adv-actions">
              <button
                type="button"
                class="btn"
                :disabled="!hasMedia || pending"
                @click="() => runConvert()"
              >
                重新生成
              </button>
              <button type="button" class="btn ghost" @click="restoreDefaults">
                恢复默认
              </button>
              <button
                type="button"
                class="text-link"
                :disabled="!previewUrl && !hasVideo"
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
            <p v-else class="status">上传图片或短视频后实时显示结果</p>
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
          v-if="hasMedia || hasResult"
          ref="previewScroll"
          class="ascii-scroll fx-scroll"
          title="Ctrl + 滚轮缩放"
        >
          <div class="ascii-scroll-inner">
            <canvas ref="previewCanvas" class="ascii-canvas" />
          </div>
        </div>
        <div v-else class="empty">
          {{
            pending
              ? '处理中…'
              : '将图片或视频拖到左侧，或点击上传开始'
          }}
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
  gap: 0.45rem;
}

.adv-group {
  border: 1px solid var(--line);
  border-radius: 10px;
  background: color-mix(in srgb, var(--soft) 70%, transparent);
  overflow: clip;
}

.adv-group-summary {
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.55rem 0.7rem;
  color: var(--text-muted);
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}

.adv-group-summary::-webkit-details-marker {
  display: none;
}

.adv-group-summary::after {
  content: '';
  width: 0.35rem;
  height: 0.35rem;
  border-right: 1.5px solid var(--text-faint);
  border-bottom: 1.5px solid var(--text-faint);
  transform: rotate(45deg);
  transition: transform 0.15s ease;
  flex-shrink: 0;
}

.adv-group[open] > .adv-group-summary::after {
  transform: rotate(-135deg);
  margin-top: 0.15rem;
}

.adv-group[open] > .adv-group-summary {
  border-bottom: 1px solid var(--line);
  color: var(--text);
}

.adv-group-body {
  display: grid;
  gap: 0.65rem;
  padding: 0.7rem;
}

.adv-group-body .field {
  margin-bottom: 0;
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

.video-thumb {
  display: none;
}

.video-thumb.show {
  display: block;
}

.video-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 0.55rem;
  align-items: center;
  margin-top: 0.65rem;
}

.video-controls .btn {
  min-height: 2rem;
  padding: 0 0.7rem;
  font-size: 0.75rem;
}

.video-seek {
  flex: 1 1 8rem;
  margin: 0;
  min-width: 6rem;
}

.video-clock {
  color: var(--text-muted);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.clip-panel {
  display: grid;
  gap: 0.35rem;
  margin-top: 0.55rem;
  padding: 0.55rem 0.6rem;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: color-mix(in srgb, var(--soft) 72%, transparent);
}

.clip-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.clip-top strong {
  color: var(--text);
  font-size: 0.72rem;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.clip-top strong.warn {
  color: var(--danger);
}

.clip-rail {
  position: relative;
  height: 1.1rem;
}

.clip-map {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 0.32rem;
  transform: translateY(-50%);
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-faint) 22%, transparent);
  pointer-events: none;
}

.clip-map-range {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: inherit;
  background: color-mix(in srgb, var(--accent) 55%, var(--accent-2));
}

.clip-map-playhead {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  margin-left: -1px;
  background: var(--text);
  border-radius: 1px;
}

.clip-rail-input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0.85;
}

.clip-chips {
  margin: 0;
}

.clip-custom {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem 0.55rem;
}

.clip-custom-field {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--text-faint);
  font-size: 0.7rem;
}

.num-input {
  width: 3.8rem;
  min-height: 1.7rem;
  padding: 0 0.35rem;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  outline: none;
}

.num-input:focus {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--line));
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.fps-select {
  min-height: 1.85rem;
  padding: 0 0.45rem;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--text);
  font: inherit;
  font-size: 0.75rem;
}

.prerender-bar {
  margin-top: 0.55rem;
}

.prerender-track {
  height: 0.35rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--soft);
}

.prerender-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  transition: width 0.15s ease;
}

.prerender-label {
  margin: 0.35rem 0 0;
  color: var(--text-muted);
  font-size: 0.72rem;
  line-height: 1.4;
}

.video-note {
  margin: 0.5rem 0 0;
  color: var(--text-faint);
  font-size: 0.72rem;
  line-height: 1.45;
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

.seg-item.has-warn {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding-right: 0.4rem;
}

.res-warn {
  display: inline-flex;
  align-items: center;
  color: var(--danger);
  opacity: 0.9;
  line-height: 1;
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
  position: relative;
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
  background: var(--bg);
  color: var(--text);
}

.fs-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-shrink: 0;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
  color: var(--text);
  backdrop-filter: blur(12px);
}

.fs-title {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.fs-tools {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.fs-tools .btn.ghost {
  color: var(--text);
  border-color: var(--border-strong);
  background: color-mix(in srgb, var(--bg-elevated) 80%, transparent);
}

.fs-tools .btn.ghost:hover {
  background: var(--bg-soft-hover);
}

.fs-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--bg);
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
