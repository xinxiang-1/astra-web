<script setup lang="ts">
import AstraMark from './AstraMark.vue'
withDefaults(defineProps<{ height?: number }>(), { height: 34 })
</script>

<template>
  <svg :width="height * 280 / 64" :height="height" viewBox="0 0 280 64" fill="none" aria-hidden="true" class="astra-logo">
    <AstraMark :size="56" x="5" y="4" />
    <g stroke="currentColor" stroke-width="3.5" stroke-linecap="square" stroke-linejoin="miter">
      <path d="m78 47 13-30 13 30m-21-10h16" />
      <path d="M140 20c-5-4-22-5-22 4 0 10 23 6 23 16 0 10-20 10-25 4" />
      <path d="M153 18h28m-14 0v29" />
      <path d="M195 47V18h13c16 0 16 16 0 16h-13m14 0 12 13" />
      <path d="m235 47 13-30 13 30m-21-10h16" />
    </g>
  </svg>
</template>

<style scoped>
.astra-logo { display: block; flex-shrink: 0; overflow: visible; }
</style>
