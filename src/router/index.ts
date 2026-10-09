import { createRouter, createWebHistory } from 'vue-router'

import AsciiArtView from '@/views/AsciiArtView.vue'
import AuthView from '@/views/AuthView.vue'
import BlackHoleView from '@/views/BlackHoleView.vue'
import FluidView from '@/views/FluidView.vue'
import HomeView from '@/views/ArtHomeView.vue'
import PrismView from '@/views/PrismView.vue'
import StudioView from '@/views/StudioView.vue'
import ToolsView from '@/views/ToolsView.vue'
import WebglFluidView from '@/views/WebglFluidView.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/art-lab', name: 'art-lab', component: () => import('@/views/ArtEngineView.vue') },
    { path: '/gallery', name: 'gallery', component: () => import('@/views/GalleryView.vue') },
    { path: '/templates', name: 'templates', component: () => import('@/views/TemplatesView.vue') },
    {
      path: '/collections',
      name: 'collections',
      component: () => import('@/views/CommerceCatalogView.vue'),
    },
    {
      path: '/collections/:slug',
      name: 'collection-detail',
      component: () => import('@/views/CommerceCatalogView.vue'),
      props: true,
    },
    {
      path: '/help',
      name: 'creation-help',
      component: () => import('@/views/CreationHelpView.vue'),
    },
    { path: '/projects', name: 'projects', component: () => import('@/views/ProjectsView.vue') },
    { path: '/admin/refunds', name: 'admin-refunds', component: () => import('@/views/AdminRefundsView.vue') },
    { path: '/admin/reconciliations', name: 'admin-reconciliations', component: () => import('@/views/AdminReconciliationsView.vue') },
    { path: '/admin/orders/:orderId/verification', name: 'admin-payment-verification', component: () => import('@/views/AdminPaymentVerificationView.vue'), props: true },
    {
      path: '/account/orders',
      name: 'account-orders',
      component: () => import('@/views/AccountCommerceView.vue'),
      props: { collection: 'orders' },
    },
    {
      path: '/account/orders/:orderId',
      name: 'account-order-detail',
      component: () => import('@/views/OrderDetailView.vue'),
      props: true,
    },
    {
      path: '/account/library',
      name: 'account-library',
      component: () => import('@/views/AccountCommerceView.vue'),
      props: { collection: 'library' },
    },
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
    {
      path: '/forgot',
      name: 'forgot',
      component: AuthView,
      props: { initialMode: 'forgot' },
    },
    {
      path: '/login/wechat',
      name: 'wechat-login',
      component: AuthView,
      props: { initialMode: 'wechat' },
    },
    { path: '/tools', name: 'tools', component: ToolsView },
    { path: '/studio', name: 'studio', component: StudioView },
    { path: '/ascii-art', name: 'ascii-art', component: AsciiArtView },
    {
      path: '/ascii-loop',
      name: 'ascii-loop',
      component: () => import('@/views/AsciiLoopView.vue'),
    },
    {
      path: '/ascii-live',
      name: 'ascii-live',
      component: () => import('@/views/AsciiLiveView.vue'),
    },
    {
      path: '/signature-portrait',
      name: 'signature-portrait',
      component: () => import('@/views/SignaturePortraitView.vue'),
    },
    {
      path: '/file-upload',
      name: 'file-upload',
      component: () => import('@/views/FileUploadView.vue'),
    },
    {
      path: '/file-preview',
      name: 'file-preview',
      component: () => import('@/views/FilePreviewView.vue'),
    },
    { path: '/prism', name: 'prism', component: PrismView },
    { path: '/black-hole', name: 'black-hole', component: BlackHoleView },
    { path: '/fluid', name: 'fluid', component: FluidView },
    { path: '/webgl-fluid', name: 'webgl-fluid', component: WebglFluidView },
  ],
  scrollBehavior(to) {
    return to.hash ? { el: to.hash, top: 20 } : { top: 0 }
  },
})

export default router
