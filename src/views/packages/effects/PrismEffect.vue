<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { normalizeHex } from '@/lib/color'
import type { PrismControls, PrismRenderer } from '@/effects/prism/renderer'

const props = withDefaults(
  defineProps<{
    /** dark = 黑墙；light = 亮色主题管线 */
    mode?: 'dark' | 'light'
    quality?: 'auto' | 'high' | 'low'
    /** 墙面/背景色，CSS hex，如 #000000 / #0b1220 */
    wallColor?: string
  }>(),
  {
    mode: 'dark',
    quality: 'auto',
    wallColor: '#000000',
  },
)

const canvasRef = ref<HTMLCanvasElement | null>(null)
const error = ref('')
const ready = ref(false)

let renderer: PrismRenderer | undefined
let controls: PrismControls | undefined

onMounted(async () => {
  if (!('gpu' in navigator) || !canvasRef.value) {
    error.value = '当前浏览器不支持 WebGPU，请使用较新的 Chrome / Edge。'
    return
  }
  try {
    const [{ createRenderer }, { DEFAULT_PRISM_CONTROLS }] = await Promise.all([
      import('@/effects/prism/renderer'),
      import('@/effects/prism/types'),
    ])
    controls = {
      ...DEFAULT_PRISM_CONTROLS,
      wallColor: normalizeHex(props.wallColor),
    }
    renderer = createRenderer({
      canvas: canvasRef.value,
      initialMode: props.mode,
      initialQuality: props.quality,
      initialControls: controls,
      onError: (e) => {
        error.value = e instanceof Error ? e.message : String(e)
      },
    })
    await renderer.ready
    ready.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'WebGPU 初始化失败'
  }
})

watch(
  () => props.mode,
  async (mode) => {
    await renderer?.setMode(mode)
  },
)

watch(
  () => props.quality,
  async (quality) => {
    await renderer?.setQualityPreference(quality)
  },
)

watch(
  () => props.wallColor,
  (wallColor) => {
    if (!renderer || !controls) return
    controls = {
      ...controls,
      wallColor: normalizeHex(wallColor),
    }
    renderer.setControls(controls)
  },
)

onBeforeUnmount(() => {
  renderer?.dispose()
  renderer = undefined
})
</script>

<template>
  <section
    class="stage"
    :style="{ background: normalizeHex(wallColor) }"
  >
    <canvas ref="canvasRef" class="canvas" :class="{ ready }" />
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
  opacity: 0;
  transition: opacity 0.45s ease;
}
.canvas.ready {
  opacity: 1;
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
