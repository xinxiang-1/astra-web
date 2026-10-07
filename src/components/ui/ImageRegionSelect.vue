<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import FxButton from './FxButton.vue'
import UiInput from './UiInput.vue'
import type { ImageRegion } from '@/lib/image-region'

const props = defineProps<{ src: string; disabled?: boolean }>()
const region = defineModel<ImageRegion>({ required: true })
const emit = defineEmits<{ commit: [] }>()
const stage = ref<HTMLElement>()
const naturalWidth = ref(1),
  naturalHeight = ref(1)
const previewWidth = computed(
  () => `${Math.min(1600, (300 * naturalWidth.value) / naturalHeight.value)}px`,
)
const overlay = computed(() => ({
  left: `${region.value.x * 100}%`,
  top: `${region.value.y * 100}%`,
  width: `${region.value.width * 100}%`,
  height: `${region.value.height * 100}%`,
}))
const full = () => ({ x: 0, y: 0, width: 1, height: 1 })
function reset() {
  region.value = full()
  emit('commit')
}
const clamp = (n: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n))
type Drag = {
  id: number
  x: number
  y: number
  start: ImageRegion
  mode: 'draw' | 'move' | 'nw' | 'ne' | 'sw' | 'se'
}
let drag: Drag | null = null
function point(event: PointerEvent) {
  const box = stage.value!.getBoundingClientRect()
  return {
    x: clamp((event.clientX - box.left) / box.width),
    y: clamp((event.clientY - box.top) / box.height),
  }
}
function begin(event: PointerEvent) {
  if (
    props.disabled ||
    !stage.value ||
    (event.pointerType === 'mouse' && event.button !== 0) ||
    drag
  )
    return
  event.preventDefault()
  const target = event.target as HTMLElement,
    p = point(event)
  const mode = target.dataset.corner as Drag['mode'] | undefined
  const wholeImage = region.value.width >= 0.999 && region.value.height >= 0.999
  drag = {
    id: event.pointerId,
    ...p,
    start: { ...region.value },
    mode: mode ?? (!wholeImage && target.closest('.selected') ? 'move' : 'draw'),
  }
  stage.value.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!drag || event.pointerId !== drag.id) return
  const p = point(event),
    a = drag.start
  const minimumX = Math.min(0.02, 4 / naturalWidth.value),
    minimumY = Math.min(0.02, 4 / naturalHeight.value)
  if (drag.mode === 'move') {
    region.value = {
      ...a,
      x: clamp(a.x + p.x - drag.x, 0, 1 - a.width),
      y: clamp(a.y + p.y - drag.y, 0, 1 - a.height),
    }
    return
  }
  let x0 = drag.mode === 'draw' ? Math.min(drag.x, p.x) : a.x
  let y0 = drag.mode === 'draw' ? Math.min(drag.y, p.y) : a.y
  let x1 = drag.mode === 'draw' ? Math.max(drag.x, p.x) : a.x + a.width
  let y1 = drag.mode === 'draw' ? Math.max(drag.y, p.y) : a.y + a.height
  if (drag.mode !== 'draw') {
    if (drag.mode.endsWith('w')) x0 = Math.min(a.x + p.x - drag.x, x1 - minimumX)
    if (drag.mode.endsWith('e')) x1 = Math.max(a.x + a.width + p.x - drag.x, x0 + minimumX)
    if (drag.mode.startsWith('n')) y0 = Math.min(a.y + p.y - drag.y, y1 - minimumY)
    if (drag.mode.startsWith('s')) y1 = Math.max(a.y + a.height + p.y - drag.y, y0 + minimumY)
  }
  x0 = clamp(x0, 0, 1 - minimumX)
  y0 = clamp(y0, 0, 1 - minimumY)
  x1 = Math.min(1, Math.max(x1, x0 + minimumX))
  y1 = Math.min(1, Math.max(y1, y0 + minimumY))
  region.value = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}
function finish(event: PointerEvent, cancel = false) {
  if (!drag || drag.id !== event.pointerId) return
  if (cancel) region.value = drag.start
  drag = null
  if (stage.value?.hasPointerCapture(event.pointerId))
    stage.value.releasePointerCapture(event.pointerId)
  emit('commit')
}
function keyboard(event: KeyboardEvent) {
  if (props.disabled || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
    return
  event.preventDefault()
  const d = (event.shiftKey ? 10 : 1) / 100,
    a = region.value
  region.value = {
    ...a,
    x: clamp(
      a.x + (event.key === 'ArrowLeft' ? -d : event.key === 'ArrowRight' ? d : 0),
      0,
      1 - a.width,
    ),
    y: clamp(
      a.y + (event.key === 'ArrowUp' ? -d : event.key === 'ArrowDown' ? d : 0),
      0,
      1 - a.height,
    ),
  }
  emit('commit')
}
function field(key: keyof ImageRegion, event: Event) {
  const input = event.target as HTMLInputElement,
    value = input.valueAsNumber
  if (!Number.isFinite(value)) {
    input.value = String(Math.round(region.value[key] * 10000) / 100)
    return
  }
  const a = { ...region.value },
    n = clamp(value / 100)
  if (key === 'x') a.x = clamp(n, 0, 1 - a.width)
  else if (key === 'y') a.y = clamp(n, 0, 1 - a.height)
  else if (key === 'width') a.width = clamp(n, Math.min(0.01, 4 / naturalWidth.value), 1 - a.x)
  else a.height = clamp(n, Math.min(0.01, 4 / naturalHeight.value), 1 - a.y)
  region.value = a
  input.value = String(Math.round(a[key] * 10000) / 100)
  emit('commit')
}
function loaded(event: Event) {
  const image = event.target as HTMLImageElement
  naturalWidth.value = image.naturalWidth
  naturalHeight.value = image.naturalHeight
}
watch(
  () => props.src,
  () => {
    drag = null
    naturalWidth.value = naturalHeight.value = 1
  },
)
onBeforeUnmount(() => {
  drag = null
})
</script>

<template>
  <div class="region-editor">
    <div
      ref="stage"
      class="image-stage"
      :style="{ maxWidth: previewWidth }"
      tabindex="0"
      role="group"
      aria-label="签名区域框选，拖动选择或使用下方百分比输入"
      @pointerdown="begin"
      @pointermove="move"
      @pointerup="finish($event)"
      @pointercancel="finish($event, true)"
      @lostpointercapture="finish($event, true)"
      @keydown="keyboard"
    >
      <img :src="src" alt="框选签名区域的原图" draggable="false" @load="loaded" />
      <div class="selected" :style="overlay">
        <span
          v-for="corner in ['nw', 'ne', 'sw', 'se']"
          :key="corner"
          class="corner"
          :class="corner"
          :data-corner="corner"
        />
      </div>
    </div>
    <p>框住完整名字并留少量纸边。拖动框内可移动，四角可调整；键盘方向键移动，Shift 加快。</p>
    <div class="region-fields">
      <label
        v-for="[key, label] in [
          ['x', '左侧'],
          ['y', '上侧'],
          ['width', '宽度'],
          ['height', '高度'],
        ]"
        :key="key"
        >{{ label }} %<UiInput
          type="number"
          :aria-label="`签名区域${label}百分比`"
          :model-value="Math.round(region[key as keyof ImageRegion] * 10000) / 100"
          min="0"
          max="100"
          step="0.1"
          :disabled="disabled"
          @change="field(key as keyof ImageRegion, $event)"
      /></label>
    </div>
    <FxButton type="button" :disabled="disabled" @click="reset">使用整张图片</FxButton>
  </div>
</template>

<style scoped>
.image-stage {
  width: 100%;
  position: relative;
  margin: auto;
  overflow: hidden;
  outline: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  touch-action: none;
  cursor: crosshair;
}
.image-stage:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
img {
  display: block;
  width: 100%;
  height: auto;
  user-select: none;
  pointer-events: none;
}
.selected {
  position: absolute;
  box-sizing: border-box;
  border: 2px solid #fff;
  outline: 1px solid #123f45;
  box-shadow: 0 0 0 2000px rgb(0 0 0 / 40%);
  cursor: move;
}
.corner {
  position: absolute;
  width: 16px;
  height: 16px;
  background: var(--accent);
  border: 2px solid var(--text);
  border-radius: 50%;
  box-sizing: border-box;
}
.nw {
  left: -8px;
  top: -8px;
  cursor: nwse-resize;
}
.ne {
  right: -8px;
  top: -8px;
  cursor: nesw-resize;
}
.sw {
  left: -8px;
  bottom: -8px;
  cursor: nesw-resize;
}
.se {
  right: -8px;
  bottom: -8px;
  cursor: nwse-resize;
}
p {
  color: var(--text-muted);
  font-size: 0.75rem;
  line-height: 1.6;
}
.region-fields {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 12px 0;
}
label {
  display: grid;
  gap: 6px;
  font-size: 0.75rem;
  min-width: 0;
}
@media (max-width: 600px) {
  .region-fields {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
