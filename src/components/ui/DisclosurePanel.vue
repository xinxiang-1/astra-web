<script setup lang="ts">
defineProps<{ title: string; description?: string; open?: boolean }>()
</script>

<template>
  <details class="ui-disclosure" :open="open">
    <summary>
      <span class="disclosure-copy"
        ><strong>{{ title }}</strong
        ><small v-if="description">{{ description }}</small></span
      >
      <span class="disclosure-chevron" aria-hidden="true">⌄</span>
    </summary>
    <div class="disclosure-body"><slot /></div>
  </details>
</template>

<style scoped>
.ui-disclosure {
  min-width: 0;
  border-top: 1px solid var(--border);
}
summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 52px;
  padding: 0.8rem 0;
  cursor: pointer;
  list-style: none;
  color: var(--text);
}
summary::-webkit-details-marker {
  display: none;
}
.disclosure-copy {
  display: grid;
  gap: 0.3rem;
}
strong {
  font-size: 0.85rem;
  font-weight: 500;
}
small {
  font-size: 0.75rem;
  color: var(--text-muted);
  line-height: 1.5;
}
.disclosure-chevron {
  color: var(--text-muted);
  font-size: 1.25rem;
  transition: transform 0.2s;
}
details[open] .disclosure-chevron {
  transform: rotate(180deg);
}
.disclosure-body {
  padding: 0 0 1rem;
}
@media (prefers-reduced-motion: reduce) {
  .disclosure-chevron {
    transition: none;
  }
}
</style>
