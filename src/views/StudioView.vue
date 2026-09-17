<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

import FxButton from '@/components/ui/FxButton.vue'
import { PrismEffect } from '@/views/packages/effects'
import { studioCatalog } from '@/content/catalog'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
const prismMode = computed(() => (theme.isDark ? 'dark' : 'light'))
const wallColor = computed(() => (theme.isDark ? '#05070e' : '#dfe6f4'))
</script>

<template>
  <div class="studio">
    <section class="hero">
      <div class="hero-fx" aria-hidden="true">
        <PrismEffect
          :mode="prismMode"
          :wall-color="wallColor"
          quality="auto"
        />
      </div>
      <div class="hero-veil" />
      <div class="hero-copy">
        <p class="eyebrow">工作室</p>
        <h1>实时视觉，可铺进网页</h1>
        <p class="lead">
          WebGPU / WebGL 特效做成可复用组件。适合品牌首屏与定制落地页——先看
          Prism。
        </p>
        <FxButton variant="primary" to="/prism">打开 Prism</FxButton>
      </div>
    </section>

    <section class="catalog">
      <h2>全部特效</h2>
      <p class="section-lead">展示与接单样板，不是订阅产品。</p>
      <ul class="list">
        <li v-for="item in studioCatalog" :key="item.to">
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
    </section>
  </div>
</template>

<style scoped>
.studio {
  --display: var(--font-display);
  --body: var(--font-body);
  font-family: var(--body);
  background: var(--bg);
  color: var(--text);
}

.hero {
  position: relative;
  min-height: 72vh;
  min-height: 72dvh;
  display: grid;
  align-items: end;
  overflow: hidden;
  color: #eef2ff;
}

.hero-fx {
  position: absolute;
  inset: 0;
}

.hero-veil {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  background:
    linear-gradient(
      to bottom,
      rgba(4, 6, 12, 0.2) 0%,
      rgba(4, 6, 12, 0.35) 50%,
      rgba(4, 6, 12, 0.82) 100%
    );
}

.hero-copy {
  position: relative;
  z-index: 2;
  width: min(640px, calc(100% - 2.5rem));
  margin: 0 auto;
  padding: 5rem 0.25rem 2.5rem;
  animation: rise 0.85s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.eyebrow {
  margin: 0 0 0.45rem;
  color: rgba(126, 220, 200, 0.9);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 0.55rem;
  max-width: 14ch;
  font-family: var(--display);
  font-size: clamp(1.65rem, 4.2vw, 2.4rem);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.1;
}

.lead {
  margin: 0 0 1.15rem;
  max-width: 30rem;
  color: rgba(238, 242, 255, 0.64);
  font-size: 0.92rem;
  line-height: 1.55;
}

.hero-copy :deep(.fx-btn.primary) {
  color: #061018;
  border-color: transparent;
  background: linear-gradient(120deg, #5b7cff, #2fbfa8);
}

.catalog {
  width: min(820px, calc(100% - 2.5rem));
  margin: 0 auto;
  padding: 3.25rem 0 4.5rem;
}

h2 {
  margin: 0 0 0.45rem;
  font-family: var(--display);
  font-size: clamp(1.35rem, 3vw, 1.75rem);
  letter-spacing: -0.03em;
}

.section-lead {
  margin: 0 0 1.35rem;
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.55;
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
}

.row {
  display: grid;
  grid-template-columns: minmax(6.5rem, 0.26fr) 1fr auto;
  gap: 0.85rem;
  align-items: baseline;
  padding: 1rem 0.15rem;
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
}

.go {
  color: var(--accent);
  transition: transform 0.2s ease;
}

.row:hover .go {
  transform: translateX(4px);
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translate3d(0, 18px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
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

@media (prefers-reduced-motion: reduce) {
  .hero-copy {
    animation: none;
  }
}
</style>
