<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

withDefaults(
  defineProps<{
    hint?: string
  }>(),
  {
    hint: 'move to stir',
  },
)

const canvasRef = ref<HTMLCanvasElement | null>(null)
const error = ref('')

let disposeRenderer: (() => void) | undefined

onMounted(async () => {
  if (!('gpu' in navigator) || !canvasRef.value) {
    error.value = '当前浏览器不支持 WebGPU，请使用较新的 Chrome / Edge。'
    return
  }
  try {
    const { createRenderer } = (await import('@/effects/fluid/renderer')) as {
      createRenderer: (options: { canvas: HTMLCanvasElement }) => {
        ready: Promise<void>
        dispose: () => void
      }
    }
    const renderer = createRenderer({ canvas: canvasRef.value })
    disposeRenderer = () => renderer.dispose()
    await renderer.ready
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
  background: #000;
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
