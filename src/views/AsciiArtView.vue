<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ComponentPublicInstance, Ref } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from 'vue-router'
import CharacterArtwork from '@/components/CharacterArtwork.vue'
import ArtIcon from '@/components/ui/ArtIcon.vue'
import AstraLogo from '@/components/ui/AstraLogo.vue'
import ExportSheet from '@/components/ExportSheet.vue'
import UnsavedChangesDialog from '@/components/UnsavedChangesDialog.vue'
import { prepareArtSource, type PreparedArtSource } from '@/lib/art-media-source'
import { artworkPresets, type ArtworkPreset } from '@/content/artwork'
import { getArtProject, saveArtProject } from '@/lib/art-projects'
import {
  assertArtProjectEngineCompatible,
  artProjectPackageFilename,
  createArtProjectPackage,
} from '@/lib/art-project-package'
import {
  ART_MODES,
  ART_ENGINE_VERSION,
  createCanvasArtRenderer,
  prepareArtFrame,
  type ArtFrame,
  type ArtMode,
  type ArtMotion,
  type ArtHover,
  type ArtSettings,
  type ArtPointerSample,
} from '@/lib/art-engine'
import { artworkEmbedPage } from '@/lib/art-engine/embed'
import '@/styles/art-editor.css'

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
  hasCjkText,
  measureMonoCellAspect,
  measureMonoCellMetrics,
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
import { asciiArtEmbedPage } from '@/lib/ascii-art-embed-page'
import {
  asciiStudioEffectsActive,
  buildAsciiStudioSettings,
  mountCharsetStudio,
  resizeCharsetStudio,
  studioCellSizeFromColumns,
  studioPatchFromInput,
  type AsciiStudioHoverEffect,
  type AsciiStudioMotion,
  type CharsetStudioHandle,
} from '@/lib/ascii/studio-preview'
import { WarningFilled } from '@element-plus/icons-vue'

const ACCEPT = MEDIA_ACCEPT
const route = useRoute()
const projectTitle = ref('未命名作品')
const projectId = ref('')
const projectStatus = ref('仅保存在此浏览器')
const savingProject = ref(false)
const packingProject = ref(false)
const packageStatus = ref('')
const mobilePanel = ref('presets')
const activePreset = ref('')
const showOriginal = ref(false)
const exportOpen = ref(false)
const exportPreview = ref('')
const backgroundColor = ref('#111615')
const foregroundColor = ref('#eeeae2')
let sourceFile: File | null = null
let exportName = ''
let exportLongEdge = 2048
let exportTransparent = false

const fileInput = ref<HTMLInputElement | null>(null)
const videoSlots = [
  shallowRef<HTMLVideoElement | null>(null),
  shallowRef<HTMLVideoElement | null>(null),
]
const activeVideoSlot = ref(0)
const sourceVideo = computed(() => videoSlots[activeVideoSlot.value]?.value ?? null)
function setVideoSlot(slot: number, element: Element | ComponentPublicInstance | null) {
  const target = videoSlots[slot]
  if (target) target.value = element instanceof HTMLVideoElement ? element : null
}
const previewCanvas = ref<HTMLCanvasElement | null>(null)
const previewHost = ref<HTMLElement | null>(null)
const fullscreenCanvas = ref<HTMLCanvasElement | null>(null)
const previewScroll = ref<HTMLElement | null>(null)
const fullscreenScroll = ref<HTMLElement | null>(null)
const previewFrame = ref<HTMLElement | null>(null)
const dragging = ref(false)
const error = ref('')
const sourceError = ref('')
const previewUrl = ref('')
const ascii = ref('')
const asciiColors = ref<Uint8ClampedArray | null>(null)
const rows = ref(0)
const columnsOut = ref(0)
const imageAspect = ref(0)
const converting = ref(false)
const loadingSource = ref(false)
const pending = computed(() => converting.value || loadingSource.value)
const sourceRevision = ref(0)
let sourceLoadController: AbortController | null = null
let sourceLoadGeneration = 0
let routeLoadGeneration = 0
let viewDisposed = false
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
const editorEngine = ref<'calibrated' | 'legacy'>(
  route.query.engine === 'legacy' ? 'legacy' : 'calibrated',
)
const artMode = ref<ArtMode>('density')
const artQuality = ref<'classic' | 'detailed' | 'smooth' | 'faithful'>('classic')
const artMotion = ref<ArtMotion>('none')
const artHover = ref<ArtHover | 'none'>('light')
const artEffectProfile = ref<'classic' | 'expressive'>('expressive')
const artMotionSpeed = ref(1)
const artMotionStrength = ref(0.65)
const artMotionStyle = ref<'studio' | 'cinematic'>('cinematic')
const artPaused = ref(false)
const artQualityOptions = computed(() => [
  { id: 'classic' as const, label: '经典' },
  ...(artMode.value === 'density'
    ? [
        { id: 'detailed' as const, label: '精细' },
        { id: 'smooth' as const, label: '柔和' },
      ]
    : []),
  { id: 'faithful' as const, label: '还原' },
])
const artFrame = shallowRef<ArtFrame | null>(null)
const reducedArtMotion = ref(matchMedia('(prefers-reduced-motion: reduce)').matches)
const artRenderers = new Map<HTMLCanvasElement, ReturnType<typeof createCanvasArtRenderer>>()
let artAnimationRaf = 0,
  artLastTick = 0,
  artElapsed = 0,
  artInteractionElapsed = 0
const artPointer = { x: 0.5, y: 0.5, strength: 0, target: 0 }
const artPointerSamples: ArtPointerSample[] = []
let artStageVisible = true
let artVisibilityObserver: IntersectionObserver | null = null
const artMotionOptions: { id: ArtMotion; label: string }[] = [
  { id: 'none', label: '静态' },
  { id: 'breathe', label: '光息' },
  { id: 'wave', label: '流动' },
  { id: 'assemble', label: '聚合' },
  { id: 'current', label: '慢流' },
  { id: 'reform', label: '重组' },
  { id: 'caustics', label: '光斑' },
]
const artMotionDescriptions: Record<ArtMotion, string> = {
  none: '保留完整静态作品，悬停仍可独立使用。',
  breathe: '光影缓缓起伏，字符随作品一起舒展。',
  wave: '连续波浪穿过画面，亮边跟随波峰流动。',
  assemble: '字符沿空间流线汇入，逐步聚成完整作品。',
  current: '层层流线卷动画面，边缘保持稳定。',
  reform: '字符散开、重新聚拢，再停留展示完整作品。',
  caustics: '交叠光带沿字符笔画游走，保留原作色彩。',
}
const cinematicMotionDescriptions: Record<ArtMotion, string> = {
  none: '保留完整静态作品，悬停仍可独立使用。',
  breathe: '光脉由中心向外推开字符，内圈余波缓缓收束。',
  wave: '斜向波面抬起作品，亮脊和暗面随波峰移动。',
  assemble: '原作字符沿连续光轨落位，完成后展示完整作品。',
  current: '局部涡流缓慢扭转作品，流动光线勾出空间层次。',
  reform: '宽片层错开，字符随片层散开，再完整归位停留。',
  caustics: '窄光束沿真实笔画扫过，局部折射与暗影跟随光线。',
}
const artHoverOptions: { id: ArtHover | 'none'; label: string }[] = [
  { id: 'light', label: '光晕' },
  { id: 'ripple', label: '涟漪' },
  { id: 'displace', label: '轻推' },
  { id: 'trail', label: '拖尾' },
  { id: 'water', label: '水面' },
  { id: 'silk', label: '丝绸' },
  { id: 'vortex', label: '漩涡' },
  { id: 'contour', label: '等高' },
  { id: 'dissolve', label: '溶解' },
  { id: 'none', label: '关闭' },
]
const phrase = ref('我爱你中国')
const phraseThreshold = ref(0.55)
const phraseFillAll = ref(false)
const phraseColor = ref(false) // kept name; applies to both modes as 彩色预览
/** Exposure bias in EV stops (-2 … +2). */
const exposure = ref(0)
/** Soft midtone boost — asciify-style contrast (0 = flat). */
const contrast = ref(0.2)
/** Stretch luminance to full charset range. */
const normalizeTone = ref(true)
/** Bayer dither 0–1; soft default reduces banding. */
const ditherStrength = ref(0.25)

/** Studio hover / motion (charset mode only; same stack as /ascii-live). */
const hoverEffect = ref<AsciiStudioHoverEffect>('none')
const hoverStrength = ref(0.65)
const hoverRadius = ref(0.38)
const ambientMotion = ref<AsciiStudioMotion>('none')

const hoverOptions = [
  { key: 'trail' as const, label: '拖尾' },
  { key: 'water' as const, label: '水面' },
  { key: 'silk' as const, label: '丝绸' },
  { key: 'vortex' as const, label: '漩涡' },
  { key: 'contour' as const, label: '等高' },
  { key: 'dissolve' as const, label: '溶解' },
  { key: 'none' as const, label: '关闭' },
]

const motionOptions = [
  { key: 'current' as const, label: '慢流' },
  { key: 'reform' as const, label: '重组' },
  { key: 'caustics' as const, label: '光斑' },
  { key: 'none' as const, label: '关闭' },
]

let artStudio: CharsetStudioHandle | null = null
let artStudioAbort: AbortController | null = null
let previewStageObserver: ResizeObserver | null = null
let artStudioBusy = false
let artStudioQueued = false
let artStudioSourceKey = ''

/** Shared contain-fit stage box (Studio + static autoZoom). */
const previewStageBox = ref({ width: 0, height: 0 })

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
  measureMonoCellAspect(12, PREVIEW_MONO_FONT) || ASCII_ASPECT_PRESETS.consolas.value,
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
const artQualityAvailable = computed(
  () =>
    editorEngine.value === 'calibrated' &&
    (artMode.value === 'color' || (artMode.value === 'density' && !phraseColor.value)) &&
    !hasVideo.value,
)

/** Realtime playback uses a lighter column cap; prerender / pause use full clarity. */
const videoLivePreview = computed(
  () => hasVideo.value && videoPlaying.value && videoPlaybackMode.value === 'live',
)

const liveColumnCap = computed(() => videoLiveColumnCap(mode.value))

const usePrerenderPath = computed(() => needsVideoPrerender(columns.value, mode.value))

const effectiveColumns = computed(() =>
  resolveAsciiColumns({
    columns: columns.value,
    kind: mediaKind.value,
    mode: mode.value,
    livePreview: videoLivePreview.value,
  }),
)

const columnsCapped = computed(
  () => hasVideo.value && videoLivePreview.value && columns.value > liveColumnCap.value,
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

const metricGlyph = computed(() => (mode.value === 'phrase' ? pickMetricGlyph(phrase.value) : 'M'))

const displayFontSize = computed(() => Math.max(0.5, (fontSize.value * zoom.value) / 100))

const hasResult = computed(() => ascii.value.length > 0)

/** Pin host to the Studio stage box so toggling hover keeps the same width. */
const stagePinned = computed(() => studioLiveActive.value || (autoZoom.value && hasResult.value))

const previewHostStyle = computed(() => {
  if (!stagePinned.value) return undefined
  const { width, height } = previewStageBox.value
  if (width < 40 || height < 40) return undefined
  const scale = studioLiveActive.value && !autoZoom.value ? Math.max(0.1, zoom.value / 100) : 1
  return {
    width: `${width}px`,
    height: `${height}px`,
    transform: scale === 1 ? undefined : `scale(${scale})`,
    transformOrigin: scale === 1 ? undefined : 'top left',
  }
})
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
  () => `${formatClock(videoCurrentTime.value)} / ${formatClock(videoDuration.value)}`,
)

const CLIP_MIN_SPAN = 0.2
const CLIP_LENGTH_OPTIONS = [5, 10, 15, 20] as const

const clipLength = ref(VIDEO_PRERENDER_MAX_DURATION_SEC)
const clipLengthCustom = ref(false)

const clipSpan = computed(() => Math.max(0, clipEnd.value - clipStart.value))

const clipFrameCount = computed(() => Math.max(1, Math.floor(clipSpan.value * videoFps.value) + 1))

const clipMaxFrames = computed(() => {
  const span = Math.min(
    VIDEO_PRERENDER_MAX_DURATION_SEC,
    videoDuration.value > 0 ? videoDuration.value : VIDEO_PRERENDER_MAX_DURATION_SEC,
  )
  return Math.max(2, Math.floor(span * videoFps.value) + 1)
})

const clipOverLimit = computed(() => clipSpan.value > VIDEO_PRERENDER_MAX_DURATION_SEC + 0.05)

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

const previewColors = computed(() => ({
  background: backgroundColor.value,
  foreground: foregroundColor.value,
}))

/** Light glyphs on a dark canvas; invert flips the density ramp. */
const previewInvert = computed(() => !invert.value)

/** Studio live preview when charset mode has hover or ambient motion. */
const studioLiveActive = computed(
  () =>
    editorEngine.value === 'legacy' &&
    mode.value === 'charset' &&
    asciiStudioEffectsActive(hoverEffect.value, ambientMotion.value) &&
    hasMedia.value,
)

/** Export uses the selected canvas palette. */
const exportColors = {
  get background() {
    return backgroundColor.value
  },
  get foreground() {
    return foregroundColor.value
  },
}

const advancedActive = computed(
  () =>
    resolutionKey.value === 'custom' ||
    customCharset.value.trim().length > 0 ||
    fontSize.value !== 9 ||
    previewFontKey.value !== 'consolas' ||
    exportFontKey.value !== 'yahei' ||
    Math.abs(previewAspect.value - ASCII_ASPECT_PRESETS.consolas.value) > 0.02 ||
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
  const wasLive = videoPlaying.value || Boolean(sourceVideo.value && !sourceVideo.value.paused)
  pauseVideoPlayback()
  // Column watch will convert; if columns unchanged, convert here.
  if (wasLive && nextColumns === columns.value) {
    void runConvert({ fitZoom: autoZoom.value })
  }
}

function selectMode(next: AsciiMode) {
  if (mode.value === next) return
  if (hasVideo.value && videoPlaying.value && columns.value > videoLiveColumnCap(next)) {
    pauseVideoPlayback()
  }
  mode.value = next
  if (next === 'phrase') applyPhraseFontDefaults()
  else restoreCharsetFontDefaults()
  autoZoom.value = true
}

function selectArtMode(next: ArtMode) {
  editorEngine.value = 'calibrated'
  selectMode(next === 'phrase' ? 'phrase' : 'charset')
  artMode.value = next
  if (next === 'color') phraseColor.value = true
  artElapsed = 0
}

function selectArtMotion(next: ArtMotion) {
  if (['current', 'reform', 'caustics'].includes(next)) artEffectProfile.value = 'expressive'
  artMotion.value = next
  artElapsed = 0
  artLastTick = 0
}

function selectArtMotionStyle(next: 'studio' | 'cinematic') {
  artMotionStyle.value = next
  artElapsed = 0
  artLastTick = 0
}

function selectArtHover(next: ArtHover | 'none') {
  if (['trail', 'water', 'silk', 'vortex', 'contour', 'dissolve'].includes(next))
    artEffectProfile.value = 'expressive'
  artHover.value = next
}

function calibratedSettings(cols = columns.value, kind = mediaKind.value): ArtSettings {
  return {
    mode: artMode.value,
    columns: cols,
    phrase: phrase.value,
    charset: charset.value,
    background: backgroundColor.value,
    ink: foregroundColor.value,
    colored: phraseColor.value,
    normalize: normalizeTone.value,
    contrast: contrast.value,
    exposure: exposure.value,
    invert: previewInvert.value,
    fillAll: phraseFillAll.value,
    threshold: 1 - phraseThreshold.value,
    fontFamily: previewFontFamily.value,
    charAspect: previewAspect.value,
    ditherStrength: ditherStrength.value,
    ...(kind !== 'video' &&
    (artMode.value === 'color' || (artMode.value === 'density' && !phraseColor.value)) &&
    artQuality.value !== 'classic'
      ? artQuality.value === 'faithful'
        ? { fontWeight: 600 as const, softwareRaster: true, colorFidelity: true }
        : {
            fontWeight: 600 as const,
            rasterQuality:
              artQuality.value === 'detailed' ? ('high' as const) : ('supersampled' as const),
          }
      : {}),
  }
}

function destroyCalibratedRenderers() {
  artPointerSamples.length = 0
  if (artAnimationRaf) cancelAnimationFrame(artAnimationRaf)
  artAnimationRaf = 0
  for (const renderer of artRenderers.values()) renderer.destroy()
  artRenderers.clear()
}

function onArtVisibilityChange() {
  artLastTick = 0
  if (document.hidden && artAnimationRaf) {
    cancelAnimationFrame(artAnimationRaf)
    artAnimationRaf = 0
  } else queueCalibratedAnimation()
}

function queueCalibratedAnimation() {
  if (
    artAnimationRaf ||
    editorEngine.value !== 'calibrated' ||
    !artFrame.value ||
    document.hidden ||
    (!artStageVisible && !fullscreen.value) ||
    reducedArtMotion.value ||
    downloading.value ||
    videoPrerendering.value
  )
    return
  if (
    (artMotion.value === 'none' || artPaused.value || artMotionStrength.value === 0) &&
    artPointer.strength < 0.002 &&
    artPointer.target === 0 &&
    ![...artRenderers.values()].some(renderer => renderer.interactionActive)
  ) {
    artLastTick = 0
    return
  }
  artAnimationRaf = requestAnimationFrame((now) => {
    artAnimationRaf = 0
    if (artLastTick && now - artLastTick < 1000 / 30) {
      queueCalibratedAnimation()
      return
    }
    const delta = artLastTick ? Math.min(0.15, (now - artLastTick) / 1000) : 0
    artLastTick = now
    if (!artPaused.value) artElapsed += delta
    artInteractionElapsed += delta
    artPointer.strength +=
      (artPointer.target - artPointer.strength) * (1 - Math.exp(-Math.max(delta, 1 / 60) / 0.14))
    if (!artPointer.target && artPointer.strength < 0.002) artPointer.strength = 0
    paintPreview()
  })
}

function onCalibratedPointer(event: PointerEvent) {
  if (
    editorEngine.value !== 'calibrated' ||
    artHover.value === 'none' ||
    reducedArtMotion.value ||
    showOriginal.value
  )
    return
  const host = event.currentTarget as HTMLElement | null
  const rect = host?.querySelector('canvas')?.getBoundingClientRect()
  if (!rect) return
  const x = (event.clientX - rect.left) / Math.max(1, rect.width)
  const y = (event.clientY - rect.top) / Math.max(1, rect.height)
  if (x < 0 || x > 1 || y < 0 || y > 1) {
    onCalibratedPointerLeave()
    return
  }
  artPointer.x = x
  artPointer.y = y
  artPointer.target = 1
  const samples = event.getCoalescedEvents?.() ?? []
  for (const sample of samples.length ? samples : [event]) {
    const sx = (sample.clientX - rect.left) / Math.max(1, rect.width)
    const sy = (sample.clientY - rect.top) / Math.max(1, rect.height)
    if (sx >= 0 && sx <= 1 && sy >= 0 && sy <= 1) artPointerSamples.push({ x: sx, y: sy, time: sample.timeStamp, active: true })
  }
  if (artPointerSamples.length > 128) artPointerSamples.splice(0, artPointerSamples.length - 128)
  queueCalibratedAnimation()
}

function onCalibratedPointerLeave() {
  artPointer.target = 0
  artPointerSamples.push({ x: artPointer.x, y: artPointer.y, time: performance.now(), active: false })
  if (artPointerSamples.length > 128) artPointerSamples.shift()
  queueCalibratedAnimation()
}

function onCalibratedPointerUp(event: PointerEvent) {
  if (event.pointerType !== 'mouse') onCalibratedPointerLeave()
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
  artFrame.value = null
  destroyCalibratedRenderers()
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
}

function currentPrerenderCacheKey() {
  return `${editorEngine.value}|${ART_ENGINE_VERSION}|${artMode.value}|${artQuality.value}|${backgroundColor.value}|${foregroundColor.value}|${previewFontFamily.value}|${buildPrerenderCacheKey(
    {
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
    },
  )}`
}

function invalidatePrerenderIfStale() {
  if (!videoPrerenderReady.value) return
  if (prerenderCacheKey !== currentPrerenderCacheKey()) {
    clearPrerenderCache()
  }
}

function resetAll() {
  sourceLoadGeneration++
  sourceLoadController?.abort()
  sourceLoadController = null
  loadingSource.value = false
  sourceFile = null
  sourceRevision.value++
  showOriginal.value = false
  destroyArtStudio()
  clearResult()
  pauseVideoPlayback()
  revokePreview()
  clearVideoElement()
  bitmap?.close()
  bitmap = null
  hasImage.value = false
  imageAspect.value = 0
  error.value = ''
  sourceError.value = ''
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
      Math.max(0.85, measureMonoCellAspect(12, previewFontFamily.value, '中') || 1),
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
  artMode.value = 'density'
  artQuality.value = 'classic'
  artMotion.value = 'none'
  artHover.value = 'light'
  artEffectProfile.value = 'expressive'
  artMotionSpeed.value = 1
  artMotionStrength.value = 0.65
  artMotionStyle.value = 'cinematic'
  artPaused.value = false
  mode.value = 'charset'
  phrase.value = '我爱你中国'
  phraseThreshold.value = 0.55
  phraseFillAll.value = false
  phraseColor.value = true
  exposure.value = 0
  contrast.value = 0.2
  normalizeTone.value = true
  ditherStrength.value = 0.25
  hoverEffect.value = 'none'
  hoverStrength.value = 0.65
  hoverRadius.value = 0.38
  ambientMotion.value = 'none'
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
    measureMonoCellAspect(12, PREVIEW_MONO_FONT) || ASCII_ASPECT_PRESETS.consolas.value
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
    height: Math.max(200, Math.min(window.innerHeight * 0.82, 920) - headH),
  }
}

/**
 * Same contain-fit box used by Studio hover preview and static autoZoom,
 * so toggling 悬停/微动 keeps the same on-screen width.
 */
function computePreviewStageSize() {
  const scroll = previewScroll.value
  const frame = readPreviewFrameSize()
  const maxW = scroll ? Math.max(160, scroll.clientWidth - 16) : frame.width
  const maxH = scroll ? Math.max(200, scroll.clientHeight - 16) : frame.height
  const ratio = imageAspect.value > 0.05 ? imageAspect.value : 1
  let w = maxW
  let h = w / ratio
  if (h > maxH) {
    h = maxH
    w = h * ratio
  }
  return { width: Math.round(w), height: Math.round(h) }
}

function refreshPreviewStageBox() {
  const stage = computePreviewStageSize()
  if (
    stage.width !== previewStageBox.value.width ||
    stage.height !== previewStageBox.value.height
  ) {
    previewStageBox.value = stage
  }
  return stage
}

/** Fit ASCII into the shared preview stage (same box as Studio). */
function applyAutoZoom(force = false) {
  if ((!force && !autoZoom.value) || columnsOut.value <= 0 || rows.value <= 0) {
    return
  }
  const stage = refreshPreviewStageBox()
  if (stage.width < 40 || stage.height < 40) return
  if (editorEngine.value === 'calibrated' && artFrame.value) {
    zoom.value = Math.max(
      10,
      Math.min(
        300,
        Math.round(
          (((stage.width / (artFrame.value.columns * artFrame.value.cellWidth)) * 22) /
            fontSize.value) *
            100,
        ),
      ),
    )
    return
  }
  zoom.value = suggestFitZoom({
    columns: columnsOut.value,
    rows: rows.value,
    fontSize: fontSize.value,
    frameWidth: stage.width,
    frameHeight: stage.height,
    fontFamily: previewFontFamily.value,
    charAspect: previewAspect.value,
    metricGlyph: metricGlyph.value,
    padding: 12,
    margin: 1,
    step: 1,
    minZoom: 10,
    maxZoom: 300,
  })
}

/**
 * Keep on-screen scale consistent when effective columns change
 * (e.g. 超清/极清 pause = full cols, play = live cap).
 */
function syncZoomForGrid(nextCols: number, nextRows: number, options?: { forceFit?: boolean }) {
  if (nextCols <= 0 || nextRows <= 0) return
  const gridChanged = nextCols !== lastPreviewCols || nextRows !== lastPreviewRows
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
  options?: { fitZoom?: boolean; forExport?: boolean; sourceKind?: AsciiMediaKind },
) {
  const invertFlag = previewInvert.value
  const cols = resolveAsciiColumns({
    columns: columns.value,
    kind: options?.sourceKind ?? mediaKind.value,
    mode: mode.value,
    livePreview: options?.forExport ? false : videoLivePreview.value,
    forExport: options?.forExport,
  })
  const result =
    editorEngine.value === 'calibrated'
      ? (() => {
          const art = prepareArtFrame(
            frame.source,
            frame.width,
            frame.height,
            calibratedSettings(cols, options?.sourceKind ?? mediaKind.value),
          )
          return { art, text: art.text, colors: art.colors, columns: art.columns, rows: art.rows }
        })()
      : mode.value === 'phrase'
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
    const prevFit = typeof convertQueued === 'object' ? Boolean(convertQueued.fitZoom) : false
    convertQueued = { fitZoom: Boolean(options?.fitZoom) || prevFit }
    return
  }
  frameBusy = true
  const capturedRevision = sourceRevision.value
  const targetCols = resolveAsciiColumns({
    columns: columns.value,
    kind: mediaKind.value,
    mode: mode.value,
    livePreview: videoLivePreview.value,
  })
  const heavy = targetCols >= 240 || (mode.value === 'phrase' && targetCols >= 180)
  const showPending = heavy || !hasVideo.value || !hasResult.value || !videoLivePreview.value
  if (showPending) converting.value = true
  error.value = ''
  try {
    if (heavy) await new Promise<void>((r) => setTimeout(r, 0))
    if (capturedRevision !== sourceRevision.value) return
    const latest = getFrameSource()
    if (!latest) {
      clearResult()
      return
    }
    imageAspect.value = latest.width / Math.max(1, latest.height)

    const result = convertFrame(latest, options)
    artFrame.value = result.art ?? null
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
    if (capturedRevision !== sourceRevision.value) return
    error.value = e instanceof Error ? e.message : '转换失败'
    clearResult()
  } finally {
    frameBusy = false
    converting.value = false
    if (convertQueued) {
      const queued = convertQueued
      convertQueued = false
      void runConvert(queued)
    }
  }
}

/** Rebuild at full sampling quality with the same polarity as the preview. */
function buildExportAscii(): {
  text: string
  colors?: Uint8ClampedArray
} {
  if (editorEngine.value === 'calibrated' && artFrame.value)
    return { text: artFrame.value.text, colors: artFrame.value.colors }
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

function applyPrerenderFrame(index: number, options?: { fitZoom?: boolean }) {
  const frame = prerenderFrames[index]
  if (!frame) return
  artFrame.value = frame.art ?? null
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
  const capturedCacheKey = currentPrerenderCacheKey()
  const capturedSettings = calibratedSettings(columns.value)
  const calibrated = editorEngine.value === 'calibrated'

  try {
    const result = await prerenderVideoFrames({
      video,
      fps: videoFps.value,
      startTime: clipStart.value,
      endTime: clipEnd.value,
      shouldAbort: () => prerenderAbort || capturedCacheKey !== currentPrerenderCacheKey(),
      getFrameSource,
      convertFrame: (source) => {
        if (!calibrated) return convertFrame(source)
        const art = prepareArtFrame(source.source, source.width, source.height, capturedSettings)
        return { art, text: art.text, colors: art.colors, columns: art.columns, rows: art.rows }
      },
      onPlan: ({ total }) => {
        videoPrerenderTotal.value = total
      },
      onProgress: ({ done, total, frame, index }) => {
        if (prerenderAbort || capturedCacheKey !== currentPrerenderCacheKey()) return
        videoPrerenderDone.value = done
        videoPrerenderTotal.value = total
        if (index === 0) {
          artFrame.value = frame.art ?? null
          ascii.value = frame.text
          asciiColors.value = frame.colors
          columnsOut.value = frame.columns
          rows.value = frame.rows
          syncZoomForGrid(frame.columns, frame.rows, { forceFit: true })
          schedulePaint()
        }
      },
    })

    if (capturedCacheKey !== currentPrerenderCacheKey()) {
      clearPrerenderCache()
      error.value = '解析期间参数已调整，请按当前设置重新解析'
      return false
    }
    if (!result.ok) {
      clearPrerenderCache()
      error.value = result.error
      return false
    }

    prerenderFrames = result.frames
    prerenderCacheKey = capturedCacheKey
    videoPrerenderReady.value = true
    applyPrerenderFrame(nearestPrerenderIndex(result.frames, result.resumeTime), { fitZoom: true })
    return true
  } finally {
    videoPrerendering.value = false
    if (!videoPrerenderReady.value && getFrameSource()) {
      const failure = error.value
      await runConvert({ fitZoom: autoZoom.value })
      error.value = failure
    }
  }
}

function startVideoLoop() {
  stopVideoLoop()
  const video = sourceVideo.value
  if (!video || mediaKind.value !== 'video') return

  if (studioLiveActive.value) {
    videoPlaybackMode.value = 'live'
    videoPlaying.value = true
    void video.play().catch(() => {
      videoPlaying.value = false
    })
    void syncArtStudio()
    return
  }

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
    shouldTick: () => videoPlaying.value && videoPlaybackMode.value === 'prerender',
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
      videoCurrentTime.value < clipStart.value || videoCurrentTime.value >= clipEnd.value
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
  const wasLive = videoPlaying.value || Boolean(sourceVideo.value && !sourceVideo.value.paused)
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
    Number.isFinite(videoDuration.value) && videoDuration.value > 0 ? videoDuration.value : 0
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
  if (video.currentTime < clipStart.value || video.currentTime >= clipEnd.value - 0.04) {
    video.currentTime = clipStart.value
    videoCurrentTime.value = clipStart.value
  }
}

function seekPlaybackIntoClip(video: HTMLVideoElement) {
  if (video.currentTime < clipStart.value || video.currentTime >= clipEnd.value - 0.05) {
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
  clipLength.value = Math.min(VIDEO_PRERENDER_MAX_DURATION_SEC, Math.max(CLIP_MIN_SPAN, seconds))
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
  const frames = Math.min(clipMaxFrames.value, Math.max(2, Math.round(raw)))
  const seconds = Math.max(CLIP_MIN_SPAN, (frames - 1) / videoFps.value)
  setClipLength(seconds, true)
}

function startClipHere() {
  clipStart.value = Math.min(Math.max(0, videoCurrentTime.value), videoDuration.value)
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

async function loadFile(file: File | undefined) {
  if (!file || viewDisposed || downloading.value || packingProject.value) return false
  sourceLoadController?.abort()
  const controller = new AbortController()
  sourceLoadController = controller
  const generation = ++sourceLoadGeneration
  let candidate: PreparedArtSource | null = null
  let committed = false
  sourceError.value = ''
  error.value = ''
  loadingSource.value = true
  try {
    await nextTick()
    controller.signal.throwIfAborted()
    const slot = 1 - activeVideoSlot.value
    candidate = await prepareArtSource(file, videoSlots[slot]?.value ?? null, controller.signal)
    controller.signal.throwIfAborted()
    if (generation !== sourceLoadGeneration) return false
    // The first frame must be usable before releasing any part of the previous work.
    const result = convertFrame(candidate.frame, { forExport: true, sourceKind: candidate.kind })
    destroyArtStudio()
    clearVideoElement()
    clearImageBitmap()
    revokePreview()
    showOriginal.value = false
    mediaKind.value = candidate.kind
    if (candidate.kind === 'video') {
      activeVideoSlot.value = slot
      videoObjectUrl = candidate.url
      const video = sourceVideo.value!
      video.loop = false
      videoDuration.value = video.duration
      videoCurrentTime.value = 0
      resetClipBounds(video.duration)
    } else {
      bitmap = candidate.bitmap!
      hasImage.value = true
      previewUrl.value = candidate.url
    }
    sourceFile = file
    sourceRevision.value++
    committed = true
    imageAspect.value = candidate.frame.width / candidate.frame.height
    autoZoom.value = true
    artFrame.value = result.art ?? null
    ascii.value = result.text
    asciiColors.value = result.colors ?? null
    rows.value = result.rows
    columnsOut.value = result.columns
    syncZoomForGrid(result.columns, result.rows, { forceFit: true })
    projectStatus.value = '有未保存的更改'
    await nextTick()
    schedulePaint()
    if (
      generation === sourceLoadGeneration &&
      candidate.kind === 'video' &&
      !usePrerenderPath.value
    )
      await playVideo()
    return generation === sourceLoadGeneration
  } catch (e) {
    if (!controller.signal.aborted && generation === sourceLoadGeneration)
      sourceError.value = e instanceof Error ? e.message : '无法读取文件'
    return false
  } finally {
    if (!committed) candidate?.dispose()
    if (generation === sourceLoadGeneration) {
      loadingSource.value = false
      sourceLoadController = null
    }
  }
}
function cancelSourceLoad() {
  sourceLoadGeneration++
  sourceLoadController?.abort()
  sourceLoadController = null
  loadingSource.value = false
}

function selectPreviewFont(key: AsciiFontPresetKey) {
  previewFontKey.value = key
  const preset = ASCII_FONT_PRESETS[key]
  previewFontFamily.value = preset.family
  previewAspect.value = measureMonoCellAspect(12, preset.family, metricGlyph.value) || preset.aspect
}

function selectExportFont(key: AsciiFontPresetKey) {
  exportFontKey.value = key
  const preset = ASCII_FONT_PRESETS[key]
  exportFontFamily.value = preset.family
  exportAspect.value = measureMonoCellAspect(12, preset.family, metricGlyph.value) || preset.aspect
}

function onPreviewAspectChange(value: number | number[]) {
  previewAspect.value = Array.isArray(value) ? (value[0] ?? previewAspect.value) : value
}

function onExportAspectChange(value: number | number[]) {
  exportAspect.value = Array.isArray(value) ? (value[0] ?? exportAspect.value) : value
}

function selectCharset(key: AsciiCharsetKey) {
  charsetKey.value = key
  customCharset.value = ''
}

function onFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  void loadFile(input.files?.[0])
  input.value = ''
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
  triggerDownload(blob, `${exportName || 'ascii-art'}.txt`)
}

async function downloadPng() {
  if (!ascii.value && !getFrameSource()) return
  downloading.value = true
  downloadProgress.value = ''
  error.value = ''
  try {
    if (editorEngine.value === 'calibrated') {
      const frame = artFrame.value
      if (!frame) throw new Error('请先生成作品')
      const canvas = document.createElement('canvas'),
        renderer = createCanvasArtRenderer(canvas)
      try {
        renderer.render(frame, {
          longEdge: exportLongEdge,
          transparent: exportTransparent,
          motion: 'none',
          time: 0,
        })
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (value) => (value ? resolve(value) : reject(new Error('图片导出失败'))),
            'image/png',
          ),
        )
        triggerDownload(blob, `${exportName || 'ascii-art'}.png`)
      } finally {
        renderer.destroy()
      }
      return
    }
    const { text, colors } = buildExportAscii()
    const metrics = measureMonoCellMetrics(12, previewFontFamily.value, metricGlyph.value)
    const lines = text.split('\n')
    const targetFontSize =
      ((exportLongEdge - 32) * 12) /
      Math.max(
        Math.max(...lines.map((line) => line.length)) * metrics.advance,
        (lines.length * metrics.advance) / previewAspect.value,
      )
    const blob = await asciiToPngBlob(text, {
      fontSize: targetFontSize,
      background: exportTransparent ? 'transparent' : exportColors.background,
      foreground: exportColors.foreground,
      fontFamily: previewFontFamily.value,
      charAspect: previewAspect.value,
      metricGlyph: metricGlyph.value,
      colors: phraseColor.value ? colors : undefined,
    })
    const image = await createImageBitmap(blob)
    const output = document.createElement('canvas')
    const scale = exportLongEdge / Math.max(image.width, image.height)
    output.width = Math.max(1, Math.round(image.width * scale))
    output.height = Math.max(1, Math.round(image.height * scale))
    const ctx = output.getContext('2d')
    if (!ctx) throw new Error('当前浏览器无法生成图片')
    ctx.drawImage(image, 0, 0, output.width, output.height)
    image.close()
    const resized = await new Promise<Blob>((resolve, reject) =>
      output.toBlob(
        (result) => (result ? resolve(result) : reject(new Error('图片导出失败'))),
        'image/png',
      ),
    )
    triggerDownload(resized, `${exportName || 'ascii-art'}.png`)
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
  const capturedSettings = calibratedSettings(columns.value)
  const capturedMotion = artMotion.value
  const capturedEffects = {
    effectProfile: artEffectProfile.value,
    motionSpeed: artMotionSpeed.value,
    motionStrength: artMotionStrength.value,
    motionStyle: artEffectProfile.value === 'expressive' ? artMotionStyle.value : 'studio',
  }
  const capturedClip = { start: clipStart.value, end: clipEnd.value }
  const calibrated = editorEngine.value === 'calibrated'
  const raster = document.createElement('canvas')
  const rasterRenderer = calibrated ? createCanvasArtRenderer(raster) : null
  pauseVideoPlayback()

  try {
    const result = await exportAsciiVideo({
      frameCount: plan.total,
      bufferFrames: calibrated ? 0 : undefined,
      fps: plan.fps,
      fontSize: Math.max(8, fontSize.value),
      background: exportColors.background,
      foreground: exportColors.foreground,
      fontFamily: previewFontFamily.value,
      charAspect: previewAspect.value,
      metricGlyph: metricGlyph.value,
      onProgress: ({ done, total }) => {
        downloadProgress.value = `${done}/${total}`
      },
      getFrame: async (index) => {
        const t = Math.min(capturedClip.end, capturedClip.start + index * plan.step)
        await seekVideoTo(video, t)
        const frame = getFrameSource()
        if (!frame) return null
        if (rasterRenderer) {
          const art = prepareArtFrame(frame.source, frame.width, frame.height, capturedSettings)
          rasterRenderer.render(art, {
            longEdge: 1280,
            time: index * plan.step,
            motion: capturedMotion,
            ...capturedEffects,
          })
          return { text: art.text, raster }
        }
        const converted = convertFrame(frame, { forExport: true })
        return {
          text: converted.text,
          colors: phraseColor.value ? converted.colors : null,
        }
      },
    })

    triggerDownload(result.blob, `${exportName || 'ascii-art'}.${result.extension}`)
    if (result.extension !== 'mp4') {
      error.value =
        '当前浏览器不支持直接录制 MP4，已导出为 WebM。Chrome / Edge / Safari 通常可导出 MP4。'
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '视频导出失败'
  } finally {
    rasterRenderer?.destroy()
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

async function handleExport(options: {
  format: string
  name: string
  longEdge: number
  transparent: boolean
}) {
  exportName = options.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').slice(0, 100) || 'astra-art'
  exportLongEdge = options.longEdge
  exportTransparent = options.transparent
  error.value = ''
  if (options.format === 'png') await downloadPng()
  else if (options.format === 'mp4') await downloadVideo()
  else if (options.format === 'txt') downloadTxt()
  else if (options.format === 'live-html') await downloadLiveHtml()
}

async function bitmapToDataUrl(source: ImageBitmap): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D unavailable')
  ctx.drawImage(source, 0, 0)
  return canvas.toDataURL('image/jpeg', 0.92)
}

async function downloadLiveHtml() {
  if (editorEngine.value === 'calibrated') {
    downloading.value = true
    error.value = ''
    try {
      const frame = artFrame.value
      if (!frame) throw new Error('请先生成作品')
      let embeddedSource:
        { kind: 'image' | 'video'; dataUrl: string; start: number; end: number } | undefined
      if (sourceFile && hasVideo.value) {
        if (sourceFile.size > 64 * 1024 * 1024)
          throw new Error('离线网页的视频素材超过 64 MB，请先缩短或压缩视频')
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result))
          reader.onerror = () => reject(new Error('视频读取失败'))
          reader.readAsDataURL(sourceFile!)
        })
        embeddedSource = { kind: 'video', dataUrl, start: clipStart.value, end: clipEnd.value }
      }
      const html = artworkEmbedPage(frame, {
        title: projectTitle.value,
        motion: artMotion.value,
        hover: artHover.value,
        effectProfile: artEffectProfile.value,
        motionSpeed: artMotionSpeed.value,
        motionStrength: artMotionStrength.value,
        motionStyle: artEffectProfile.value === 'expressive' ? artMotionStyle.value : 'studio',
        hoverStrength: hoverStrength.value,
        hoverRadius: hoverRadius.value,
        transparent: exportTransparent,
        source: embeddedSource,
      })
      triggerDownload(
        new Blob([html], { type: 'text/html;charset=utf-8' }),
        `${exportName || 'astra-art'}.html`,
      )
    } catch (e) {
      error.value = e instanceof Error ? e.message : '网页导出失败'
    } finally {
      downloading.value = false
    }
    return
  }
  if (mode.value !== 'charset') {
    error.value = '动效网页仅支持灰度字符模式'
    return
  }
  downloading.value = true
  downloadProgress.value = ''
  try {
    const input = artStudioInput()
    // 「动效网页」应带上悬停/微动；UI 都关时写入预览同款默认，打开后仍可改。
    if (input.hoverEffect === 'none' && input.motion === 'none') {
      input.hoverEffect = 'trail'
      input.hoverStrength = 0.65
      input.hoverRadius = 0.38
      input.motion = 'current'
    }
    const settings = buildAsciiStudioSettings(input)
    const ratio =
      imageAspect.value > 0.05
        ? imageAspect.value
        : columnsOut.value > 0 && rows.value > 0
          ? columnsOut.value / rows.value
          : 1
    let dataUrl: string | undefined
    if (!hasVideo.value && bitmap) {
      dataUrl = await bitmapToDataUrl(bitmap)
    }
    const html = asciiArtEmbedPage({
      settings,
      ratio,
      dataUrl,
      title: '字符画动效',
      fontFamily: previewFontFamily.value,
    })
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    triggerDownload(blob, `${exportName || 'ascii-art-live'}.html`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '动效网页下载失败'
  } finally {
    downloading.value = false
  }
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
  zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom.value + delta)))
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

function artStudioInput(stageCssWidth?: number) {
  const hostW =
    stageCssWidth ??
    previewHost.value?.clientWidth ??
    Math.max(160, (previewScroll.value?.clientWidth ?? 640) - 16)
  return {
    charset: charset.value,
    colored: phraseColor.value,
    ink: previewColors.value.foreground,
    invert: previewInvert.value,
    exposure: exposure.value,
    contrast: contrast.value,
    // Clarity presets (列数) → Studio cell size, not fontSize.
    cellSize: studioCellSizeFromColumns(hostW, columns.value),
    hoverEffect: hoverEffect.value,
    hoverStrength: hoverStrength.value,
    hoverRadius: hoverRadius.value,
    motion: ambientMotion.value,
    backdrop: previewColors.value.background,
  }
}

function destroyArtStudio() {
  artStudioAbort?.abort()
  artStudioAbort = null
  artStudio?.destroy()
  artStudio = null
  artStudioSourceKey = ''
  // Host size is owned by Vue `previewHostStyle` while stagePinned;
  // do not clear width/height here or static autoZoom shrinks after hover off.
}

function currentArtStudioSourceKey() {
  if (hasVideo.value && videoObjectUrl) return `video:${videoObjectUrl}`
  if (previewUrl.value) return `img:${previewUrl.value}`
  return ''
}

function resolveArtStudioSource(): string | null {
  // asciify mountStudio only accepts File | string (URL). ImageBitmap /
  // HTMLVideoElement lack .type and crash inside loadStudioMedia.
  if (hasVideo.value && videoObjectUrl) return videoObjectUrl
  if (previewUrl.value) return previewUrl.value
  return null
}

/** Contain-fit stage to the preview scroll; manual zoom scales, autoZoom stays 1:1 fitted. */
function layoutArtStudioStage() {
  const host = previewHost.value
  const canvas = previewCanvas.value
  if (!host || !canvas) return { width: 0, height: 0 }
  const stage = refreshPreviewStageBox()
  if (stage.width < 40) return { width: 0, height: 0 }
  return stage
}

function resizeArtStudio() {
  if (!artStudio || !previewHost.value) return
  const { width } = layoutArtStudioStage()
  if (width > 0) {
    artStudio.update(studioPatchFromInput(artStudioInput(width)))
  }
  resizeCharsetStudio(artStudio, previewHost.value)
}

function onPreviewStageResize() {
  const stage = refreshPreviewStageBox()
  if (stage.width < 40) return
  if (artStudio) {
    resizeArtStudio()
    return
  }
  if (autoZoom.value && ascii.value) {
    applyAutoZoom(true)
    schedulePaint()
  }
}

async function syncArtStudio() {
  if (!studioLiveActive.value) {
    destroyArtStudio()
    if (ascii.value) {
      refreshPreviewStageBox()
      if (autoZoom.value) applyAutoZoom(true)
      schedulePaint()
    }
    return
  }
  const canvas = previewCanvas.value
  if (!canvas) return
  if (artStudioBusy) {
    artStudioQueued = true
    return
  }
  artStudioBusy = true
  artStudioQueued = false
  try {
    // Studio owns the video frames — stop our ASCII convert loop.
    if (hasVideo.value) {
      stopVideoLoop()
      if (videoPlaybackMode.value === 'prerender') {
        videoPlaybackMode.value = 'live'
      }
    }
    const { width: stageW } = layoutArtStudioStage()
    const input = artStudioInput(stageW || undefined)
    const sourceKey = currentArtStudioSourceKey()
    if (artStudio && artStudioSourceKey === sourceKey) {
      artStudio.update(studioPatchFromInput(input))
      if (previewHost.value) resizeCharsetStudio(artStudio, previewHost.value)
      return
    }
    destroyArtStudio()
    artStudioAbort = new AbortController()
    const signal = artStudioAbort.signal
    const source = resolveArtStudioSource()
    if (!source) {
      error.value = '没有可用的素材地址，请重新上传'
      return
    }
    artStudio = await mountCharsetStudio(canvas, source, input, { signal })
    if (signal.aborted) {
      artStudio.destroy()
      artStudio = null
      return
    }
    artStudioSourceKey = sourceKey
    resizeArtStudio()
    // Studio loads its own video element from the blob URL; keep UI in sync.
    if (hasVideo.value) {
      videoPlaying.value = true
      videoPlaybackMode.value = 'live'
    }
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) {
      error.value = e instanceof Error ? e.message : '动效预览启动失败'
    }
    destroyArtStudio()
    schedulePaint()
  } finally {
    artStudioBusy = false
    if (artStudioQueued) {
      artStudioQueued = false
      void syncArtStudio()
    }
  }
}

function paintTo(canvas: HTMLCanvasElement | null, pointerSamples: readonly ArtPointerSample[] = []) {
  if (!canvas || !ascii.value) return
  if (editorEngine.value === 'calibrated' && artFrame.value) {
    const frame = artFrame.value
    let renderer = artRenderers.get(canvas)
    if (!renderer) {
      renderer = createCanvasArtRenderer(canvas)
      artRenderers.set(canvas, renderer)
    }
    let stage = refreshPreviewStageBox()
    if (canvas === fullscreenCanvas.value && fullscreenScroll.value) {
      const maxWidth = Math.max(64, fullscreenScroll.value.clientWidth - 32)
      const maxHeight = Math.max(64, fullscreenScroll.value.clientHeight - 32)
      const width = Math.min(maxWidth, maxHeight * (frame.width / frame.height))
      stage = { width, height: width * (frame.height / frame.width) }
    }
    const cssWidth = autoZoom.value
      ? stage.width
      : (frame.columns * frame.cellWidth * displayFontSize.value) / 22
    const cssHeight = (cssWidth * frame.height) / frame.width
    const pointer = {
      ...artPointer,
      active: artPointer.target > 0 && !reducedArtMotion.value && !downloading.value,
      strength:
        reducedArtMotion.value || downloading.value ? 0 : artPointer.strength * hoverStrength.value,
    }
    renderer.render(frame, {
      longEdge: Math.max(cssWidth, cssHeight) * Math.min(2, devicePixelRatio || 1),
      motion: reducedArtMotion.value ? 'none' : artMotion.value,
      time: artElapsed,
      hoverTime: artInteractionElapsed,
      effectProfile: artEffectProfile.value,
      motionSpeed: artMotionSpeed.value,
      motionStrength: artMotionStrength.value,
      motionStyle: artEffectProfile.value === 'expressive' ? artMotionStyle.value : 'studio',
      hoverRadius: hoverRadius.value,
      hoverStrength: reducedArtMotion.value || downloading.value ? 0 : hoverStrength.value,
      pointerSamples,
      hover: artHover.value === 'none' ? 'light' : artHover.value,
      pointer: artHover.value === 'none' ? undefined : pointer,
    })
    canvas.style.width = `${cssWidth}px`
    canvas.style.height = `${cssHeight}px`
    canvas.dataset.engine = 'calibrated'
    canvas.dataset.columns = String(frame.columns)
    canvas.dataset.mode = frame.settings.mode
    canvas.dataset.quality = frame.settings.softwareRaster
      ? 'faithful'
      : frame.settings.rasterQuality === 'high'
        ? 'detailed'
        : frame.settings.rasterQuality === 'supersampled'
          ? 'smooth'
          : 'classic'
    canvas.dataset.time = String(artElapsed)
    canvas.dataset.motionStyle = artEffectProfile.value === 'expressive' ? artMotionStyle.value : 'studio'
    canvas.dataset.interactionTime = String(artInteractionElapsed)
    canvas.dataset.pointerStrength = String(artPointer.strength)
    canvas.dataset.interactionActive = String(renderer.interactionActive)
    queueCalibratedAnimation()
    return
  }
  // Preview canvas is owned by Studio while hover/motion is on.
  if (canvas === previewCanvas.value && studioLiveActive.value && artStudio) {
    return
  }
  const colors = canvas === fullscreenCanvas.value ? fullscreenPaintColors() : previewColors.value
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
  // Stage box is CSS-pinned; paint's inline canvas size is overridden by .staged.
  if (canvas === previewCanvas.value && autoZoom.value) {
    refreshPreviewStageBox()
  }
}

function paintPreview() {
  const samples = artPointerSamples.splice(0)
  paintTo(previewCanvas.value, samples)
  if (fullscreen.value) paintTo(fullscreenCanvas.value, samples)
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
    const playing = videoPlaying.value || Boolean(sourceVideo.value && !sourceVideo.value.paused)
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
    previewFontFamily,
    mode,
    phrase,
    phraseThreshold,
    phraseFillAll,
    phraseColor,
    exposure,
    contrast,
    normalizeTone,
    ditherStrength,
    editorEngine,
    artMode,
    artQuality,
    backgroundColor,
    foregroundColor,
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
  if (editorEngine.value === 'calibrated') return
  if (getFrameSource() && autoZoom.value) applyAutoZoom()
  schedulePaint()
})

watch([artQualityAvailable, artMode], ([available]) => {
  if (!available || !artQualityOptions.value.some((item) => item.id === artQuality.value))
    artQuality.value = 'classic'
})

watch(artPaused, () => {
  if (artAnimationRaf) cancelAnimationFrame(artAnimationRaf)
  artAnimationRaf = 0
  artLastTick = 0
  queueCalibratedAnimation()
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

watch(
  [
    studioLiveActive,
    hoverEffect,
    hoverStrength,
    hoverRadius,
    ambientMotion,
    charsetKey,
    customCharset,
    phraseColor,
    exposure,
    contrast,
    columns,
    autoZoom,
    invert,
    previewInvert,
    backgroundColor,
    foregroundColor,
    zoom,
    hasMedia,
    mode,
    previewUrl,
  ],
  async () => {
    await nextTick()
    void syncArtStudio()
  },
)

watch(
  [
    ascii,
    artFrame,
    displayFontSize,
    previewColors,
    phraseColor,
    asciiColors,
    zoom,
    artMotion,
    artHover,
    artPaused,
    artEffectProfile,
    artMotionSpeed,
    artMotionStrength,
    artMotionStyle,
    hoverStrength,
    hoverRadius,
    reducedArtMotion,
  ],
  async () => {
    if (!hasResult.value) return
    await nextTick()
    if (studioLiveActive.value) {
      resizeArtStudio()
      return
    }
    schedulePaint()
  },
)

watch(previewCanvas, (el, previous) => {
  if (previous) {
    artRenderers.get(previous)?.destroy()
    artRenderers.delete(previous)
  }
  if (!el) return
  artVisibilityObserver?.disconnect()
  artVisibilityObserver = new IntersectionObserver((entries) => {
    artStageVisible = Boolean(entries[0]?.isIntersecting)
    if (!artStageVisible && artAnimationRaf) {
      cancelAnimationFrame(artAnimationRaf)
      artAnimationRaf = 0
    } else queueCalibratedAnimation()
  })
  artVisibilityObserver.observe(el)
  if (studioLiveActive.value) void syncArtStudio()
  else if (ascii.value) schedulePaint()
})

watch(imageAspect, () => {
  if (imageAspect.value <= 0.05) return
  refreshPreviewStageBox()
  if (artStudio) resizeArtStudio()
  else if (autoZoom.value && ascii.value) {
    applyAutoZoom(true)
    schedulePaint()
  }
})

watch(previewScroll, (el, _prev, onCleanup) => {
  if (!el) return
  const handler = (event: WheelEvent) => onPreviewWheel(event)
  el.addEventListener('wheel', handler, { passive: false })
  previewStageObserver?.disconnect()
  previewStageObserver = new ResizeObserver(() => onPreviewStageResize())
  previewStageObserver.observe(el)
  refreshPreviewStageBox()
  onCleanup(() => {
    el.removeEventListener('wheel', handler)
    previewStageObserver?.disconnect()
    previewStageObserver = null
  })
})

watch(fullscreenScroll, (el, _prev, onCleanup) => {
  if (!el) return
  const handler = (event: WheelEvent) => onPreviewWheel(event)
  el.addEventListener('wheel', handler, { passive: false })
  onCleanup(() => el.removeEventListener('wheel', handler))
})

watch(fullscreenCanvas, (el, previous) => {
  if (previous) {
    artRenderers.get(previous)?.destroy()
    artRenderers.delete(previous)
  }
  if (el && ascii.value) schedulePaint()
})

watch(fullscreen, (open) => {
  document.body.style.overflow = open ? 'hidden' : ''
})

const projectSettings: Record<string, Ref<string | number | boolean>> = {
  editorEngine,
  artMode,
  artQuality,
  artMotion,
  artHover,
  artEffectProfile,
  artMotionSpeed,
  artMotionStrength,
  artMotionStyle,
  mode,
  phrase,
  phraseThreshold,
  phraseFillAll,
  phraseColor,
  exposure,
  contrast,
  normalizeTone,
  ditherStrength,
  hoverEffect,
  hoverStrength,
  hoverRadius,
  ambientMotion,
  resolutionKey,
  columns,
  charsetKey,
  customCharset,
  invert,
  fontSize,
  previewFontKey,
  previewFontFamily,
  previewAspect,
  exportFontKey,
  exportFontFamily,
  exportAspect,
  backgroundColor,
  foregroundColor,
  clipStart,
  clipEnd,
  videoFps,
}
const savedSnapshot = ref('')
function snapshot() {
  return JSON.stringify({
    name: projectTitle.value,
    sourceRevision: sourceRevision.value,
    settings: Object.fromEntries(
      Object.entries(projectSettings).map(([key, value]) => [key, value.value]),
    ),
  })
}
watch(
  () => snapshot(),
  () => {
    if (sourceFile)
      projectStatus.value =
        snapshot() !== savedSnapshot.value ? '有未保存的更改' : '已保存到此浏览器'
  },
)
const hasUnsavedChanges = computed(() => hasMedia.value && snapshot() !== savedSnapshot.value)
function makeThumbnail() {
  const canvas = document.createElement('canvas')
  const frame = getFrameSource()
  if (!frame) return ''
  const result =
    editorEngine.value === 'calibrated' && artFrame.value
      ? { art: artFrame.value, text: artFrame.value.text, colors: artFrame.value.colors }
      : convertFrame(frame, { forExport: true })
  if (result.art) {
    const renderer = createCanvasArtRenderer(canvas)
    try {
      renderer.render(result.art, { longEdge: 420, motion: 'none', time: 0 })
    } finally {
      renderer.destroy()
    }
    return canvas.toDataURL('image/jpeg', 0.85)
  }
  paintAsciiToCanvas(canvas, result.text, {
    fontSize: 5,
    background: backgroundColor.value,
    foreground: foregroundColor.value,
    fontFamily: previewFontFamily.value,
    charAspect: previewAspect.value,
    metricGlyph: metricGlyph.value,
    colors: phraseColor.value ? result.colors : undefined,
    padding: 0,
  })
  const thumb = document.createElement('canvas')
  thumb.width = 420
  thumb.height = Math.max(1, Math.round((canvas.height * 420) / canvas.width))
  thumb.getContext('2d')?.drawImage(canvas, 0, 0, thumb.width, thumb.height)
  return thumb.toDataURL('image/jpeg', 0.85)
}
async function openExport() {
  if (editorEngine.value === 'calibrated' && videoPlaying.value) {
    const wasPrerender = videoPlaybackMode.value === 'prerender'
    pauseVideo()
    if (!wasPrerender) await runConvert({ fitZoom: autoZoom.value })
  }
  exportPreview.value = makeThumbnail()
  exportOpen.value = true
}
async function saveProject() {
  if (!sourceFile || savingProject.value || pending.value || downloading.value) return false
  savingProject.value = true
  const captured = snapshot()
  const capturedRevision = sourceRevision.value
  try {
    const id = projectId.value || crypto.randomUUID()
    await saveArtProject({
      id,
      name: projectTitle.value.trim() || '未命名作品',
      kind: hasVideo.value ? 'video' : 'image',
      source: sourceFile,
      updatedAt: Date.now(),
      thumbnail: makeThumbnail(),
      settings: JSON.parse(captured).settings,
      engineVersion: editorEngine.value === 'calibrated' ? ART_ENGINE_VERSION : 'legacy-1',
    })
    if (capturedRevision !== sourceRevision.value) return false
    projectId.value = id
    savedSnapshot.value = captured
    projectStatus.value = captured === snapshot() ? '已保存到此浏览器' : '有未保存的更改'
    return captured === snapshot()
  } catch {
    error.value = '保存失败，浏览器存储空间可能不足。请先导出作品。'
    return false
  } finally {
    savingProject.value = false
  }
}
const leaveDialogOpen = ref(false)
const leaveAction = ref<'离开' | '清空'>('离开')
const leaveError = ref('')
const leaveBusy = computed(
  () =>
    pending.value ||
    savingProject.value ||
    downloading.value ||
    packingProject.value ||
    videoPrerendering.value,
)
let resolveLeave: ((allow: boolean) => void) | null = null
function requestLeave(action: '离开' | '清空' = '离开'): boolean | Promise<boolean> {
  if (!hasUnsavedChanges.value && !leaveBusy.value) return true
  resolveLeave?.(false)
  leaveError.value = ''
  leaveAction.value = action
  leaveDialogOpen.value = true
  return new Promise<boolean>((resolve) => {
    resolveLeave = resolve
  })
}
function finishLeave(allow: boolean) {
  if (allow && leaveBusy.value) return
  leaveDialogOpen.value = false
  resolveLeave?.(allow)
  resolveLeave = null
}
async function saveAndLeave() {
  if (leaveBusy.value) return
  leaveError.value = ''
  if (await saveProject()) finishLeave(true)
  else leaveError.value = error.value || '保存期间作品发生变化，请确认后再保存。'
}
async function clearArtwork() {
  if (!(await requestLeave('清空'))) return
  resetAll()
  projectId.value = ''
  projectTitle.value = '未命名作品'
  savedSnapshot.value = ''
  projectStatus.value = '仅保存在此浏览器'
}
function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return
  event.preventDefault()
  event.returnValue = ''
}
onBeforeRouteLeave(() => requestLeave())
onBeforeRouteUpdate((to, from) => to.fullPath === from.fullPath || requestLeave())
async function downloadProjectPackage() {
  if (!sourceFile || packingProject.value || pending.value || downloading.value) return
  packingProject.value = true
  packageStatus.value = '正在打包原始素材…'
  error.value = ''
  try {
    const captured = JSON.parse(snapshot())
    const blob = await createArtProjectPackage({
      id: projectId.value || crypto.randomUUID(),
      name: projectTitle.value.trim() || '未命名作品',
      kind: hasVideo.value ? 'video' : 'image',
      source: sourceFile,
      updatedAt: Date.now(),
      thumbnail: makeThumbnail(),
      settings: captured.settings,
      engineVersion: editorEngine.value === 'calibrated' ? ART_ENGINE_VERSION : 'legacy-1',
    })
    triggerDownload(blob, artProjectPackageFilename(captured.name))
    packageStatus.value = '作品包已生成，可在“我的项目”导入继续创作。'
  } catch (cause) {
    packageStatus.value = ''
    error.value = cause instanceof Error ? cause.message : '作品包下载失败，请重试。'
  } finally {
    packingProject.value = false
  }
}
async function applyPreset(preset: ArtworkPreset, replaceSource = false) {
  activePreset.value = preset.id
  selectMode(preset.mode)
  if (editorEngine.value === 'calibrated')
    artMode.value = preset.mode === 'phrase' ? 'phrase' : preset.color ? 'color' : 'density'
  await nextTick()
  phrase.value = preset.phrase || '光与影'
  phraseFillAll.value = Boolean(preset.phrase)
  phraseColor.value = preset.color
  contrast.value = 0.2
  exposure.value = 0
  invert.value = false
  customCharset.value = ''
  charsetKey.value = 'dense'
  hoverEffect.value = 'none'
  ambientMotion.value = 'none'
  backgroundColor.value = '#111615'
  foregroundColor.value = '#eeeae2'
  selectResolution('high')
  if (preset.mode === 'phrase') {
    previewAspect.value = 0.85
    exportAspect.value = 0.85
  } else {
    previewAspect.value = 0.55
  }
  if (!hasMedia.value || replaceSource) {
    const requestedSourceGeneration = sourceLoadGeneration
    try {
      const response = await fetch(preset.src)
      if (!response.ok) throw new Error('素材加载失败')
      const blob = await response.blob()
      if (viewDisposed || requestedSourceGeneration !== sourceLoadGeneration) return
      const loaded = await loadFile(
        new File([blob], `${preset.id}.${preset.src.split('.').pop()}`, { type: blob.type }),
      )
      if (!loaded) return
      projectTitle.value = preset.title
    } catch {
      error.value = '示例暂时无法加载，请上传自己的照片。'
    }
  }
  await nextTick()
  void runConvert({ fitZoom: true })
}
async function loadRouteProject() {
  const generation = ++routeLoadGeneration
  const requestedPath = route.fullPath
  if (typeof route.query.project !== 'string')
    editorEngine.value = route.query.engine === 'legacy' ? 'legacy' : 'calibrated'
  if (typeof route.query.project === 'string') {
    try {
      const project = await getArtProject(route.query.project)
      if (viewDisposed || generation !== routeLoadGeneration || requestedPath !== route.fullPath)
        return
      if (!project) {
        error.value = '没有找到这个本地项目。它可能已被删除，或保存在另一个浏览器中。'
        return
      }
      assertArtProjectEngineCompatible(project)
      editorEngine.value = project.settings.editorEngine === 'calibrated' ? 'calibrated' : 'legacy'
      artQuality.value = 'classic'
      if (!(await loadFile(project.source))) return
      artEffectProfile.value =
        project.settings.artEffectProfile === 'expressive' ? 'expressive' : 'classic'
      artMotionSpeed.value = 1
      artMotionStrength.value = 0.65
      artMotionStyle.value = 'studio'
      if (hasVideo.value) pauseVideoPlayback()
      if (project.settings.mode === 'phrase' || project.settings.mode === 'charset')
        selectMode(project.settings.mode)
      await nextTick()
      for (const [key, value] of Object.entries(project.settings)) {
        const target = projectSettings[key]
        if (target && typeof value === typeof target.value) target.value = value
      }
      if (!['studio', 'cinematic'].includes(artMotionStyle.value)) artMotionStyle.value = 'studio'
      if (!ART_MODES.some((item) => item.id === artMode.value))
        artMode.value = mode.value === 'phrase' ? 'phrase' : 'density'
      if (
        !artQualityOptions.value.some((item) => item.id === artQuality.value) ||
        !artQualityAvailable.value
      )
        artQuality.value = 'classic'
      if (hasVideo.value && sourceVideo.value) {
        clipLength.value = Math.max(CLIP_MIN_SPAN, clipEnd.value - clipStart.value)
        clipLengthCustom.value = true
        await seekVideoTo(sourceVideo.value, clipStart.value)
        videoCurrentTime.value = clipStart.value
      }
      projectId.value = project.id
      projectTitle.value = project.name
      await nextTick()
      await runConvert({ fitZoom: true })
      savedSnapshot.value = snapshot()
      projectStatus.value = '已从此浏览器恢复'
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '项目无法恢复，请检查浏览器存储权限。'
    }
  } else {
    const preset = artworkPresets.find((p) => p.id === route.query.preset)
    if (preset) await applyPreset(preset, true)
  }
}
watch(
  () => route.fullPath,
  async () => {
    if (route.name !== 'ascii-art') return
    resetAll()
    projectId.value = ''
    savedSnapshot.value = ''
    projectTitle.value = '未命名作品'
    await loadRouteProject()
  },
)
onMounted(() => {
  window.addEventListener('beforeunload', onBeforeUnload)
  document.addEventListener('visibilitychange', onArtVisibilityChange)
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)')
  const onMotionChange = () => {
    reducedArtMotion.value = motionQuery.matches
    schedulePaint()
  }
  motionQuery.addEventListener('change', onMotionChange)
  onBeforeUnmount(() => motionQuery.removeEventListener('change', onMotionChange))
  window.addEventListener('keydown', onFullscreenKey)
  void loadRouteProject()
})

onBeforeUnmount(() => {
  viewDisposed = true
  routeLoadGeneration++
  resolveLeave?.(false)
  resolveLeave = null
  window.removeEventListener('beforeunload', onBeforeUnload)
  destroyCalibratedRenderers()
  artVisibilityObserver?.disconnect()
  document.removeEventListener('visibilitychange', onArtVisibilityChange)
  destroyArtStudio()
  previewStageObserver?.disconnect()
  previewStageObserver = null
  resetAll()
  window.clearTimeout(copyTimer)
  if (paintRaf) cancelAnimationFrame(paintRaf)
  stopVideoLoop()
  window.removeEventListener('keydown', onFullscreenKey)
  document.body.style.overflow = ''
})
</script>
<template>
  <div class="page art-editor" :class="`mobile-${mobilePanel}`">
    <header class="editor-header">
      <div class="editor-brand">
        <RouterLink to="/" class="art-wordmark" aria-label="Astra 首页"
          ><AstraLogo :height="28" /></RouterLink
        ><RouterLink to="/gallery" class="editor-back">← 返回作品</RouterLink>
      </div>
      <input v-model="projectTitle" class="project-title" aria-label="作品名称" maxlength="60" />
      <div class="editor-header-actions">
        <span class="save-status" role="status">{{ projectStatus }}</span
        ><button
          class="editor-save"
          :disabled="!hasResult || pending || savingProject || downloading"
          @click="saveProject"
        >
          {{ savingProject ? '保存中…' : '保存项目' }}</button
        ><button
          class="art-button primary"
          :disabled="!hasResult || pending || downloading"
          @click="openExport"
        >
          导出 <ArtIcon :size="17" />
        </button>
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
      <aside class="source-panel side fx-scroll">
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
            :aria-label="previewUrl || hasVideo ? '点击更换文件' : '点击上传图片或视频'"
            @dragenter.prevent="dragging = true"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
            @click="fileInput?.click()"
            @keydown.enter.prevent="fileInput?.click()"
            @keydown.space.prevent="fileInput?.click()"
          >
            <video
              v-for="slot in [0, 1]"
              :key="slot"
              :ref="(element) => setVideoSlot(slot, element)"
              class="thumb video-thumb"
              :class="{ show: hasVideo && activeVideoSlot === slot }"
              muted
              playsinline
              loop
              @click.stop
              @timeupdate="activeVideoSlot === slot && onVideoTimeUpdate()"
              @seeked="activeVideoSlot === slot && onVideoSeeked()"
              @play="activeVideoSlot === slot && onSourceVideoPlay()"
              @pause="activeVideoSlot === slot && onSourceVideoPause()"
            />
            <img v-if="previewUrl && !hasVideo" class="thumb" :src="previewUrl" alt="上传预览" />
            <div class="drop-copy">
              <p class="drop-title">
                {{ previewUrl || hasVideo ? '点击或拖拽更换' : '拖拽或点击上传' }}
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

          <div v-if="hasVideo && usePrerenderPath" class="clip-panel" @click.stop>
            <div class="clip-top">
              <strong :class="{ warn: clipOverLimit }">
                {{ formatClock(clipStart) }}–{{ formatClock(clipEnd) }} · {{ clipSpan.toFixed(1) }}s
                · {{ clipFrameCount }}帧
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
                <div class="clip-map-playhead" :style="{ left: `${playheadPct}%` }" />
              </div>
              <input
                class="range clip-rail-input"
                type="range"
                min="0"
                :max="Math.max(0.1, videoDuration)"
                step="0.1"
                :value="clipStart"
                :disabled="videoDuration <= 0 || videoPrerendering || downloading"
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
                    videoPrerenderTotal ? (videoPrerenderDone / videoPrerenderTotal) * 100 : 0
                  }%`,
                }"
              />
            </div>
            <p class="prerender-label">{{ prerenderProgressLabel }}</p>
          </div>
          <p v-if="hasVideo && videoHint" class="video-note">{{ videoHint }}</p>
        </section>
        <section class="preset-section">
          <div class="preset-heading">
            <h2>风格预设</h2>
            <RouterLink to="/gallery">全部 ↗</RouterLink>
          </div>
          <div class="editor-presets">
            <button
              v-for="preset in artworkPresets"
              :key="preset.id"
              :class="{ selected: activePreset === preset.id }"
              :disabled="pending || downloading"
              @click="applyPreset(preset)"
            >
              <div class="preset-image">
                <CharacterArtwork
                  :src="preset.src"
                  :color="preset.color"
                  :phrase="preset.phrase"
                  :label="preset.title"
                />
              </div>
              <span>{{ preset.title }}</span>
            </button>
          </div>
          <p class="preset-note">先选喜欢的风格，再换成你的照片。</p>
        </section>
        <RouterLink to="/projects" class="editor-projects"
          ><ArtIcon name="folder" :size="17" /> 我的项目 <span>↗</span></RouterLink
        >
        <button
          class="editor-package"
          :disabled="!hasResult || pending || downloading || packingProject"
          @click="downloadProjectPackage"
        >
          <ArtIcon name="download" :size="17" /> {{ packingProject ? '打包中…' : '下载作品包' }}
        </button>
        <p class="package-hint" role="status" aria-live="polite">
          {{ packageStatus || '备份原始素材与参数，换设备继续创作。' }}
        </p>
      </aside>
      <nav class="mobile-editor-tabs" aria-label="编辑面板">
        <button :class="{ active: mobilePanel === 'presets' }" @click="mobilePanel = 'presets'">
          素材与预设</button
        ><button :class="{ active: mobilePanel === 'settings' }" @click="mobilePanel = 'settings'">
          调整效果</button
        ><button :disabled="!hasResult || savingProject || pending" @click="saveProject">
          保存项目
        </button>
      </nav>
      <aside class="inspector-panel side fx-scroll">
        <div class="inspector-title">
          <h2>文字与风格</h2>
          <span>⌃</span>
        </div>
        <p v-if="editorEngine === 'legacy'" class="hint legacy-project-note">
          此项目保留旧版样式。选择下方六模式可尝试新版效果，保存后更新项目。
        </p>
        <div class="inspector-modes six-modes" aria-label="艺术模式">
          <button
            v-for="item in ART_MODES"
            :key="item.id"
            :class="{ selected: editorEngine === 'calibrated' && artMode === item.id }"
            :disabled="downloading || videoPrerendering"
            :aria-pressed="editorEngine === 'calibrated' && artMode === item.id"
            :title="item.description"
            @click="selectArtMode(item.id)"
          >
            {{ item.name }}
          </button>
        </div>
        <div v-if="editorEngine === 'legacy'" class="inspector-modes">
          <button :class="{ selected: mode === 'charset' }" @click="selectMode('charset')">
            字符</button
          ><button :class="{ selected: mode === 'phrase' }" @click="selectMode('phrase')">
            中文铺字
          </button>
        </div>
        <section class="card">
          <header class="card-head">
            <h2>细节调整</h2>
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
                  'has-warn': hasVideo && needsVideoPrerender(opt.columns, mode),
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
                  <span class="res-warn" role="img" aria-label="需解析播放" @click.stop>
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
          <div
            v-else-if="editorEngine === 'legacy' || artMode === 'density' || artMode === 'color'"
            class="field"
          >
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
                <button v-if="!autoZoom" type="button" class="text-link" @click="resetZoom">
                  自适应
                </button>
                <em v-else>自适应</em>
              </span>
            </div>
            <div class="zoom-row">
              <button type="button" class="icon-btn" :disabled="zoom <= 10" @click="zoomOut">
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
              <button type="button" class="icon-btn" :disabled="zoom >= 300" @click="zoomIn">
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
              :disabled="editorEngine === 'calibrated' && artMode === 'color'"
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

        <section
          v-if="editorEngine === 'calibrated' && (artMode === 'density' || artMode === 'color')"
          class="card"
        >
          <div class="card-head"><h2>渲染品质</h2></div>
          <div
            class="seg"
            role="group"
            aria-label="图片渲染品质"
            aria-describedby="art-quality-hint"
          >
            <button
              v-for="item in artQualityOptions"
              :key="item.id"
              type="button"
              :data-quality="item.id"
              :class="['seg-item', { on: artQuality === item.id }]"
              :aria-pressed="artQuality === item.id"
              :disabled="!artQualityAvailable"
              @click="artQuality = item.id"
            >
              {{ item.label }}
            </button>
          </div>
          <p id="art-quality-hint" class="hint">
            {{
              artQualityAvailable
                ? artMode === 'color'
                  ? '还原保留色彩与明暗层次，适用于图片创作。'
                  : '精细强化纹理，柔和减轻锯齿，还原保留明暗层次。'
                : '品质增强适用于光影字符的单色图片和原色字符图片。'
            }}
          </p>
        </section>

        <section class="card palette-card">
          <label>背景 <input v-model="backgroundColor" type="color" aria-label="背景颜色" /></label
          ><label
            >文字颜色 <input v-model="foregroundColor" type="color" aria-label="文字颜色"
          /></label>
        </section>
        <details v-if="editorEngine === 'calibrated'" class="card calibrated-effects">
          <summary class="card-head">
            <h2>动态效果</h2>
            <span>＋</span>
          </summary>
          <div class="field">
            <div class="seg" role="group" aria-label="效果风格">
              <button
                type="button"
                :class="['seg-item', { on: artEffectProfile === 'expressive' }]"
                @click="artEffectProfile = 'expressive'"
              >
                增强光影
              </button>
              <button
                type="button"
                :class="['seg-item', { on: artEffectProfile === 'classic' }]"
                @click="artEffectProfile = 'classic'"
              >
                经典光影
              </button>
            </div>
          </div>
          <div class="field">
            <div class="field-label"><span>悬停</span></div>
            <div class="seg wrap" role="group" aria-label="六模式悬停">
              <button
                v-for="item in artHoverOptions"
                :key="item.id"
                type="button"
                :class="['seg-item', { on: artHover === item.id }]"
                @click="selectArtHover(item.id)"
              >
                {{ item.label }}
              </button>
            </div>
          </div>
          <template v-if="artHover !== 'none'">
            <div class="field">
              <div class="field-label">
                <label for="art-hover-strength">悬停强度</label
                ><span class="field-val">{{ Math.round(hoverStrength * 100) }}%</span>
              </div>
              <input
                id="art-hover-strength"
                v-model.number="hoverStrength"
                class="range"
                type="range"
                min="0"
                max="1"
                step="0.01"
              />
            </div>
            <div v-if="artEffectProfile === 'expressive'" class="field">
              <div class="field-label">
                <label for="art-hover-radius">悬停范围</label
                ><span class="field-val">{{ Math.round(hoverRadius * 100) }}%</span>
              </div>
              <input
                id="art-hover-radius"
                v-model.number="hoverRadius"
                class="range"
                type="range"
                min="0.1"
                max="1"
                step="0.01"
              />
            </div>
          </template>
          <div class="field">
            <div class="field-label"><span>环境动效</span></div>
            <div class="seg wrap" role="group" aria-label="六模式微动">
              <button
                v-for="item in artMotionOptions"
                :key="item.id"
                type="button"
                :class="['seg-item', { on: artMotion === item.id }]"
                @click="selectArtMotion(item.id)"
              >
                {{ item.label }}
              </button>
            </div>
            <p v-if="artEffectProfile === 'expressive' && artMotionStyle === 'studio'" class="hint">{{ artMotionDescriptions[artMotion] }}</p>
            <template v-if="artEffectProfile === 'expressive'">
              <div class="seg" role="group" aria-label="动效风格">
                <button type="button" :class="['seg-item', { on: artMotionStyle === 'cinematic' }]" :aria-pressed="artMotionStyle === 'cinematic'" @click="selectArtMotionStyle('cinematic')">电影感</button>
                <button type="button" :class="['seg-item', { on: artMotionStyle === 'studio' }]" :aria-pressed="artMotionStyle === 'studio'" @click="selectArtMotionStyle('studio')">Studio</button>
              </div>
              <p v-if="artMotionStyle === 'cinematic'" class="hint">{{ cinematicMotionDescriptions[artMotion] }}</p>
            </template>
          </div>
          <template v-if="artMotion !== 'none' && artEffectProfile === 'expressive'">
            <div class="field">
              <div class="field-label">
                <label for="art-motion-speed">动效速度</label
                ><span class="field-val">{{ artMotionSpeed.toFixed(1) }}×</span>
              </div>
              <input
                id="art-motion-speed"
                v-model.number="artMotionSpeed"
                class="range"
                type="range"
                min="0.2"
                max="2"
                step="0.1"
              />
            </div>
            <div class="field">
              <div class="field-label">
                <label for="art-motion-strength">动效强度</label
                ><span class="field-val">{{ Math.round(artMotionStrength * 100) }}%</span>
              </div>
              <input
                id="art-motion-strength"
                v-model.number="artMotionStrength"
                class="range"
                type="range"
                min="0"
                max="1"
                step="0.01"
              />
            </div>
          </template>
          <button
            type="button"
            class="btn ghost"
            :aria-pressed="artPaused"
            @click="artPaused = !artPaused"
          >
            {{ artPaused ? '继续动效' : '暂停动效' }}
          </button>
          <p class="hint">
            暂停微动后仍可悬停探索。PNG 保存静态作品，视频保留微动，离线网页保留微动与悬停。
          </p>
        </details>
        <details v-else class="card" :class="{ muted: mode !== 'charset' }">
          <summary class="card-head">
            <h2>动态效果</h2>
            <span>＋</span>
          </summary>
          <p v-if="mode !== 'charset'" class="hint">切换到字符模式，即可添加悬停与微动效果。</p>
          <template v-else>
            <div class="field">
              <div class="field-label"><span>悬停</span></div>
              <div class="seg wrap" role="group">
                <button
                  v-for="opt in hoverOptions"
                  :key="opt.key"
                  type="button"
                  class="seg-item"
                  :class="{ on: hoverEffect === opt.key }"
                  @click="hoverEffect = opt.key"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
            <div v-if="hoverEffect !== 'none'" class="field">
              <div class="field-label">
                <span>强度</span>
                <span class="field-val">{{ Math.round(hoverStrength * 100) }}%</span>
              </div>
              <input
                v-model.number="hoverStrength"
                class="range"
                type="range"
                min="0.1"
                max="1"
                step="0.05"
              />
            </div>
            <div v-if="hoverEffect !== 'none'" class="field">
              <div class="field-label">
                <span>范围</span>
                <span class="field-val">{{ Math.round(hoverRadius * 100) }}%</span>
              </div>
              <input
                v-model.number="hoverRadius"
                class="range"
                type="range"
                min="0.1"
                max="0.55"
                step="0.02"
              />
            </div>
            <div class="field">
              <div class="field-label"><span>微动</span></div>
              <div class="seg wrap" role="group">
                <button
                  v-for="opt in motionOptions"
                  :key="opt.key"
                  type="button"
                  class="seg-item"
                  :class="{ on: ambientMotion === opt.key }"
                  @click="ambientMotion = opt.key"
                >
                  {{ opt.label }}
                </button>
              </div>
            </div>
            <p class="hint">悬停与微动可随“动态网页”导出。PNG 和文本保留静态效果。</p>
          </template>
        </details>

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

            <details v-if="editorEngine === 'legacy'" class="adv-group">
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
              <button type="button" class="btn ghost" @click="restoreDefaults">恢复默认</button>
              <button
                type="button"
                class="text-link"
                :disabled="!previewUrl && !hasVideo"
                @click="clearArtwork"
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
            <p v-if="loadingSource" class="status" role="status">
              正在读取新素材，当前作品会保留。
              <button type="button" class="text-link" @click="cancelSourceLoad">取消读取</button>
            </p>
            <p v-else-if="sourceError || error" class="status error" role="alert">
              {{ sourceError || error }}
            </p>
            <p v-else-if="meta" class="status">{{ meta }}</p>
            <p v-else class="status">上传图片或短视频后实时显示结果</p>
          </div>
          <div v-if="hasResult" class="stage-view-actions">
            <button :class="{ selected: showOriginal }" @click="showOriginal = true">原图</button
            ><button :class="{ selected: !showOriginal }" @click="showOriginal = false">效果</button
            ><button class="stage-fullscreen" @click="openFullscreen">全屏 ↗</button>
          </div>
        </header>

        <div
          v-if="hasMedia || hasResult"
          ref="previewScroll"
          class="ascii-scroll fx-scroll"
          title="Ctrl + 滚轮缩放"
          @pointermove="onCalibratedPointer"
          @pointerdown="onCalibratedPointer"
          @pointerup="onCalibratedPointerUp"
          @pointercancel="onCalibratedPointerLeave"
          @pointerleave="onCalibratedPointerLeave"
        >
          <div class="ascii-scroll-inner">
            <img
              v-if="showOriginal && !hasVideo"
              :src="previewUrl"
              class="original-overlay"
              alt="原始图片"
            />
            <div v-if="showOriginal && hasVideo" class="original-video-note">
              原始视频可在左侧素材面板查看。<button @click="showOriginal = false">返回效果</button>
            </div>
            <div
              ref="previewHost"
              class="ascii-host"
              :class="{ live: studioLiveActive, staged: stagePinned }"
              :style="previewHostStyle"
            >
              <canvas :key="editorEngine" ref="previewCanvas" class="ascii-canvas" />
            </div>
          </div>
        </div>
        <div v-else class="empty art-empty" @dragover.prevent @drop.prevent="onDrop">
          <span class="art-eyebrow">YOUR CANVAS, YOUR EXPRESSION</span
          ><ArtIcon name="upload" :size="40" />
          <h1>{{ pending ? '正在准备你的画布…' : '从一张照片开始' }}</h1>
          <p>拖入图片或短视频，让文字重新描绘它。</p>
          <button class="art-button primary" :disabled="pending" @click="fileInput?.click()">
            选择本地文件 <ArtIcon :size="17" /></button
          ><button class="empty-demo" :disabled="pending" @click="applyPreset(artworkPresets[0]!)">
            或先试试示例 →</button
          ><small>JPG / PNG / WebP / GIF · MP4 / WebM</small>
        </div>
      </section>
    </div>
    <footer class="editor-footer">
      <button :disabled="!hasResult" @click="copyAscii">
        {{ copied ? '已复制 ✓' : '复制字符文本' }}
      </button>
      <div>
        <button :disabled="!hasResult" @click="resetZoom">适应画布</button
        ><button aria-label="缩小" @click="zoomOut">−</button><span>{{ zoom }}%</span
        ><button aria-label="放大" @click="zoomIn">＋</button>
      </div>
      <span class="editor-privacy"><ArtIcon name="shield" :size="18" /> 所有处理均在本地完成</span>
    </footer>
    <ExportSheet
      v-model="exportOpen"
      :video="hasVideo"
      :phrase="mode === 'phrase'"
      :busy="downloading"
      :progress="downloadProgress"
      :error="error"
      :name="projectTitle"
      :preview="exportPreview"
      :offline-html="editorEngine === 'calibrated'"
      @export="handleExport"
    />

    <UnsavedChangesDialog
      :open="leaveDialogOpen"
      :busy="leaveBusy"
      :error="leaveError"
      :action="leaveAction"
      @cancel="finishLeave(false)"
      @discard="finishLeave(true)"
      @save="saveAndLeave"
    />
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
            <button type="button" class="btn ghost" @click="resetZoom">自适应</button>
            <button type="button" class="btn primary" @click="closeFullscreen">退出全屏</button>
          </div>
        </div>
        <div
          ref="fullscreenScroll"
          class="fs-scroll fx-scroll"
          title="Ctrl + 滚轮缩放"
          @pointermove="onCalibratedPointer"
          @pointerdown="onCalibratedPointer"
          @pointerup="onCalibratedPointerUp"
          @pointercancel="onCalibratedPointerLeave"
          @pointerleave="onCalibratedPointerLeave"
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
  background: linear-gradient(
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

.card.muted {
  opacity: 0.72;
}

.hint {
  margin: 0 0 0.55rem;
  color: var(--text-faint);
  font-size: 0.72rem;
  line-height: 1.4;
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
  /* Keep status changes from resizing and repainting the current artwork. */
  height: 3.6em;
  overflow: auto;
  overflow-wrap: anywhere;
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

.ascii-host {
  position: relative;
  display: inline-block;
  width: fit-content;
  max-width: 100%;
}

.ascii-host.staged {
  display: block;
  overflow: hidden;
  background: #0a0a0a;
  /* Beat paintAsciiToCanvas inline pixel sizes so the box matches Studio. */
}

.ascii-host.staged .ascii-canvas {
  width: 100% !important;
  height: 100% !important;
  object-fit: fill;
}

.ascii-host.live {
  display: block;
  background: #0a0a0a;
}

.ascii-host.live .ascii-canvas {
  width: 100%;
  height: 100%;
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
