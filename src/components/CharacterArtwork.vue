<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createArtRenderer, prepareArtFrame, type ArtFrame, type ArtMode, type ArtMotion, type ArtHover } from '@/lib/art-engine'
import { mountCharsetStudio, studioRasterForGrid, studioPatchFromInput, type CharsetStudioHandle } from '@/lib/ascii/studio-preview'
import { ASCII_ART_DEFAULTS } from '@/lib/ascii/constants'
const props = withDefaults(
  defineProps<{
    src: string
    color?: boolean
    phrase?: string
    compare?: boolean
    label?: string
    animated?: boolean
    interactive?: boolean
    mode?: ArtMode
    motion?: ArtMotion
    hover?: ArtHover
    columns?: number
    engine?: 'studio' | 'calibrated'
  }>(),
  { color: false, phrase: '', compare: false, label: '字符艺术作品', animated: false, interactive: false, mode: 'density', motion: 'wave', hover: 'light', columns: 180, engine: 'calibrated' },
)
const canvas = ref<HTMLCanvasElement>()
const host = ref<HTMLElement>()
const split = ref(45)
const ready = ref(false)
const failed = ref(false)
const paused = ref(false)
const live = ref(false)
let revision = 0
let frame: ArtFrame | null = null
let sourceSize = { width: 1, height: 1 }
let renderer: ReturnType<typeof createArtRenderer> | null = null
let studio: CharsetStudioHandle | null = null
let studioAbort: AbortController | null = null
let observer: IntersectionObserver | null = null
let motionPreference: MediaQueryList | null = null
let visible = true
let raf = 0
let started = 0
let last = 0
const pointer = { x: .5, y: .5, strength: 0 }
let pointerTarget = { x: .5, y: .5, strength: 0 }
function originalStudioInput(active: boolean) {
  return { charset: ASCII_ART_DEFAULTS.charset, colored: props.color, ink: ASCII_ART_DEFAULTS.foreground, backdrop: ASCII_ART_DEFAULTS.background, invert: true, exposure: ASCII_ART_DEFAULTS.exposure, contrast: ASCII_ART_DEFAULTS.contrast, normalize: ASCII_ART_DEFAULTS.normalize, ditherStrength: ASCII_ART_DEFAULTS.ditherStrength, cellSize: 6, hoverEffect: active && props.interactive ? 'trail' as const : 'none' as const, hoverStrength: .65, hoverRadius: .38, motion: active ? 'current' as const : 'none' as const, motionSpeed: .45 }
}
function draw(time = 0) {
  if (!frame || !renderer) return
  renderer.render(frame, { longEdge: 1200, time, motion: live.value ? props.motion : 'none', hover: props.hover, pointer: live.value ? pointer : undefined })
}
function animate(timestamp: number) {
  if (!live.value) return
  if (timestamp - last >= 1000 / (window.innerWidth < 700 ? 24 : 30)) {
    const follow = 1 - Math.exp(-Math.min(100, timestamp - last) / 75)
    pointer.x += (pointerTarget.x - pointer.x) * follow
    pointer.y += (pointerTarget.y - pointer.y) * follow
    pointer.strength += (pointerTarget.strength - pointer.strength) * follow
    last = timestamp
    draw((timestamp - started) / 1000)
  }
  raf = requestAnimationFrame(animate)
}
function syncMotion() {
  cancelAnimationFrame(raf)
  live.value = Boolean(ready.value && props.animated && !paused.value && visible && !document.hidden && !motionPreference?.matches)
  if (studio) {
    studio.update(studioPatchFromInput(originalStudioInput(live.value)))
    studio.pause(!live.value)
    studio.redraw()
    return
  }
  if (live.value) { started = performance.now(); raf = requestAnimationFrame(animate) }
  else draw()
}
function move(event: PointerEvent) {
  if (!props.interactive || !canvas.value || !ready.value) return
  const rect = canvas.value.getBoundingClientRect()
  const scale = Math.max(rect.width / sourceSize.width, rect.height / sourceSize.height)
  pointerTarget = { x: (event.clientX - rect.left + (sourceSize.width * scale - rect.width) / 2) / (sourceSize.width * scale), y: (event.clientY - rect.top + (sourceSize.height * scale - rect.height) / 2) / (sourceSize.height * scale), strength: 1 }
  // Preserve pointer routing when the transparent comparison control covers the canvas.
  if (event.target !== canvas.value) canvas.value.dispatchEvent(new PointerEvent('pointermove', { clientX: studio ? rect.left + pointerTarget.x * rect.width : event.clientX, clientY: studio ? rect.top + pointerTarget.y * rect.height : event.clientY }))
}
function leave() { pointerTarget.strength = 0; if (studio && canvas.value) canvas.value.dispatchEvent(new PointerEvent('pointerleave')) }
async function render() {
  const current = ++revision
  ready.value = false
  failed.value = false
  const img = new Image()
  img.src = props.src
  try {
    await img.decode()
    await document.fonts.ready
    if (current !== revision || !canvas.value) return
    sourceSize = { width: img.naturalWidth, height: img.naturalHeight }
    frame = null
    renderer?.destroy()
    renderer = null
    studioAbort?.abort(); studio?.destroy(); studio = null
    if (props.engine === 'studio') {
      studioAbort = new AbortController()
      const mounted = await mountCharsetStudio(canvas.value, props.src, originalStudioInput(!motionPreference?.matches && !paused.value), { signal: studioAbort.signal })
      if (current !== revision) { mounted.destroy(); return }
      studio = mounted
      const raster = studioRasterForGrid({ columns: props.columns, rows: 1, cssWidth: img.naturalWidth, cssHeight: img.naturalHeight })
      studio.resize(raster.width, raster.height, raster.pixelRatio)
    } else {
      frame = prepareArtFrame(img, img.naturalWidth, img.naturalHeight, { mode: props.phrase ? 'phrase' : props.mode, phrase: props.phrase || '光与影', columns: props.columns, colored: props.color })
      renderer = createArtRenderer(canvas.value)
    }
    ready.value = true
    syncMotion()
  } catch {
    if (current === revision) { failed.value = true; syncMotion() }
  }
}
onMounted(() => {
  motionPreference = matchMedia('(prefers-reduced-motion: reduce)')
  motionPreference.addEventListener('change', syncMotion)
  document.addEventListener('visibilitychange', syncMotion)
  observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; syncMotion() }, { threshold: .01 })
  if (host.value) observer.observe(host.value)
  void render()
})
watch(() => [props.src, props.color, props.phrase, props.mode, props.columns, props.engine], render)
watch(() => [props.animated, props.interactive, props.motion, props.hover, paused.value], syncMotion)
onBeforeUnmount(() => {
  revision++
  cancelAnimationFrame(raf)
  observer?.disconnect()
  motionPreference?.removeEventListener('change', syncMotion)
  document.removeEventListener('visibilitychange', syncMotion)
  renderer?.destroy()
  studioAbort?.abort(); studio?.destroy()
  frame = null
})
</script>
<template>
  <div
    ref="host"
    class="character-art"
    :class="{ ready, comparing: compare, 'live-active': live }"
    :style="{ '--split': `${split}%` }"
    @pointermove="move"
    @pointerleave="leave"
  >
    <canvas ref="canvas" class="art-live" :class="{ 'studio-canvas': engine === 'studio' }" role="img" :aria-label="label" />
    <template v-if="compare">
      <img :src="src" class="art-original" alt="原始照片" />
      <div class="compare-line"><span>‹ ›</span></div>
      <input
        v-model.number="split"
        type="range"
        min="0"
        max="100"
        aria-label="拖动对比原图与字符作品"
        class="compare-control"
      />
      <span class="compare-caption original-caption">原图</span
      ><span class="compare-caption">字符作品</span>
    </template>
    <span v-if="!ready" class="art-loading">{{
      failed ? '作品暂时无法加载' : '正在用文字描绘…'
    }}</span>
    <button v-if="animated && ready" class="motion-toggle" :aria-label="paused ? '播放字符动效' : '暂停字符动效'" :aria-pressed="paused" @click="paused = !paused">{{ paused ? '播放动效' : '暂停动效' }}</button>
  </div>
</template>
<style scoped>
.character-art {
  position: relative;
  overflow: hidden;
  background: #111615;
  width: 100%;
  height: 100%;
  min-height: 100px;
}
.character-art canvas,
.art-original {
  position: absolute;
  inset: 0;
  width: 100% !important;
  height: 100% !important;
  object-fit: cover;
  display: block;
}
.character-art canvas {
  opacity: 0;
  transition: opacity 0.6s;
}
.studio-canvas { pointer-events: none; }
.ready canvas {
  opacity: 1;
}
.art-original {
  filter: grayscale(1);
  clip-path: inset(0 calc(100% - var(--split)) 0 0);
}
.compare-line {
  position: absolute;
  left: var(--split);
  top: 0;
  bottom: 0;
  width: 1px;
  background: #eee9;
  pointer-events: none;
}
.compare-line span {
  position: absolute;
  top: 54%;
  left: -18px;
  width: 37px;
  height: 37px;
  border: 1px solid #fff8;
  background: #202625;
  color: #fff;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 20px;
}
.compare-control {
  position: absolute;
  inset: 0;
  opacity: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  cursor: ew-resize;
}
.comparing:focus-within {
  outline: 2px solid #54e8ef;
  outline-offset: -3px;
}
.compare-caption {
  position: absolute;
  bottom: 22px;
  right: 24px;
  pointer-events: none;
  color: #eee;
  font-size: 11px;
  letter-spacing: 2px;
  background: #1119;
  padding: 5px 9px;
}
.original-caption {
  right: auto;
  left: 24px;
}
.art-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #aaaa9e;
  font-size: 12px;
  letter-spacing: 2px;
  pointer-events: none;
}
.motion-toggle { position: absolute; top: 18px; right: 18px; border: 1px solid #ffffff35; border-radius: 20px; background: #111615d9; color: #eeeae2; padding: 8px 12px; font-size: 10px; cursor: pointer; z-index: 2; }
.motion-toggle:focus-visible { outline: 2px solid var(--art-cyan); outline-offset: 3px; }
</style>
