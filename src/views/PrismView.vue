<script setup lang="ts">
import { reactive } from 'vue'

import { PrismEffect } from '@/views/packages/effects'

const config = reactive({
  mode: 'dark' as 'dark' | 'light',
  quality: 'auto' as 'auto' | 'high' | 'low',
  wallColor: '#000000',
})

const presets = [
  { label: '纯黑', color: '#000000' },
  { label: '午夜蓝', color: '#0b1220' },
  { label: '炭灰', color: '#1a1a1a' },
  { label: '暖米', color: '#f3efe6' },
  { label: '亮白', color: '#f7f7f7' },
]
</script>

<template>
  <div class="page">
    <PrismEffect
      :mode="config.mode"
      :quality="config.quality"
      :wall-color="config.wallColor"
    />
    <aside class="panel">
      <h2>Prism 配置</h2>
      <label>
        主题
        <select v-model="config.mode">
          <option value="dark">dark 暗色</option>
          <option value="light">light 亮色</option>
        </select>
      </label>
      <label>
        画质
        <select v-model="config.quality">
          <option value="auto">auto</option>
          <option value="high">high</option>
          <option value="low">low</option>
        </select>
      </label>
      <label>
        墙面色
        <input v-model="config.wallColor" type="color" />
        <code>{{ config.wallColor }}</code>
      </label>
      <div class="presets">
        <button
          v-for="p in presets"
          :key="p.color"
          type="button"
          @click="config.wallColor = p.color"
        >
          {{ p.label }}
        </button>
      </div>
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
  top: 4.5rem;
  right: 1rem;
  z-index: 5;
  display: grid;
  gap: 0.7rem;
  width: min(220px, calc(100vw - 2rem));
  padding: 0.9rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  background: rgba(8, 12, 22, 0.72);
  backdrop-filter: blur(12px);
  color: #eef2ff;
  font-size: 0.82rem;
}
h2 {
  margin: 0;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(238, 242, 255, 0.55);
  font-weight: 600;
}
label {
  display: grid;
  gap: 0.35rem;
  color: rgba(238, 242, 255, 0.78);
}
select,
input[type='color'] {
  width: 100%;
  min-height: 2rem;
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
  color: rgba(238, 242, 255, 0.55);
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.presets button {
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
</style>
