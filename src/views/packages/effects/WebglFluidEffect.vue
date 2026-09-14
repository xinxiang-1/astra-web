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

let disposeRenderer: (() => void) | undefined

onMounted(async () => {
  if (!canvasRef.value) return
  try {
    const { createRenderer } = await import('@/effects/webgl-fluid/renderer')
    const bg = hexToRgb01(props.backgroundColor)
    const renderer = createRenderer({
      canvas: canvasRef.value,
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
    error.value = e instanceof Error ? e.message : 'WebGL 流体初始化失败'
  }
})

onBeforeUnmount(() => {
  disposeRenderer?.()
})
</script>

<template>
  <section
    class="stage"
    :style="{ background: normalizeHex(backgroundColor) }"
  >
    <canvas ref="canvasRef" class="canvas" />
    <p v-if="hint" class="hint">{{ hint }}</p>
    <aside v-if="error" class="error">{{ error }}</aside>
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
</style>
