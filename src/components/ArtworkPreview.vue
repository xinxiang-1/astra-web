<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ArtworkPreset } from '@/content/artwork'
const props = defineProps<{ art: Pick<ArtworkPreset, 'title' | 'preview'> }>()
const ready = ref(false),
  failed = ref(false)
watch(
  () => props.art.preview,
  () => {
    ready.value = false
    failed.value = false
  },
)
</script>

<template>
  <div class="artwork-preview" :aria-busy="!ready && !failed">
    <img
      :src="art.preview"
      :alt="`${art.title} · 字符作品`"
      width="1122"
      height="1402"
      loading="lazy"
      decoding="async"
      @load="ready = true"
      @error="failed = true"
    />
    <span v-if="!ready" class="preview-state">{{
      failed ? '预览暂时无法加载' : '载入字符作品…'
    }}</span>
  </div>
</template>

<style scoped>
.artwork-preview {
  position: relative;
  width: 100%;
  height: 100%;
  background: #111615;
}
img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.preview-state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #b9c4b8;
  font-size: 12px;
  pointer-events: none;
}
</style>
