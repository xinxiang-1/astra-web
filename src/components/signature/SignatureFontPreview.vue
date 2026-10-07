<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { loadSignatureFont, SIGNATURE_FONTS, type SignatureFontId } from '@/lib/signature-portrait/fonts'
const props = defineProps<{ font: SignatureFontId; text: string }>()
const family = ref('')
const error = ref('')
const loading = ref(false)
let controller: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | undefined
watch(() => [props.font, props.text], () => {
  controller?.abort(); clearTimeout(timer); family.value = ''; error.value = ''; loading.value = true
  timer = setTimeout(async () => {
    const current = new AbortController(); controller = current
    try { family.value = await loadSignatureFont(props.font, props.text.trim() || '名字', current.signal) }
    catch (e) { if (!current.signal.aborted) error.value = e instanceof Error ? e.message : '字体加载失败' }
    finally { if (controller === current) { loading.value = false; controller = null } }
  }, 180)
}, { immediate: true })
onBeforeUnmount(() => { controller?.abort(); clearTimeout(timer) })
</script>

<template>
  <div class="font-preview" aria-label="所选字体预览" aria-live="polite">
    <span class="sample" :style="family ? { fontFamily: `'${family}'` } : undefined">{{ family ? text.trim() || '名字' : loading ? '正在加载字体…' : '字体暂未加载' }}</span>
    <span class="caption">{{ SIGNATURE_FONTS.find(f => f.id === font)?.name }} · 字体辅助写法</span>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.font-preview { padding: 12px 16px; margin-block: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg); overflow-wrap: anywhere; }
.sample { display: block; font-size: 2rem; line-height: 1.6; color: var(--text); }
.caption, p { font-size: .75rem; color: var(--text-muted); }
</style>
