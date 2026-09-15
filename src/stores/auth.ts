import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type AuthMode = 'login' | 'register' | 'forgot' | 'wechat'

export interface AuthUser {
  email: string
  name: string
}

/** Frontend-only auth shell — replace with real API later. */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const pending = ref(false)
  const lastMessage = ref('')

  const isLoggedIn = computed(() => user.value !== null)

  async function login(email: string, _password: string) {
    pending.value = true
    lastMessage.value = ''
    try {
      await wait(450)
      user.value = {
        email,
        name: email.split('@')[0] || 'Astra',
      }
      lastMessage.value = '登录成功（前端模拟）'
      return true
    } finally {
      pending.value = false
    }
  }

  async function register(name: string, email: string, _password: string) {
    pending.value = true
    lastMessage.value = ''
    try {
      await wait(550)
      user.value = { email, name: name.trim() || email.split('@')[0] || 'Astra' }
      lastMessage.value = '注册成功（前端模拟）'
      return true
    } finally {
      pending.value = false
    }
  }

  async function requestPasswordReset(email: string) {
    pending.value = true
    lastMessage.value = ''
    try {
      await wait(500)
      lastMessage.value = `重置链接已发送至 ${email}（前端模拟）`
      return true
    } finally {
      pending.value = false
    }
  }

  /** Simulate WeChat QR scan confirm. */
  async function loginWithWechat(ticket: string) {
    pending.value = true
    lastMessage.value = ''
    try {
      await wait(400)
      const short = ticket.slice(-4) || '0000'
      user.value = {
        email: `wx_${short}@wechat.local`,
        name: `微信用户_${short}`,
      }
      lastMessage.value = '微信登录成功（前端模拟）'
      return true
    } finally {
      pending.value = false
    }
  }

  function logout() {
    user.value = null
    lastMessage.value = ''
  }

  return {
    user,
    pending,
    lastMessage,
    isLoggedIn,
    login,
    register,
    requestPasswordReset,
    loginWithWechat,
    logout,
  }
})

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
