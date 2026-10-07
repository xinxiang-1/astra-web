<script setup lang="ts">
import { computed } from 'vue'
import FxButton from '@/components/ui/FxButton.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import { signatureExportSize } from '@/lib/signature-portrait/ultra-png-export'

const props = defineProps<{ width: number; height: number; disabled: boolean }>()
const longSide = defineModel<8192 | 16384>('longSide', { default: 8192 })
const inkMode = defineModel<'original' | 'outline'>('inkMode', { default: 'outline' })
const emit = defineEmits<{ export: [] }>()
const size = computed(() =>
  props.width > 0 && props.height > 0
    ? signatureExportSize({ width: props.width, height: props.height }, longSide.value)
    : null,
)
</script>

<template>
  <div class="ultra-export" aria-label="超清图片导出">
    <div class="export-head">
      <strong>超清图片</strong
      ><span>{{ size ? `${size.width} × ${size.height} px` : '生成作品后可导出' }}</span>
    </div>
    <div class="export-controls">
      <label
        >输出尺寸<UiSelect v-model="longSide" aria-label="超清导出尺寸" :disabled="disabled"
          ><option :value="8192">8K · 常用超清</option>
          <option :value="16384">16K · 大幅细节</option></UiSelect
        ></label
      >
      <label
        >笔迹方式<UiSelect v-model="inkMode" aria-label="超清笔迹方式" :disabled="disabled"
          ><option value="outline">轮廓重绘 · 推荐</option>
          <option value="original">原笔迹 · 保留浓淡</option></UiSelect
        ></label
      >
      <FxButton
        type="button"
        variant="primary"
        :disabled="disabled || !size"
        @click="emit('export')"
        >下载超清 PNG</FxButton
      >
    </div>
    <p>
      {{
        inkMode === 'outline'
          ? '后台按目标尺寸绘制完整签名轮廓，保留作品排版；下载为PNG，放大笔迹更清晰。'
          : '按原始笔迹重绘，保留透明浓淡；原稿分辨率会影响放大细节。'
      }}{{ longSide === 16384 ? ' 16K文件较大，导出需要更长时间。' : '' }}
    </p>
  </div>
</template>

<style scoped>
.ultra-export {
  padding: 14px;
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg);
}
.export-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  font-size: 0.85rem;
}
.export-head span,
p {
  color: var(--text-muted);
  font-size: 0.75rem;
}
.export-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) auto;
  align-items: end;
  gap: 10px;
}
label {
  display: grid;
  gap: 6px;
  min-width: 0;
  font-size: 0.75rem;
  color: var(--text-muted);
}
p {
  margin: 10px 0 0;
  line-height: 1.65;
}
@media (max-width: 700px) {
  .export-controls {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
