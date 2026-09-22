<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import FxButton from '@/components/ui/FxButton.vue'
import {
  addStampToBank,
  addStampsToBank,
  buildPathSvgDocument,
  canvasToPngBlob,
  createGlStampPreview,
  createTextStamp,
  deleteBank,
  deleteBankEntry,
  ensureBank,
  generateHandwritingVariants,
  listBankEntries,
  listBanks,
  loadBankAsStamps,
  loadImageElement,
  paintPlacementsRegion,
  paintPlacementsTiled,
  pathSvgToBlob,
  renderSignaturePortrait,
  revokeEntryUrls,
  stampFromDrawnCanvas,
  stampFromFile,
  stampHasVector,
  traceStamps,
  triggerDownload,
  type BankEntryView,
  type GlStampPreview,
  type NameBank,
  type Placement,
  type SignatureStamp,
} from '@/lib/signature-portrait'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
const BANK_ID_KEY = 'astra-sig-bank-id'

const signatureInput = ref<HTMLInputElement | null>(null)
const portraitInput = ref<HTMLInputElement | null>(null)
const drawCanvas = ref<HTMLCanvasElement | null>(null)
const resultHost = ref<HTMLElement | null>(null)
const resultCanvas = ref<HTMLCanvasElement | null>(null)
const previewHost = ref<HTMLElement | null>(null)
const compareRoot = ref<HTMLElement | null>(null)

const stamps = ref<SignatureStamp[]>([])
const portrait = ref<HTMLImageElement | null>(null)
const portraitName = ref('')
const portraitObjectUrl = ref('')
const hasResult = ref(false)
const placementCount = ref(0)
/** Canvas2D 回退用的概览栅格 */
let lastOverview: HTMLCanvasElement | null = null
/** 矢量排版源：坐标 / 印章编号 / 大小 / 角度 … */
let lastPlacements: Placement[] = []
let layoutW = 0
let layoutH = 0
let paintSignal: { cancelled?: boolean } = { cancelled: false }
let zoomPaintTimer: ReturnType<typeof setTimeout> | null = null
let zoomPaintSeq = 0
/** 第二档：WebGL 图集实例化预览 */
let glPreview: GlStampPreview | null = null
let previewBackend: 'webgl' | 'canvas2d' = 'canvas2d'
/** 概览图最长边：仅 Canvas2D 回退路径 */
const OVERVIEW_LONG = 1280

/** 对比条位置：左侧效果 / 右侧原图，0–100 */
const comparePct = ref(52)
const stageW = ref(0)
const stageH = ref(0)
/** 相对适应宽度；最大到高清成图 1:1 */
const viewScale = ref(1)
let compareDragging = false

const error = ref('')
const pending = ref(false)
const hasInk = ref(false)
const bankSaving = ref(false)
const generatingVariants = ref(false)

const demoName = ref('心上人')
const bankGoal = ref(100)
const activeBank = ref<NameBank | null>(null)
const bankEntries = ref<BankEntryView[]>([])
const banks = ref<NameBank[]>([])

const threshold = ref(168)
const invertInk = ref(false)
const density = ref(30)
/** 成图布局/导出最长边：影响点数与 PNG；屏上预览另有轻量概览 */
const maxSide = ref(4096)
const angleRange = ref(12)
const minSizePct = ref(2.2)
const maxSizePct = ref(6.5)
const colorize = ref(true)
const coverFill = ref(true)
const fillHighlights = ref(false)
/** true = 亮处密铺（密度反向）；null = 自动 */
const invertDensity = ref<boolean | null>(true)
const allowVertical = ref(false)
/** 边缘勾勒 */
const edgeOutline = ref(true)
const edgeBoost = ref(0.95)
const edgeThreshold = ref(0.32)
const edgeColorMode = ref<'auto' | 'custom' | 'ink'>('auto')
/** 自定义边缘色 #rrggbb */
const edgeColorHex = ref('#1c4860')
const seed = ref(42)
const brushSize = ref(3.2)
const progressStage = ref('')
const progressRatio = ref(0)

const previewBg = computed(() =>
  theme.isDark ? '#12161f' : '#f3efe6',
)

const portraitSrc = computed(
  () => portraitObjectUrl.value || portrait.value?.src || '',
)

const canCompare = computed(
  () => hasResult.value && Boolean(portraitSrc.value),
)

const viewScaleLabel = computed(() => {
  if (viewScale.value <= 1.02) return '适应'
  if (layoutW > 0) {
    const one = layoutW / Math.max(1, getFitWidth(layoutW))
    if (Math.abs(viewScale.value - one) / one < 0.04) return `原大 ${Math.round(viewScale.value * 100)}%`
  }
  return `${Math.round(viewScale.value * 100)}%`
})

const lastOutputMeta = computed(() => {
  if (!hasResult.value || layoutW <= 0) return ''
  return `矢量 ${layoutW}×${layoutH} · ${placementCount.value} 笔 · ${previewBackend === 'webgl' ? 'WebGL' : 'Canvas'}`
})

const maxSideLabel = computed(() => {
  const n = maxSide.value
  if (n >= 7680) return `约 ${Math.round(n / 1024)}K`
  if (n >= 3840) return `约 ${Math.round(n / 1024)}K`
  return `${n}px`
})

const canRender = computed(
  () => Boolean(portrait.value) && stamps.value.length > 0,
)

const tracedStampCount = computed(
  () => stamps.value.filter((s) => stampHasVector(s)).length,
)

const bankProgress = computed(() => {
  const c = activeBank.value?.count ?? 0
  const g = activeBank.value?.goal ?? bankGoal.value
  return { count: c, goal: g, pct: Math.min(100, Math.round((c / Math.max(1, g)) * 100)) }
})

let drawing = false
let lastX = 0
let lastY = 0
let drawCtx: CanvasRenderingContext2D | null = null
let renderSeq = 0

async function refreshBanks() {
  banks.value = await listBanks()
}

async function openOrCreateBank(label: string) {
  const bank = await ensureBank(label.trim() || demoName.value, bankGoal.value)
  activeBank.value = bank
  localStorage.setItem(BANK_ID_KEY, bank.id)
  revokeEntryUrls(bankEntries.value)
  bankEntries.value = await listBankEntries(bank.id)
  await refreshBanks()
}

async function reloadActiveBankEntries() {
  if (!activeBank.value) return
  const fresh = await listBanks()
  activeBank.value = fresh.find((b) => b.id === activeBank.value!.id) ?? activeBank.value
  revokeEntryUrls(bankEntries.value)
  bankEntries.value = await listBankEntries(activeBank.value.id)
}

async function saveWritingToBank() {
  error.value = ''
  const canvas = drawCanvas.value
  if (!canvas || !hasInk.value) {
    error.value = '请先在手写板上写一遍名字'
    return
  }
  bankSaving.value = true
  try {
    if (!activeBank.value) {
      await openOrCreateBank(demoName.value)
    } else if (activeBank.value.label !== demoName.value.trim() && demoName.value.trim()) {
      // 改名则开新库
      await openOrCreateBank(demoName.value)
    }
    const stamp = stampFromDrawnCanvas(canvas, {
      threshold: 200,
      label: `${activeBank.value!.label} #${(activeBank.value!.count ?? 0) + 1}`,
    })
    const entry = await addStampToBank(activeBank.value!.id, stamp)
    bankEntries.value = [...bankEntries.value, entry]
    const banksNow = await listBanks()
    activeBank.value = banksNow.find((b) => b.id === activeBank.value!.id) ?? activeBank.value
    clearPad()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存到名字库失败'
  } finally {
    bankSaving.value = false
  }
}

async function useBankForPainting() {
  error.value = ''
  if (!activeBank.value) {
    error.value = '请先创建名字库并写入至少一遍'
    return
  }
  if ((activeBank.value.count ?? 0) < 1) {
    error.value = '名字库还是空的，先写几遍再作画'
    return
  }
  if (!portrait.value) {
    error.value = '请先上传画像，或点「一键试用示例」'
    portraitInput.value?.click()
    return
  }
  pending.value = true
  try {
    const loaded = await loadBankAsStamps(activeBank.value.id)
    stamps.value = loaded
    await renderNow()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载名字库失败'
  } finally {
    pending.value = false
  }
}

async function generate100Styles() {
  error.value = ''
  const name = demoName.value.trim() || '心上人'
  if (
    activeBank.value &&
    activeBank.value.count > 0 &&
    !confirm(`将清空「${activeBank.value.label}」现有 ${activeBank.value.count} 遍，再写入新生成的写法？`)
  ) {
    return
  }
  generatingVariants.value = true
  progressStage.value = '生成写法'
  progressRatio.value = 0
  try {
    if (activeBank.value && activeBank.value.count > 0) {
      await deleteBank(activeBank.value.id)
      revokeEntryUrls(bankEntries.value)
      bankEntries.value = []
      activeBank.value = null
      localStorage.removeItem(BANK_ID_KEY)
    }
    await openOrCreateBank(name)
    if (!activeBank.value) throw new Error('名字库创建失败')
    const variants = await generateHandwritingVariants(name, {
      count: bankGoal.value || 100,
      seed: seed.value,
      onProgress: (r) => {
        progressStage.value = '生成写法'
        progressRatio.value = r * 0.55
      },
    })
    progressStage.value = '写入名字库'
    const views = await addStampsToBank(activeBank.value.id, variants, (r) => {
      progressStage.value = '写入名字库'
      progressRatio.value = 0.55 + r * 0.45
    })
    bankEntries.value = views
    await reloadActiveBankEntries()
    stamps.value = variants
    progressStage.value = '完成'
    progressRatio.value = 1
    if (portrait.value) await renderNow()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '生成写法失败'
  } finally {
    generatingVariants.value = false
    progressStage.value = ''
    progressRatio.value = 0
  }
}

async function uploadPortraitThenPaint() {
  portraitInput.value?.click()
}

async function removeBankEntry(id: string) {
  try {
    await deleteBankEntry(id)
    await reloadActiveBankEntries()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '删除失败'
  }
}

async function clearActiveBank() {
  if (!activeBank.value) return
  if (!confirm(`清空「${activeBank.value.label}」名字库？共 ${activeBank.value.count} 遍`)) return
  try {
    await deleteBank(activeBank.value.id)
    revokeEntryUrls(bankEntries.value)
    bankEntries.value = []
    activeBank.value = null
    localStorage.removeItem(BANK_ID_KEY)
    await refreshBanks()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '清空失败'
  }
}

async function switchBank(bankId: string) {
  const b = banks.value.find((x) => x.id === bankId)
  if (!b) return
  activeBank.value = b
  demoName.value = b.label
  localStorage.setItem(BANK_ID_KEY, b.id)
  await reloadActiveBankEntries()
}

function revokePortraitUrl() {
  if (portraitObjectUrl.value) {
    URL.revokeObjectURL(portraitObjectUrl.value)
    portraitObjectUrl.value = ''
  }
}

function disposeGlPreview() {
  glPreview?.dispose()
  glPreview = null
}

function mountDisplayCanvas(canvas: HTMLCanvasElement) {
  const host = resultHost.value
  if (!host) return
  host.replaceChildren(canvas)
  resultCanvas.value = canvas
  canvas.classList.add('result-canvas')
}

function ensureCanvas2d(): HTMLCanvasElement {
  disposeGlPreview()
  previewBackend = 'canvas2d'
  const canvas = document.createElement('canvas')
  mountDisplayCanvas(canvas)
  return canvas
}

function ensureGlPreview(): GlStampPreview | null {
  if (glPreview) return glPreview
  // 新 canvas，避免已被 getContext('2d') 占用
  const canvas = document.createElement('canvas')
  const preview = createGlStampPreview(canvas)
  if (!preview) return null
  glPreview = preview
  previewBackend = 'webgl'
  mountDisplayCanvas(preview.canvas)
  return preview
}

function clearResultStage() {
  paintSignal.cancelled = true
  if (zoomPaintTimer) {
    clearTimeout(zoomPaintTimer)
    zoomPaintTimer = null
  }
  disposeGlPreview()
  hasResult.value = false
  placementCount.value = 0
  lastOverview = null
  lastPlacements = []
  layoutW = 0
  layoutH = 0
  stageW.value = 0
  stageH.value = 0
  previewBackend = 'canvas2d'
  const host = resultHost.value
  const preview = previewHost.value
  if (!host) return
  const w = Math.max(280, (preview?.clientWidth ?? 400) - 16)
  const h = Math.max(320, Math.round(w * 0.75))
  const canvas = ensureCanvas2d()
  canvas.width = w
  canvas.height = h
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.fillStyle = previewBg.value
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = theme.isDark ? 'rgba(220,228,255,0.45)' : 'rgba(40,48,70,0.45)'
  ctx.font = '14px system-ui,sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('生成后预览显示在这里', w / 2, h / 2)
}

function getFitWidth(nativeW: number) {
  const host = previewHost.value
  const maxW = Math.max(280, (host?.clientWidth ?? 400) - 16)
  return Math.min(maxW, nativeW)
}

function oneToOneScale(nativeW: number) {
  return Math.max(1, nativeW / Math.max(1, getFitWidth(nativeW)))
}

function maxViewScale(nativeW: number) {
  return oneToOneScale(nativeW) * 8
}

function visibleLayoutRect(): { x: number; y: number; w: number; h: number } {
  const host = previewHost.value
  const root = compareRoot.value
  if (!host || !root || layoutW <= 0) {
    return { x: 0, y: 0, w: layoutW || 1, h: layoutH || 1 }
  }
  const hostRect = host.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  if (rootRect.width <= 0 || rootRect.height <= 0) {
    return { x: 0, y: 0, w: layoutW, h: layoutH }
  }
  const visLeft = Math.max(0, hostRect.left - rootRect.left)
  const visTop = Math.max(0, hostRect.top - rootRect.top)
  const visRight = Math.min(rootRect.width, hostRect.right - rootRect.left)
  const visBottom = Math.min(rootRect.height, hostRect.bottom - rootRect.top)
  const visW = Math.max(1, visRight - visLeft)
  const visH = Math.max(1, visBottom - visTop)
  return {
    x: (visLeft / rootRect.width) * layoutW,
    y: (visTop / rootRect.height) * layoutH,
    w: (visW / rootRect.width) * layoutW,
    h: (visH / rootRect.height) * layoutH,
  }
}

function applyStageDisplaySize() {
  if (layoutW <= 0) return
  const fitW = getFitWidth(layoutW)
  const maxS = maxViewScale(layoutW)
  viewScale.value = Math.min(maxS, Math.max(1, viewScale.value))
  const cssW = Math.max(1, Math.round(fitW * viewScale.value))
  const cssH = Math.max(1, Math.round(layoutH * (cssW / layoutW)))
  stageW.value = cssW
  stageH.value = cssH

  if (glPreview && previewBackend === 'webgl') {
    const dpr = Math.min(2.5, window.devicePixelRatio || 1)
    glPreview.resize(cssW, cssH, dpr)
    // 适应视图看全图；放大后相机对准可视布局矩形
    if (viewScale.value <= 1.05) {
      glPreview.setView({ x: 0, y: 0, w: layoutW, h: layoutH })
    } else {
      glPreview.setView(visibleLayoutRect())
    }
    glPreview.redraw()
    return
  }

  const canvas = resultCanvas.value
  if (!canvas) return
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  canvas.style.imageRendering = 'auto'

  if (viewScale.value <= 1.05) {
    blitOverviewToStage()
  } else {
    scheduleSharpViewportPaint()
  }
}

function blitOverviewToStage() {
  const canvas = resultCanvas.value
  if (!canvas || !lastOverview) return
  const cssW = stageW.value
  const cssH = stageH.value
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const pw = Math.max(1, Math.round(cssW * dpr))
  const ph = Math.max(1, Math.round(cssH * dpr))
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, pw, ph)
  ctx.drawImage(lastOverview, 0, 0, pw, ph)
}

function scheduleSharpViewportPaint() {
  if (previewBackend === 'webgl') {
    applyStageDisplaySize()
    return
  }
  if (!lastPlacements.length || layoutW <= 0) return
  if (zoomPaintTimer) clearTimeout(zoomPaintTimer)
  zoomPaintTimer = setTimeout(() => {
    zoomPaintTimer = null
    void paintSharpViewport()
  }, 70)
}

async function paintSharpViewport() {
  if (previewBackend === 'webgl') {
    applyStageDisplaySize()
    return
  }
  const canvas = resultCanvas.value
  const host = previewHost.value
  const root = compareRoot.value
  if (!canvas || !host || !root || !lastPlacements.length || !portrait.value) return
  if (layoutW <= 0) return

  const seq = ++zoomPaintSeq
  const cssW = stageW.value
  const cssH = stageH.value
  const dpr = Math.min(2.5, window.devicePixelRatio || 1)
  const region = visibleLayoutRect()

  const hostRect = host.getBoundingClientRect()
  const rootRect = root.getBoundingClientRect()
  const visLeft = Math.max(0, hostRect.left - rootRect.left)
  const visTop = Math.max(0, hostRect.top - rootRect.top)
  const visRight = Math.min(rootRect.width, hostRect.right - rootRect.left)
  const visBottom = Math.min(rootRect.height, hostRect.bottom - rootRect.top)
  const visW = Math.max(1, visRight - visLeft)
  const visH = Math.max(1, visBottom - visTop)

  let outW = Math.max(1, Math.round(visW * dpr))
  let outH = Math.max(1, Math.round(visH * dpr))
  const maxPx = 2400
  const long = Math.max(outW, outH)
  if (long > maxPx) {
    const k = maxPx / long
    outW = Math.max(1, Math.round(outW * k))
    outH = Math.max(1, Math.round(outH * k))
  }

  const tile = paintPlacementsRegion(
    lastPlacements,
    stamps.value,
    region,
    outW,
    outH,
    {
      background: previewBg.value,
      colorize: colorize.value,
      coverFill: coverFill.value,
      portrait: portrait.value,
      layoutW,
      layoutH,
      underlay: coverFill.value ? 0.28 : 0.16,
      stampMaxLong: Math.min(1600, Math.max(800, Math.round(Math.max(outW, outH) * 0.65))),
    },
  )
  if (seq !== zoomPaintSeq) return

  const fw = Math.max(1, Math.round(cssW * dpr))
  const fh = Math.max(1, Math.round(cssH * dpr))
  if (canvas.width !== fw || canvas.height !== fh) {
    canvas.width = fw
    canvas.height = fh
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  if (lastOverview) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(lastOverview, 0, 0, fw, fh)
  } else {
    ctx.fillStyle = previewBg.value
    ctx.fillRect(0, 0, fw, fh)
  }
  const dx = (visLeft / Math.max(1, rootRect.width)) * fw
  const dy = (visTop / Math.max(1, rootRect.height)) * fh
  const dw = (visW / Math.max(1, rootRect.width)) * fw
  const dh = (visH / Math.max(1, rootRect.height)) * fh
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(tile, dx, dy, dw, dh)
}

function setViewScale(scale: number) {
  if (layoutW <= 0) return
  viewScale.value = scale
  applyStageDisplaySize()
}

function bumpViewScale(factor: number) {
  if (layoutW <= 0) return
  const maxS = maxViewScale(layoutW)
  viewScale.value = Math.min(maxS, Math.max(1, viewScale.value * factor))
  applyStageDisplaySize()
}

function zoomToNative() {
  if (layoutW <= 0) return
  setViewScale(oneToOneScale(layoutW))
}

function zoomToMax() {
  if (layoutW <= 0) return
  setViewScale(maxViewScale(layoutW))
}

function onStageWheel(event: WheelEvent) {
  if (!hasResult.value || layoutW <= 0) return
  event.preventDefault()
  const host = previewHost.value
  const root = compareRoot.value
  if (!host || !root) return

  const hostRect = host.getBoundingClientRect()
  const before = root.getBoundingClientRect()
  const relX = (event.clientX - before.left) / Math.max(1, before.width)
  const relY = (event.clientY - before.top) / Math.max(1, before.height)

  bumpViewScale(event.deltaY > 0 ? 0.86 : 1.16)

  requestAnimationFrame(() => {
    host.scrollLeft = Math.max(
      0,
      root.offsetLeft + relX * root.offsetWidth - (event.clientX - hostRect.left),
    )
    host.scrollTop = Math.max(
      0,
      root.offsetTop + relY * root.offsetHeight - (event.clientY - hostRect.top),
    )
    if (viewScale.value > 1.05) scheduleSharpViewportPaint()
  })
}

function setCompareFromClientX(clientX: number) {
  const root = compareRoot.value
  if (!root) return
  const rect = root.getBoundingClientRect()
  if (rect.width <= 0) return
  comparePct.value = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))
}

function onComparePointerDown(event: PointerEvent) {
  if (!canCompare.value) return
  compareDragging = true
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  setCompareFromClientX(event.clientX)
}

function onComparePointerMove(event: PointerEvent) {
  if (!compareDragging) return
  setCompareFromClientX(event.clientX)
}

function onComparePointerUp(event: PointerEvent) {
  if (!compareDragging) return
  compareDragging = false
  try {
    ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
  } catch {
    /* ignore */
  }
}

function syncDrawSurface() {
  const canvas = drawCanvas.value
  if (!canvas) return
  const parent = canvas.parentElement
  const cssW = Math.max(240, Math.floor(parent?.clientWidth ?? 420))
  const cssH = 160
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const prev = hasInk.value ? canvas.toDataURL('image/png') : ''
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  drawCtx = canvas.getContext('2d')
  if (!drawCtx) return
  drawCtx.setTransform(1, 0, 0, 1, 0, 0)
  drawCtx.fillStyle = '#ffffff'
  drawCtx.fillRect(0, 0, canvas.width, canvas.height)
  if (prev) {
    const img = new Image()
    img.onload = () => {
      drawCtx?.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    img.src = prev
  }
  drawCtx.lineCap = 'round'
  drawCtx.lineJoin = 'round'
  drawCtx.strokeStyle = '#141820'
}

function clearPad() {
  const canvas = drawCanvas.value
  if (!canvas || !drawCtx) return
  drawCtx.setTransform(1, 0, 0, 1, 0, 0)
  drawCtx.fillStyle = '#ffffff'
  drawCtx.fillRect(0, 0, canvas.width, canvas.height)
  hasInk.value = false
}

function pointerPos(event: PointerEvent) {
  const canvas = drawCanvas.value
  if (!canvas) return { x: 0, y: 0 }
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  }
}

function onPadPointerDown(event: PointerEvent) {
  const canvas = drawCanvas.value
  if (!canvas || !drawCtx) return
  event.preventDefault()
  canvas.setPointerCapture(event.pointerId)
  drawing = true
  const p = pointerPos(event)
  lastX = p.x
  lastY = p.y
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  drawCtx.beginPath()
  drawCtx.fillStyle = '#141820'
  drawCtx.arc(p.x, p.y, (brushSize.value * dpr) / 2, 0, Math.PI * 2)
  drawCtx.fill()
  hasInk.value = true
}

function onPadPointerMove(event: PointerEvent) {
  if (!drawing || !drawCtx) return
  event.preventDefault()
  const p = pointerPos(event)
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  drawCtx.strokeStyle = '#141820'
  drawCtx.lineWidth = brushSize.value * dpr
  drawCtx.lineCap = 'round'
  drawCtx.lineJoin = 'round'
  drawCtx.beginPath()
  drawCtx.moveTo(lastX, lastY)
  drawCtx.lineTo(p.x, p.y)
  drawCtx.stroke()
  lastX = p.x
  lastY = p.y
  hasInk.value = true
}

function onPadPointerUp(event: PointerEvent) {
  drawing = false
  try {
    drawCanvas.value?.releasePointerCapture(event.pointerId)
  } catch {
    /* already released */
  }
}

function commitDrawnStamp() {
  error.value = ''
  const canvas = drawCanvas.value
  if (!canvas || !hasInk.value) {
    error.value = '请先在手写板上签名'
    return
  }
  try {
    const stamp = stampFromDrawnCanvas(canvas, {
      threshold: 200,
      label: '手写签名',
    })
    stamps.value = [...stamps.value, stamp]
    clearPad()
    void maybeAutoRender()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '手写抠模失败'
  }
}

onMounted(async () => {
  await nextTick()
  syncDrawSurface()
  clearResultStage()
  window.addEventListener('resize', onWindowResize)
  previewHost.value?.addEventListener('scroll', onPreviewScroll, { passive: true })
  ;(window as unknown as { __runSignatureDemo?: () => Promise<void> }).__runSignatureDemo =
    loadDemo
  try {
    await refreshBanks()
    const savedId = localStorage.getItem(BANK_ID_KEY)
    if (savedId) {
      const found = banks.value.find((b) => b.id === savedId)
      if (found) {
        activeBank.value = found
        demoName.value = found.label
        bankEntries.value = await listBankEntries(found.id)
      }
    }
  } catch {
    /* IndexedDB 不可用时仍可手写即时作画 */
  }
})

function onPreviewScroll() {
  if (viewScale.value > 1.05) scheduleSharpViewportPaint()
}

function onWindowResize() {
  syncDrawSurface()
  if (layoutW > 0) applyStageDisplaySize()
  else clearResultStage()
}

onBeforeUnmount(() => {
  paintSignal.cancelled = true
  disposeGlPreview()
  if (zoomPaintTimer) clearTimeout(zoomPaintTimer)
  revokePortraitUrl()
  revokeEntryUrls(bankEntries.value)
  window.removeEventListener('resize', onWindowResize)
  previewHost.value?.removeEventListener('scroll', onPreviewScroll)
  delete (window as unknown as { __runSignatureDemo?: () => Promise<void> })
    .__runSignatureDemo
})

async function addSignatureFiles(files: FileList | File[] | null) {
  if (!files || files.length === 0) return
  error.value = ''
  pending.value = true
  try {
    const next: SignatureStamp[] = []
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue
      const stamp = await stampFromFile(file, {
        threshold: threshold.value,
        invert: invertInk.value,
      })
      next.push(stamp)
    }
    if (next.length === 0) {
      error.value = '请选择签名图片'
      return
    }
    stamps.value = [...stamps.value, ...next]
    void maybeAutoRender()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '签名抠模失败'
  } finally {
    pending.value = false
    if (signatureInput.value) signatureInput.value.value = ''
  }
}

function onSignatureChange(event: Event) {
  const input = event.target as HTMLInputElement
  void addSignatureFiles(input.files)
}

function addDemoStamp() {
  error.value = ''
  try {
    const stamp = createTextStamp(demoName.value)
    stamps.value = [...stamps.value, stamp]
    void maybeAutoRender()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '示意签名失败'
  }
}

function removeStamp(id: string) {
  stamps.value = stamps.value.filter((s) => s.id !== id)
  if (stamps.value.length === 0) clearResultStage()
  else void maybeAutoRender()
}

function clearStamps() {
  stamps.value = []
  clearResultStage()
}

async function loadDemo() {
  error.value = ''
  pending.value = true
  progressStage.value = '准备示例'
  progressRatio.value = 0
  try {
    demoName.value = demoName.value.trim() || '心上人'
    await openOrCreateBank(demoName.value)
    // 示例：自动生成一批写法再作画
    if (!activeBank.value || activeBank.value.count < 24) {
      progressStage.value = '生成写法'
      const variants = await generateHandwritingVariants(demoName.value, {
        count: Math.min(100, Math.max(40, bankGoal.value || 100)),
        seed: seed.value,
        onProgress: (r) => {
          progressStage.value = '生成写法'
          progressRatio.value = r * 0.5
        },
      })
      if (activeBank.value && activeBank.value.count > 0) {
        // 已有手写则追加到临时池作画，不强制覆盖库
        stamps.value = [
          ...(await loadBankAsStamps(activeBank.value.id)),
          ...variants,
        ]
      } else {
        const views = await addStampsToBank(activeBank.value!.id, variants, (r) => {
          progressStage.value = '写入名字库'
          progressRatio.value = 0.5 + r * 0.25
        })
        bankEntries.value = views
        await reloadActiveBankEntries()
        stamps.value = variants
      }
    } else {
      stamps.value = await loadBankAsStamps(activeBank.value.id)
    }

    revokePortraitUrl()
    const demoPath = `${import.meta.env.BASE_URL}demos/ascii-live/aristotle-bust.webp`
    const image = new Image()
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('示例画像加载失败'))
      image.src = demoPath
    })
    invertDensity.value = true
    portrait.value = image
    portraitName.value = '示例 · 亚里士多德胸像'
    progressStage.value = '渲染'
    progressRatio.value = 0.8
    await renderNow()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '示例加载失败'
    pending.value = false
  }
}

async function onPortraitChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.item(0)
  if (!file) return
  error.value = ''
  pending.value = true
  try {
    revokePortraitUrl()
    const { image, objectUrl } = await loadImageElement(file)
    portrait.value = image
    portraitObjectUrl.value = objectUrl
    portraitName.value = file.name
    // 已有名字库则自动载入并作画
    if (activeBank.value && activeBank.value.count > 0) {
      const loaded = await loadBankAsStamps(activeBank.value.id)
      stamps.value = loaded
      await renderNow()
    } else {
      void maybeAutoRender()
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : '画像读取失败'
    portrait.value = null
    portraitName.value = ''
    clearResultStage()
  } finally {
    pending.value = false
    if (portraitInput.value) portraitInput.value.value = ''
  }
}

async function maybeAutoRender() {
  if (!canRender.value) return
  await renderNow()
}

async function renderNow() {
  error.value = ''
  if (!portrait.value) {
    error.value = '请先上传画像照片'
    return
  }
  if (stamps.value.length === 0) {
    error.value = '请先上传签名、手写或生成示意印章'
    return
  }
  const seq = ++renderSeq
  paintSignal.cancelled = true
  paintSignal = { cancelled: false }
  const signal = paintSignal
  pending.value = true
  progressStage.value = '准备中'
  progressRatio.value = 0
  try {
    await new Promise((r) => setTimeout(r, 0))
    if (seq !== renderSeq) return

    // 1) 只算矢量排版（坐标 / 印章编号 / 大小 / 角度）
    const { placements, width, height } = await renderSignaturePortrait(
      portrait.value,
      portrait.value.naturalWidth || portrait.value.width,
      portrait.value.naturalHeight || portrait.value.height,
      stamps.value,
      {
        maxSide: Math.round(maxSide.value),
        density: density.value,
        angleRange: angleRange.value,
        allowVertical: allowVertical.value,
        minSizeRatio: minSizePct.value / 100,
        maxSizeRatio: maxSizePct.value / 100,
        fillHighlights: fillHighlights.value,
        invertDensity: invertDensity.value ?? undefined,
        colorize: colorize.value,
        overlap: 0.22,
        gamma: 1.15,
        background: previewBg.value,
        seed: seed.value,
        edgeOutline: edgeOutline.value,
        edgeBoost: edgeBoost.value,
        edgeThreshold: edgeThreshold.value,
        edgeColorMode: edgeColorMode.value,
        edgeColor: hexToRgb(edgeColorHex.value),
        skipPaint: true,
        onProgress: (stage, ratio) => {
          if (seq !== renderSeq) return
          progressStage.value = stage
          progressRatio.value = ratio * 0.55
        },
      },
      signal,
    )
    if (seq !== renderSeq || signal.cancelled) return

    lastPlacements = placements
    layoutW = width
    layoutH = height
    placementCount.value = placements.length
    hasResult.value = true
    comparePct.value = 52
    viewScale.value = 1
    await nextTick()
    stageW.value = getFitWidth(layoutW)
    stageH.value = Math.max(1, Math.round(layoutH * (stageW.value / layoutW)))

    // 2) 优先 WebGL 图集实例化；失败则回退 Canvas2D 分块概览
    progressStage.value = '准备预览'
    progressRatio.value = 0.55
    await nextTick()

    disposeGlPreview()
    const gl = ensureGlPreview()
    if (gl && portrait.value) {
      progressStage.value = 'WebGL 实例化'
      progressRatio.value = 0.7
      gl.setBackground(previewBg.value)
      gl.setColorize(colorize.value)
      gl.setPortrait(portrait.value, coverFill.value ? 0.28 : 0.16)
      gl.setStamps(stamps.value)
      gl.setPlacements(placements, layoutW, layoutH)
      if (seq !== renderSeq || signal.cancelled) return
      progressStage.value = '完成'
      progressRatio.value = 1
      applyStageDisplaySize()
    } else {
      previewBackend = 'canvas2d'
      ensureCanvas2d()
      const overviewLong = Math.min(layoutW, OVERVIEW_LONG)
      const outW = overviewLong
      const outH = Math.max(1, Math.round(layoutH * (outW / layoutW)))
      const overview = await paintPlacementsTiled(
        placements,
        stamps.value,
        layoutW,
        layoutH,
        outW,
        outH,
        {
          background: previewBg.value,
          colorize: colorize.value,
          coverFill: coverFill.value,
          portrait: portrait.value,
          underlay: coverFill.value ? 0.28 : 0.16,
          tileSize: 320,
          onTile: ({ canvas: partial, done, total }) => {
            if (seq !== renderSeq || signal.cancelled) return
            lastOverview = partial
            progressStage.value = `预览 ${done}/${total}`
            progressRatio.value = 0.55 + (done / Math.max(1, total)) * 0.45
            applyStageDisplaySize()
          },
          signal,
        },
      )
      if (seq !== renderSeq || signal.cancelled) return
      lastOverview = overview
      progressStage.value = '完成'
      progressRatio.value = 1
      applyStageDisplaySize()
    }
    previewHost.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  } catch (e) {
    if (seq !== renderSeq) return
    if (e instanceof Error && e.message === '已取消') return
    error.value = e instanceof Error ? e.message : '渲染失败'
    clearResultStage()
  } finally {
    if (seq === renderSeq) {
      pending.value = false
      if (!error.value) {
        progressStage.value = ''
        progressRatio.value = 0
      }
    }
  }
}

/** 导出矢量源（placements JSON），不含印章位图 */
function downloadVectorJson() {
  if (!lastPlacements.length || layoutW <= 0) return
  const doc = {
    version: 1,
    kind: 'astra-signature-portrait',
    width: layoutW,
    height: layoutH,
    seed: seed.value,
    density: density.value,
    maxSide: maxSide.value,
    colorize: colorize.value,
    stampCount: stamps.value.length,
    placementCount: lastPlacements.length,
    placements: lastPlacements,
  }
  const blob = new Blob([JSON.stringify(doc)], { type: 'application/json' })
  triggerDownload(blob, `signature-portrait-${layoutW}x${layoutH}.json`)
}

/** 第三档：对当前写法模板做 path trace（不 trace 整幅成图） */
async function traceStampTemplates() {
  if (stamps.value.length === 0) {
    error.value = '请先准备写法（生成/手写/上传）'
    return
  }
  error.value = ''
  pending.value = true
  progressStage.value = '矢量化写法'
  progressRatio.value = 0
  const signal = { cancelled: false }
  paintSignal.cancelled = true
  paintSignal = signal
  try {
    const traced = await traceStamps(stamps.value, {
      signal,
      onProgress: (done, total) => {
        progressStage.value = `矢量化 ${done}/${total}`
        progressRatio.value = done / Math.max(1, total)
      },
    })
    stamps.value = traced
    progressStage.value = '完成'
    progressRatio.value = 1
  } catch (e) {
    if (e instanceof Error && e.message === '已取消') return
    error.value = e instanceof Error ? e.message : '矢量化失败'
  } finally {
    pending.value = false
    progressStage.value = ''
    progressRatio.value = 0
  }
}

/** 导出 path 级 SVG（模板 path + placements transform） */
async function downloadPathSvg() {
  if (!lastPlacements.length || layoutW <= 0) return
  error.value = ''
  pending.value = true
  try {
    if (tracedStampCount.value < stamps.value.length) {
      progressStage.value = '矢量化写法'
      progressRatio.value = 0
      const traced = await traceStamps(stamps.value, {
        onProgress: (done, total) => {
          progressStage.value = `矢量化 ${done}/${total}`
          progressRatio.value = done / Math.max(1, total) * 0.55
        },
      })
      stamps.value = traced
    }
    progressStage.value = '拼 Path SVG'
    progressRatio.value = 0.7
    await new Promise((r) => setTimeout(r, 0))
    const svg = buildPathSvgDocument(
      lastPlacements,
      stamps.value,
      layoutW,
      layoutH,
      {
        background: previewBg.value,
        colorize: colorize.value,
        underlay: 0,
      },
    )
    triggerDownload(
      pathSvgToBlob(svg),
      `signature-portrait-paths-${layoutW}x${layoutH}.svg`,
    )
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Path SVG 导出失败'
  } finally {
    pending.value = false
    progressStage.value = ''
    progressRatio.value = 0
  }
}

async function downloadPng() {
  if (!lastPlacements.length || layoutW <= 0 || !portrait.value) return
  error.value = ''
  pending.value = true
  progressStage.value = '导出 PNG'
  progressRatio.value = 0
  const signal = { cancelled: false }
  try {
    const canvas = await paintPlacementsTiled(
      lastPlacements,
      stamps.value,
      layoutW,
      layoutH,
      layoutW,
      layoutH,
      {
        background: previewBg.value,
        colorize: colorize.value,
        coverFill: coverFill.value,
        portrait: portrait.value,
        underlay: coverFill.value ? 0.28 : 0.16,
        tileSize: 384,
        onTile: ({ done, total }) => {
          progressStage.value = `导出 ${done}/${total}`
          progressRatio.value = done / Math.max(1, total)
        },
        signal,
      },
    )
    const blob = await canvasToPngBlob(canvas)
    triggerDownload(blob, `signature-portrait-${layoutW}x${layoutH}.png`)
  } catch (e) {
    error.value = e instanceof Error ? e.message : '导出失败'
  } finally {
    pending.value = false
    progressStage.value = ''
    progressRatio.value = 0
  }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return { r: 28, g: 72, b: 96 }
  const n = parseInt(m[1]!, 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

function setDensityPolarity(mode: 'auto' | 'bright' | 'dark') {
  if (mode === 'auto') invertDensity.value = null
  else if (mode === 'bright') invertDensity.value = true
  else invertDensity.value = false
}

function reshuffle() {
  seed.value = (seed.value + 17) % 100000
  void renderNow()
}

watch(previewBg, () => {
  if (canRender.value && hasResult.value) void renderNow()
  else if (!hasResult.value) clearResultStage()
})
</script>

<template>
  <div class="page">
    <header class="head">
      <p class="eyebrow">实验</p>
      <h1>签名画像</h1>
      <p class="lead">
        矢量坐标为源；预览优先 WebGL。第三档可把写法 trace 成 path，再下 Path SVG。分辨率主要影响布局/导出。
      </p>
    </header>

    <div class="layout">
      <div class="controls">
        <section class="panel">
          <h2>1. 名字库（同名写很多遍）</h2>
          <p class="hint">
            推荐：填名字 →「一键生成写法」→ 上传画像。点画密度跟暗部走，脸颊会明显更疏。
          </p>

          <div class="row">
            <label class="inline">
              名字
              <input v-model="demoName" type="text" maxlength="16" />
            </label>
            <label class="inline">
              目标遍数
              <input v-model.number="bankGoal" type="number" min="10" max="200" step="10" />
            </label>
            <FxButton type="button" @click="openOrCreateBank(demoName)">
              打开 / 新建库
            </FxButton>
            <FxButton
              type="button"
              variant="primary"
              :disabled="generatingVariants || pending"
              @click="generate100Styles"
            >
              {{ generatingVariants ? '生成中…' : `一键生成 ${bankGoal} 种写法` }}
            </FxButton>
          </div>

          <p v-if="activeBank" class="bank-progress">
            「{{ activeBank.label }}」已写
            <strong>{{ bankProgress.count }}</strong>
            /
            {{ bankProgress.goal }}
            <span class="hint-inline">（建议目标，未满也可作画）</span>
            <span class="bar"><i :style="{ width: `${bankProgress.pct}%` }" /></span>
          </p>

          <div v-if="banks.length > 1" class="row">
            <label class="inline">
              切换库
              <select
                :value="activeBank?.id ?? ''"
                @change="switchBank(($event.target as HTMLSelectElement).value)"
              >
                <option disabled value="">选择…</option>
                <option v-for="b in banks" :key="b.id" :value="b.id">
                  {{ b.label }}（{{ b.count }}）
                </option>
              </select>
            </label>
          </div>

          <div class="pad-wrap">
            <canvas
              ref="drawCanvas"
              class="pad"
              @pointerdown="onPadPointerDown"
              @pointermove="onPadPointerMove"
              @pointerup="onPadPointerUp"
              @pointercancel="onPadPointerUp"
            />
            <p class="pad-tip">写一遍 → 存入名字库 → 再写一遍（鼓励大小/斜度略有变化）</p>
          </div>

          <div class="row">
            <label class="inline brush">
              笔粗 {{ brushSize.toFixed(1) }}
              <input v-model.number="brushSize" type="range" min="1.2" max="8" step="0.1" />
            </label>
            <FxButton
              type="button"
              variant="primary"
              :disabled="!hasInk || bankSaving"
              @click="saveWritingToBank"
            >
              {{ bankSaving ? '保存中…' : '存入名字库' }}
            </FxButton>
            <FxButton type="button" :disabled="!hasInk" @click="clearPad">
              清空板
            </FxButton>
          </div>

          <div class="paint-strip">
            <p class="paint-strip-title">下一步：选画像作画</p>
            <div class="row">
              <FxButton type="button" variant="primary" @click="uploadPortraitThenPaint">
                上传画像照片
              </FxButton>
              <input
                ref="portraitInput"
                class="sr-only"
                type="file"
                accept="image/*"
                @change="onPortraitChange"
              />
              <FxButton type="button" @click="loadDemo">
                一键试用示例
              </FxButton>
              <FxButton
                type="button"
                :disabled="!activeBank || bankProgress.count < 1 || pending"
                @click="useBankForPainting"
              >
                {{ portrait ? `用名字库重画（${bankProgress.count} 遍）` : `已写 ${bankProgress.count} 遍 · 先上传画像` }}
              </FxButton>
            </div>
            <p v-if="portraitName" class="meta">当前画像：{{ portraitName }}</p>
            <p v-else class="hint">还没选画像 — 点上面「上传画像照片」，或用示例胸像试效果。</p>
            <FxButton
              type="button"
              :disabled="!activeBank || bankProgress.count < 1"
              @click="clearActiveBank"
            >
              清空本库
            </FxButton>
          </div>

          <ul v-if="bankEntries.length" class="stamps bank-grid">
            <li v-for="e in bankEntries" :key="e.id">
              <img :src="e.previewUrl" :alt="`#${e.index}`" />
              <span class="stamp-label">#{{ e.index }}</span>
              <button type="button" class="linkish" @click="removeBankEntry(e.id)">
                删
              </button>
            </li>
          </ul>
          <p v-else class="empty">名字库还是空的 — 开始写第 1 遍吧</p>

          <details class="more">
            <summary>其它：临时印章 / 上传 / 示意</summary>
            <div class="row">
              <FxButton type="button" :disabled="!hasInk" @click="commitDrawnStamp">
                仅加入临时池
              </FxButton>
              <FxButton type="button" @click="signatureInput?.click()">
                上传签名
              </FxButton>
              <input
                ref="signatureInput"
                class="sr-only"
                type="file"
                accept="image/*"
                multiple
                @change="onSignatureChange"
              />
              <FxButton type="button" @click="addDemoStamp">示意印章</FxButton>
              <FxButton v-if="stamps.length" type="button" @click="clearStamps">
                清空临时池
              </FxButton>
            </div>
            <div class="sliders compact">
              <label>
                上传抠模阈值 {{ threshold }}
                <input v-model.number="threshold" type="range" min="80" max="230" />
              </label>
              <label class="check">
                <input v-model="invertInk" type="checkbox" />
                浅色字 / 深色底
              </label>
            </div>
            <ul v-if="stamps.length" class="stamps">
              <li v-for="s in stamps" :key="s.id">
                <img :src="s.previewUrl" :alt="s.label" />
                <span class="stamp-label">{{ s.label }}</span>
                <button type="button" class="linkish" @click="removeStamp(s.id)">
                  移除
                </button>
              </li>
            </ul>
          </details>
        </section>

        <section class="panel">
          <h2>2. 布局微调</h2>
          <p class="hint">
            8K 会用更小更密的字（不是同一套布局放大）。请分别生成 2K / 8K，点「原大」对比同一局部。
          </p>
          <div class="row">
            <span v-if="portraitName" class="meta">画像：{{ portraitName }}</span>
            <span v-else class="meta">尚未上传画像</span>
            <FxButton type="button" @click="uploadPortraitThenPaint">
              更换画像
            </FxButton>
            <FxButton type="button" @click="loadDemo">试用示例</FxButton>
          </div>

          <label class="ink-control">
            <span class="ink-control-head">
              <span>墨量</span>
              <strong>{{ density.toFixed(1) }}</strong>
            </span>
            <input
              v-model.number="density"
              type="range"
              min="1"
              max="50"
              step="0.5"
            />
            <span class="ink-control-meta">
              <span>疏</span>
              <span>密</span>
            </span>
          </label>

          <label class="ink-control">
            <span class="ink-control-head">
              <span>填色垫底</span>
              <strong>{{ coverFill ? '开' : '关' }}</strong>
            </span>
            <label class="check edge-toggle">
              <input v-model="coverFill" type="checkbox" />
              印章下垫软色块，补笔画空洞（默认开）
            </label>
          </label>

          <label class="ink-control">
            <span class="ink-control-head">
              <span>密度方向</span>
              <strong>
                {{
                  invertDensity === true
                    ? '亮处密'
                    : invertDensity === false
                      ? '暗处密'
                      : '自动'
                }}
              </strong>
            </span>
            <div class="edge-color-row">
              <label class="check">
                <input
                  type="radio"
                  name="densify"
                  :checked="invertDensity === null"
                  @change="setDensityPolarity('auto')"
                />
                自动
              </label>
              <label class="check">
                <input
                  type="radio"
                  name="densify"
                  :checked="invertDensity === true"
                  @change="setDensityPolarity('bright')"
                />
                亮处密（反向）
              </label>
              <label class="check">
                <input
                  type="radio"
                  name="densify"
                  :checked="invertDensity === false"
                  @change="setDensityPolarity('dark')"
                />
                暗处密
              </label>
            </div>
            <p class="hint res-hint">
              浅色雕像 / 白衣深底选「亮处密」；普通写真选「暗处密」。现在默认亮处密。
            </p>
          </label>

          <label class="ink-control">
            <span class="ink-control-head">
              <span>布局 / 导出分辨率</span>
              <strong>{{ maxSide }}px · {{ maxSideLabel }}</strong>
            </span>
            <input
              v-model.number="maxSide"
              type="range"
              min="2048"
              max="8192"
              step="256"
            />
            <span class="ink-control-meta">
              <span>更快 2K</span>
              <span>导出更清 8K</span>
            </span>
            <p class="hint res-hint">
              影响排版点数与下载 PNG/JSON 的坐标空间。屏上预览始终用轻量概览，放大时从矢量源按视口重画，不会把整张 8K 塞进页面。
            </p>
            <div class="res-presets">
              <button type="button" class="zoom-btn" @click="maxSide = 2048">2K</button>
              <button type="button" class="zoom-btn" :class="{ on: maxSide === 4096 }" @click="maxSide = 4096">4K</button>
              <button type="button" class="zoom-btn" @click="maxSide = 6144">6K</button>
              <button type="button" class="zoom-btn" @click="maxSide = 8192">8K</button>
            </div>
          </label>

          <label class="ink-control">
            <span class="ink-control-head">
              <span>边缘勾勒</span>
              <strong>{{ edgeOutline ? '开' : '关' }}</strong>
            </span>
            <label class="check edge-toggle">
              <input v-model="edgeOutline" type="checkbox" />
              沿轮廓加细密章，勾出画像边缘
            </label>
            <template v-if="edgeOutline">
              <span class="ink-control-head">
                <span>勾勒强度</span>
                <strong>{{ edgeBoost.toFixed(2) }}</strong>
              </span>
              <input
                v-model.number="edgeBoost"
                type="range"
                min="0.2"
                max="2"
                step="0.05"
              />
              <span class="ink-control-head">
                <span>边缘阈值</span>
                <strong>{{ edgeThreshold.toFixed(2) }}</strong>
              </span>
              <input
                v-model.number="edgeThreshold"
                type="range"
                min="0.12"
                max="0.7"
                step="0.02"
              />
              <span class="ink-control-head">
                <span>边缘颜色</span>
              </span>
              <div class="edge-color-row">
                <label class="check">
                  <input v-model="edgeColorMode" type="radio" value="auto" />
                  随画像加深
                </label>
                <label class="check">
                  <input v-model="edgeColorMode" type="radio" value="ink" />
                  纯墨色
                </label>
                <label class="check">
                  <input v-model="edgeColorMode" type="radio" value="custom" />
                  自定义
                </label>
                <input
                  v-model="edgeColorHex"
                  type="color"
                  class="edge-color-picker"
                  :disabled="edgeColorMode !== 'custom'"
                  title="自定义边缘色"
                />
              </div>
            </template>
          </label>

          <details class="more">
            <summary>高级参数</summary>
            <div class="sliders">
              <label>
                角度范围 ±{{ angleRange }}°
                <input v-model.number="angleRange" type="range" min="10" max="80" />
              </label>
              <label>
                最小印章 {{ minSizePct.toFixed(1) }}%
                <input v-model.number="minSizePct" type="range" min="1" max="5" step="0.1" />
              </label>
              <label>
                最大印章 {{ maxSizePct.toFixed(1) }}%
                <input v-model.number="maxSizePct" type="range" min="3" max="12" step="0.1" />
              </label>
              <label class="check">
                <input v-model="allowVertical" type="checkbox" />
                弱边缘处允许竖排
              </label>
              <label class="check">
                <input v-model="colorize" type="checkbox" />
                局部染色（更像原片）
              </label>
              <label class="check">
                <input v-model="fillHighlights" type="checkbox" />
                亮部也铺字（对比会变弱）
              </label>
            </div>
          </details>

          <div class="row">
            <FxButton
              type="button"
              variant="primary"
              :disabled="pending || !canRender"
              @click="renderNow"
            >
              {{ pending ? '生成中…' : '生成预览' }}
            </FxButton>
            <FxButton
              type="button"
              :disabled="!hasResult || pending"
              @click="reshuffle"
            >
              换一版
            </FxButton>
            <FxButton type="button" :disabled="!hasResult || pending" @click="downloadVectorJson">
              下载矢量 JSON
            </FxButton>
            <FxButton
              type="button"
              :disabled="stamps.length === 0 || pending"
              @click="traceStampTemplates"
            >
              矢量化写法
              <template v-if="tracedStampCount">
                （{{ tracedStampCount }}/{{ stamps.length }}）
              </template>
            </FxButton>
            <FxButton type="button" :disabled="!hasResult || pending" @click="downloadPathSvg">
              下载 Path SVG
            </FxButton>
            <FxButton type="button" :disabled="!hasResult || pending" @click="downloadPng">
              下载 PNG
            </FxButton>
          </div>
          <p v-if="hasResult || stamps.length" class="hint">
            JSON = 坐标源。Path SVG = 写法 trace 成真正 path 再按 placements 摆放（第三档）。PNG = 栅格导出。
          </p>
          <p v-if="error" class="error">{{ error }}</p>
          <p v-else-if="pending && progressStage" class="meta">
            {{ progressStage }} · {{ Math.round(progressRatio * 100) }}%
          </p>
          <p v-else-if="placementCount" class="meta">
            用 {{ stamps.length }} 种写法铺了 {{ placementCount }} 枚
            <template v-if="edgeOutline">
              · 边缘勾勒
              {{ edgeColorMode === 'custom' ? edgeColorHex : edgeColorMode === 'ink' ? '纯墨' : '随画像' }}
            </template>
          </p>
        </section>
      </div>

      <section class="preview panel">
        <div class="preview-head">
          <h2>预览</h2>
          <span v-if="pending" class="meta">
            {{ progressStage || '生成中' }}
            <template v-if="progressRatio">
              · {{ Math.round(progressRatio * 100) }}%
            </template>
            · 后台计算中，页面可滚动
          </span>
          <span v-else-if="canCompare" class="meta">
            滚轮放大 · {{ viewScaleLabel }}
            <template v-if="lastOutputMeta"> · {{ lastOutputMeta }}</template>
          </span>
        </div>
        <div v-if="hasResult" class="zoom-bar">
          <button
            type="button"
            class="zoom-btn"
            :class="{ on: viewScale <= 1.02 }"
            @click="setViewScale(1)"
          >
            适应
          </button>
          <button type="button" class="zoom-btn" @click="bumpViewScale(1 / 1.25)">
            −
          </button>
          <button type="button" class="zoom-btn" @click="bumpViewScale(1.25)">
            +
          </button>
          <button type="button" class="zoom-btn" @click="zoomToNative">
            原大
          </button>
          <button type="button" class="zoom-btn" @click="zoomToMax">
            最大
          </button>
        </div>
        <div
          ref="previewHost"
          class="stage"
          :style="{ background: previewBg }"
          @wheel.prevent="onStageWheel"
        >
          <div
            ref="compareRoot"
            class="compare"
            :class="{ interactive: canCompare }"
            :style="
              stageW && stageH
                ? { width: `${stageW}px`, height: `${stageH}px` }
                : undefined
            "
            @pointerdown="onComparePointerDown"
            @pointermove="onComparePointerMove"
            @pointerup="onComparePointerUp"
            @pointercancel="onComparePointerUp"
          >
            <img
              v-if="canCompare"
              class="compare-base"
              :src="portraitSrc"
              alt="原图"
              draggable="false"
            />
            <div
              class="compare-clip"
              :style="{ width: canCompare ? `${comparePct}%` : '100%' }"
            >
              <div ref="resultHost" class="result-host"><canvas ref="resultCanvas" class="result-canvas" /></div>
            </div>
            <template v-if="canCompare">
              <div
                class="compare-handle"
                :style="{ left: `${comparePct}%` }"
                aria-hidden="true"
              >
                <span class="compare-knob" />
              </div>
              <span class="compare-tag left">效果</span>
              <span class="compare-tag right">原图</span>
            </template>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.page {
  --display: var(--font-display);
  --body: var(--font-body);
  width: min(1280px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 1.25rem 0 2.5rem;
  font-family: var(--body);
  /* 顶栏下整页可滚，不用缩浏览器 */
  height: calc(100dvh - 3.4rem);
  max-height: calc(100dvh - 3.4rem);
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.head {
  margin-bottom: 1.25rem;
}

.eyebrow {
  margin: 0 0 0.35rem;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 0.4rem;
  font-family: var(--display);
  font-size: clamp(1.6rem, 3.5vw, 2.1rem);
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.lead {
  margin: 0;
  max-width: 40rem;
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.55;
}

.layout {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  gap: 1rem;
  align-items: start;
}

.controls {
  display: grid;
  gap: 1rem;
}

.preview {
  position: sticky;
  top: 0.5rem;
  max-height: calc(100dvh - 4.2rem);
  overflow: auto;
}

.preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.55rem;
}

.panel {
  padding: 1rem 1.05rem 1.15rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-elevated, var(--bg)) 88%, transparent);
}

h2 {
  margin: 0 0 0.3rem;
  font-family: var(--display);
  font-size: 1.02rem;
  letter-spacing: -0.02em;
}

.hint {
  margin: 0 0 0.75rem;
  color: var(--text-muted);
  font-size: 0.84rem;
  line-height: 1.45;
}

.pad-wrap {
  margin-bottom: 0.65rem;
}

.pad {
  display: block;
  width: 100%;
  height: 160px;
  border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--border));
  border-radius: 12px;
  background: #fff;
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}

.pad-tip {
  margin: 0.3rem 0 0;
  color: var(--text-muted);
  font-size: 0.76rem;
}

.brush {
  min-width: 8rem;
  flex: 1 1 8rem;
}

.brush input[type='range'] {
  width: 100%;
  max-width: 9rem;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: center;
  margin-bottom: 0.75rem;
}

.inline {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.84rem;
  color: var(--text-muted);
}

.inline input[type='text'] {
  width: 7rem;
  padding: 0.32rem 0.45rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
}

.ink-control {
  display: grid;
  gap: 0.35rem;
  margin: 0.15rem 0 0.85rem;
  padding: 0.7rem 0.8rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 6%, transparent);
  font-size: 0.86rem;
  color: var(--text-muted);
}

.ink-control-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.ink-control-head strong {
  font-variant-numeric: tabular-nums;
  color: var(--text);
  font-size: 1rem;
}

.ink-control input[type='range'] {
  width: 100%;
  accent-color: var(--accent);
}

.ink-control-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.72rem;
  opacity: 0.75;
}

.res-hint {
  margin: 0.35rem 0 0;
  line-height: 1.45;
}

.edge-toggle {
  margin: 0.25rem 0 0.5rem;
}

.edge-color-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem 0.85rem;
  margin-top: 0.35rem;
}

.edge-color-picker {
  width: 2rem;
  height: 1.6rem;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--fg, #222) 18%, transparent);
  border-radius: 0.25rem;
  background: transparent;
  cursor: pointer;
}

.edge-color-picker:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.res-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.15rem;
}

.sliders {
  display: grid;
  gap: 0.5rem;
  margin-bottom: 0.65rem;
}

.sliders.compact {
  margin-bottom: 0.5rem;
}

.sliders label {
  display: grid;
  gap: 0.15rem;
  font-size: 0.8rem;
  color: var(--text-muted);
}

.sliders input[type='range'] {
  width: 100%;
}

.check {
  display: flex !important;
  align-items: center;
  gap: 0.4rem;
  grid-template-columns: none !important;
}

.meta,
.empty {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8rem;
}

.error {
  margin: 0.3rem 0 0;
  color: #c44;
  font-size: 0.86rem;
}

.stamps {
  list-style: none;
  margin: 0.6rem 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
  gap: 0.5rem;
}

.stamps li {
  display: grid;
  gap: 0.2rem;
  justify-items: center;
  padding: 0.4rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background-color: #fff;
  background-image:
    linear-gradient(45deg, #ddd 25%, transparent 25%),
    linear-gradient(-45deg, #ddd 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #ddd 75%),
    linear-gradient(-45deg, transparent 75%, #ddd 75%);
  background-size: 10px 10px;
  background-position: 0 0, 0 5px, 5px -5px, -5px 0;
}

.stamps img {
  max-width: 100%;
  max-height: 3rem;
  object-fit: contain;
}

.stamp-label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.7rem;
  color: #333;
}

.linkish {
  border: 0;
  background: none;
  color: var(--accent);
  font-size: 0.72rem;
  cursor: pointer;
  padding: 0;
}

.stage {
  min-height: 360px;
  max-height: min(70vh, 820px);
  display: grid;
  place-items: start center;
  border-radius: 12px;
  overflow: auto;
  border: 1px solid var(--border);
  padding: 0.5rem;
}

.zoom-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0 0 0.55rem;
}

.zoom-btn {
  appearance: none;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.74rem;
  padding: 0.22rem 0.65rem;
  cursor: pointer;
}

.zoom-btn.on {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--text);
  font-weight: 600;
}

.compare {
  position: relative;
  max-width: none;
  line-height: 0;
  overflow: hidden;
  border-radius: 8px;
  touch-action: none;
  user-select: none;
}

.compare.interactive {
  cursor: ew-resize;
}

.compare-base {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}

.compare-clip {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  overflow: hidden;
  pointer-events: none;
}

.result-host {
  display: block;
  width: 100%;
  height: 100%;
}

.result-canvas {
  display: block;
  max-width: none;
  image-rendering: auto;
}

.compare-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  margin-left: -1px;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
  pointer-events: none;
  z-index: 2;
}

.compare-knob {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 1.65rem;
  height: 1.65rem;
  margin: -0.825rem 0 0 -0.825rem;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.95);
  background: color-mix(in srgb, var(--accent, #3d8b8b) 85%, #111);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

.compare-knob::before,
.compare-knob::after {
  content: '';
  position: absolute;
  top: 50%;
  width: 0;
  height: 0;
  border-style: solid;
  transform: translateY(-50%);
}

.compare-knob::before {
  left: 0.28rem;
  border-width: 4px 5px 4px 0;
  border-color: transparent rgba(255, 255, 255, 0.9) transparent transparent;
}

.compare-knob::after {
  right: 0.28rem;
  border-width: 4px 0 4px 5px;
  border-color: transparent transparent transparent rgba(255, 255, 255, 0.9);
}

.compare-tag {
  position: absolute;
  top: 0.55rem;
  z-index: 3;
  padding: 0.18rem 0.45rem;
  border-radius: 999px;
  background: rgba(12, 14, 20, 0.55);
  color: #f4f6fb;
  font-size: 0.68rem;
  letter-spacing: 0.04em;
  pointer-events: none;
  line-height: 1.2;
}

.compare-tag.left {
  left: 0.55rem;
}

.compare-tag.right {
  right: 0.55rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.bank-progress {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.45rem 0.65rem;
  margin: 0.35rem 0 0.75rem;
  font-size: 0.88rem;
  color: var(--text-muted);
}

.bank-progress .hint-inline {
  font-size: 0.78rem;
  opacity: 0.85;
}

.paint-strip {
  margin: 0.85rem 0 1rem;
  padding: 0.85rem 0.9rem;
  border-radius: 0.65rem;
  border: 1px solid color-mix(in srgb, var(--accent, #3d8b8b) 35%, transparent);
  background: color-mix(in srgb, var(--accent, #3d8b8b) 8%, transparent);
}

.paint-strip-title {
  margin: 0 0 0.55rem;
  font-weight: 600;
  font-size: 0.92rem;
}

.paint-strip .hint {
  margin: 0.35rem 0 0.55rem;
}

.bank-progress .bar {
  flex: 1 1 8rem;
  height: 0.35rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 12%, transparent);
  overflow: hidden;
}

.bank-progress .bar i {
  display: block;
  height: 100%;
  background: var(--accent, #3d8b8b);
}

.bank-grid {
  max-height: 11rem;
  overflow: auto;
}

.more {
  margin-top: 0.85rem;
  padding-top: 0.65rem;
  border-top: 1px solid color-mix(in srgb, var(--text) 10%, transparent);
}

.more summary {
  cursor: pointer;
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-bottom: 0.5rem;
}

.inline select,
.inline input[type='number'] {
  max-width: 7rem;
}

@media (max-width: 960px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .preview {
    position: static;
    order: -1;
    max-height: none;
    overflow: visible;
  }

  .stage {
    min-height: 260px;
  }
}
</style>
