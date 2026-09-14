<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    hint?: string
    /** 基础吸积盘转速 */
    baseDiskSpeed?: number
    /** 鼠标左右带动的视角摆幅 */
    mouseYaw?: number
    /** 视角跟随平滑时间（秒，越小越跟手） */
    yawSmoothing?: number
    /** 指针左右位置对转速的影响 */
    speedFromPointerX?: number
    /** 滑动速度对转速的影响 */
    speedFromVelocity?: number
  }>(),
  {
    hint: 'move to spin',
    baseDiskSpeed: 0.75,
    mouseYaw: 0.42,
    yawSmoothing: 0.18,
    speedFromPointerX: 0.4,
    speedFromVelocity: 0.28,
  },
)

const canvasRef = ref<HTMLCanvasElement | null>(null)
const error = ref('')
const ready = ref(false)

let disposeRenderer: (() => void) | undefined

onMounted(async () => {
  if (!('gpu' in navigator) || !canvasRef.value) {
    error.value = '当前浏览器不支持 WebGPU，请使用较新的 Chrome / Edge。'
    return
  }
  try {
    const { createRenderer } = await import(
      '@/effects/optimized-black-hole/renderer'
    )
    const renderer = createRenderer({
      canvas: canvasRef.value,
      baseDiskSpeed: props.baseDiskSpeed,
      interaction: {
        mouseYaw: props.mouseYaw,
        yawSmoothing: props.yawSmoothing,
        speedFromPointerX: props.speedFromPointerX,
        speedFromVelocity: props.speedFromVelocity,
      },
    })
    disposeRenderer = () => renderer.dispose()
    await renderer.ready
    ready.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'WebGPU 初始化失败'
  }
})

onBeforeUnmount(() => {
  disposeRenderer?.()
})
</script>

<template>
  <section class="stage">
    <canvas ref="canvasRef" class="canvas" :class="{ ready }" />
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
  background: #000;
}
.canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  opacity: 0;
  transition: opacity 0.5s ease;
}
.canvas.ready {
  opacity: 1;
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
