<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import FxButton from '@/components/ui/FxButton.vue'
import { PrismEffect } from '@/views/packages/effects'
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()

const prismMode = computed(() => (theme.isDark ? 'dark' : 'light'))
const wallColor = computed(() => (theme.isDark ? '#05070e' : '#dfe6f4'))

const suite = [
  {
    to: '/prism',
    name: 'Prism',
    line: '色散与折射的官方级 WebGPU 背景',
  },
  {
    to: '/black-hole',
    name: 'Black Hole',
    line: '可交互吸积盘与引力透镜视场',
  },
  {
    to: '/fluid',
    name: 'Fluid',
    line: '指针搅动的实时流体场',
  },
  {
    to: '/webgl-fluid',
    name: 'Smoke',
    line: '轻量彩烟，鼠标即绘',
  },
] as const

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
    { threshold: 0.2 },
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
        <h1>实时视觉，装进网页</h1>
        <p class="support">
          把可交互的 WebGPU / WebGL 特效做成组件，直接铺在品牌与产品页面上。
        </p>
        <div class="cta">
          <FxButton variant="primary" to="/prism">进入特效</FxButton>
          <FxButton variant="ghost" to="/login">登录</FxButton>
        </div>
      </div>
    </section>

    <section
      ref="revealRef"
      class="suite"
      :class="{ in: revealed }"
    >
      <h2>四条可复用视觉线</h2>
      <p class="suite-lead">
        同一套 Astra 语言：暗亮主题、轻交互壳、重渲染按路由加载。
      </p>
      <ul class="suite-list">
        <li v-for="item in suite" :key="item.to">
          <RouterLink class="suite-link" :to="item.to">
            <span class="name">{{ item.name }}</span>
            <span class="line">{{ item.line }}</span>
            <span class="go" aria-hidden="true">→</span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <section class="invite">
      <h2>从登录开始</h2>
      <p>前端账户壳已就绪，风格与特效层分离，方便后续接真实接口。</p>
      <FxButton variant="primary" to="/register">创建账户</FxButton>
    </section>
  </div>
</template>

<style scoped>
.landing {
  --display: 'Syne', 'Segoe UI', sans-serif;
  --body: 'DM Sans', 'Segoe UI', sans-serif;
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
      to top,
      rgba(4, 6, 12, 0.82) 0%,
      rgba(4, 6, 12, 0.35) 42%,
      rgba(4, 6, 12, 0.2) 100%
    ),
    linear-gradient(
      115deg,
      rgba(8, 12, 28, 0.35),
      transparent 55%
    );
}

.hero-copy {
  position: relative;
  z-index: 2;
  width: min(760px, calc(100% - 2.5rem));
  margin: 0 auto 12vh;
  padding: 0 0.25rem;
  animation: rise 0.9s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.brand {
  margin: 0 0 0.85rem;
  font-family: var(--display);
  font-size: clamp(3.4rem, 10vw, 6.4rem);
  font-weight: 750;
  letter-spacing: -0.045em;
  line-height: 0.92;
  text-transform: none;
}

h1 {
  margin: 0 0 0.85rem;
  max-width: 14ch;
  font-family: var(--display);
  font-size: clamp(1.45rem, 3.2vw, 2.15rem);
  font-weight: 560;
  letter-spacing: -0.03em;
  line-height: 1.15;
  color: rgba(238, 242, 255, 0.92);
}

.support {
  margin: 0 0 1.5rem;
  max-width: 34rem;
  color: rgba(238, 242, 255, 0.68);
  font-size: 1.05rem;
  line-height: 1.6;
}

.cta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

.cta :deep(.fx-btn) {
  color: #eef2ff;
  border-color: rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.06);
}

.cta :deep(.fx-btn.primary) {
  color: #081018;
  border-color: transparent;
  background: linear-gradient(120deg, #6f8cff, #9b7bff);
}

.cta :deep(.fx-btn.ghost:hover),
.cta :deep(.fx-btn.soft:hover) {
  background: rgba(255, 255, 255, 0.12);
}

.suite,
.invite {
  width: min(920px, calc(100% - 2.5rem));
  margin: 0 auto;
  padding: 5.5rem 0 2rem;
}

.suite h2,
.invite h2 {
  margin: 0 0 0.7rem;
  font-family: var(--display);
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  letter-spacing: -0.035em;
  line-height: 1.1;
}

.suite-lead,
.invite p {
  margin: 0 0 2rem;
  max-width: 36rem;
  color: var(--text-muted);
  font-size: 1.05rem;
  line-height: 1.65;
}

.suite-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid var(--border);
}

.suite-link {
  display: grid;
  grid-template-columns: minmax(7rem, 0.28fr) 1fr auto;
  gap: 1rem;
  align-items: baseline;
  padding: 1.25rem 0.15rem;
  border-bottom: 1px solid var(--border);
  text-decoration: none;
  color: inherit;
  transition:
    background 0.2s ease,
    padding-left 0.2s ease;
}

.suite.in .suite-link {
  animation: rise 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.suite.in .suite-link:nth-child(1) {
  animation-delay: 0.05s;
}
.suite.in .suite-link:nth-child(2) {
  animation-delay: 0.12s;
}
.suite.in .suite-link:nth-child(3) {
  animation-delay: 0.19s;
}
.suite.in .suite-link:nth-child(4) {
  animation-delay: 0.26s;
}

.suite-link:hover {
  padding-left: 0.55rem;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--accent) 10%, transparent),
    transparent 70%
  );
}

.name {
  font-family: var(--display);
  font-size: 1.2rem;
  letter-spacing: -0.02em;
}

.line {
  color: var(--text-muted);
  font-size: 0.98rem;
}

.go {
  color: var(--accent);
  font-size: 1.2rem;
  transition: transform 0.2s ease;
}

.suite-link:hover .go {
  transform: translateX(4px);
}

.invite {
  padding-bottom: 6rem;
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
    margin-bottom: 18vh;
  }

  .suite-link {
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
  .suite.in .suite-link {
    animation: none;
  }
}
</style>
