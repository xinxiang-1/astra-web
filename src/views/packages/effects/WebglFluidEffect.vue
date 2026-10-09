<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

import { hexToRgb01, normalizeHex } from '@/lib/color'

const props = withDefaults(
  defineProps<{
    hint?: string
    /** 背景色 CSS hex，如 #000000 */
    backgroundColor?: string
    /** hover = 移动即绘；click = 按住绘制 */
    trigger?: 'hover' | 'click'
    /** 启动时随机喷溅 */
    immediate?: boolean
    /** 定时自动喷溅 */
    auto?: boolean
    autoInterval?: number
    colorful?: boolean
    bloom?: boolean
    sunrays?: boolean
    /** 染料消散，越大散得越快 */
    densityDissipation?: number
    /** 喷溅半径 0.1–1 */
    splatRadius?: number
    /** 喷溅力度 */
    splatForce?: number
  }>(),
  {
    hint: 'move to paint',
    backgroundColor: '#000000',
    trigger: 'hover',
    immediate: true,
    auto: false,
    autoInterval: 3000,
    colorful: true,
    bloom: true,
    sunrays: true,
    densityDissipation: 1,
    splatRadius: 0.25,
    splatForce: 6000,
  },
)

const canvasRef = ref<HTMLCanvasElement | null>(null)
const error = ref('')
const loading = ref(true)
let disposed = false

let disposeRenderer: (() => void) | undefined

onMounted(async () => {
  const canvas = canvasRef.value
  if (!canvas) return
  try {
    const { createRenderer } = await import('@/effects/webgl-fluid/renderer')
    if (disposed) return
    const bg = hexToRgb01(props.backgroundColor)
    const renderer = createRenderer({
      canvas,
      options: {
        TRIGGER: props.trigger,
        IMMEDIATE: props.immediate,
        AUTO: props.auto,
        INTERVAL: props.autoInterval,
        COLORFUL: props.colorful,
        BLOOM: props.bloom,
        SUNRAYS: props.sunrays,
        DENSITY_DISSIPATION: props.densityDissipation,
        SPLAT_RADIUS: props.splatRadius,
        SPLAT_FORCE: props.splatForce,
        BACK_COLOR: bg,
      },
    })
    disposeRenderer = () => renderer.dispose()
    await renderer.ready
  } catch (e) {
    if (disposed) return
    const message = e instanceof Error ? e.message : ''
    error.value = /fetch|import|module/i.test(message)
      ? '彩烟资源加载失败，请重新加载后重试。'
      : message || '彩烟初始化失败，请重新加载后重试。'
  } finally {
    if (!disposed) loading.value = false
  }
})

onBeforeUnmount(() => {
  disposed = true
  disposeRenderer?.()
})

function reload() {
  window.location.reload()
}
</script>

<template>
  <section class="stage" :style="{ background: normalizeHex(backgroundColor) }">
    <canvas ref="canvasRef" class="canvas" />
    <p v-if="loading" class="hint" role="status">正在加载彩烟…</p>
    <p v-else-if="hint && !error" class="hint">{{ hint }}</p>
    <aside v-if="error" class="error" role="alert">
      <p>{{ error }}</p>
      <button type="button" @click="reload">重新加载彩烟</button>
    </aside>
  </section>
</template>

<style scoped>
.stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}
.hint {
  position: absolute;
  bottom: 18px;
  left: 50%;
  z-index: 2;
  margin: 0;
  transform: translateX(-50%);
  color: rgba(255, 255, 255, 0.8);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  pointer-events: none;
}
.error {
  position: absolute;
  top: 4.5rem;
  left: 1.25rem;
  max-width: 28rem;
  padding: 0.75rem 1rem;
  border-radius: 12px;
  background: rgba(40, 0, 0, 0.75);
  color: #ffb4b4;
  font-size: 0.85rem;
}
.error p {
  margin: 0 0 0.65rem;
}
.error button {
  min-height: 44px;
  padding: 0.5rem 0.9rem;
  border: 1px solid currentColor;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
</style>
