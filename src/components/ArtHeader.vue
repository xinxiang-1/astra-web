<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import ArtIcon from '@/components/ui/ArtIcon.vue'
import { useAuthStore } from '@/stores/auth'
const menu = ref(false)
const route = useRoute()
const auth = useAuthStore()
watch(
  () => route.fullPath,
  () => {
    menu.value = false
  },
)
</script>
<template>
  <header class="art-header">
    <RouterLink to="/" class="art-wordmark" aria-label="Astra 首页">Astra</RouterLink>
    <nav aria-label="主导航" :class="{ expanded: menu }">
      <RouterLink to="/gallery">作品</RouterLink
      ><RouterLink class="how-link" :to="{ path: '/', hash: '#how-it-works' }" :class="{ 'at-section': route.hash === '#how-it-works' }">如何创作</RouterLink
      ><RouterLink to="/studio">实验室 <span>↗</span></RouterLink
      ><RouterLink class="projects-link" to="/projects">我的项目</RouterLink>
    </nav>
    <div class="header-actions">
      <RouterLink v-if="!auth.isLoggedIn" class="header-login" to="/login">登录</RouterLink
      ><button v-else class="header-login" @click="void auth.logout()">退出</button
      ><RouterLink to="/ascii-art" class="art-button primary"
        >免费制作 <ArtIcon :size="16" /></RouterLink
      ><button
        class="menu-button"
        :aria-expanded="menu"
        aria-label="切换导航菜单"
        @click="menu = !menu"
      >
        <ArtIcon :name="menu ? 'close' : 'menu'" />
      </button>
    </div>
  </header>
</template>
<style scoped>
.art-header {
  height: 76px;
  padding: 0 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #111615;
  color: #f4f0e8;
  gap: 24px;
  border-bottom: 1px solid #ffffff13;
  position: relative;
  z-index: 30;
}
.art-wordmark {
  font-size: 35px;
}
.art-header nav {
  display: flex;
  align-items: center;
  gap: 35px;
  margin-left: auto;
  margin-right: auto;
}
.art-header nav a {
  font-size: 12px;
  letter-spacing: 1px;
  text-decoration: none;
  color: #bfc4ba;
  padding: 28px 0;
  position: relative;
}
.art-header nav a.router-link-exact-active:after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  bottom: 16px;
  background: var(--art-cyan);
}
.art-header nav a:hover {
  color: white;
}
.art-header nav .how-link:not(.at-section)::after { display: none; }
.art-header nav span {
  font-size: 10px;
  color: #7d847b;
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 24px;
}
.header-login {
  font: 12px var(--font-body);
  text-decoration: none;
  color: #bec5b9;
  background: none;
  border: 0;
  cursor: pointer;
}
.header-actions .art-button {
  font-size: 12px;
  min-height: 39px;
  padding: 10px 22px;
  gap: 17px;
}
.menu-button {
  display: none;
  color: inherit;
  background: none;
  border: 0;
  min-width: 44px;
  min-height: 44px;
}
.art-header a:focus-visible,
.art-header button:focus-visible {
  outline: 2px solid var(--art-cyan);
  outline-offset: 4px;
}
@media (max-width: 1000px) {
  .art-header {
    padding: 0 28px;
  }
  .art-header nav {
    gap: 22px;
  }
  .header-actions {
    gap: 16px;
  }
}
@media (max-width: 700px) {
  .art-header {
    height: 66px;
    padding: 0 22px;
    gap: 12px;
  }
  .menu-button {
    display: grid;
    place-items: center;
  }
  .header-actions .art-button {
    display: none;
  }
  .art-header nav {
    display: none;
  }
  .art-header nav.expanded {
    display: flex;
    position: absolute;
    top: 66px;
    left: 0;
    right: 0;
    background: #171e1a;
    padding: 12px 22px 25px;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
    box-shadow: 0 20px 30px #0003;
  }
  .art-header nav a {
    padding: 16px;
  }
  .art-header nav a.router-link-exact-active:after {
    bottom: 9px;
    left: 16px;
    right: auto;
    width: 25px;
  }
  .art-wordmark {
    font-size: 32px;
  }
}
</style>
