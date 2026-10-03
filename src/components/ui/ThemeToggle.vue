<script setup lang="ts">
import ArtIcon from './ArtIcon.vue'
import { useThemeStore } from '@/stores/theme'
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const theme = useThemeStore()
</script>
<template>
  <button
    type="button"
    class="theme-toggle"
    :class="{ compact }"
    :aria-label="theme.isDark ? '切换到亮色' : '切换到暗色'"
    :title="theme.isDark ? '切换到亮色' : '切换到暗色'"
    @click="theme.toggle()"
  >
    <ArtIcon :name="theme.isDark ? 'sun' : 'moon'" :size="18" />
    <span v-if="!compact">{{ theme.isDark ? '暗色' : '亮色' }}</span>
  </button>
</template>
<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 24px;
  color: var(--text-muted);
  background: transparent;
  cursor: pointer;
  font: 12px var(--font-body);
  transition:
    color 0.2s,
    background 0.2s,
    border-color 0.2s;
}
.theme-toggle.compact {
  width: 44px;
  padding: 0;
}
.theme-toggle:hover {
  color: var(--text);
  background: var(--bg-soft-hover);
  border-color: var(--border-strong);
}
</style>
