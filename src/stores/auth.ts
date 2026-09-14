import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

export type AuthMode = 'login' | 'register'

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

  function logout() {
    user.value = null
    lastMessage.value = ''
  }

  return { user, pending, lastMessage, isLoggedIn, login, register, logout }
})

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}
