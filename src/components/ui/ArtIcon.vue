<script setup lang="ts">
withDefaults(defineProps<{ name?: string; size?: number }>(), { name: 'arrow', size: 20 })
const paths: Record<string, string> = {
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5',
  download: 'M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4',
  shield: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6',
  image: 'M3 3h18v18H3ZM3 17l6-6 4 4 3-3 5 5M8 7h.01',
  sliders: 'M4 6h5m4 0h7M4 12h10m4 0h2M4 18h2m4 0h10M9 3v6m5 0v6m-8 0v6',
  search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  plus: 'M12 4v16M4 12h16',
  close: 'm5 5 14 14M5 19 19 5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  folder: 'M3 6h7l2 3h9v11H3Z',
  check: 'm4 12 5 5L20 6',
}
</script>
<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path :d="paths[name] || paths.arrow" />
  </svg>
</template>
