<script setup lang="ts">
import { computed, ref } from 'vue'
import ArtIcon from '@/components/ui/ArtIcon.vue'
const open = defineModel<boolean>({ required: true })
const props = defineProps<{
  video: boolean
  phrase: boolean
  busy: boolean
  progress: string
  error: string
  name: string
  preview: string
}>()
const emit = defineEmits<{
  export: [options: { format: string; name: string; longEdge: number; transparent: boolean }]
}>()
const format = ref('png')
const longEdge = ref(2048)
const transparent = ref(false)
const filename = ref('')
const formats = [
  { id: 'png', label: 'PNG', sub: '图片', icon: 'image' },
  { id: 'mp4', label: '视频', sub: 'MP4 / WebM', icon: 'image' },
  { id: 'live-html', label: '动态网页', sub: 'HTML', icon: 'sliders' },
  { id: 'txt', label: '文本', sub: 'TXT', icon: 'menu' },
]
const unavailable = (id: string) =>
  (id === 'mp4' && !props.video) || (id === 'live-html' && props.phrase)
const valid = computed(() => !unavailable(format.value))
function submit() {
  if (valid.value)
    emit('export', {
      format: format.value,
      name: filename.value.trim() || props.name || 'astra-art',
      longEdge: longEdge.value,
      transparent: transparent.value,
    })
}
</script>
<template>
  <el-drawer
    v-model="open"
    class="art-export-drawer"
    title="导出作品"
    size="min(580px, 100%)"
    :close-on-click-modal="!busy"
    :close-on-press-escape="!busy"
    :show-close="!busy"
    :before-close="
      (done: () => void) => {
        if (!busy) done()
      }
    "
    ><div class="export-content">
      <span class="art-eyebrow">READY FOR THE WORLD</span>
      <h2>让你的创作，<br />走向更大的世界。</h2>
      <p class="export-intro">选择格式，把这份灵感带走。</p>
      <img v-if="preview" :src="preview" alt="当前字符作品" class="export-thumbnail" />
      <h3>格式</h3>
      <div class="format-grid">
        <button
          v-for="item in formats"
          :key="item.id"
          :disabled="busy || unavailable(item.id)"
          :title="
            unavailable(item.id)
              ? item.id === 'mp4'
                ? '上传视频后可用'
                : '切换至字符模式后可用'
              : item.label
          "
          :class="{ selected: format === item.id }"
          @click="format = item.id"
        >
          <ArtIcon :name="item.icon" :size="23" /><b>{{ item.label }}</b
          ><small>{{ item.sub }}</small>
        </button>
      </div>
      <p class="format-hint">
        {{
          format === 'live-html'
            ? '动态网页在打开时需要联网加载动效引擎。'
            : format === 'mp4'
              ? '导出当前视频选段；不支持 MP4 的浏览器会保存为 WebM。'
              : format === 'txt'
                ? '下载可复制、可编辑的纯字符文本。'
                : '保留当前作品的文字与色彩。视频会导出当前帧。'
        }}
      </p>
      <template v-if="format === 'png'"
        ><h3>长边尺寸</h3>
        <div class="size-options">
          <button
            v-for="n in [1080, 2048, 3840]"
            :key="n"
            :disabled="busy"
            :class="{ selected: longEdge === n }"
            @click="longEdge = n"
          >
            {{ n === 1080 ? '1080 px' : n === 2048 ? '2K' : '4K' }}
          </button>
        </div>
        <label class="transparent-toggle"
          ><span>透明背景</span
          ><input v-model="transparent" type="checkbox" :disabled="busy" /></label></template
      ><label class="filename-label"
        >文件名<input
          v-model="filename"
          :placeholder="name || 'astra-art'"
          maxlength="100"
          :disabled="busy"
      /></label>
      <div class="export-free">
        <ArtIcon name="check" />
        <div>
          <b>当前版本，所有导出免费</b>
          <p>无需订阅，专注于你的创作。</p>
        </div>
      </div>
      <p v-if="error" role="alert" class="export-error">{{ error }}</p>
      <button class="art-button primary export-submit" :disabled="busy || !valid" @click="submit">
        <ArtIcon name="download" />{{ busy ? `正在导出 ${progress}` : '免费下载作品'
        }}<ArtIcon v-if="!busy" :size="17" />
      </button>
      <p class="export-bottom">
        <ArtIcon name="shield" :size="16" /> 在你的浏览器中生成 · 文件直接保存到设备
      </p>
    </div></el-drawer
  >
</template>
<style>
.art-export-drawer {
  background: #f5f3ef !important;
  color: #151918 !important;
  color-scheme: light;
  --el-color-primary: #087b82;
  --el-text-color-primary: #151918;
  --el-text-color-regular: #151918;
}
.art-export-drawer .el-drawer__header {
  margin: 0;
  padding: 26px 30px 0;
  color: #151918;
}
.art-export-drawer .el-drawer__title {
  font: 30px var(--art-serif);
}
.art-export-drawer .el-drawer__body {
  padding: 26px 30px;
}
.export-content h2 {
  font: 28px/1.5 var(--art-serif);
  margin: 13px 0;
}
.export-intro {
  color: #7b7f74;
  font-size: 12px;
}
.export-content > .art-eyebrow {
  color: #7b8273;
  font-size: 9px;
}
.export-thumbnail {
  height: 140px;
  width: 100%;
  object-fit: contain;
  background: #111615;
  margin: 12px 0;
  display: block;
  border-radius: 3px;
}
.export-content h3 {
  font-size: 12px;
  font-weight: 500;
  margin: 22px 0 12px;
}
.format-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.format-grid button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: none;
  border: 1px solid #dcded4;
  color: #1c271b;
  border-radius: 4px;
  padding: 18px 4px;
  cursor: pointer;
  font: 12px var(--font-body);
}
.format-grid button.selected {
  border-color: #16aeb6;
  background: #e9fafa;
}
.format-grid button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.format-grid small {
  font-size: 10px;
  color: #777e70;
}
.format-grid b {
  font-weight: 500;
}
.format-hint {
  font-size: 11px;
  line-height: 1.8;
  color: #7d8375;
  min-height: 20px;
}
.size-options {
  display: flex;
  gap: 8px;
}
.size-options button {
  background: #e7e8e0;
  color: #333c2b;
  border: 0;
  border-radius: 30px;
  padding: 10px 24px;
  flex: 1;
  font: 12px var(--font-body);
  cursor: pointer;
}
.size-options .selected {
  background: #192018;
  color: #fff;
}
.transparent-toggle {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 20px 0;
  font-size: 12px;
}
.transparent-toggle input {
  accent-color: #087b82;
  width: 17px;
  height: 17px;
}
.filename-label {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 12px;
  margin: 22px 0;
}
.filename-label input {
  padding: 12px;
  border: 1px solid #d5d8cc;
  color: #151918;
  background: transparent;
  border-radius: 3px;
  font: 13px var(--font-body);
  width: 100%;
}
.export-free {
  background: #e9ede4;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
}
.export-free svg {
  background: #12858b;
  border-radius: 50%;
  padding: 5px;
  box-sizing: content-box;
  color: white;
}
.export-free b {
  font-size: 12px;
  font-weight: 500;
}
.export-free p {
  font-size: 11px;
  color: #7d8474;
  margin: 6px 0 0;
}
.export-submit {
  width: 100%;
  margin-top: 20px;
}
.export-bottom {
  font-size: 10px;
  color: #858b7c;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 20px;
}
.export-error {
  color: #ad3528;
  font-size: 12px;
}
.export-content button:focus-visible {
  outline: 2px solid #087b82;
  outline-offset: 3px;
}
@media (max-width: 600px) {
  .art-export-drawer .el-drawer__body {
    padding: 22px;
  }
  .art-export-drawer .el-drawer__header {
    padding: 24px 22px 0;
  }
  .export-content h2 {
    font-size: 24px;
  }
  .format-grid {
    gap: 5px;
  }
}
</style>
