<script setup lang="ts">
import { computed, reactive } from 'vue'

import { WebglFluidEffect } from '@/views/packages/effects'

const config = reactive({
  backgroundColor: '#000000',
  trigger: 'hover' as 'hover' | 'click',
  immediate: true,
  auto: false,
  colorful: true,
  bloom: true,
  sunrays: true,
  densityDissipation: 1,
  splatRadius: 0.25,
})

/** webgl-fluid 只在初始化时读配置，改参后用 key 重建实例 */
const effectKey = computed(() => JSON.stringify(config))

const presets = [
  { label: '纯黑', color: '#000000' },
  { label: '深蓝', color: '#04101f' },
  { label: '墨绿', color: '#06140f' },
  { label: '酒红底', color: '#1a0508' },
  { label: '浅灰', color: '#d8d8d8' },
]
</script>

<template>
  <div class="page">
    <WebglFluidEffect
      :key="effectKey"
      :background-color="config.backgroundColor"
      :trigger="config.trigger"
      :immediate="config.immediate"
      :auto="config.auto"
      :colorful="config.colorful"
      :bloom="config.bloom"
      :sunrays="config.sunrays"
      :density-dissipation="config.densityDissipation"
      :splat-radius="config.splatRadius"
    />
    <aside class="panel">
      <h2>彩烟配置</h2>
      <label>
        背景色
        <input v-model="config.backgroundColor" type="color" />
        <code>{{ config.backgroundColor }}</code>
      </label>
      <div class="presets">
        <button
          v-for="p in presets"
          :key="p.color"
          type="button"
          @click="config.backgroundColor = p.color"
        >
          {{ p.label }}
        </button>
      </div>
      <label>
        触发
        <select v-model="config.trigger">
          <option value="hover">hover 移动</option>
          <option value="click">click 按住</option>
        </select>
      </label>
      <label class="check">
        <input v-model="config.bloom" type="checkbox" />
        Bloom 辉光
      </label>
      <label class="check">
        <input v-model="config.sunrays" type="checkbox" />
        Sunrays 丁达尔
      </label>
      <label class="check">
        <input v-model="config.colorful" type="checkbox" />
        彩色染料
      </label>
      <label class="check">
        <input v-model="config.auto" type="checkbox" />
        自动喷溅
      </label>
      <label>
        消散速度 {{ config.densityDissipation.toFixed(1) }}
        <input
          v-model.number="config.densityDissipation"
          type="range"
          min="0.2"
          max="3"
          step="0.1"
        />
      </label>
      <label>
        喷溅半径 {{ config.splatRadius.toFixed(2) }}
        <input v-model.number="config.splatRadius" type="range" min="0.1" max="0.8" step="0.05" />
      </label>
      <p class="note">调整配置后，当前烟雾将重新开始。</p>
    </aside>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  height: 100%;
  min-height: 0;
}
.panel {
  position: absolute;
  top: calc(var(--site-header-height) + 16px);
  right: 1rem;
  z-index: 5;
  display: grid;
  gap: 0.65rem;
  width: min(230px, calc(100vw - 2rem));
  max-height: calc(100% - var(--site-header-height) - 32px);
  overflow: auto;
  padding: 0.9rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  background: #111615eb;
  color-scheme: dark;
  backdrop-filter: blur(12px);
  color: #f4f0e8;
  font-size: 0.82rem;
}
h2 {
  margin: 0;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #a0afa1;
  font-weight: 600;
}
label {
  display: grid;
  gap: 0.3rem;
  color: #c4cec1;
}
label.check {
  min-height: 44px;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.5rem;
}
select,
input[type='color'],
input[type='range'] {
  width: 100%;
}
select,
input[type='color'] {
  min-height: 44px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
}
input[type='color'] {
  padding: 0.15rem;
  cursor: pointer;
}
code {
  font-size: 0.75rem;
  color: #a0afa1;
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.presets button {
  min-height: 44px;
  padding: 0.3rem 0.55rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.05);
  color: inherit;
  font-size: 0.72rem;
  cursor: pointer;
}
.presets button:hover {
  background: rgba(255, 255, 255, 0.12);
}
.note {
  margin: 0;
  color: rgba(238, 242, 255, 0.45);
  font-size: 0.7rem;
  line-height: 1.4;
}
</style>
