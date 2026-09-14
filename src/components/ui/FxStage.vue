<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

withDefaults(
  defineProps<{
    /** Softer ambient for dense forms */
    intensity?: 'normal' | 'soft'
  }>(),
  {
    intensity: 'normal',
  },
)

const rootRef = ref<HTMLElement | null>(null)
let raf = 0
let targetX = 0.5
let targetY = 0.35
let currentX = 0.5
let currentY = 0.35
let reducedMotion = false

function onMove(event: PointerEvent) {
  const el = rootRef.value
  if (!el || reducedMotion) return
  const rect = el.getBoundingClientRect()
  targetX = (event.clientX - rect.left) / Math.max(rect.width, 1)
  targetY = (event.clientY - rect.top) / Math.max(rect.height, 1)
}

function tick() {
  currentX += (targetX - currentX) * 0.08
  currentY += (targetY - currentY) * 0.08
  const el = rootRef.value
  if (el) {
    el.style.setProperty('--mx', `${(currentX * 100).toFixed(2)}%`)
    el.style.setProperty('--my', `${(currentY * 100).toFixed(2)}%`)
  }
  raf = requestAnimationFrame(tick)
}

onMounted(() => {
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reducedMotion) raf = requestAnimationFrame(tick)
})

onBeforeUnmount(() => {
  if (raf) cancelAnimationFrame(raf)
})
</script>

<template>
  <div
    ref="rootRef"
    class="fx-stage"
    :class="intensity"
    @pointermove="onMove"
  >
    <div class="orb orb-a" />
    <div class="orb orb-b" />
    <div class="orb orb-c" />
    <div class="spotlight" />
    <div class="grid" />
    <div class="content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.fx-stage {
  --mx: 50%;
  --my: 35%;
  position: relative;
  isolation: isolate;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background:
    radial-gradient(circle at 18% 16%, var(--grad-hero-1), transparent 42%),
    radial-gradient(circle at 86% 10%, var(--grad-hero-2), transparent 36%),
    var(--bg);
  color: var(--text);
}

.content {
  position: relative;
  z-index: 2;
  height: 100%;
  min-height: 0;
}

.orb {
  position: absolute;
  z-index: 0;
  border-radius: 50%;
  filter: blur(48px);
  pointer-events: none;
  will-change: transform;
}

.orb-a {
  width: min(34vw, 360px);
  height: min(34vw, 360px);
  top: 6%;
  left: 4%;
  background: var(--glow-a);
  animation: drift 14s ease-in-out infinite;
}

.orb-b {
  width: min(28vw, 280px);
  height: min(28vw, 280px);
  right: 8%;
  top: 18%;
  background: var(--glow-b);
  animation: drift 18s ease-in-out infinite reverse;
}

.orb-c {
  width: min(32vw, 320px);
  height: min(32vw, 320px);
  right: 18%;
  bottom: 4%;
  background: var(--glow-c);
  animation: drift 16s ease-in-out infinite;
}

.fx-stage.soft .orb {
  opacity: 0.7;
  filter: blur(56px);
}

.spotlight {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background: radial-gradient(
    420px circle at var(--mx) var(--my),
    var(--spotlight),
    transparent 55%
  );
}

.grid {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  opacity: 0.22;
  background-image:
    linear-gradient(var(--border) 1px, transparent 1px),
    linear-gradient(90deg, var(--border) 1px, transparent 1px);
  background-size: 56px 56px;
  mask-image: radial-gradient(circle at center, black 20%, transparent 75%);
}

@keyframes drift {
  0%,
  100% {
    transform: translate3d(0, 0, 0) scale(1);
  }
  50% {
    transform: translate3d(22px, -18px, 0) scale(1.05);
  }
}

@media (prefers-reduced-motion: reduce) {
  .orb {
    animation: none;
  }
}
</style>
