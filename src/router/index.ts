import { createRouter, createWebHistory } from 'vue-router'

import AsciiArtView from '@/views/AsciiArtView.vue'
import AuthView from '@/views/AuthView.vue'
import BlackHoleView from '@/views/BlackHoleView.vue'
import FluidView from '@/views/FluidView.vue'
import HomeView from '@/views/HomeView.vue'
import PrismView from '@/views/PrismView.vue'
import WebglFluidView from '@/views/WebglFluidView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    {
      path: '/login',
      name: 'login',
      component: AuthView,
      props: { initialMode: 'login' },
    },
    {
      path: '/register',
      name: 'register',
      component: AuthView,
      props: { initialMode: 'register' },
    },
    { path: '/ascii-art', name: 'ascii-art', component: AsciiArtView },
    { path: '/prism', name: 'prism', component: PrismView },
    { path: '/black-hole', name: 'black-hole', component: BlackHoleView },
    { path: '/fluid', name: 'fluid', component: FluidView },
    { path: '/webgl-fluid', name: 'webgl-fluid', component: WebglFluidView },
  ],
})

export default router
