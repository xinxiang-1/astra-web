<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import CharacterArtwork from '@/components/CharacterArtwork.vue'
import ArtIcon from '@/components/ui/ArtIcon.vue'
import FxButton from '@/components/ui/FxButton.vue'
import CatalogRows from '@/components/ui/CatalogRows.vue'
import { toolsCatalog } from '@/content/catalog'
import { useScrollMotion } from '@/lib/scroll-motion'
const root = ref<HTMLElement>()
useScrollMotion(root)
</script>
<template>
  <div ref="root" class="tools-page">
    <section class="tools-hero site-wrap">
      <header class="intro">
        <p class="art-eyebrow">THE CREATIVE WORKBENCH / 01</p>
        <h1>让每一个灵感，<br />都有自己的表达。</h1>
        <p class="lead">
          把照片织成文字，把名字写进光影。<br />从一张图片开始，在自己的浏览器里完成创作。
        </p>
        <div class="hero-actions">
          <FxButton variant="primary" to="/ascii-art">开始做字符画 <ArtIcon :size="17" /></FxButton>
          <RouterLink class="text-link" to="/signature-portrait"
            >试试名字画 <ArtIcon :size="17"
          /></RouterLink>
        </div>
        <p class="local-note"><ArtIcon name="shield" :size="17" />素材本地处理 · 现有导出免费</p>
      </header>
      <figure class="tools-art">
        <CharacterArtwork
          src="/artwork/porcelain-study-v1.png"
          phrase="把名字写成光"
          :columns="100"
          label="原创瓷像由中文字符组成的作品"
        />
        <figcaption>
          <span class="art-eyebrow">MADE OF CHARACTERS.</span
          ><span>文字里的光影 <ArtIcon :size="14" /></span>
        </figcaption>
      </figure>
    </section>
    <section class="tools-catalog site-wrap" data-reveal>
      <div class="catalog-heading">
        <div>
          <p class="art-eyebrow">FIND YOUR EXPRESSION / 02</p>
          <h2>选择一种创作方式</h2>
        </div>
        <p>照片、名字与动态画面，<br />都可以成为你的作品。</p>
      </div>
      <CatalogRows :items="toolsCatalog" />
    </section>
  </div>
</template>
<style scoped>
.tools-page {
  background: var(--bg);
  color: var(--text);
}
.site-wrap {
  width: min(1328px, calc(100% - 112px));
  margin-inline: auto;
}
.tools-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
  align-items: center;
  gap: clamp(40px, 7vw, 104px);
  padding-block: 70px 64px;
}
.intro .art-eyebrow {
  color: var(--accent);
  margin: 0 0 28px;
}
h1 {
  font: 500 clamp(32px, 3.4vw, 50px)/1.32 var(--font-display);
  letter-spacing: -1.2px;
  margin: 0 0 24px;
}
.lead {
  font-size: 14px;
  line-height: 1.9;
  color: var(--text-muted);
  margin: 0 0 28px;
}
.hero-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 22px;
}
.hero-actions :deep(.label) {
  display: flex;
  align-items: center;
  gap: 18px;
}
.text-link {
  display: inline-flex;
  align-items: center;
  gap: 14px;
  min-height: 44px;
  font-size: 13px;
  text-decoration: none;
}
.text-link:hover {
  color: var(--accent);
}
.local-note {
  display: flex;
  gap: 10px;
  align-items: center;
  color: var(--text-muted);
  font-size: 11px;
  margin: 32px 0 0;
}
.tools-art {
  margin: 0;
  height: 420px;
  min-width: 0;
  position: relative;
  border: 1px solid #3d65544a;
  background: #111615;
  color: #eeeae2;
  border-radius: 6px;
  overflow: hidden;
}
.tools-art :deep(.character-art) {
  height: calc(100% - 42px);
}
figcaption {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  height: 42px;
  padding: 0 18px;
  border-top: 1px solid #ffffff18;
  font-size: 10px;
}
figcaption .art-eyebrow {
  font-size: 8px;
  color: #a8c0b5;
  letter-spacing: 1.5px;
}
figcaption span:last-child {
  display: inline-flex;
  align-items: center;
  gap: 14px;
}
.tools-catalog {
  padding-block: 24px 80px;
}
.catalog-heading {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 24px;
  margin-bottom: 26px;
}
.catalog-heading .art-eyebrow {
  margin: 0 0 12px;
  color: var(--accent);
}
h2 {
  font: 500 30px/1.3 var(--font-display);
  margin: 0;
}
.catalog-heading > p {
  font-size: 12px;
  line-height: 1.8;
  margin: 0;
  color: var(--text-muted);
}
@media (max-width: 1000px) {
  .site-wrap {
    width: calc(100% - 56px);
  }
  .tools-hero {
    gap: 32px;
  }
  .tools-art {
    height: 350px;
  }
}
@media (max-width: 700px) {
  .site-wrap {
    width: calc(100% - 44px);
  }
  .tools-hero {
    grid-template-columns: 1fr;
    padding-block: 38px;
    gap: 32px;
  }
  .intro .art-eyebrow {
    margin-bottom: 22px;
  }
  .tools-art {
    height: 360px;
  }
  .catalog-heading {
    align-items: start;
    flex-direction: column;
  }
  .catalog-heading > p br {
    display: none;
  }
  .tools-catalog {
    padding-bottom: 48px;
  }
}
</style>
