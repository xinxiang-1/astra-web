<script setup lang="ts">
import { useThemeStore } from '@/stores/theme'

const theme = useThemeStore()
</script>

<template>
  <button
    type="button"
    class="theme-toggle"
    :aria-label="theme.isDark ? '切换到亮色' : '切换到暗色'"
    :title="theme.isDark ? '亮色' : '暗色'"
    @click="theme.toggle()"
  >
    <span class="track" :class="{ light: !theme.isDark }">
      <span class="thumb" />
    </span>
    <span class="text">{{ theme.isDark ? '暗色' : '亮色' }}</span>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  min-height: 2.2rem;
  padding: 0.2rem 0.55rem 0.2rem 0.25rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--bg-soft);
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.8rem;
  transition:
    background 0.18s ease,
    border-color 0.18s ease,
    color 0.18s ease;
}

.theme-toggle:hover {
  background: var(--bg-soft-hover);
  color: var(--text);
  border-color: var(--border-strong);
}

.track {
  position: relative;
  width: 2.4rem;
  height: 1.3rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--accent) 25%, var(--bg-soft));
}

.thumb {
  position: absolute;
  top: 0.15rem;
  left: 0.15rem;
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
  background: linear-gradient(140deg, var(--accent), var(--accent-2));
  box-shadow: 0 2px 8px color-mix(in srgb, var(--accent) 40%, transparent);
  transition: transform 0.22s ease;
}

.track.light .thumb {
  transform: translateX(1.05rem);
}

.text {
  min-width: 2em;
}
</style>
