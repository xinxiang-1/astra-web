<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import FxButton from '@/components/ui/FxButton.vue'
import { useFilePreviewStore } from '@/stores/filePreview'

const ACCEPT =
  '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.ofd,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.zip,.rar,.7z'

const router = useRouter()
const preview = useFilePreviewStore()

const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const error = ref('')
const selected = ref<File | null>(null)

const selectedMeta = computed(() => {
  if (!selected.value) return ''
  const size =
    selected.value.size < 1024 * 1024
      ? `${(selected.value.size / 1024).toFixed(1)} KB`
      : `${(selected.value.size / (1024 * 1024)).toFixed(1)} MB`
  return `${selected.value.name} · ${size}`
})

function pickFile(file: File | undefined | null) {
  error.value = ''
  if (!file) return
  selected.value = file
}

function onInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  pickFile(input.files?.item(0))
}

function onDrop(event: DragEvent) {
  dragging.value = false
  pickFile(event.dataTransfer?.files?.item(0))
}

function openPicker() {
  fileInput.value?.click()
}

function clearSelected() {
  selected.value = null
  error.value = ''
  if (fileInput.value) fileInput.value.value = ''
}

function goPreview() {
  if (!selected.value) {
    error.value = '请先选择一个文件'
    return
  }
  preview.setFile(selected.value)
  void router.push({ name: 'file-preview' })
}
</script>

<template>
  <div class="upload-page">
    <header class="head">
      <p class="eyebrow">本地预览</p>
      <h1>上传文件</h1>
      <p class="lead">
        文件留在浏览器内，不会上传到服务器。支持 Office、PDF、图片与常见压缩包。
      </p>
    </header>

    <section
      class="dropzone"
      :class="{ dragging, filled: Boolean(selected) }"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <input
        ref="fileInput"
        class="sr-only"
        type="file"
        :accept="ACCEPT"
        @change="onInputChange"
      />

      <template v-if="!selected">
        <p class="drop-title">拖拽文件到这里</p>
        <p class="drop-hint">或点击下方按钮从本地选择</p>
        <FxButton variant="primary" type="button" @click="openPicker">
          选择文件
        </FxButton>
      </template>

      <template v-else>
        <p class="file-name">{{ selected.name }}</p>
        <p class="file-meta">{{ selectedMeta }}</p>
        <div class="actions">
          <FxButton variant="primary" type="button" @click="goPreview">
            打开预览
          </FxButton>
          <FxButton variant="ghost" type="button" @click="openPicker">
            更换文件
          </FxButton>
          <FxButton variant="soft" type="button" @click="clearSelected">
            清除
          </FxButton>
        </div>
      </template>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <p class="note">
      预览使用 FlyFish File Viewer（Office preset），按路由懒加载，离开预览页会释放渲染实例。
    </p>
  </div>
</template>

<style scoped>
.upload-page {
  --display: 'Syne', 'Segoe UI', sans-serif;
  --body: 'DM Sans', 'Segoe UI', sans-serif;
  max-width: 720px;
  margin: 0 auto;
  padding: 5.5rem 1.25rem 3rem;
  font-family: var(--body);
}

.head {
  margin-bottom: 1.75rem;
}

.eyebrow {
  margin: 0 0 0.45rem;
  color: var(--text-faint);
  font-size: 0.78rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 0.55rem;
  font-family: var(--display);
  font-size: clamp(1.8rem, 4vw, 2.4rem);
  font-weight: 700;
  letter-spacing: -0.03em;
}

.lead {
  margin: 0;
  max-width: 38rem;
  color: var(--text-muted);
  line-height: 1.55;
}

.dropzone {
  display: grid;
  gap: 0.75rem;
  justify-items: start;
  min-height: 240px;
  padding: 1.75rem;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  background:
    radial-gradient(120% 80% at 10% 0%, var(--glow-a), transparent 55%),
    var(--bg-elevated);
  box-shadow: var(--shadow);
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    transform 0.18s ease;
}

.dropzone.dragging {
  border-color: var(--accent);
  transform: translateY(-1px);
}

.dropzone.filled {
  border-style: solid;
}

.drop-title {
  margin: 0;
  font-family: var(--display);
  font-size: 1.2rem;
  font-weight: 650;
}

.drop-hint,
.file-meta,
.note {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.5;
}

.file-name {
  margin: 0;
  font-family: var(--display);
  font-size: 1.15rem;
  font-weight: 650;
  word-break: break-all;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  margin-top: 0.35rem;
}

.error {
  margin: 0.9rem 0 0;
  color: var(--danger);
  font-size: 0.9rem;
}

.note {
  margin-top: 1.25rem;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
