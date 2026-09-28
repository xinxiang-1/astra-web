<script setup lang="ts">
import CharacterArtwork from '@/components/CharacterArtwork.vue'
import ArtIcon from '@/components/ui/ArtIcon.vue'
import ArtFooter from '@/components/ArtFooter.vue'
import { artworkPresets } from '@/content/artwork'
const featured = [artworkPresets[0]!, artworkPresets[1]!, artworkPresets[2]!]
</script>
<template>
  <div class="art-page home-art">
    <section class="hero-gallery">
      <div class="hero-art">
        <CharacterArtwork
          src="/artwork/portrait-reference.png"
          compare
          label="女性肖像的原图与字符作品对比"
        />
      </div>
      <div class="hero-shade" />
      <div class="hero-copy">
        <div class="art-eyebrow hero-kicker">A NEW WAY TO SEE.<br />一种关于文字的全新表达</div>
        <h1>把照片，<br />变成由文字<br />组成的作品<span>。</span></h1>
        <p>留住光影，也写下心意。<br />将图片与短视频，变成独一无二的字符艺术。</p>
        <div class="hero-actions">
          <RouterLink to="/ascii-art" class="art-button primary">免费制作 <ArtIcon /></RouterLink
          ><RouterLink to="/gallery" class="art-link">浏览作品 <ArtIcon :size="16" /></RouterLink>
        </div>
        <div class="hero-index">
          <span class="index-line" /><span>01 / 06</span
          ><span>LET IMAGINATION<br />BE WRITTEN.</span>
        </div>
      </div>
      <span class="hero-side-label art-eyebrow">CHARACTERS. ENDLESS POSSIBILITIES.</span>
    </section>
    <div class="trust-strip">
      <span class="art-eyebrow">PRIVATE<br />LOCAL<br />CREATIVE</span>
      <p><ArtIcon name="shield" :size="25" /> 本地处理 <i /> 无需上传 <i /> 图片与短视频</p>
      <span class="trust-aside">你的创作<br />始终属于你 <b>—</b></span>
    </div>
    <section class="art-wrap featured-section">
      <div class="art-section-heading">
        <div>
          <span class="art-eyebrow">SELECTED WORKS / 01</span>
          <h2>文字的另一种可能</h2>
          <p>从人像到山川，每一幅都有自己的表达。</p>
        </div>
        <RouterLink to="/gallery" class="art-link">全部作品 <ArtIcon :size="18" /></RouterLink>
      </div>
      <div class="featured-grid">
        <RouterLink
          v-for="art in featured"
          :key="art.id"
          :to="`/ascii-art?preset=${art.id}`"
          class="art-card"
          ><div class="art-card-image">
            <CharacterArtwork
              :src="art.src"
              :color="art.color"
              :phrase="art.phrase"
              :label="art.title"
            />
          </div>
          <div class="art-card-info">
            <div>
              <h3>{{ art.title }}</h3>
              <p>{{ art.caption }}</p>
            </div>
            <span class="art-card-arrow"><ArtIcon :size="16" /></span></div
        ></RouterLink>
      </div>
    </section>
    <section id="how-it-works" class="steps-section art-wrap">
      <div class="art-section-heading">
        <div>
          <span class="art-eyebrow">YOUR FIRST CREATION / 02</span>
          <h2>从一张照片开始</h2>
          <p>只需三步，把你的想象变成可以带走的作品。</p>
        </div>
        <span class="art-eyebrow step-note">简单，但不简单。<br />————</span>
      </div>
      <div class="steps-grid">
        <article
          v-for="(step, index) in [
            {
              title: '上传',
              icon: 'upload',
              text: '选一张照片，或一段短视频。\n所有处理，都在你的浏览器里完成。',
            },
            {
              title: '选择风格',
              icon: 'sliders',
              text: '找到喜欢的预设，写下自己的文字。\n调整细节，让作品更像你。',
            },
            {
              title: '导出作品',
              icon: 'download',
              text: '下载图片、视频或动态网页。\n让你的作品，走向更大的世界。',
            },
          ]"
          :key="step.title"
        >
          <span class="step-number">0{{ index + 1 }}</span>
          <h3>{{ step.title }}</h3>
          <div class="step-body">
            <span class="step-icon"><ArtIcon :name="step.icon" :size="25" /></span>
            <p>{{ step.text }}</p>
          </div>
        </article>
      </div>
    </section>
    <section class="closing-strip">
      <div>
        <ArtIcon name="shield" :size="40" />
        <div>
          <h3>你的隐私，我们始终放在心上</h3>
          <p>图片与视频在本地处理，源文件无需上传。<br />作品可保存在当前浏览器，随时回来继续。</p>
        </div>
      </div>
      <div>
        <ArtIcon name="download" :size="34" />
        <div>
          <h3>多种格式，随心发布</h3>
          <p>PNG 图片 · MP4 / WebM 视频 · TXT 文本 · HTML 动效网页</p>
          <RouterLink to="/ascii-art" class="art-link"
            >开始你的第一幅作品 <ArtIcon :size="16"
          /></RouterLink>
        </div>
      </div>
    </section>
    <ArtFooter />
  </div>
</template>
<style scoped>
.hero-gallery {
  height: min(760px, calc(100dvh - 76px));
  min-height: 590px;
  background: #111615;
  color: #f3f0e9;
  position: relative;
  overflow: hidden;
}
.hero-art {
  position: absolute;
  inset: 0 5% 0 39%;
}
.hero-shade {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(90deg, #111615 0%, #111615 25%, #111615df 34%, transparent 57%);
}
.hero-copy {
  position: relative;
  padding: 47px 0 0 56px;
  pointer-events: none;
  max-width: 670px;
}
.hero-kicker {
  color: #a5aaa0;
  font-size: 9px;
  line-height: 2;
  letter-spacing: 2px;
}
.hero-copy h1 {
  font-size: clamp(46px, 4.7vw, 73px);
  line-height: 1.28;
  letter-spacing: 1px;
  margin: 45px 0 22px;
  font-weight: 500;
}
.hero-copy h1 span {
  color: var(--art-cyan);
}
.hero-copy > p {
  font-size: 14px;
  line-height: 2;
  color: #aab0a8;
  letter-spacing: 1px;
}
.hero-actions {
  display: flex;
  align-items: center;
  gap: 34px;
  margin-top: 30px;
  pointer-events: auto;
}
.hero-actions .art-link {
  color: #e4e4d9;
}
.hero-index {
  display: flex;
  align-items: center;
  gap: 22px;
  margin-top: 52px;
  font:
    10px/1.7 Consolas,
    monospace;
  color: #8f968d;
  letter-spacing: 1.5px;
}
.index-line {
  width: 38px;
  height: 1px;
  background: #91988f;
}
.hero-index > span:last-child {
  margin-left: 25px;
  font-size: 8px;
}
.hero-side-label {
  position: absolute;
  right: 21px;
  top: 38%;
  writing-mode: vertical-rl;
  font-size: 8px;
  color: #959c92;
  letter-spacing: 3px;
}
.trust-strip {
  background: #151918;
  color: #dddcd4;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 56px;
  border-top: 1px solid #ffffff26;
}
.trust-strip > .art-eyebrow {
  font-size: 8px;
  color: #92988e;
  line-height: 1.5;
}
.trust-strip > p {
  display: flex;
  align-items: center;
  gap: 28px;
  font-size: 14px;
  letter-spacing: 2px;
}
.trust-strip i {
  width: 3px;
  height: 3px;
  background: #aaaa9c;
  border-radius: 50%;
}
.trust-aside {
  font-size: 10px;
  color: #94998f;
  line-height: 1.7;
  position: relative;
  padding-right: 60px;
  letter-spacing: 2px;
}
.trust-aside b {
  position: absolute;
  right: 0;
  top: 10px;
  color: var(--art-cyan);
  font-weight: 400;
  font-size: 28px;
}
.featured-section {
  padding-top: 70px;
  padding-bottom: 60px;
}
.featured-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 22px;
}
.featured-grid .art-card-image {
  height: 380px;
}
.steps-section {
  border-top: 1px solid var(--art-line);
  padding-top: 50px;
  padding-bottom: 70px;
}
.steps-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 40px;
  margin-top: 40px;
}
.steps-grid article {
  position: relative;
  padding: 0 25px 0 0;
  border-right: 1px solid var(--art-line);
}
.steps-grid article:last-child {
  border: 0;
}
.step-number {
  font: italic 22px var(--art-serif);
  color: #8b8c83;
}
.steps-grid h3 {
  display: inline-block;
  margin: 0 0 24px 25px;
  font-size: 22px;
}
.step-body {
  display: flex;
  gap: 22px;
  align-items: center;
}
.step-icon {
  width: 56px;
  height: 56px;
  background: #eae8e1;
  display: grid;
  place-items: center;
  border-radius: 50%;
  flex-shrink: 0;
}
.step-body p {
  white-space: pre-line;
  font-size: 11px;
  line-height: 1.9;
  color: var(--art-muted);
}
.step-note {
  text-align: right;
  color: var(--art-muted);
}
.closing-strip {
  padding: 48px 56px;
  background: #151918;
  color: #eeece4;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 70px;
}
.closing-strip > div {
  display: flex;
  gap: 25px;
  align-items: center;
}
.closing-strip > div > svg {
  color: #949b91;
  flex-shrink: 0;
}
.closing-strip h3 {
  font-size: 19px;
  margin: 0 0 12px;
}
.closing-strip p {
  font-size: 11px;
  color: #9ea59a;
  line-height: 1.8;
}
.closing-strip .art-link {
  color: var(--art-cyan);
  font-size: 11px;
}
@media (min-width: 1600px) {
  .hero-copy {
    padding-left: calc((100vw - 1328px) / 2);
  }
  .hero-art {
    right: calc((100vw - 1400px) / 2);
  }
}
@media (max-width: 900px) {
  .hero-copy {
    padding-left: 28px;
  }
  .hero-copy h1 {
    font-size: 52px;
  }
  .hero-art {
    left: 30%;
    right: 0;
  }
  .hero-side-label {
    display: none;
  }
  .trust-strip {
    padding: 22px 28px;
  }
  .trust-aside {
    display: none;
  }
  .featured-grid .art-card-image {
    height: 280px;
  }
  .steps-grid {
    gap: 20px;
  }
  .step-body {
    gap: 12px;
  }
  .closing-strip {
    padding: 36px 28px;
    gap: 30px;
  }
}
@media (max-width: 600px) {
  .hero-gallery {
    height: auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    padding: 26px 22px 30px;
  }
  .hero-copy {
    display: contents;
  }
  .hero-kicker {
    order: 0;
  }
  .hero-copy h1 {
    order: 1;
    font-size: 38px;
    line-height: 1.4;
    margin: 22px 0 12px;
  }
  .hero-copy h1 br:nth-child(2) {
    display: none;
  }
  .hero-copy > p {
    order: 2;
    font-size: 12px;
    margin: 0 0 22px;
  }
  .hero-copy > p br {
    display: none;
  }
  .hero-art {
    order: 3;
    position: relative;
    inset: auto;
    height: 410px;
    border: 1px solid #ffffff18;
    border-radius: 3px;
  }
  .hero-shade {
    display: none;
  }
  .hero-actions {
    order: 4;
    margin-top: 22px;
    flex-wrap: wrap;
    gap: 18px;
    justify-content: center;
  }
  .hero-actions .art-button {
    width: 100%;
    font-size: 15px;
    min-height: 52px;
  }
  .hero-index {
    display: none;
  }
  .trust-strip {
    padding: 12px 22px;
    justify-content: center;
  }
  .trust-strip > .art-eyebrow {
    display: none;
  }
  .trust-strip > p {
    gap: 12px;
    font-size: 10px;
    letter-spacing: 0;
  }
  .featured-section {
    padding-top: 40px;
    padding-bottom: 36px;
  }
  .featured-grid {
    grid-template-columns: 1fr;
    gap: 20px;
  }
  .featured-grid .art-card-image {
    height: 340px;
  }
  .art-section-heading .art-link {
    font-size: 11px;
    white-space: nowrap;
    gap: 6px;
  }
  .steps-section {
    padding-top: 36px;
    padding-bottom: 40px;
  }
  .steps-grid {
    grid-template-columns: 1fr;
    gap: 25px;
    margin-top: 24px;
  }
  .steps-grid article {
    border-right: 0;
    border-bottom: 1px solid var(--art-line);
    padding-bottom: 20px;
  }
  .steps-grid h3 {
    margin-bottom: 12px;
  }
  .step-note {
    display: none;
  }
  .closing-strip {
    grid-template-columns: 1fr;
    padding: 35px 22px;
    gap: 32px;
  }
  .closing-strip h3 {
    font-size: 17px;
  }
}
</style>
