<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'

import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'

const route = useRoute()
const auth = useAuthStore()
useThemeStore()

const isAuthPage = computed(
  () => route.name === 'login' || route.name === 'register',
)
const isLanding = computed(() => route.name === 'home')
const isImmersive = computed(
  () => isLanding.value || (route.name !== 'home' && !isAuthPage.value),
)
const isScrollable = computed(() => isLanding.value)
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
      <RouterLink class="brand" to="/">Astra</RouterLink>
      <nav>
        <template v-if="!isAuthPage">
          <RouterLink to="/prism">Prism</RouterLink>
          <RouterLink to="/black-hole">黑洞</RouterLink>
          <RouterLink to="/fluid">流体</RouterLink>
          <RouterLink to="/webgl-fluid">彩烟</RouterLink>
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
        <RouterLink v-else class="login-link" to="/">返回</RouterLink>
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
  font-family: 'DM Sans', var(--font);
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
  grid-template-rows: auto 1fr;
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
  font-family: 'Syne', var(--font);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-decoration: none;
  text-transform: uppercase;
}

nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.75rem;
}

nav a {
  color: var(--text-muted);
  text-decoration: none;
  font-size: 0.9rem;
  transition: color 0.15s ease;
}

nav a.router-link-active,
nav a:hover {
  color: var(--text);
}

.login-link {
  padding: 0.35rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-pill);
  background: var(--bg-soft);
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
</style>
