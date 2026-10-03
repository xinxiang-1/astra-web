<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import FxButton from '@/components/ui/FxButton.vue'
import ArtIcon from '@/components/ui/ArtIcon.vue'
import CatalogRows from '@/components/ui/CatalogRows.vue'
import { PrismEffect } from '@/views/packages/effects'
import { studioCatalog } from '@/content/catalog'
import { useThemeStore } from '@/stores/theme'
import { useScrollMotion } from '@/lib/scroll-motion'
const root = ref<HTMLElement>()
useScrollMotion(root)
const theme = useThemeStore()
const prismMode = computed(() => (theme.isDark ? 'dark' : 'light'))
const wallColor = computed(() => (theme.isDark ? '#111615' : '#e4e4dd'))
</script>
<template>
  <div ref="root" class="studio">
    <section class="hero">
      <div class="hero-fx" aria-hidden="true">
        <PrismEffect :mode="prismMode" :wall-color="wallColor" quality="auto" />
      </div>
      <div class="hero-veil" aria-hidden="true" />
      <div class="hero-copy site-wrap">
        <p class="art-eyebrow">THE VISUAL LAB / 01</p>
        <h1>让网页，<br />有自己的光。</h1>
        <p class="lead">从折射、烟雾到流体，<br />探索可以触摸的光与空间。</p>
        <FxButton variant="primary" to="/prism">打开 Prism <ArtIcon :size="17" /></FxButton>
        <span class="hero-coordinate art-eyebrow" aria-hidden="true"
          >LIGHT. SPACE. INTERACTION.</span
        >
      </div>
    </section>
    <section class="catalog site-wrap" data-reveal>
      <div class="catalog-heading">
        <div>
          <p class="art-eyebrow">EXPLORE THE COLLECTION / 02</p>
          <h2>视觉实验室</h2>
        </div>
        <p>在浏览器中体验实时视觉，<br />寻找适合自己网站的表达。</p>
      </div>
      <CatalogRows :items="studioCatalog" />
      <div class="studio-note">
        <span>从视觉实验，到你的创作。</span
        ><RouterLink class="text-link" to="/help">查看创作帮助 <ArtIcon :size="17" /></RouterLink>
      </div>
    </section>
  </div>
</template>
<style scoped>
.studio {
  background: var(--bg);
  color: var(--text);
}
.site-wrap {
  width: min(1328px, calc(100% - 112px));
  margin-inline: auto;
}
.hero {
  position: relative;
  min-height: 650px;
  display: grid;
  align-items: center;
  overflow: hidden;
  background: #111615;
  color: #f4f0e8;
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
    linear-gradient(90deg, #111615e8 0%, #111615a6 40%, #11161516 80%),
    linear-gradient(0deg, #11161599, transparent 40%);
}
.hero-copy {
  position: relative;
  z-index: 2;
  padding-block: 84px;
}
.hero-copy > .art-eyebrow {
  color: #b6cec2;
  margin: 0 0 28px;
}
h1 {
  margin: 0 0 24px;
  font: 500 clamp(42px, 4.6vw, 68px)/1.22 var(--font-display);
  letter-spacing: -1px;
}
.lead {
  margin: 0 0 32px;
  font-size: 14px;
  line-height: 1.9;
  color: #c4cfc4;
}
.hero-copy :deep(.label) {
  display: flex;
  align-items: center;
  gap: 22px;
}
.hero-coordinate {
  display: block;
  margin-top: 58px;
  font-size: 9px;
  color: #a4b5a7;
}
.catalog {
  padding-block: 70px 72px;
}
.catalog-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 26px;
}
.catalog-heading .art-eyebrow {
  margin: 0 0 12px;
  color: var(--accent);
}
h2 {
  margin: 0;
  font: 500 30px/1.3 var(--font-display);
}
.catalog-heading > p {
  margin: 0;
  font-size: 12px;
  line-height: 1.8;
  color: var(--text-muted);
}
.studio-note {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 24px;
  align-items: center;
  padding-top: 28px;
  font-size: 12px;
  color: var(--text-muted);
}
.text-link {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  min-height: 44px;
  text-decoration: none;
  color: var(--text);
}
.text-link:hover {
  color: var(--accent);
}
@media (max-width: 1000px) {
  .site-wrap {
    width: calc(100% - 56px);
  }
}
@media (max-width: 700px) {
  .site-wrap {
    width: calc(100% - 44px);
  }
  .hero {
    min-height: 570px;
  }
  .hero-copy {
    padding-block: 58px;
  }
  .hero-veil {
    background:
      linear-gradient(90deg, #111615c9, #11161544),
      linear-gradient(0deg, #111615d9, transparent 80%);
  }
  .catalog {
    padding-block: 42px;
  }
  .catalog-heading {
    align-items: start;
    flex-direction: column;
  }
  .catalog-heading > p br {
    display: none;
  }
}
</style>
