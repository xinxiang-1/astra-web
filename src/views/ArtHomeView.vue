<script setup lang="ts">
import { computed, ref } from 'vue'
import CharacterArtwork from '@/components/CharacterArtwork.vue'
import ArtworkPreview from '@/components/ArtworkPreview.vue'
import ArtIcon from '@/components/ui/ArtIcon.vue'
import ArtFooter from '@/components/ArtFooter.vue'
import { artworkPresets } from '@/content/artwork'
import { ART_MODES, type ArtMode, type ArtHover } from '@/lib/art-engine'
import { useScrollMotion } from '@/lib/scroll-motion'
const featured = [artworkPresets[0]!, artworkPresets[1]!, artworkPresets[2]!]
const home = ref<HTMLElement>()
const showcaseMode = ref<ArtMode>('color')
const showcaseHover = ref<ArtHover>('light')
const showcaseDescription = computed(() => ART_MODES.find(item => item.id === showcaseMode.value)!)
function moveShowcaseGlow(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  const element = event.currentTarget as HTMLElement
  const box = element.getBoundingClientRect()
  element.style.setProperty('--glow-x', `${event.clientX - box.left}px`)
  element.style.setProperty('--glow-y', `${event.clientY - box.top}px`)
}
useScrollMotion(home)
</script>
<template>
  <div ref="home" class="art-page home-art">
    <section class="hero-gallery">
      <div class="hero-art">
        <CharacterArtwork
          src="/artwork/portrait-reference.png"
          compare
          animated
          interactive
          engine="studio"
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
      <div class="hero-coordinate" aria-hidden="true"><span>LOCAL RENDER / 02</span><span>SCROLL TO EXPLORE ↓</span></div>
    </section>
    <div class="trust-strip">
      <span class="art-eyebrow">PRIVATE<br />LOCAL<br />CREATIVE</span>
      <p><ArtIcon name="shield" :size="25" /> 本地处理 <i /> 无需上传 <i /> 图片与短视频</p>
      <span class="trust-aside">你的创作<br />始终属于你 <b>—</b></span>
    </div>
    <section class="art-wrap featured-section" data-reveal>
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
            <ArtworkPreview :art="art" />
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
    <section class="engine-story" data-scroll-stage>
      <div class="story-grid" aria-hidden="true" /><div class="story-orbit" aria-hidden="true" />
      <div class="story-copy" data-reveal>
        <span class="art-eyebrow">ONE IMAGE. MANY EXPRESSIONS. / 02</span>
        <h2>让光影，<br />拥有更多语言。</h2>
        <p>字符、中文、轮廓与点阵。<br />每一种表达，都来自同一张原图。</p>
        <div class="story-modes" role="group" aria-label="切换引擎展示模式"><button v-for="(item, index) in ART_MODES" :key="item.id" :aria-pressed="showcaseMode === item.id" :class="{ active: showcaseMode === item.id }" @click="showcaseMode = item.id"><span class="mode-number" aria-hidden="true">0{{ index + 1 }}</span><span>{{ item.name }}</span><ArtIcon :size="13" /></button></div>
        <p class="story-mode-description" aria-live="polite">{{ showcaseDescription.description }}</p>
        <RouterLink to="/art-lab" class="art-button primary">探索六种表达 <ArtIcon :size="16" /></RouterLink>
        <span class="story-note">新引擎验证版 · 本地生成 · 可下载 4K 图片</span>
      </div>
      <div class="story-art" data-reveal @pointermove="moveShowcaseGlow">
        <div class="story-art-heading"><span><i aria-hidden="true" />{{ showcaseDescription.name }}</span><span class="art-eyebrow">LIVE CANVAS</span></div>
        <div class="story-canvas"><CharacterArtwork src="/artwork/portrait-reference.png" :mode="showcaseMode" :phrase="showcaseMode === 'phrase' ? '光与影，皆是你' : ''" :color="showcaseMode === 'color'" :columns="140" animated interactive motion="breathe" :hover="showcaseHover" label="六种字符模式的真实图像演示" /></div>
        <div class="story-art-toolbar"><span class="story-hover-hint">移动鼠标，唤醒光影</span><div role="group" aria-label="展示作品的悬停效果"><button :class="{ active: showcaseHover === 'light' }" :aria-pressed="showcaseHover === 'light'" @click="showcaseHover = 'light'">光晕</button><button :class="{ active: showcaseHover === 'ripple' }" :aria-pressed="showcaseHover === 'ripple'" @click="showcaseHover = 'ripple'">涟漪</button></div></div>
        <span class="story-registration" aria-hidden="true">ASTRA / CHARACTER STUDY</span>
      </div>
    </section>
    <section id="how-it-works" class="steps-section art-wrap" data-reveal>
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
    <section class="closing-strip" data-reveal>
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
.hero-coordinate { position: absolute; bottom: 18px; left: 56px; right: 28px; display: flex; justify-content: space-between; color: #6c8880; font: 8px monospace; letter-spacing: 2px; pointer-events: none; }
.motion-ready [data-reveal] { opacity: 0; transform: translateY(28px); transition: opacity .7s ease, transform .7s cubic-bezier(.2,.6,.2,1); }
.motion-ready [data-reveal].is-revealed { opacity: 1; transform: translateY(0); }
.engine-story { position: relative; display: grid; grid-template-columns: .9fr 1.1fr; min-height: 680px; background: #101a19; color: #eeece4; padding: 80px max(56px, calc((100vw - 1328px)/2)); gap: 60px; overflow: hidden; }
.story-grid { position: absolute; inset: 0; opacity: .07; background-image: linear-gradient(#9dc3ba30 1px, transparent 1px), linear-gradient(90deg, #9dc3ba30 1px, transparent 1px); background-size: 70px 70px; transform: translateY(calc((var(--scroll-progress, .5) - .5) * 60px)); pointer-events: none; }
.story-orbit { position: absolute; width: 850px; height: 850px; border: 1px solid #58e8ed0c; border-radius: 50%; top: -110px; left: 38%; transform: scale(calc(.95 + var(--scroll-progress, .5) * .15)); pointer-events: none; }
.story-orbit::before, .story-orbit::after { content: ''; position: absolute; border: 1px solid #58e8ed14; border-radius: 50%; inset: 90px; }
.story-orbit::after { inset: 180px; }
.story-copy { position: relative; align-self: center; z-index: 1; }
.story-copy > .art-eyebrow { color: var(--art-cyan); }
.story-copy h2 { font-size: clamp(36px, 4vw, 60px); line-height: 1.25; margin: 28px 0 24px; }
.story-copy p { font-size: 13px; line-height: 2; color: #9cb1a9; }
.story-modes { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin: 28px 0 12px; max-width: 400px; }
.story-modes button { display: flex; align-items: center; gap: 12px; border: 1px solid #ffffff20; border-radius: 5px; background: #101a19; color: #b9c8c2; font: 12px var(--font-body); padding: 16px 12px; cursor: pointer; transition: color .25s, border-color .25s, background .25s, box-shadow .25s; text-align: left; }
.story-modes .mode-number { font: 9px Consolas, monospace; color: #6d9185; }
.story-modes button svg { margin-left: auto; opacity: 0; transform: translateX(-4px); transition: opacity .25s, transform .25s; }
.story-modes button:hover { background: #58e8ed0a; border-color: #58e8ed65; color: #eeece4; box-shadow: inset 0 0 18px #58e8ed08; }
.story-modes button:hover svg, .story-modes button.active svg { opacity: 1; transform: translateX(0); }
.story-modes button.active { color: var(--art-cyan); border-color: #58e8ed90; background: #58e8ed0b; }
.story-modes button:focus-visible { outline: 2px solid var(--art-cyan); outline-offset: 3px; }
.story-copy .story-mode-description { min-height: 24px; margin: 0 0 24px; color: #a7bdb3; font-size: 11px; }
.story-note { display: block; margin-top: 16px; font: 9px var(--font-body); color: #8fa89e; }
.story-art { position: relative; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; height: 568px; min-width: 0; border: 1px solid #5da89b44; border-radius: 8px; background: #111615; align-self: center; box-shadow: 0 28px 75px #030e0b55; }
.story-art::after { content: ''; position: absolute; inset: -1px; border-radius: inherit; border: 1px solid #58e8ed55; background: radial-gradient(300px circle at var(--glow-x, 50%) var(--glow-y, 50%), #58e8ed12, transparent 75%); opacity: 0; transition: opacity .4s; pointer-events: none; }
.story-art-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 20px; border-bottom: 1px solid #ffffff10; color: #c5d3ca; font-size: 11px; }
.story-art-heading > span:first-child { display: flex; align-items: center; gap: 10px; }
.story-art-heading i { width: 5px; height: 5px; border-radius: 50%; background: var(--art-cyan); box-shadow: 0 0 10px #58e8ed40; }
.story-art-heading .art-eyebrow { font-size: 8px; color: #749187; letter-spacing: 1.5px; }
.story-canvas { min-height: 0; overflow: hidden; }
.story-art-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; padding: 10px 18px; border-top: 1px solid #ffffff10; color: #8aa397; font-size: 10px; }
.story-art-toolbar > div { display: flex; gap: 4px; }
.story-art-toolbar button { padding: 7px 12px; border: 1px solid transparent; border-radius: 4px; background: transparent; color: #9aafa6; font: 11px var(--font-body); cursor: pointer; transition: color .2s, background .2s; }
.story-art-toolbar button:hover, .story-art-toolbar button.active { color: var(--art-cyan); background: #58e8ed0b; border-color: #58e8ed22; }
.story-art-toolbar button:focus-visible { outline: 2px solid var(--art-cyan); outline-offset: 2px; }
@media (hover: hover) and (pointer: fine) { .story-art:hover::after { opacity: 1; } }
@media (hover: none) { .story-hover-hint { display: none; } .story-art-toolbar { justify-content: flex-end; } }
.story-registration { position: absolute; bottom: -28px; right: 0; font: 8px monospace; letter-spacing: 2px; color: #648c80; }
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
  .engine-story { padding: 50px 28px; gap: 26px; }.story-art { height: 470px; }.story-modes { grid-template-columns: 1fr 1fr; }
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
  .engine-story { grid-template-columns: 1fr; padding: 48px 22px; min-height: 0; gap: 32px; }.story-copy h2 { font-size: 38px; }.story-art { height: 430px; }.hero-coordinate { display: none; }.hero-art { transform: none; }
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
@media (prefers-reduced-motion: reduce) { .story-grid, .story-orbit { transform: none !important; } [data-reveal], .story-modes button, .story-modes button svg, .story-art::after, .story-art-toolbar button { transition: none !important; } .story-art::after { display: none; } .story-hover-hint { display: none; } }
</style>
