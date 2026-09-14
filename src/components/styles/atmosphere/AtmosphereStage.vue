<script setup lang="ts">
/**
 * 氛围舞台：可复用壳。
 * preset=auth → 轻量大气 Aurora + 胶片颗粒（登录/注册推荐）
 * preset=soft → 更淡的 Aurora
 * preset=bare → 仅壳，自行 #layers 组合
 */
import AuroraField from './AuroraField.vue'
import FilmGrain from './FilmGrain.vue'

withDefaults(
  defineProps<{
    preset?: 'auth' | 'soft' | 'bare'
  }>(),
  {
    preset: 'auth',
  },
)
</script>

<template>
  <div class="atmosphere-stage" :data-preset="preset">
    <div class="fx-layers" aria-hidden="true">
      <slot name="layers">
        <template v-if="preset !== 'bare'">
          <AuroraField :intensity="preset === 'soft' ? 'soft' : 'grand'" />
          <FilmGrain :opacity="preset === 'auth' ? 0.05 : 0.03" />
        </template>
      </slot>
    </div>
    <div class="content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.atmosphere-stage {
  position: relative;
  isolation: isolate;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--text);
  background: var(--bg);
}

.atmosphere-stage[data-preset='auth'] {
  background:
    radial-gradient(
      ellipse 90% 60% at 50% -20%,
      color-mix(in srgb, var(--accent) 18%, transparent),
      transparent 55%
    ),
    radial-gradient(circle at 50% 100%, #0a1020 0%, var(--bg) 55%);
}

[data-theme='light'] .atmosphere-stage[data-preset='auth'] {
  background:
    radial-gradient(
      ellipse 90% 55% at 50% -15%,
      color-mix(in srgb, var(--accent) 16%, transparent),
      transparent 55%
    ),
    var(--bg);
}

.fx-layers {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
}

.content {
  position: relative;
  z-index: 1;
  height: 100%;
  min-height: 0;
}
</style>
