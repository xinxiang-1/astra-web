<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 34 })
</script>
<template>
  <svg :width="size" :height="size" viewBox="0 0 56 56" fill="none" aria-hidden="true" class="astra-mark">
    <path class="mark-body" d="M22 8h5l21 40H37L24.5 22 12 48H1L22 8Z" fill="currentColor" />
    <path class="mark-beam" d="M17 33h15l3 6H14l3-6Z" fill="var(--logo-accent, #58e8ed)" />
    <path class="mark-star" d="m43 1 1.7 5.3L50 8l-5.3 1.7L43 15l-1.7-5.3L36 8l5.3-1.7L43 1Z" fill="var(--logo-accent, #58e8ed)" />
  </svg>
</template>
<style scoped>
.astra-mark { flex-shrink: 0; overflow: visible; }
.mark-beam, .mark-star { transform-origin: 43px 8px; transition: transform .35s ease, opacity .35s ease; }
/* Vue's :global() replaces the full selector. Keep the whole target inside it. */
:global(a:hover .astra-mark .mark-star) { transform: rotate(90deg); }
:global(a:hover .astra-mark .mark-beam) { opacity: .7; }
@media(prefers-reduced-motion: reduce) { .mark-beam, .mark-star { transition: none; } :global(a:hover .astra-mark .mark-star) { transform: none; } }
</style>
