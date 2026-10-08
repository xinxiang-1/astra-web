<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { isNavigationFailure, useRouter } from 'vue-router'
import ArtFooter from '@/components/ArtFooter.vue'
import ArtIcon from '@/components/ui/ArtIcon.vue'
import { starterTemplates, type StarterTemplate } from '@/content/starter-templates'
import { readStarterTemplate, starterAssetUrl } from '@/lib/starter-templates'
import { saveArtProject } from '@/lib/art-projects'
import { useScrollMotion } from '@/lib/scroll-motion'

const root = ref<HTMLElement>()
useScrollMotion(root)
const router = useRouter()
const search = ref('')
const category = ref('全部')
const filtered = computed(() =>
  starterTemplates.filter(
    (template) =>
      (category.value === '全部' || template.category === category.value) &&
      `${template.name}${template.modeLabel}${template.suitedTo}`.includes(search.value.trim()),
  ),
)
const dialog = ref<HTMLDialogElement>()
const selected = ref<StarterTemplate | null>(null)
const phase = ref<'idle' | 'loading' | 'saving'>('idle')
const busy = computed(() => phase.value !== 'idle')
const error = ref('')
let trigger: HTMLElement | null = null
let controller: AbortController | null = null
let disposed = false

async function showDetails(template: StarterTemplate, event: Event) {
  trigger = event.currentTarget as HTMLElement
  selected.value = template
  error.value = ''
  await nextTick()
  dialog.value?.showModal()
}
function closeDetails() {
  if (!busy.value) dialog.value?.close()
}
function afterClose() {
  selected.value = null
  if (trigger?.isConnected) trigger.focus()
}
function cancelDetails(event: Event) {
  if (busy.value) event.preventDefault()
}
function handleDialogKey(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !dialog.value) return
  const controls = Array.from(
    dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'),
  ).filter((element) => element.getClientRects().length)
  const first = controls[0]
  const last = controls[controls.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}
function resetFilters() {
  search.value = ''
  category.value = '全部'
}
async function startCreating() {
  if (!selected.value || busy.value) return
  const template = selected.value
  controller = new AbortController()
  const attempt = controller
  phase.value = 'loading'
  error.value = ''
  let saved = false
  try {
    const project = await readStarterTemplate(template, attempt.signal)
    if (disposed || attempt.signal.aborted) return
    phase.value = 'saving'
    try {
      await saveArtProject(project)
    } catch {
      throw new Error(
        '浏览器未能保存模板，存储空间可能不足。请检查存储权限后重试，已有作品保持原样。',
      )
    }
    saved = true
    if (disposed || attempt.signal.aborted) return
    const failure = await router.push({ path: '/ascii-art', query: { project: project.id } })
    if (isNavigationFailure(failure)) throw new Error('编辑器暂时未能打开。')
  } catch (cause) {
    if (disposed || attempt.signal.aborted) return
    error.value = saved
      ? '模板已保存到此浏览器，请从“我的项目”打开继续创作。'
      : cause instanceof Error && !(cause instanceof TypeError)
        ? cause.message
        : '模板暂时无法读取，请检查网络后重试。'
  } finally {
    if (!disposed) phase.value = 'idle'
  }
}
onBeforeUnmount(() => {
  disposed = true
  controller?.abort()
})
</script>

<template>
  <div ref="root" class="art-page templates-page">
    <header class="templates-hero">
      <div class="art-wrap hero-content">
        <div>
          <span class="art-eyebrow">ASTRA · STARTER COLLECTION</span>
          <h1>从一束灵感，<br />开始创作。</h1>
          <p>挑选喜欢的字符风格，换成你的图片与文字。<br />三款原创入门模板，免费体验。</p>
          <a href="#starter-collection" class="art-button primary"
            >挑选模板 <ArtIcon :size="17"
          /></a>
          <RouterLink to="/help" class="hero-help">第一次创作？查看使用帮助 ↗</RouterLink>
          <RouterLink to="/collections" class="hero-help">查看内容合集与交付说明 ↗</RouterLink>
        </div>
        <div class="collection-symbol" aria-hidden="true">
          <span>03</span><i></i><small>LIGHT · COLOR · WORDS</small>
        </div>
      </div>
    </header>
    <div id="starter-collection" class="art-wrap templates-main">
      <section aria-labelledby="collection-heading">
        <div class="collection-heading" data-reveal>
          <div>
            <span class="art-eyebrow">MAKE IT YOURS</span>
            <h2 id="collection-heading">三种起点，同一个创作空间。</h2>
          </div>
          <p>每次使用创建新项目<br />素材保存在此浏览器</p>
        </div>
        <div class="template-tools">
          <div class="template-filters" role="group" aria-label="筛选模板">
            <button
              v-for="item in ['全部', '光影', '彩色', '中文']"
              :key="item"
              class="art-chip"
              :class="{ active: category === item }"
              :aria-pressed="category === item"
              @click="category = item"
            >
              {{ item }}
            </button>
          </div>
          <label class="template-search"
            ><ArtIcon name="search" :size="18" /><input
              v-model="search"
              aria-label="搜索模板"
              placeholder="搜索模板与适用素材"
              type="search"
          /></label>
        </div>
        <p class="filter-count" role="status">找到 {{ filtered.length }} 款原创模板</p>
        <div v-if="filtered.length" class="template-grid">
          <article
            v-for="template in filtered"
            :key="template.id"
            class="starter-card"
            :data-template="template.id"
          >
            <button
              class="template-preview"
              :aria-label="`查看${template.name}模板详情`"
              @click="showDetails(template, $event)"
            >
              <img
                :src="starterAssetUrl(template.assets.preview.path)"
                :alt="`${template.name}真实字符成品`"
                width="864"
                height="1080"
                loading="lazy"
              />
              <span class="preview-tag">{{ template.modeLabel }}</span
              ><span class="preview-open" aria-hidden="true"><ArtIcon :size="22" /></span>
            </button>
            <div class="starter-card-content">
              <div class="starter-card-title">
                <h3>{{ template.name }}</h3>
                <span>免费体验</span>
              </div>
              <p class="effect-label">
                {{ template.motionLabel }}微动 <span>·</span> {{ template.hoverLabel }}悬停
              </p>
              <p class="template-fit">{{ template.suitedTo }}</p>
              <button class="template-detail-button" @click="showDetails(template, $event)">
                查看模板与创作建议 <ArtIcon :size="17" />
              </button>
            </div>
          </article>
        </div>
        <div v-else class="template-empty">
          <h3>没有找到匹配的模板</h3>
          <p>换个关键词，或查看全部三款入门模板。</p>
          <button class="art-button" @click="resetFilters">重置筛选</button>
        </div>
      </section>
      <section class="template-next" data-reveal>
        <div>
          <span class="art-eyebrow">YOUR IMAGE, YOUR WORDS</span>
          <h2>风格是起点，作品属于你。</h2>
          <p>在编辑器替换图片、修改短句，再按需要保存或下载。成品适合发布，作品包让你继续创作。</p>
        </div>
        <RouterLink to="/help#save-and-backup" class="art-button"
          >了解保存与备份 <ArtIcon :size="17"
        /></RouterLink>
      </section>
    </div>
    <dialog
      ref="dialog"
      class="template-dialog"
      aria-labelledby="template-title"
      @close="afterClose"
      @cancel="cancelDetails"
      @keydown="handleDialogKey"
      @click="$event.target === dialog && closeDetails()"
    >
      <div v-if="selected" class="template-dialog-content" :aria-busy="busy">
        <button
          class="dialog-close"
          aria-label="关闭模板详情"
          :disabled="busy"
          @click="closeDetails"
        >
          <ArtIcon name="close" :size="20" />
        </button>
        <div class="dialog-preview">
          <img
            :src="starterAssetUrl(selected.assets.preview.path)"
            :alt="`${selected.name}真实字符成品`"
            width="864"
            height="1080"
          /><span>{{ selected.modeLabel }} · 真实成品预览</span>
        </div>
        <div class="dialog-copy">
          <span class="art-eyebrow">ORIGINAL STARTER · 免费体验</span>
          <h2 id="template-title">{{ selected.name }}</h2>
          <p class="dialog-effects">
            {{ selected.motionLabel }}微动 · {{ selected.hoverLabel }}悬停
          </p>
          <h3>适合什么素材</h3>
          <p>{{ selected.suitedTo }}</p>
          <h3>从这里开始调整</h3>
          <p>{{ selected.adjust }}</p>
          <div class="template-includes">
            <strong>打开后，你可以</strong>
            <p>替换原图、调整颜色与动效，免费下载成品或完整作品包。每次使用都会创建新项目。</p>
          </div>
          <p v-if="busy" class="launch-status" role="status">
            {{ phase === 'loading' ? '正在读取模板…' : '正在保存新的本地项目…' }}
          </p>
          <p v-if="error" class="launch-error" role="alert">
            {{ error }}
            <RouterLink v-if="error.includes('已保存')" to="/projects">打开我的项目</RouterLink>
          </p>
          <button
            class="art-button primary launch-template"
            :disabled="busy"
            @click="startCreating"
          >
            {{ busy ? '正在准备…' : '用这个模板创作' }} <ArtIcon :size="17" />
          </button>
          <RouterLink class="dialog-help" to="/help">查看使用帮助 ↗</RouterLink>
        </div>
      </div>
    </dialog>
    <ArtFooter />
  </div>
</template>

<style scoped>
.templates-hero {
  background: #111615;
  color: #f5f3ef;
  overflow: hidden;
}
.hero-content {
  display: grid;
  grid-template-columns: 1.3fr 1fr;
  align-items: center;
  gap: 50px;
  padding-top: 72px;
  padding-bottom: 72px;
}
.templates-hero .art-eyebrow {
  color: var(--art-cyan);
  font-size: 11px;
}
.templates-hero h1 {
  font-size: clamp(38px, 5vw, 66px);
  line-height: 1.15;
  letter-spacing: 1px;
  margin: 22px 0;
}
.templates-hero p {
  color: #b9c4b7;
  font-size: 14px;
  line-height: 1.9;
  margin: 0 0 30px;
}
.hero-help {
  display: block;
  width: fit-content;
  margin-top: 22px;
  color: #bac9bc;
  font-size: 12px;
  text-underline-offset: 5px;
}
.collection-symbol {
  min-height: 320px;
  position: relative;
  display: grid;
  place-items: center;
  isolation: isolate;
}
.collection-symbol::before,
.collection-symbol::after {
  content: '';
  position: absolute;
  width: 270px;
  height: 270px;
  border: 1px solid #476459;
  border-radius: 50%;
  transform: rotate(-25deg) scaleX(1.35);
  z-index: -1;
}
.collection-symbol::after {
  width: 230px;
  height: 230px;
  transform: rotate(25deg) scaleX(1.4);
  border-color: #58e8ed45;
}
.collection-symbol span {
  font: 150px var(--art-serif);
  color: #dbe9d8;
  letter-spacing: -8px;
}
.collection-symbol i {
  position: absolute;
  width: 6px;
  height: 6px;
  background: var(--art-cyan);
  top: 26px;
  right: 100px;
  border-radius: 50%;
  box-shadow: 0 0 22px #58e8edaa;
}
.collection-symbol small {
  position: absolute;
  bottom: 8px;
  color: #93aa9e;
  font:
    10px Consolas,
    monospace;
  letter-spacing: 3px;
}
.templates-main {
  padding-top: 54px;
  padding-bottom: 58px;
  scroll-margin-top: 20px;
}
.collection-heading {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: end;
}
.collection-heading h2 {
  font-size: 32px;
  margin: 12px 0 0;
}
.collection-heading > p {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.8;
  text-align: right;
}
.template-tools {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  margin: 30px 0 14px;
}
.template-filters {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.template-filters button {
  min-height: 44px;
}
.template-search {
  display: flex;
  gap: 12px;
  align-items: center;
  border-bottom: 1px solid var(--border);
  padding: 8px 4px;
}
.template-search input {
  width: 200px;
  min-height: 28px;
  border: none;
  background: transparent;
  font: 13px var(--font-body);
  color: var(--art-ink);
  outline: none;
}
.template-search:focus-within {
  border-color: #078c91;
}
.filter-count {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 20px;
}
.template-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 26px;
}
.starter-card {
  border: 1px solid var(--art-line);
  background: var(--bg-elevated);
  border-radius: 12px;
  overflow: hidden;
}
.template-preview {
  width: 100%;
  display: block;
  aspect-ratio: 4/5;
  border: 0;
  padding: 0;
  position: relative;
  overflow: hidden;
  background: #111615;
  cursor: pointer;
}
.template-preview img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  transition: transform 0.4s;
}
.template-preview:hover img {
  transform: scale(1.025);
}
.preview-tag {
  position: absolute;
  top: 18px;
  left: 18px;
  padding: 8px 12px;
  border: 1px solid #ffffff33;
  background: #111615dc;
  color: #f5f3ef;
  font-size: 11px;
  border-radius: 25px;
}
.preview-open {
  position: absolute;
  right: 18px;
  bottom: 18px;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--art-cyan);
  color: #111615;
  transition: transform 0.2s;
}
.template-preview:hover .preview-open {
  transform: rotate(-35deg);
}
.starter-card-content {
  padding: 24px;
}
.starter-card-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.starter-card-title h3 {
  font-size: 25px;
  margin: 0;
}
.starter-card-title > span {
  font-size: 11px;
  color: var(--accent);
  white-space: nowrap;
}
.effect-label {
  font-size: 12px;
  color: var(--text-muted);
  margin: 12px 0;
}
.effect-label span {
  margin: 0 6px;
}
.template-fit {
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-muted);
  min-height: 70px;
  margin-bottom: 18px;
}
.template-detail-button {
  border: none;
  border-top: 1px solid var(--art-line);
  background: none;
  width: 100%;
  color: var(--art-ink);
  font: 13px var(--font-body);
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 48px;
  padding-top: 15px;
  cursor: pointer;
}
.template-empty {
  border: 1px dashed var(--border);
  padding: 40px 20px;
  text-align: center;
}
.template-empty p {
  color: var(--text-muted);
  font-size: 13px;
}
.template-next {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 32px;
  border-top: 1px solid var(--art-line);
  margin-top: 58px;
  padding-top: 36px;
}
.template-next h2 {
  font-size: 30px;
  margin: 12px 0;
}
.template-next p {
  font-size: 13px;
  line-height: 1.8;
  max-width: 600px;
  color: var(--text-muted);
}
.template-next .art-button {
  flex-shrink: 0;
}
.template-dialog {
  border: 1px solid #d1d6cb;
  border-radius: 16px;
  width: min(940px, calc(100% - 40px));
  max-height: calc(100dvh - 40px);
  padding: 0;
  color: var(--art-ink);
  background: #f5f3ef;
  overflow-y: auto;
}
.template-dialog::backdrop {
  background: #07120fcc;
}
.template-dialog-content {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr);
  position: relative;
}
.dialog-close {
  position: absolute;
  z-index: 1;
  top: 12px;
  right: 12px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid #c2c8bf;
  background: #f5f3ef;
  display: grid;
  place-items: center;
  cursor: pointer;
}
.dialog-close:disabled {
  opacity: 0.4;
}
.dialog-preview {
  background: #111615;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.dialog-preview img {
  width: 100%;
  height: auto;
  display: block;
}
.dialog-preview > span {
  padding: 20px;
  text-align: center;
  font-size: 11px;
  color: #bdc9b9;
}
.dialog-copy {
  padding: 60px 34px 30px;
}
.dialog-copy .art-eyebrow {
  color: var(--accent);
  font-size: 10px;
  letter-spacing: 1px;
}
.dialog-copy h2 {
  font: 36px var(--art-serif);
  margin: 16px 0 10px;
}
.dialog-effects {
  color: var(--text-muted);
  margin-bottom: 30px;
}
.dialog-copy h3 {
  font: 600 13px var(--font-body);
  margin: 22px 0 8px;
}
.dialog-copy p {
  font-size: 13px;
  line-height: 1.8;
}
.template-includes {
  border-top: 1px solid var(--art-line);
  margin-top: 25px;
  padding-top: 20px;
}
.template-includes strong {
  font-size: 13px;
}
.template-includes p {
  color: var(--text-muted);
}
.launch-template {
  width: 100%;
  margin-top: 12px;
}
.dialog-help {
  display: block;
  width: fit-content;
  padding: 14px 0 0;
  min-height: 44px;
  font-size: 12px;
  color: var(--accent);
  text-underline-offset: 4px;
}
.launch-error {
  color: #9a3030;
}
.launch-status {
  color: var(--accent);
}
.templates-page button:focus-visible,
.templates-page a:focus-visible {
  outline: 3px solid #078c91;
  outline-offset: 4px;
}
.template-preview:focus-visible {
  outline-offset: -4px !important;
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
@media (max-width: 1100px) {
  .hero-content {
    gap: 20px;
  }
  .collection-symbol::before {
    transform: rotate(-25deg) scaleX(1.15);
  }
  .collection-symbol::after {
    transform: rotate(25deg) scaleX(1.2);
  }
  .starter-card-content {
    padding: 18px;
  }
  .starter-card-title {
    align-items: start;
    flex-direction: column;
    gap: 8px;
  }
}
@media (max-width: 800px) {
  .hero-content {
    grid-template-columns: 1fr;
    padding-top: 42px;
    padding-bottom: 42px;
  }
  .collection-symbol {
    display: none;
  }
  .collection-heading {
    align-items: start;
    flex-direction: column;
    gap: 10px;
  }
  .collection-heading > p {
    text-align: left;
  }
  .template-grid {
    grid-template-columns: 1fr;
    gap: 28px;
  }
  .template-preview {
    max-height: 470px;
  }
  .template-tools,
  .template-next {
    align-items: stretch;
    flex-direction: column;
  }
  .template-search input {
    width: 100%;
  }
  .starter-card-title {
    flex-direction: row;
    align-items: center;
  }
  .template-fit {
    min-height: 0;
  }
  .template-dialog-content {
    grid-template-columns: 1fr;
  }
  .dialog-preview img {
    height: 160px;
    object-fit: contain;
  }
  .dialog-preview > span {
    padding: 12px;
  }
  .dialog-copy {
    padding: 25px;
  }
  .dialog-copy h2 {
    font-size: 30px;
  }
  .collection-heading h2 {
    font-size: 27px;
  }
  .template-next h2 {
    font-size: 26px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .templates-page :deep(*) {
    transition: none !important;
    animation: none !important;
  }
  .template-preview:hover img,
  .template-preview:hover .preview-open,
  .templates-page .art-button:hover {
    transform: none;
  }
  [data-reveal] {
    opacity: 1 !important;
    transform: none !important;
  }
}
</style>
