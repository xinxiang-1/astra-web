<script setup lang="ts">
import { RouterLink } from 'vue-router'

import FxButton from '@/components/ui/FxButton.vue'
import { toolsCatalog } from '@/content/catalog'
</script>

<template>
  <div class="hub">
    <header class="intro">
      <p class="eyebrow">工具</p>
      <h1>本地出结果</h1>
      <p class="lead">
        图片与文件在浏览器里处理。主推字符画——做出一张愿意发出去的图。
      </p>
      <FxButton variant="primary" to="/ascii-art">开始做字符画</FxButton>
    </header>

    <ul class="list">
      <li v-for="item in toolsCatalog" :key="item.to">
        <RouterLink class="row" :to="item.to">
          <span class="name">
            {{ item.name }}
            <span v-if="item.tag" class="tag">{{ item.tag }}</span>
          </span>
          <span class="line">{{ item.line }}</span>
          <span class="go" aria-hidden="true">→</span>
        </RouterLink>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.hub {
  --display: var(--font-display);
  --body: var(--font-body);
  width: min(820px, calc(100% - 2.5rem));
  margin: 0 auto;
  padding: 2.75rem 0 4.5rem;
  font-family: var(--body);
}

.intro {
  margin-bottom: 2.25rem;
}

.eyebrow {
  margin: 0 0 0.45rem;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 0.55rem;
  font-family: var(--display);
  font-size: clamp(1.75rem, 4vw, 2.35rem);
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.lead {
  margin: 0 0 1.25rem;
  max-width: 34rem;
  color: var(--text-muted);
  font-size: 0.95rem;
  line-height: 1.6;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
}

.row {
  display: grid;
  grid-template-columns: minmax(7rem, 0.28fr) 1fr auto;
  gap: 0.85rem;
  align-items: baseline;
  padding: 1.05rem 0.15rem;
  border-bottom: 1px solid var(--border);
  text-decoration: none;
  color: inherit;
  transition:
    background 0.2s ease,
    padding-left 0.2s ease;
}

.row:hover {
  padding-left: 0.55rem;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent) 10%, transparent),
    transparent 70%
  );
}

.name {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  font-family: var(--display);
  font-size: 1.05rem;
  letter-spacing: -0.02em;
}

.tag {
  padding: 0.12rem 0.45rem;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  border-radius: var(--radius-pill);
  color: var(--accent);
  font-family: var(--body);
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.line {
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

.go {
  color: var(--accent);
  font-size: 1.05rem;
  transition: transform 0.2s ease;
}

.row:hover .go {
  transform: translateX(4px);
}

@media (max-width: 720px) {
  .row {
    grid-template-columns: 1fr auto;
    grid-template-areas:
      'name go'
      'line line';
  }

  .name {
    grid-area: name;
  }

  .line {
    grid-area: line;
  }

  .go {
    grid-area: go;
  }
}
</style>
