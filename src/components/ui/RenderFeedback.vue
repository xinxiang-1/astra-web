<script setup lang="ts">
withDefaults(
  defineProps<{ title: string; detail?: string; progress?: number; progressLabel?: string }>(),
  {
    progressLabel: '作品生成进度',
  },
)
</script>

<template>
  <div class="render-feedback" role="status" aria-live="polite">
    <span class="render-spinner" aria-hidden="true" />
    <div class="render-feedback-copy">
      <strong>{{ title }}</strong>
      <p v-if="detail">{{ detail }}</p>
      <progress
        v-if="progress !== undefined && progress > 0"
        :value="progress"
        max="1"
        :aria-label="progressLabel"
      />
    </div>
  </div>
</template>

<style scoped>
.render-feedback {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  margin: 0.75rem 0;
  padding: 0.9rem;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-elevated));
}
.render-feedback-copy {
  flex: 1;
  min-width: 0;
}
strong {
  font-size: 0.87rem;
  color: var(--text);
}
p {
  margin: 0.3rem 0 0;
  font-size: 0.79rem;
  line-height: 1.6;
  color: var(--text-muted);
}
progress {
  display: block;
  width: 100%;
  height: 5px;
  margin-top: 0.65rem;
  accent-color: var(--accent);
}
.render-spinner {
  flex: 0 0 24px;
  height: 24px;
  border: 2px solid color-mix(in srgb, var(--accent) 20%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: render-spin 1.2s linear infinite;
}
@keyframes render-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .render-spinner {
    animation: none;
  }
}
</style>
