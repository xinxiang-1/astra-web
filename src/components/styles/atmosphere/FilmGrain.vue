<script setup lang="ts">
/** 静态胶片颗粒：一张 SVG noise，无动画、几乎零成本。 */
withDefaults(
  defineProps<{
    opacity?: number
  }>(),
  {
    opacity: 0.045,
  },
)
</script>

<template>
  <div
    class="grain"
    :style="{ '--grain-opacity': opacity }"
    aria-hidden="true"
  />
</template>

<style scoped>
.grain {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: var(--grain-opacity, 0.045);
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E");
  background-size: 180px 180px;
}

[data-theme='light'] .grain {
  mix-blend-mode: soft-light;
  opacity: calc(var(--grain-opacity, 0.045) * 1.4);
}
</style>
