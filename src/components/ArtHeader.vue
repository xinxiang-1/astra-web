<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import ArtIcon from '@/components/ui/ArtIcon.vue'
import AstraLogo from '@/components/ui/AstraLogo.vue'
import ThemeToggle from '@/components/ui/ThemeToggle.vue'
import { siteNavigation } from '@/content/navigation'
import { studioRouteNames, toolRouteNames } from '@/content/catalog'
import { useAuthStore } from '@/stores/auth'

withDefaults(defineProps<{ immersive?: boolean; account?: boolean; showTheme?: boolean }>(), {
  immersive: false,
  account: false,
  showTheme: false,
})
const menu = ref(false)
const root = ref<HTMLElement>()
const toggle = ref<HTMLButtonElement>()
const route = useRoute()
const auth = useAuthStore()
let widthPreference: MediaQueryList | null = null
const section = computed(() => {
  const name = String(route.name ?? '')
  if ((toolRouteNames as readonly string[]).includes(name)) return 'tools'
  if ((studioRouteNames as readonly string[]).includes(name)) return 'studio'
  if (route.hash === '#how-it-works') return 'guide'
  return name
})
function closeMenu(restoreFocus = false) {
  menu.value = false
  if (restoreFocus) toggle.value?.focus()
}
function onKey(event: KeyboardEvent) {
  if (menu.value && event.key === 'Escape') {
    event.preventDefault()
    closeMenu(true)
  }
}
function onOutside(event: PointerEvent) {
  if (menu.value && event.target instanceof Node && !root.value?.contains(event.target)) closeMenu()
}
function onWidth() {
  if (widthPreference?.matches) closeMenu()
}
watch(
  () => route.fullPath,
  () => closeMenu(),
)
onMounted(() => {
  widthPreference = matchMedia('(min-width: 1181px)')
  widthPreference.addEventListener('change', onWidth)
  document.addEventListener('keydown', onKey)
  document.addEventListener('pointerdown', onOutside)
})
onBeforeUnmount(() => {
  widthPreference?.removeEventListener('change', onWidth)
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('pointerdown', onOutside)
})
</script>

<template>
  <header
    ref="root"
    class="art-header"
    :class="{ 'is-immersive': immersive, 'is-account': account }"
  >
    <RouterLink to="/" class="art-wordmark" aria-label="Astra 首页"><AstraLogo /></RouterLink>
    <button
      v-if="!account"
      ref="toggle"
      type="button"
      class="menu-button"
      :aria-expanded="menu"
      aria-controls="site-navigation"
      aria-label="切换导航菜单"
      @click="menu = !menu"
    >
      <ArtIcon :name="menu ? 'close' : 'menu'" />
    </button>
    <nav v-if="!account" id="site-navigation" aria-label="主导航" :class="{ expanded: menu }">
      <RouterLink
        v-for="item in siteNavigation"
        :key="item.to"
        :to="item.to"
        :aria-current="
          item.group === 'guide' && route.path === '/' && route.hash === '#how-it-works'
            ? 'location'
            : route.path === item.to
              ? 'page'
              : undefined
        "
        :class="{ 'section-active': section === item.group }"
      >
        {{ item.label }}<span v-if="item.group === 'studio'" aria-hidden="true"> ↗</span>
      </RouterLink>
      <RouterLink class="mobile-create" to="/ascii-art">免费制作 <ArtIcon :size="16" /></RouterLink>
    </nav>
    <div class="header-actions">
      <ThemeToggle v-if="showTheme" compact />
      <template v-if="!account">
        <RouterLink v-if="!auth.isLoggedIn" class="header-login" to="/login">登录</RouterLink>
        <button
          v-else
          type="button"
          class="header-login"
          :disabled="auth.pending"
          @click="void auth.logout()"
        >
          退出
        </button>
        <RouterLink to="/ascii-art" class="art-button primary"
          >免费制作 <ArtIcon :size="16"
        /></RouterLink>
      </template>
      <RouterLink v-else class="header-back" to="/">返回首页 <ArtIcon :size="16" /></RouterLink>
    </div>
  </header>
</template>

<style scoped>
.art-header {
  --text: #f4f0e8;
  --text-muted: #bfc4ba;
  --border: #ffffff26;
  --border-strong: #ffffff55;
  --bg-soft: #ffffff08;
  --bg-soft-hover: #ffffff16;
  --accent: var(--art-cyan);
  --accent-2: var(--art-cyan);
  height: var(--site-header-height);
  padding: 0 clamp(22px, 3.8vw, 56px);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  background: #111615;
  color: #f4f0e8;
  gap: clamp(16px, 2vw, 28px);
  border-bottom: 1px solid #ffffff18;
  position: relative;
  z-index: 30;
}
.art-header.is-immersive {
  position: absolute;
  inset: 0 0 auto;
  background: #111615e8;
  backdrop-filter: blur(14px);
}
.art-header.is-account {
  grid-template-columns: auto 1fr;
}
.art-wordmark {
  display: inline-flex;
  align-items: center;
  width: fit-content;
}
.art-header nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: clamp(18px, 2.1vw, 30px);
}
.art-header nav a {
  position: relative;
  padding: 28px 0;
  white-space: nowrap;
  color: #bfc4ba;
  font: 12px var(--font-body);
  letter-spacing: 0.6px;
  text-decoration: none;
  transition: color 0.2s;
}
.art-header nav a::after {
  content: '';
  position: absolute;
  inset: auto 0 17px;
  height: 2px;
  background: var(--art-cyan);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 0.25s var(--ease-out);
}
.art-header nav a.section-active {
  color: #f4f0e8;
}
.art-header nav a.section-active::after,
.art-header nav a:hover::after,
.art-header nav a:focus-visible::after {
  transform: scaleX(1);
}
.art-header nav a:hover {
  color: #fff;
}
.art-header nav span {
  color: #9ca79e;
}
.header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 18px;
}
.header-login,
.header-back {
  font: 12px var(--font-body);
  color: #c5cec4;
  text-decoration: none;
  background: none;
  border: 0;
  cursor: pointer;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
.header-back {
  gap: 12px;
}
.header-actions .art-button {
  font-size: 12px;
  min-height: 44px;
  padding: 10px 18px;
  gap: 14px;
}
.menu-button {
  display: none;
  color: inherit;
  background: transparent;
  border: 1px solid #ffffff28;
  border-radius: 50%;
  width: 44px;
  height: 44px;
  cursor: pointer;
}
.art-header nav .mobile-create {
  display: none;
}
.art-header a:focus-visible,
.art-header button:focus-visible {
  outline: 2px solid var(--art-cyan);
  outline-offset: 4px;
}
@media (max-width: 1180px) {
  .art-header {
    grid-template-columns: auto minmax(0, 1fr) auto;
  }
  .menu-button {
    display: grid;
    place-items: center;
    grid-column: 3;
    grid-row: 1;
  }
  .header-actions {
    grid-column: 2;
    grid-row: 1;
  }
  .art-header nav {
    display: none;
  }
  .art-header nav.expanded {
    display: flex;
    position: absolute;
    top: var(--site-header-height);
    inset-inline: 0;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    padding: 12px 22px 22px;
    background: #171e1a;
    border-bottom: 1px solid #ffffff26;
    box-shadow: 0 20px 30px #0003;
    max-height: calc(100dvh - var(--site-header-height));
    overflow-y: auto;
  }
  .art-header nav a {
    padding: 15px 12px;
    min-height: 48px;
    border-radius: 4px;
  }
  .art-header nav a::after {
    inset: auto auto 8px 12px;
    width: 26px;
  }
  .art-header nav a:hover {
    background: #ffffff08;
  }
  .art-header nav .mobile-create {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--art-cyan);
    border-top: 1px solid #ffffff24;
    margin-top: 8px;
    padding-top: 20px;
  }
}
@media (max-width: 700px) {
  .art-header {
    gap: 12px;
  }
  .header-actions {
    gap: 10px;
  }
  .header-actions .art-button {
    display: none;
  }
  .art-wordmark :deep(.astra-logo) {
    width: 122px;
    height: 28px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .art-header nav a::after {
    transition: none;
  }
}
</style>
