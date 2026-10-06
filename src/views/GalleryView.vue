<script setup lang="ts">
import { computed, ref } from 'vue'
import { artworkPresets } from '@/content/artwork'
import ArtworkPreview from '@/components/ArtworkPreview.vue'
import ArtFooter from '@/components/ArtFooter.vue'
import ArtIcon from '@/components/ui/ArtIcon.vue'
const filter = ref('全部')
const search = ref('')
const categories = ['全部', ...new Set(artworkPresets.map(art => art.category))]
function resetFilters() {
  search.value = ''
  filter.value = '全部'
}
const filtered = computed(() =>
  artworkPresets.filter(
    (a) =>
      (filter.value === '全部' || a.category === filter.value) &&
      `${a.title}${a.caption}${a.category}`.includes(search.value.trim()),
  ),
)
</script>
<template>
  <div class="art-page">
    <div class="art-wrap gallery-main">
      <header class="gallery-heading">
        <span class="art-eyebrow">THE CHARACTER COLLECTION</span>
        <h1>作品案例<span> / 06</span></h1>
        <p>从一个灵感开始，换成你的照片与文字。</p>
        <RouterLink to="/templates" class="art-link gallery-template-link">浏览原创模板 <ArtIcon :size="16" /></RouterLink>
      </header>
      <div class="gallery-tools">
        <div class="gallery-filters">
          <button
            v-for="item in categories"
            :key="item"
            class="art-chip"
            :class="{ active: filter === item }"
            :aria-pressed="filter === item"
            @click="filter = item"
          >
            {{ item }}
          </button>
        </div>
        <label class="gallery-search"
          ><ArtIcon name="search" :size="17" /><input
            v-model="search"
            placeholder="搜索作品"
            aria-label="搜索作品"
        /></label>
      </div>
      <div v-if="filtered.length" class="gallery-grid">
        <RouterLink
          v-for="(art, index) in filtered"
          :key="art.id"
          :to="`/ascii-art?preset=${art.id}`"
          class="art-card"
          ><div class="art-card-image">
            <ArtworkPreview :art="art" /><span class="art-number">0{{ index + 1 }}</span>
          </div>
          <div class="art-card-info">
            <div>
              <h3>{{ art.title }}</h3>
              <p>{{ art.category }} · {{ art.phrase ? '中文铺字' : art.color ? '原色字符' : '光影字符' }}</p>
            </div>
            <span class="template-action">试用此风格 <ArtIcon :size="15" /></span></div
        ></RouterLink>
      </div>
      <div v-else class="gallery-empty">
        <h2>还没找到想要的作品？</h2>
        <p>换个关键词，或从你自己的照片开始。</p>
        <button
          class="art-button"
          @click="resetFilters"
        >
          重置筛选
        </button>
      </div>
      <section class="gallery-feature">
        <div>
          <span class="art-eyebrow">EXPLORE A LITTLE FURTHER</span>
          <h2>让文字，流动起来。</h2>
          <p>探索悬停交互、动态字符与循环影像。</p>
          <RouterLink to="/ascii-live" class="art-button"
            >探索动态字符 <ArtIcon :size="17"
          /></RouterLink>
        </div>
        <div class="feature-art">
          <ArtworkPreview :art="artworkPresets[4]!" />
        </div>
      </section>
    </div>
    <ArtFooter />
  </div>
</template>
<style scoped>
.gallery-main {
  padding-top: 60px;
  padding-bottom: 55px;
}
.gallery-heading h1 {
  font-size: 62px;
  letter-spacing: 1px;
  margin: 15px 0;
}
.gallery-heading h1 span {
  font:
    14px Consolas,
    monospace;
  color: var(--text-muted);
  vertical-align: middle;
  margin-left: 20px;
}
.gallery-heading > p {
  color: var(--art-muted);
  font-size: 14px;
}
.gallery-heading > .art-eyebrow {
  color: var(--text-muted);
}
.gallery-template-link { margin-top: 12px; min-height: 44px; color: var(--accent); }
.gallery-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 36px 0 28px;
  gap: 20px;
}
.gallery-filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.gallery-search {
  display: flex;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--border);
  padding: 9px 4px;
}
.gallery-search input {
  background: none;
  border: 0;
  outline: none;
  color: var(--text);
  width: 160px;
  font: 12px var(--font-body);
}
.gallery-search:focus-within {
  border-color: #00868c;
}
.gallery-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 25px;
}
.gallery-grid .art-card-image {
  height: auto;
  aspect-ratio: 4 / 5;
  position: relative;
}
.art-number {
  position: absolute;
  top: 14px;
  left: 15px;
  color: #f3f2e8;
  font:
    10px Consolas,
    monospace;
  padding: 6px 8px;
  background: #15191888;
}
.template-action {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  padding: 9px 10px;
  border-radius: 30px;
  font-size: 10px;
  white-space: nowrap;
}
.gallery-feature {
  margin-top: 60px;
  background: var(--bg-elevated);
  color: var(--text);
  display: flex;
  justify-content: space-between;
  height: 280px;
  overflow: hidden;
}
.gallery-feature > div:first-child {
  padding: 40px;
  position: relative;
  z-index: 1;
}
.gallery-feature h2 {
  font-size: 35px;
  margin: 16px 0;
}
.gallery-feature p {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 24px;
}
.gallery-feature .art-button {
  color: var(--accent);
  font-size: 11px;
  min-height: 38px;
  padding: 8px 18px;
}
.feature-art {
  width: 45%;
  mask-image: linear-gradient(90deg, transparent, #000 30%);
}
.gallery-empty {
  padding: 70px;
  text-align: center;
  border: 1px dashed var(--art-line);
}
.gallery-empty p {
  color: var(--art-muted);
}
@media (max-width: 1000px) {
  .gallery-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .gallery-heading h1 {
    font-size: 50px;
  }
}
@media (max-width: 600px) {
  .gallery-main {
    padding-top: 30px;
  }
  .gallery-heading h1 {
    font-size: 38px;
  }
  .gallery-heading h1 span {
    font-size: 11px;
    margin-left: 8px;
  }
  .gallery-tools {
    flex-direction: column;
    align-items: stretch;
    margin-top: 24px;
  }
  .gallery-grid {
    grid-template-columns: 1fr;
  }
  .gallery-grid .art-card-image {
    height: auto;
  }
  .gallery-search input {
    width: 100%;
  }
  .gallery-feature {
    height: 300px;
    position: relative;
    margin-top: 35px;
  }
  .gallery-feature > div:first-child {
    padding: 28px 22px;
  }
  .gallery-feature h2 {
    font-size: 30px;
  }
  .feature-art {
    position: absolute;
    inset: 0 0 0 auto;
    width: 65%;
    opacity: 0.35;
  }
  .gallery-empty {
    padding: 35px 16px;
  }
}
</style>
