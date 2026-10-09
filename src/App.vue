<script setup lang="ts">
import { computed, nextTick, onBeforeMount, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { ElConfigProvider } from 'element-plus'
import ArtHeader from '@/components/ArtHeader.vue'
import ArtFooter from '@/components/ArtFooter.vue'
import { authRouteNames, studioRouteNames, toolRouteNames } from '@/content/catalog'
import { routeTitles } from '@/content/navigation'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { ACCESS_TOKEN_KEY } from '@/api/http'

const route = useRoute(),
  auth = useAuthStore()
useThemeStore()
const main = ref<HTMLElement>()
const routeName = computed(() => String(route.name ?? ''))
const isEditor = computed(() => ['ascii-art', 'art-lab'].includes(routeName.value))
const isAuthPage = computed(() => (authRouteNames as readonly string[]).includes(routeName.value))
const isStudioHub = computed(() => routeName.value === 'studio')
const isToolPage = computed(() => (toolRouteNames as readonly string[]).includes(routeName.value))
const isImmersive = computed(
  () => (studioRouteNames as readonly string[]).includes(routeName.value) && !isStudioHub.value,
)
const isScrollable = computed(() => !isEditor.value && !isImmersive.value)
const hasSharedFooter = computed(
  () =>
    (isToolPage.value && !isEditor.value && routeName.value !== 'file-preview') ||
    isStudioHub.value,
)

function focusMain(event?: MouseEvent) {
  event?.preventDefault()
  main.value?.focus({ preventScroll: true })
}
watch(
  routeName,
  (name) => {
    document.title = `${routeTitles[name] ?? '创作'} · Astra`
  },
  { immediate: true },
)
watch(
  () => route.path,
  async () => {
    await nextTick()
    focusMain()
  },
)
function synchronizeSession(event: StorageEvent) {
  if (event.storageArea === localStorage && (event.key === ACCESS_TOKEN_KEY || event.key === null))
    void auth.synchronizeSession()
}
onMounted(() => {
  window.addEventListener('storage', synchronizeSession)
})
onBeforeMount(() => { void auth.restoreSession() })
onBeforeUnmount(() => window.removeEventListener('storage', synchronizeSession))
</script>

<template>
  <ElConfigProvider :message="{ offset: 92, showClose: true }">
    <div
      class="app-shell"
      :class="{
        immersive: isImmersive,
        auth: isAuthPage,
        scrollable: isScrollable,
        editor: isEditor,
      }"
    >
      <a class="skip-link" href="#main-content" @click="focusMain">跳到主要内容</a>
      <ArtHeader v-if="!isEditor" :immersive="isImmersive" :account="isAuthPage" show-theme />
      <main id="main-content" ref="main" tabindex="-1"><RouterView /></main>
      <ArtFooter v-if="hasSharedFooter" />
    </div>
  </ElConfigProvider>
</template>

<style>
* {
  box-sizing: border-box;
}
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
}
body {
  overflow: hidden;
  font-family: var(--font-body);
  background: var(--bg);
  color: var(--text);
  transition:
    background-color 0.25s,
    color 0.25s;
}
body:has(.app-shell.scrollable) {
  overflow: auto;
}
a {
  color: inherit;
}
button,
input,
select,
textarea {
  font: inherit;
}
:where(a, button, input, select, textarea, summary):focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
</style>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
}
main {
  min-width: 0;
  min-height: 0;
}
main:focus {
  outline: none;
}
.app-shell.scrollable main {
  min-height: calc(100dvh - var(--site-header-height));
}
.app-shell.auth main {
  height: calc(100dvh - var(--site-header-height));
  min-height: 500px;
}
.app-shell.editor {
  display: block;
  height: 100%;
}
.app-shell.editor main {
  height: 100%;
}
.app-shell.immersive {
  display: block;
  position: relative;
  height: 100dvh;
  overflow: clip;
}
.app-shell.immersive main {
  height: 100%;
}
.skip-link {
  position: fixed;
  z-index: 100;
  inset: 8px auto auto 16px;
  padding: 12px 18px;
  border-radius: 4px;
  background: var(--art-cyan);
  color: #102020;
  font-size: 14px;
  text-decoration: none;
  transform: translateY(-180%);
}
.skip-link:focus {
  transform: none;
  outline: 2px solid #102020;
  outline-offset: 3px;
}
</style>
