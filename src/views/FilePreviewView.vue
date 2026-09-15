<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import { FileViewer } from '@file-viewer/vue3'
import officePreset from '@file-viewer/preset-office'

import FxButton from '@/components/ui/FxButton.vue'
import { useFilePreviewStore } from '@/stores/filePreview'
import { useThemeStore } from '@/stores/theme'

const router = useRouter()
const preview = useFilePreviewStore()
const theme = useThemeStore()

const fileInput = ref<HTMLInputElement | null>(null)
const viewerFile = ref<File | undefined>()

const options = computed(() => ({
  preset: officePreset,
  rendererMode: 'replace' as const,
  theme: theme.isDark ? ('dark' as const) : ('light' as const),
  styleIsolation: 'shadow' as const,
  toolbar: {
    position: 'bottom-right' as const,
    download: true,
    print: true,
  },
}))

watch(
  () => preview.file,
  (file) => {
    viewerFile.value = file ?? undefined
  },
  { immediate: true },
)

function openPicker() {
  fileInput.value?.click()
}

function onInputChange(event: Event) {
  const input = event.target as HTMLInputElement
  const next = input.files?.item(0)
  if (!next) return
  preview.setFile(next)
}

function clearAndBack() {
  preview.clear()
  void router.push({ name: 'file-upload' })
}
</script>

<template>
  <div class="preview-page">
    <header class="bar">
      <div class="meta">
        <RouterLink class="back" :to="{ name: 'file-upload' }">← 上传</RouterLink>
        <div class="titles">
          <h1>{{ preview.fileName || '文件预览' }}</h1>
          <p v-if="preview.fileSizeLabel">{{ preview.fileSizeLabel }} · 本地预览</p>
        </div>
      </div>
      <div class="actions">
        <input
          ref="fileInput"
          class="sr-only"
          type="file"
          accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.ofd,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.zip,.rar,.7z"
          @change="onInputChange"
        />
        <FxButton variant="ghost" type="button" @click="openPicker">
          更换文件
        </FxButton>
        <FxButton variant="soft" type="button" @click="clearAndBack">
          清除并返回
        </FxButton>
      </div>
    </header>

    <div v-if="viewerFile" class="viewer-shell">
      <FileViewer
        :key="`${viewerFile.name}-${viewerFile.size}-${viewerFile.lastModified}`"
        :file="viewerFile"
        :options="options"
      />
    </div>

    <div v-else class="empty">
      <p>还没有可预览的文件</p>
      <FxButton variant="primary" to="/file-upload">
        去上传
      </FxButton>
    </div>
  </div>
</template>

<style scoped>
.preview-page {
  --display: 'Syne', 'Segoe UI', sans-serif;
  --body: 'DM Sans', 'Segoe UI', sans-serif;
  display: flex;
  flex-direction: column;
  height: calc(100dvh - 3.4rem);
  min-height: 0;
  padding: 4.4rem 1rem 1rem;
  font-family: var(--body);
}

.bar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.85rem;
  margin-bottom: 0.85rem;
}

.meta {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.back {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.82rem;
}

.back:hover {
  color: var(--text);
}

.titles h1 {
  margin: 0;
  max-width: min(70vw, 42rem);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--display);
  font-size: clamp(1.15rem, 2.6vw, 1.55rem);
  font-weight: 700;
}

.titles p {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.86rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem;
}

.viewer-shell {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow);
}

.empty {
  display: grid;
  place-content: center;
  gap: 0.9rem;
  flex: 1;
  min-height: 280px;
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-lg);
  color: var(--text-muted);
  text-align: center;
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
