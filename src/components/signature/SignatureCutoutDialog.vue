<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import FxButton from '@/components/ui/FxButton.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import RenderFeedback from '@/components/ui/RenderFeedback.vue'
import { cutoutSignature, cutoutToStamp, prepareSignaturePhoto } from '@/lib/signature-portrait/cutout-client'
import type { SignatureCutoutSettings } from '@/lib/signature-portrait/signature-cutout'
import type { SignatureStamp } from '@/lib/signature-portrait/extract'

const props = defineProps<{ files: File[] }>()
const emit = defineEmits<{ accept: [stamps: SignatureStamp[]]; cancel: [] }>()
const dialog = ref<HTMLDialogElement>()
const index = ref(0)
const file = computed(() => props.files[index.value])
const originalUrl = ref('')
const candidate = shallowRef<SignatureStamp | null>(null)
const accepted: SignatureStamp[] = []
const polarity = ref<SignatureCutoutSettings['polarity']>('auto')
const sensitivity = ref(60)
const busy = ref(false)
const error = ref('')
const warning = ref('')
let pixels: ImageData | null = null
let controller: AbortController | null = null
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false

function releaseCandidate() {
  if (candidate.value) candidate.value.canvas.width = candidate.value.canvas.height = 1
  candidate.value = null
}
async function process(load: boolean) {
  controller?.abort()
  const current = new AbortController()
  controller = current
  busy.value = true; error.value = ''; warning.value = ''
  releaseCandidate()
  try {
    const input = file.value
    if (!input) return
    if (load) {
      pixels = null
      if (originalUrl.value) URL.revokeObjectURL(originalUrl.value)
      originalUrl.value = URL.createObjectURL(input)
      pixels = await prepareSignaturePhoto(input, current.signal)
    }
    if (!pixels) return
    const result = await cutoutSignature(pixels, { polarity: polarity.value, sensitivity: sensitivity.value }, current.signal)
    if (current.signal.aborted || disposed) return
    candidate.value = cutoutToStamp(result, input)
    if (result.coverage > 0.55) warning.value = '提取区域较密，请确认没有残留纸面或阴影；可调低力度，或上传裁切后的签名。'
  } catch (e) {
    if (!current.signal.aborted && !disposed) error.value = e instanceof Error ? e.message : '签名抠图失败'
  } finally {
    if (controller === current) { controller = null; busy.value = false }
  }
}
function accept() {
  if (!candidate.value || busy.value) return
  if ([...accepted, candidate.value].reduce((sum, stamp) => sum + stamp.width * stamp.height, 0) > 16 * 1024 * 1024) {
    error.value = '签名模板总量超过64MB，请减少图片数量或先裁切签名区域。'
    return
  }
  accepted.push(candidate.value); candidate.value = null
  if (index.value < props.files.length - 1) { index.value++; void process(true) }
  else { emit('accept', accepted.slice()); accepted.length = 0 }
}
watch([polarity, sensitivity], () => {
  controller?.abort(); releaseCandidate(); busy.value = true
  clearTimeout(timer)
  timer = setTimeout(() => void process(!pixels), 180)
})
onMounted(async () => { await nextTick(); dialog.value?.showModal(); void process(true) })
onBeforeUnmount(() => {
  disposed = true; clearTimeout(timer); controller?.abort(); dialog.value?.close()
  if (originalUrl.value) URL.revokeObjectURL(originalUrl.value)
  releaseCandidate()
  for (const stamp of accepted) stamp.canvas.width = stamp.canvas.height = 1
})
</script>

<template>
  <dialog ref="dialog" class="cutout-dialog" aria-labelledby="cutout-title" @cancel.prevent="emit('cancel')">
    <div class="dialog-head">
      <div><h2 id="cutout-title">提取手写签名</h2><p>{{ file?.name }} · {{ index + 1 }}/{{ files.length }}</p></div>
      <FxButton type="button" aria-label="取消签名抠图" @click="emit('cancel')">关闭</FxButton>
    </div>
    <p>先去除纸面背景，再将完整笔迹加入画像。棋盘格表示透明区域，请确认每个字都保留。</p>
    <div class="comparison">
      <figure><figcaption>上传原图</figcaption><div class="photo"><img :src="originalUrl" alt="上传的签名原图" /></div></figure>
      <figure><figcaption>透明笔迹预览</figcaption><div class="checker"><img v-if="candidate" :src="candidate.previewUrl" alt="去除背景后的手写签名" /><span v-else>{{ busy ? '正在提取笔迹…' : '调整参数后重试' }}</span></div></figure>
    </div>
    <div class="controls">
      <label>笔迹类型<UiSelect v-model="polarity" aria-label="抠图笔迹类型"><option value="auto">自动判断</option><option value="dark">深色笔迹 · 浅色纸面</option><option value="light">浅色笔迹 · 深色底</option></UiSelect></label>
      <label>提取力度 {{ sensitivity }}<input v-model.number="sensitivity" aria-label="签名提取力度" type="range" min="0" max="100" /><small>浅笔迹可调高；纸面残留可调低。</small></label>
    </div>
    <RenderFeedback v-if="busy" title="正在后台抠出笔迹" detail="完成后可检查透明预览；可以随时取消。" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="warning" role="status">{{ warning }}</p>
    <div class="actions"><FxButton type="button" @click="emit('cancel')">取消上传</FxButton><FxButton v-if="error" type="button" :disabled="busy" @click="process(!pixels)">重新提取</FxButton><FxButton type="button" variant="primary" :disabled="!candidate || busy" @click="accept">{{ index < files.length - 1 ? '确认笔迹，下一张' : '确认并加入画像' }}</FxButton></div>
    <p class="note">建议只拍摄签名区域。纹理纸、横线和复杂背景请先裁切；此步骤保留原笔迹形状。</p>
  </dialog>
</template>

<style scoped>
.cutout-dialog { width: min(900px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; box-sizing: border-box; padding: 24px; color: var(--text); background: var(--bg-elevated); border: 1px solid var(--border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow); }
.cutout-dialog::backdrop { background: rgb(0 0 0 / 55%); }
.dialog-head, .actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
h2 { margin: 0; font-size: 1.3rem; }
p, small { color: var(--text-muted); line-height: 1.6; font-size: .85rem; }
.comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; }
figure { margin: 0; min-width: 0; }
figcaption { margin-bottom: 8px; font-size: .85rem; }
.photo, .checker { display: flex; align-items: center; justify-content: center; height: 200px; border: 1px solid var(--border); border-radius: var(--radius-md); overflow: hidden; }
.photo { background: var(--bg); }
.checker { background-color: #fff; background-image: conic-gradient(#e2e5e2 25%, transparent 0 50%, #e2e5e2 0 75%, transparent 0); background-size: 20px 20px; color: #26352b; }
img { max-width: 100%; max-height: 100%; object-fit: contain; }
.controls { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
label { display: grid; gap: 8px; font-size: .85rem; }
input { width: 100%; accent-color: var(--accent); }
.actions { justify-content: flex-end; margin-top: 20px; }
.error { color: var(--danger, #c33); }
.note { font-size: .75rem; }
@media (max-width: 600px) { .comparison, .controls { grid-template-columns: 1fr; } .cutout-dialog { padding: 16px; } .photo, .checker { height: 150px; } }
</style>
