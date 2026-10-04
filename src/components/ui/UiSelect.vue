<script setup lang="ts" generic="T extends string | number">
const model = defineModel<T>()
</script>

<template>
  <select v-model="model" class="astra-control astra-select">
    <slot />
  </select>
</template>

<style scoped>
.astra-select {
  appearance: none;
  padding-right: 2.4rem;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m4 6 4 4 4-4' fill='none' stroke='%2368736d' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-size: 16px;
  background-position: right 0.8rem center;
}
:global([data-theme='dark']) .astra-select {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m4 6 4 4 4-4' fill='none' stroke='%23b9c4b8' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
}
option {
  color: var(--text);
  background: var(--bg-elevated);
}
@media (forced-colors: active) {
  .astra-select {
    appearance: auto;
    background-image: none;
  }
}
</style>
