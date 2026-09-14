<script setup lang="ts">
/**
 * 轻量 Aurora 场：父级一次 blur + 少量径向色斑，只动画 transform。
 * 参考主流 SaaS / Aurora UI：无 canvas、无粒子 DOM、无 JS 帧循环。
 */
withDefaults(
  defineProps<{
    intensity?: 'soft' | 'grand'
  }>(),
  {
    intensity: 'grand',
  },
)
</script>

<template>
  <div class="aurora" :class="intensity" aria-hidden="true">
    <div class="field">
      <span class="blob b1" />
      <span class="blob b2" />
      <span class="blob b3" />
      <span class="blob b4" />
    </div>
  </div>
</template>

<style scoped>
.aurora {
  --dur: 22s;
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.field {
  position: absolute;
  inset: -28%;
  filter: blur(72px) saturate(1.25);
  opacity: 0.88;
  will-change: transform;
}

.blob {
  position: absolute;
  border-radius: 60% 40% 70% 30% / 50% 60% 40% 50%;
  mix-blend-mode: screen;
  animation: drift var(--dur) ease-in-out infinite alternate;
}

.b1 {
  width: 58%;
  height: 62%;
  top: -8%;
  left: -12%;
  background: radial-gradient(
    ellipse at center,
    color-mix(in srgb, var(--accent) 72%, transparent) 0%,
    transparent 68%
  );
  animation-duration: var(--dur);
}

.b2 {
  width: 50%;
  height: 54%;
  top: -4%;
  right: -10%;
  background: radial-gradient(
    ellipse at center,
    color-mix(in srgb, var(--glow-b) 95%, transparent) 0%,
    transparent 68%
  );
  animation-duration: calc(var(--dur) * 1.25);
  animation-delay: calc(var(--dur) * -0.35);
}

.b3 {
  width: 56%;
  height: 48%;
  bottom: -6%;
  left: 18%;
  background: radial-gradient(
    ellipse at center,
    color-mix(in srgb, var(--glow-c) 90%, transparent) 0%,
    transparent 68%
  );
  animation-duration: calc(var(--dur) * 1.45);
  animation-delay: calc(var(--dur) * -0.55);
}

.b4 {
  width: 42%;
  height: 44%;
  top: 36%;
  left: 38%;
  background: radial-gradient(
    ellipse at center,
    color-mix(in srgb, var(--accent-2) 55%, transparent) 0%,
    transparent 70%
  );
  animation-duration: calc(var(--dur) * 1.1);
  animation-delay: calc(var(--dur) * -0.2);
  opacity: 0.75;
}

.aurora.soft .field {
  filter: blur(88px) saturate(1.1);
  opacity: 0.62;
}

.aurora.grand .field {
  opacity: 0.95;
}

@keyframes drift {
  from {
    transform: translate3d(-2%, 1%, 0) rotate(-6deg) scale(1);
  }
  to {
    transform: translate3d(4%, -3%, 0) rotate(8deg) scale(1.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .blob {
    animation: none;
  }
}

[data-theme='light'] .blob {
  mix-blend-mode: multiply;
}

[data-theme='light'] .field {
  opacity: 0.55;
  filter: blur(80px) saturate(1.15);
}
</style>
