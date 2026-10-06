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
:deep(option),
:deep(optgroup) {
  color: var(--text);
  background: var(--bg-elevated);
}
/* Keep native selection, keyboard and form behavior; newer browsers expose
   the popup itself for styling. Slotted options need :deep() in scoped CSS. */
@supports (appearance: base-select) {
  .astra-select,
  .astra-select::picker(select) {
    appearance: base-select;
  }
  .astra-select::picker-icon {
    display: none;
  }
  .astra-select::picker(select) {
    color: var(--text);
    background: var(--bg-elevated);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow);
    padding: 6px;
    margin-block: 5px;
    max-height: min(320px, 60dvh);
    overflow-y: auto;
  }
  :deep(option) {
    min-height: 42px;
    padding: 9px 12px;
    gap: 12px;
    border-radius: 4px;
    cursor: pointer;
  }
  :deep(option:checked) {
    color: var(--text);
    background: var(--bg-soft);
    font-weight: 600;
  }
  :deep(option:hover),
  :deep(option:focus) {
    color: var(--text);
    background: var(--bg-soft-hover);
  }
  :deep(option:disabled) {
    color: var(--text-faint);
    cursor: not-allowed;
  }
  :deep(option::checkmark) {
    color: var(--accent);
  }
}
@media (forced-colors: active) {
  .astra-select {
    appearance: auto;
    background-image: none;
  }
  .astra-select::picker(select) {
    appearance: auto;
  }
  :deep(option) {
    color: CanvasText;
    background: Canvas;
  }
}
</style>
