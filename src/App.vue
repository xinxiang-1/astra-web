<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import {
  authRouteNames,
  studioRouteNames,
  toolRouteNames,
} from '@/content/catalog'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'

const route = useRoute()
const auth = useAuthStore()
useThemeStore()

const routeName = computed(() => String(route.name ?? ''))

const isAuthPage = computed(() =>
  (authRouteNames as readonly string[]).includes(routeName.value),
)
const isLanding = computed(() => routeName.value === 'home')
const isStudioHub = computed(() => routeName.value === 'studio')
const isToolPage = computed(() =>
  (toolRouteNames as readonly string[]).includes(routeName.value),
)
const isStudioEffect = computed(
  () =>
    (studioRouteNames as readonly string[]).includes(routeName.value) &&
    !isStudioHub.value,
)

/** Full-bleed FX under a translucent topbar */
const isImmersive = computed(
  () => isLanding.value || isStudioHub.value || isStudioEffect.value,
)

const isScrollable = computed(
  () =>
    isLanding.value ||
    isStudioHub.value ||
    isToolPage.value,
)
</script>

<template>
  <div
    class="app-shell"
    :class="{
      immersive: isImmersive,
      auth: isAuthPage,
      scrollable: isScrollable,
    }"
  >
    <header class="topbar">
      <RouterLink v-if="!isAuthPage" class="brand" to="/">Astra</RouterLink>
      <span v-else class="topbar-spacer" aria-hidden="true" />
      <nav>
        <template v-if="!isAuthPage">
          <RouterLink class="nav-primary" to="/ascii-art">字符画</RouterLink>
          <RouterLink to="/tools">工具</RouterLink>
          <RouterLink to="/studio">工作室</RouterLink>
        </template>
        <ThemeToggle />
        <template v-if="!isAuthPage && auth.isLoggedIn">
          <span class="user">{{ auth.user?.name }}</span>
          <button type="button" class="nav-btn" @click="auth.logout()">
            退出
          </button>
        </template>
        <RouterLink
          v-else-if="!isAuthPage"
          class="login-link"
          to="/login"
        >
          登录
        </RouterLink>
        <RouterLink v-else class="back-link" to="/">← 返回</RouterLink>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
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
    background-color 0.25s ease,
    color 0.25s ease;
}

body:has(.app-shell.scrollable) {
  overflow: auto;
}

a {
  color: inherit;
}
</style>

<style scoped>
.app-shell {
  display: grid;
  grid-template-rows: auto 1fr;
  height: 100%;
  background: var(--bg);
  color: var(--text);
}

.app-shell.auth {
  grid-template-rows: 1fr;
}

.app-shell.auth .topbar {
  position: absolute;
  inset: 0 0 auto;
  border-bottom-color: transparent;
  background: transparent;
  backdrop-filter: none;
  padding-top: 0.7rem;
  padding-bottom: 0.7rem;
}

.app-shell.auth main {
  height: 100%;
}

.topbar {
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.85rem 1.25rem;
  border-bottom: 1px solid var(--border);
  background: var(--topbar);
  backdrop-filter: blur(14px);
}

.app-shell.scrollable {
  height: auto;
  min-height: 100%;
}

.app-shell.scrollable main {
  height: auto;
  min-height: 100vh;
  min-height: 100dvh;
}

.immersive .topbar {
  position: absolute;
  inset: 0 0 auto;
  border-bottom-color: transparent;
  background: linear-gradient(
    to bottom,
    rgba(0, 0, 0, 0.5),
    transparent
  );
  color: #eef2ff;
}

.immersive .topbar .brand,
.immersive .topbar nav a,
.immersive .topbar .user,
.immersive .topbar .nav-btn {
  color: rgba(238, 242, 255, 0.82);
}

.immersive .topbar nav a:hover,
.immersive .topbar nav a.router-link-active {
  color: #fff;
}

.brand {
  font-family: var(--font-display);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-decoration: none;
  text-transform: uppercase;
  font-size: 0.9rem;
}

nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.65rem;
}

nav a {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.8125rem;
  transition: color 0.15s ease;
}

nav a.nav-primary {
  font-weight: 600;
  color: var(--text);
}

nav a.router-link-active,
nav a:hover {
  color: var(--text);
}

.topbar-spacer {
  width: 1px;
  height: 1px;
}

.login-link {
  padding: 0.35rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--bg-soft);
}

.back-link {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.8125rem;
  transition: color 0.15s ease;
}

.back-link:hover {
  color: var(--text);
}

.user {
  color: var(--text-muted);
  font-size: 0.86rem;
}

.nav-btn {
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-muted);
  padding: 0.3rem 0.7rem;
  cursor: pointer;
  font: inherit;
  font-size: 0.86rem;
}

.nav-btn:hover {
  color: var(--text);
  background: var(--bg-soft);
}

main {
  min-height: 0;
  height: 100%;
}

@media (max-width: 560px) {
  nav {
    gap: 0.5rem;
  }

  nav a:not(.login-link):not(.back-link) {
    font-size: 0.78rem;
  }
}
</style>
