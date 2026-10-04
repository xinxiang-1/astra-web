<script setup lang="ts">
import { ref } from 'vue'
import ArtFooter from '@/components/ArtFooter.vue'
import ArtIcon from '@/components/ui/ArtIcon.vue'
import { useScrollMotion } from '@/lib/scroll-motion'

const root = ref<HTMLElement>()
useScrollMotion(root)
const formats = [
  { name: 'PNG 图片', use: '发布海报、头像或静态作品。可选择尺寸和透明背景。' },
  { name: '视频', use: '发布会动的字符作品。根据素材和浏览器支持选择导出方式。' },
  { name: 'HTML 网页', use: '保存成可以离线打开的作品页面，体验暂停和悬停互动。' },
  { name: 'TXT 文本', use: '保留字符文字；颜色、动效与源图片不包含在文本里。' },
  { name: 'Astra 作品包（.astra）', use: '备份完整源素材与创作参数，换设备后导入继续编辑。' },
]
</script>

<template>
  <div ref="root" class="art-page help-page">
    <div class="art-wrap help-main">
      <header class="help-heading">
        <span class="art-eyebrow">ASTRA · CREATION GUIDE</span>
        <h1>让灵感，成为作品。</h1>
        <p>从一张图片、一句短句开始。先看效果，再保存你喜欢的版本。</p>
        <div class="help-actions">
          <RouterLink to="/templates" class="art-button dark"
            >从原创模板开始 <ArtIcon :size="17" /></RouterLink
          ><RouterLink to="/ascii-art" class="art-button"
            >使用自己的素材 <ArtIcon :size="17"
          /></RouterLink>
        </div>
      </header>
      <section aria-labelledby="steps-title" class="help-section" data-reveal>
        <span class="art-eyebrow">THREE SMALL STEPS</span>
        <h2 id="steps-title">从素材到作品，只需三步。</h2>
        <ol class="creation-steps">
          <li>
            <span>01</span>
            <h3>选一张图，或一个模板</h3>
            <p>
              图片在本机读取。选择原创模板时，会创建新的本地项目；点击编辑器素材区域，或拖入图片换成你的素材。
            </p>
          </li>
          <li>
            <span>02</span>
            <h3>把风格调成你喜欢的样子</h3>
            <p>
              尝试六种模式，调整颜色与清晰度。中文铺字可替换“铺底文案”；展开动效设置，选择微动与悬停，再与原图对比。
            </p>
          </li>
          <li>
            <span>03</span>
            <h3>下载成品，也留好备份</h3>
            <p>
              导出面板选择格式和尺寸，免费下载作品。想以后再改，请保存本地项目，并下载一份完整作品包。
            </p>
          </li>
        </ol>
      </section>
      <section
        id="save-and-backup"
        class="help-section backup-section"
        aria-labelledby="backup-title"
        data-reveal
      >
        <div>
          <span class="art-eyebrow">KEEP THE ORIGINAL</span>
          <h2 id="backup-title">成品用来分享，作品包用来继续。</h2>
          <p>
            “保存项目”会将原图和参数保存在当前浏览器。清理浏览器数据、换浏览器或换设备后，本地项目不会自动出现。
          </p>
          <p>
            在编辑器或“我的项目”下载 .astra
            作品包；在新设备打开“我的项目”，选择“导入作品包”。每次导入创建独立项目。
          </p>
          <RouterLink to="/projects" class="art-button"
            >打开我的项目 <ArtIcon :size="17"
          /></RouterLink>
        </div>
        <div class="backup-note">
          <ArtIcon name="shield" :size="28" />
          <h3>给灵感留一个备份</h3>
          <p>
            PNG、视频和离线网页保留成品，不能代替完整作品包。下载文件后，请妥善保存原始素材与备份。
          </p>
          <p>离开编辑器前遇到“有未保存的更改”，可先保存再离开，或返回继续编辑。</p>
        </div>
      </section>
      <section class="help-section formats-section" aria-labelledby="formats-title" data-reveal>
        <span class="art-eyebrow">CHOOSE YOUR FORMAT</span>
        <h2 id="formats-title">按用途，选择下载格式。</h2>
        <dl>
          <div v-for="format in formats" :key="format.name">
            <dt>{{ format.name }}</dt>
            <dd>{{ format.use }}</dd>
          </div>
        </dl>
      </section>
      <section class="help-section faq-section" aria-labelledby="faq-title" data-reveal>
        <span class="art-eyebrow">A LITTLE HELP</span>
        <h2 id="faq-title">创作中常见的问题。</h2>
        <details>
          <summary>为什么换了图片，效果会不一样？</summary>
          <p>
            模板保留风格与参数，结果也取决于原图的明暗、颜色和细节。先选主体清楚、背景简洁的图片；过暗时调整曝光，细节过密时降低列数，再逐张确认真实预览。
          </p>
        </details>
        <details>
          <summary>手机上怎样修改图片和文字？</summary>
          <p>
            先在上方确认预览，再用“素材与预设 /
            调整效果”切换面板。中文铺字的“铺底文案”在调整面板中；“保存项目”在预览下方，导出在顶部。下载作品包时切回“素材与预设”。查看已存项目，可点左上角Astra返回首页，再从导航进入“我的项目”。长视频和高分辨率图片需要更多处理时间。
          </p>
        </details>
        <details>
          <summary>我想先暂停，再看悬停效果。</summary>
          <p>
            在动效设置中暂停微动后，悬停仍可独立体验。系统启用“减少动态效果”时，页面与持续动效会适当减少。离线HTML也可以暂停播放。
          </p>
        </details>
        <details>
          <summary>模板打不开，或项目保存失败怎么办？</summary>
          <p>
            先检查网络，再尝试模板详情中的创作按钮。已有项目保存在本地，不会被模板覆盖。保存失败时检查浏览器存储权限与空间；不要清理未备份的项目数据，可以先下载作品包。
          </p>
        </details>
        <details>
          <summary>需要登录或付费才能下载吗？</summary>
          <p>
            目前已有的PNG、透明图片、TXT、视频、HTML和作品包导出保持免费。三款原创入门模板可直接体验，无需登录。
          </p>
        </details>
      </section>
      <div class="help-bottom">
        <p>准备好了？从你喜欢的一款开始。</p>
        <RouterLink to="/templates" class="art-button primary"
          >挑选原创模板 <ArtIcon :size="17"
        /></RouterLink>
      </div>
    </div>
    <ArtFooter />
  </div>
</template>

<style scoped>
.help-main {
  max-width: 1240px;
  padding-top: 62px;
  padding-bottom: 62px;
}
.help-heading h1 {
  font-size: clamp(36px, 4.5vw, 58px);
  margin: 20px 0;
}
.help-heading > p {
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1.8;
}
.help-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  margin-top: 28px;
}
.help-section {
  margin-top: 64px;
  padding-top: 36px;
  border-top: 1px solid var(--art-line);
  scroll-margin-top: 24px;
}
.help-section > h2,
.backup-section h2 {
  font-size: 32px;
  line-height: 1.4;
  margin: 14px 0 30px;
}
.creation-steps {
  list-style: none;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
}
.creation-steps li {
  padding: 26px;
  background: var(--bg-elevated);
  border-radius: 12px;
}
.creation-steps li > span {
  font: 32px var(--art-serif);
  color: var(--accent);
}
.creation-steps h3 {
  font-size: 20px;
  margin: 24px 0 16px;
}
.creation-steps p,
.backup-section p {
  font-size: 13px;
  line-height: 1.9;
  color: var(--text-muted);
}
.backup-section {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  gap: 50px;
  align-items: center;
}
.backup-section h2 {
  margin-bottom: 20px;
}
.backup-section .art-button {
  margin-top: 18px;
}
.backup-note {
  background: #111615;
  color: #f5f3ef;
  padding: 34px;
  border-radius: 12px;
}
.backup-note > svg {
  color: var(--art-cyan);
}
.backup-note h3 {
  font-size: 26px;
  margin: 24px 0 16px;
}
.backup-note p {
  color: #b9c4b7;
}
.formats-section dl {
  margin: 0;
}
.formats-section dl > div {
  display: grid;
  grid-template-columns: 230px minmax(0, 1fr);
  gap: 24px;
  padding: 22px 0;
  border-bottom: 1px solid var(--art-line);
}
.formats-section dt {
  font-size: 14px;
  font-weight: 600;
}
.formats-section dd {
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-muted);
  margin: 0;
}
.faq-section details {
  border-bottom: 1px solid var(--art-line);
}
.faq-section summary {
  padding: 22px 4px;
  font-size: 14px;
  cursor: pointer;
  min-height: 44px;
}
.faq-section details p {
  padding: 0 4px 20px;
  margin: 0;
  font-size: 13px;
  line-height: 1.9;
  color: var(--text-muted);
}
.help-bottom {
  margin-top: 55px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.help-bottom p {
  font: 25px var(--art-serif);
}
.help-page a:focus-visible,
.help-page summary:focus-visible {
  outline: 3px solid #078c91;
  outline-offset: 4px;
}
.motion-ready [data-reveal] {
  opacity: 0;
  transform: translateY(20px);
  transition:
    opacity 0.5s,
    transform 0.5s;
}
.motion-ready [data-reveal].is-revealed {
  opacity: 1;
  transform: none;
}
@media (max-width: 800px) {
  .help-main {
    padding-top: 36px;
    padding-bottom: 36px;
  }
  .help-section {
    margin-top: 42px;
    padding-top: 26px;
  }
  .help-section > h2,
  .backup-section h2 {
    font-size: 27px;
  }
  .creation-steps,
  .backup-section {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .creation-steps li,
  .backup-note {
    padding: 24px;
  }
  .formats-section dl > div {
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .help-bottom {
    align-items: stretch;
    flex-direction: column;
  }
}
@media (prefers-reduced-motion: reduce) {
  .help-page :deep(*) {
    transition: none !important;
    animation: none !important;
  }
  .help-page .art-button:hover {
    transform: none;
  }
  [data-reveal] {
    opacity: 1 !important;
    transform: none !important;
  }
}
</style>
