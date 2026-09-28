<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { convertSourceToAscii, convertSourceToPhraseAscii, paintAsciiToCanvas } from '@/lib/ascii'
const props = withDefaults(
  defineProps<{
    src: string
    color?: boolean
    phrase?: string
    compare?: boolean
    label?: string
  }>(),
  { color: false, phrase: '', compare: false, label: '字符艺术作品' },
)
const canvas = ref<HTMLCanvasElement>()
const split = ref(45)
const ready = ref(false)
const failed = ref(false)
let revision = 0
async function render() {
  const current = ++revision
  ready.value = false
  failed.value = false
  const img = new Image()
  img.src = props.src
  try {
    await img.decode()
    if (current !== revision || !canvas.value) return
    const frame = { source: img, width: img.naturalWidth, height: img.naturalHeight }
    const aspect = props.phrase ? 0.85 : 0.55
    const options = {
      columns: 180,
      charAspect: aspect,
      withColors: props.color,
      invert: true,
      contrast: 0.2,
      normalize: true,
      ditherStrength: 0.25,
    }
    const result = props.phrase
      ? convertSourceToPhraseAscii(frame, { ...options, phrase: props.phrase, fillAll: true })
      : convertSourceToAscii(frame, { ...options, charset: '@80GCLft1i;:,. ' })
    paintAsciiToCanvas(canvas.value, result.text, {
      fontSize: 10,
      background: '#111615',
      foreground: '#eeeae2',
      fontFamily: props.phrase ? '"Microsoft YaHei", monospace' : 'Consolas, monospace',
      metricGlyph: props.phrase ? '中' : 'M',
      charAspect: aspect,
      colors: result.colors,
      padding: 0,
    })
    ready.value = true
  } catch {
    failed.value = true
  }
}
onMounted(render)
watch(() => [props.src, props.color, props.phrase], render)
onBeforeUnmount(() => {
  revision++
})
</script>
<template>
  <div
    class="character-art"
    :class="{ ready, comparing: compare }"
    :style="{ '--split': `${split}%` }"
  >
    <canvas ref="canvas" role="img" :aria-label="label" />
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
</style>
