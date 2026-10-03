<script setup lang="ts">
import { RouterLink } from 'vue-router'
import ArtIcon from './ArtIcon.vue'
import type { CatalogItem } from '@/content/catalog'
defineProps<{ items: readonly CatalogItem[] }>()
</script>
<template>
  <ul class="catalog-list">
    <li v-for="(item, index) in items" :key="item.to">
      <RouterLink class="catalog-row" :to="item.to">
        <span class="row-index" aria-hidden="true">0{{ index + 1 }}</span>
        <span class="row-title"
          >{{ item.name }}<span v-if="item.tag" class="row-tag">{{ item.tag }}</span></span
        >
        <span class="row-line">{{ item.line }}</span>
        <span class="row-go" aria-hidden="true"><ArtIcon :size="21" /></span>
      </RouterLink>
    </li>
  </ul>
</template>
<style scoped>
.catalog-list {
  padding: 0;
  margin: 0;
  list-style: none;
  border-top: 1px solid var(--border);
}
.catalog-row {
  display: grid;
  grid-template-columns: 42px minmax(200px, 0.75fr) minmax(0, 1.5fr) 44px;
  gap: 20px;
  align-items: center;
  min-height: 108px;
  padding: 22px 12px;
  border-bottom: 1px solid var(--border);
  text-decoration: none;
  transition:
    background 0.25s,
    border-color 0.25s;
}
.row-index {
  font:
    10px Consolas,
    monospace;
  color: var(--text-faint);
}
.row-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  font: 500 24px var(--font-display);
}
.row-tag {
  color: var(--accent);
  padding: 5px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 20px;
  font: 10px var(--font-body);
}
.row-line {
  font-size: 12px;
  line-height: 1.8;
  color: var(--text-muted);
}
.row-go {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--bg-soft);
  transition:
    transform 0.25s var(--ease-out),
    background 0.25s;
}
.catalog-row:hover,
.catalog-row:focus-visible {
  background: color-mix(in srgb, var(--accent) 5%, transparent);
  border-color: var(--border-strong);
}
.catalog-row:hover .row-go {
  transform: translateX(4px);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-soft));
}
@media (max-width: 1000px) {
  .catalog-row {
    grid-template-columns: 30px minmax(170px, 0.8fr) minmax(0, 1.2fr) 40px;
    gap: 16px;
  }
}
@media (max-width: 700px) {
  .catalog-row {
    grid-template-columns: 24px minmax(0, 1fr) 40px;
    gap: 10px;
  }
  .row-title {
    grid-column: 2;
    gap: 12px;
  }
  .row-line {
    grid-column: 2;
    grid-row: 2;
  }
  .row-go {
    grid-column: 3;
    grid-row: 1 / 3;
  }
}
@media (prefers-reduced-motion: reduce) {
  .catalog-row:hover .row-go {
    transform: none;
  }
}
</style>
