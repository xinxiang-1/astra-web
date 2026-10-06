<script setup lang="ts">
import AstraLogo from '@/components/ui/AstraLogo.vue'
</script>
<template>
  <footer class="art-footer">
    <RouterLink to="/" class="art-wordmark" aria-label="Astra 首页"
      ><AstraLogo :height="32"
    /></RouterLink>
    <p>用文字，创造更多可能。</p>
    <nav aria-label="页脚导航">
      <RouterLink to="/gallery">作品案例</RouterLink
      ><RouterLink to="/templates">原创模板</RouterLink><RouterLink to="/help">创作帮助</RouterLink
      ><RouterLink to="/studio">实验室</RouterLink><RouterLink to="/tools">创作工具</RouterLink
      ><RouterLink to="/projects">我的项目</RouterLink>
    </nav>
    <span class="art-eyebrow">MADE OF CHARACTERS.</span>
  </footer>
</template>
<style scoped>
.art-wordmark {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.art-footer {
  flex-wrap: wrap;
}
.art-footer nav {
  flex-wrap: wrap;
  row-gap: 8px;
}
.art-footer nav a {
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
.art-footer a:hover {
  color: var(--accent);
}
.art-footer a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}
</style>
