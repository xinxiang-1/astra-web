<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import FxButton from '@/components/ui/FxButton.vue'
import { studioCatalog, toolsCatalog } from '@/content/catalog'
import { PrismEffect } from '@/views/packages/effects'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()

const prismMode = computed(() => (theme.isDark ? 'dark' : 'light'))
const wallColor = computed(() => (theme.isDark ? '#05070e' : '#dfe6f4'))

const revealRef = ref<HTMLElement | null>(null)
const revealed = ref(false)
let observer: IntersectionObserver | undefined

onMounted(() => {
  if (!revealRef.value) return
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        revealed.value = true
        observer?.disconnect()
      }
    },
    { threshold: 0.15 },
  )
  observer.observe(revealRef.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
})
</script>

<template>
  <div class="landing">
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
        <p class="brand">Astra</p>
        <h1>本地出片，网页会动</h1>
        <p class="support">
          主推字符画——图片本地变成可晒的铺字作品；工作室里是可嵌入网页的实时特效。
        </p>
        <div class="cta">
          <FxButton variant="primary" to="/ascii-art">做一张字符画</FxButton>
          <FxButton variant="ghost" to="/studio">逛工作室</FxButton>
        </div>
      </div>
    </section>

    <div
      ref="revealRef"
      class="below"
      :class="{ in: revealed }"
    >
      <section class="block">
        <div class="block-head">
          <h2>工具</h2>
          <p>带走结果。纯前端，默认不上传。</p>
          <RouterLink class="all" to="/tools">全部工具 →</RouterLink>
        </div>
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
      </section>

      <section class="block">
        <div class="block-head">
          <h2>工作室</h2>
          <p>品牌首屏与定制样板。先看 Prism。</p>
          <RouterLink class="all" to="/studio">进入工作室 →</RouterLink>
        </div>
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
  </div>
</template>

<style scoped>
.landing {
  --display: var(--font-display);
  --body: var(--font-body);
  min-height: 100%;
  font-family: var(--body);
  background: var(--bg);
  color: var(--text);
}

.hero {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  align-items: center;
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
      rgba(4, 6, 12, 0.28) 0%,
      rgba(4, 6, 12, 0.22) 45%,
      rgba(4, 6, 12, 0.55) 100%
    ),
    linear-gradient(115deg, rgba(8, 12, 28, 0.35), transparent 55%);
}

.hero-copy {
  position: relative;
  z-index: 2;
  width: min(640px, calc(100% - 2.5rem));
  margin: 0 auto;
  padding: 4rem 0.25rem 1.75rem;
  transform: translateY(-3vh);
  animation: rise 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.brand {
  margin: 0 0 0.55rem;
  font-family: var(--display);
  font-size: clamp(2.35rem, 7vw, 4rem);
  font-weight: 700;
  letter-spacing: -0.04em;
  line-height: 0.95;
}

h1 {
  margin: 0 0 0.6rem;
  max-width: 16ch;
  font-family: var(--display);
  font-size: clamp(1.1rem, 2.4vw, 1.45rem);
  font-weight: 500;
  letter-spacing: -0.025em;
  line-height: 1.25;
  color: rgba(238, 242, 255, 0.9);
}

.support {
  margin: 0 0 1.15rem;
  max-width: 30rem;
  color: rgba(238, 242, 255, 0.64);
  font-size: 0.92rem;
  line-height: 1.55;
}

.cta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.cta :deep(.fx-btn) {
  min-height: 2.35rem;
  font-size: 0.875rem;
  color: #eef2ff;
  border-color: rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.06);
}

.cta :deep(.fx-btn.primary) {
  color: #061018;
  border-color: transparent;
  background: linear-gradient(120deg, #5b7cff, #2fbfa8);
}

.cta :deep(.fx-btn.ghost:hover),
.cta :deep(.fx-btn.soft:hover) {
  background: rgba(255, 255, 255, 0.12);
}

.below {
  width: min(820px, calc(100% - 2.5rem));
  margin: 0 auto;
  padding: 0 0 3.5rem;
}

.block {
  padding: 3.5rem 0 0.5rem;
}

.block-head {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'title all'
    'lead lead';
  gap: 0.35rem 1rem;
  margin-bottom: 1.25rem;
  align-items: baseline;
}

.block-head h2 {
  grid-area: title;
  margin: 0;
  font-family: var(--display);
  font-size: clamp(1.4rem, 3.2vw, 1.95rem);
  letter-spacing: -0.03em;
  line-height: 1.15;
}

.block-head p {
  grid-area: lead;
  margin: 0;
  max-width: 34rem;
  color: var(--text-muted);
  font-size: 0.95rem;
  line-height: 1.55;
}

.all {
  grid-area: all;
  color: var(--accent);
  font-size: 0.86rem;
  text-decoration: none;
  transition: opacity 0.15s ease;
}

.all:hover {
  opacity: 0.8;
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

.below.in .row {
  animation: rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.below.in .block:nth-child(1) .row:nth-child(1) {
  animation-delay: 0.04s;
}
.below.in .block:nth-child(1) .row:nth-child(2) {
  animation-delay: 0.1s;
}
.below.in .block:nth-child(2) .row:nth-child(1) {
  animation-delay: 0.14s;
}
.below.in .block:nth-child(2) .row:nth-child(2) {
  animation-delay: 0.2s;
}
.below.in .block:nth-child(2) .row:nth-child(3) {
  animation-delay: 0.26s;
}
.below.in .block:nth-child(2) .row:nth-child(4) {
  animation-delay: 0.32s;
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
  font-size: 1.05rem;
  transition: transform 0.2s ease;
}

.row:hover .go {
  transform: translateX(4px);
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translate3d(0, 22px, 0);
  }
  to {
    opacity: 1;
    transform: translate3d(0, 0, 0);
  }
}

@media (max-width: 720px) {
  .hero-copy {
    transform: translateY(-2vh);
    padding-top: 4rem;
  }

  .block-head {
    grid-template-columns: 1fr;
    grid-template-areas:
      'title'
      'lead'
      'all';
  }

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
  .hero-copy,
  .below.in .row {
    animation: none;
  }
}
</style>
