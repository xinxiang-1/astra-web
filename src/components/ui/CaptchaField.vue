<script setup lang="ts">
import UiInput from './UiInput.vue'
defineProps<{ image?: string; loading?: boolean }>()
const model = defineModel<string>()
const emit = defineEmits<{ refresh: []; enter: [] }>()
</script>

<template>
  <div class="captcha-field">
    <div class="captcha-label">
      <span>图形验证码</span
      ><button type="button" :disabled="loading" @click="emit('refresh')">换一张</button>
    </div>
    <div class="captcha-shell" :aria-busy="loading">
      <UiInput
        v-model="model"
        aria-label="图形验证码"
        name="captcha"
        maxlength="6"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        placeholder="输入右侧字符"
        @keyup.enter.prevent="emit('enter')"
      />
      <button
        class="captcha-shot"
        type="button"
        :disabled="loading"
        aria-label="刷新图形验证码"
        @click="emit('refresh')"
      >
        <img v-if="image" :src="image" alt="验证码字符" draggable="false" />
        <span v-else role="status">{{ loading ? '正在加载…' : '点击加载' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.captcha-field {
  display: grid;
  gap: 0.45rem;
  min-width: 0;
}
.captcha-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--text-muted);
  font-size: 0.8rem;
}
.captcha-label button {
  padding: 0.4rem 0;
  min-height: 32px;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}
.captcha-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(112px, 38%);
  gap: 0.5rem;
}
.captcha-shell input {
  letter-spacing: 0.12em;
  text-transform: uppercase;
}
.captcha-shot {
  display: grid;
  place-items: center;
  min-width: 0;
  min-height: 44px;
  padding: 4px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-soft);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
}
.captcha-shot:hover {
  border-color: var(--border-strong);
  background: var(--bg-soft-hover);
}
button:disabled {
  opacity: 0.6;
  cursor: wait;
}
.captcha-shot img {
  display: block;
  width: 100%;
  height: 38px;
  object-fit: contain;
  border-radius: 4px;
  user-select: none;
  pointer-events: none;
}
</style>
