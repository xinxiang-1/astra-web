<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'

const props = withDefaults(
  defineProps<{
    to?: string
    variant?: 'primary' | 'ghost' | 'soft'
    type?: 'button' | 'submit'
    disabled?: boolean
  }>(),
  {
    variant: 'soft',
    type: 'button',
    disabled: false,
  },
)

const isLink = computed(() => Boolean(props.to))

function onMove(event: MouseEvent) {
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const x = ((event.clientX - rect.left) / rect.width) * 100
  const y = ((event.clientY - rect.top) / rect.height) * 100
  el.style.setProperty('--bx', `${x}%`)
  el.style.setProperty('--by', `${y}%`)
}
</script>

<template>
  <RouterLink
    v-if="isLink && to && !disabled"
    class="fx-btn"
    :class="variant"
    :to="to"
    @mousemove="onMove"
  >
    <span class="shine" aria-hidden="true" />
    <span class="label"><slot /></span>
  </RouterLink>
  <button
    v-else
    class="fx-btn"
    :class="variant"
    :type="type"
    :disabled="disabled"
    @mousemove="onMove"
  >
    <span class="shine" aria-hidden="true" />
    <span class="label"><slot /></span>
  </button>
</template>

<style scoped>
.fx-btn {
  --bx: 50%;
  --by: 50%;
  position: relative;
  isolation: isolate;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 1.15rem;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--bg-soft);
  color: var(--text);
  text-decoration: none;
  cursor: pointer;
  font: 500 13px var(--font-body);
  transition:
    transform 0.18s ease,
    background 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.fx-btn:hover {
  background: var(--bg-soft-hover);
  border-color: var(--border-strong);
  transform: translateY(-1px);
}

.fx-btn:active {
  transform: translateY(0);
}

.fx-btn:disabled {
  opacity: 0.65;
  cursor: not-allowed;
  transform: none;
}

.fx-btn.primary {
  border-color: transparent;
  background: var(--action-bg);
  color: var(--action-text);
  font-weight: 600;
  box-shadow: 0 4px 20px #58e8ed10;
}

.fx-btn.primary:hover {
  box-shadow: 0 8px 28px #58e8ed28;
}

.fx-btn.ghost {
  background: transparent;
}

.shine {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0;
  background: radial-gradient(
    120px circle at var(--bx) var(--by),
    color-mix(in srgb, var(--accent) 35%, transparent),
    transparent 60%
  );
  transition: opacity 0.2s ease;
}

.fx-btn:hover .shine {
  opacity: 1;
}

.label {
  position: relative;
  z-index: 1;
}

@media (prefers-reduced-motion: reduce) {
  .fx-btn:hover,
  .fx-btn:active {
    transform: none;
  }
  .shine {
    display: none;
  }
}
</style>
