import { defineStore } from 'pinia'
import { ElMessage } from 'element-plus'
import { computed, ref } from 'vue'

import * as authApi from '@/api/auth'
import { getAccessToken, setAccessToken, ApiError } from '@/api/http'

export type AuthMode = 'login' | 'register' | 'forgot' | 'wechat'

export interface AuthUser {
  id: string
  email: string
  name: string
  phone?: string
  avatar?: string
}

function mapUser(profile: authApi.AuthUserProfile): AuthUser {
  return {
    id: String(profile.id),
    email: profile.email || profile.phone || '',
    name: profile.nickname || 'Astra',
    phone: profile.phone || undefined,
    avatar: profile.avatar || undefined,
  }
}

function applyToken(payload: authApi.TokenPayload) {
  setAccessToken(payload.accessToken)
  return mapUser(payload.user)
}

function tipOk(message: string) {
  ElMessage.success({ message, duration: 2200 })
}

function tipErr(message: string) {
  ElMessage.error({ message, duration: 3200 })
}

function tipWarn(message: string) {
  ElMessage.warning({ message, duration: 2800 })
}

function errText(err: unknown, fallback = '请求失败') {
  if (err instanceof ApiError) return err.message || fallback
  if (err instanceof Error && err.message) return err.message
  return fallback
}

/** Auth store wired to astra-auth via gateway `/api`. */
export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const pending = ref(false)
  const lastMessage = ref('')

  const isLoggedIn = computed(() => user.value !== null)

  async function withPending<T>(fn: () => Promise<T>, opts?: { silent?: boolean }): Promise<T> {
    pending.value = true
    lastMessage.value = ''
    try {
      return await fn()
    } catch (err) {
      const msg = errText(err)
      lastMessage.value = msg
      if (!opts?.silent) tipErr(msg)
      throw err
    } finally {
      pending.value = false
    }
  }

  async function login(
    account: string,
    password: string,
    captcha: authApi.CaptchaFields,
  ) {
    try {
      const data = await withPending(() =>
        authApi.loginByPassword(account, password, captcha),
      )
      user.value = applyToken(data)
      lastMessage.value = '登录成功'
      tipOk(`欢迎回来，${user.value.name}`)
      return true
    } catch {
      return false
    }
  }

  async function loginByPhone(phone: string, code: string) {
    try {
      const data = await withPending(() => authApi.loginByPhone(phone, code))
      user.value = applyToken(data)
      lastMessage.value = '登录成功'
      tipOk(`欢迎回来，${user.value.name}`)
      return true
    } catch {
      return false
    }
  }

  async function loginByEmail(email: string, code: string) {
    try {
      const data = await withPending(() => authApi.loginByEmail(email, code))
      user.value = applyToken(data)
      lastMessage.value = '登录成功'
      tipOk(`欢迎回来，${user.value.name}`)
      return true
    } catch {
      return false
    }
  }

  async function register(
    name: string,
    email: string,
    password: string,
    captcha: authApi.CaptchaFields,
    phone?: string,
  ) {
    try {
      const data = await withPending(() =>
        authApi.register({
          nickname: name,
          email,
          password,
          phone: phone || undefined,
          ...captcha,
        }),
      )
      user.value = applyToken(data)
      lastMessage.value = '注册成功'
      tipOk('注册成功，已自动登录')
      return true
    } catch {
      return false
    }
  }

  async function sendLoginSms(phone: string, captcha: authApi.CaptchaFields) {
    try {
      await withPending(() => authApi.sendSms(phone, 'login', captcha))
      lastMessage.value = '验证码已发送'
      tipOk(lastMessage.value)
      return true
    } catch {
      return false
    }
  }

  async function sendLoginEmail(email: string, captcha: authApi.CaptchaFields) {
    try {
      const msg = await withPending(() => authApi.sendEmailCode(email, 'login', captcha))
      lastMessage.value = msg || '验证码已发送至邮箱'
      tipOk(lastMessage.value)
      return true
    } catch {
      return false
    }
  }

  async function requestPasswordReset(account: string, captcha: authApi.CaptchaFields) {
    try {
      const msg = await withPending(() => authApi.forgotPassword(account, captcha))
      lastMessage.value = msg || '验证码已发送'
      tipOk(lastMessage.value)
      return true
    } catch {
      return false
    }
  }

  async function resetPassword(account: string, code: string, newPassword: string) {
    try {
      await withPending(() => authApi.resetPassword(account, code, newPassword))
      lastMessage.value = '密码已重置，请登录'
      tipOk(lastMessage.value)
      return true
    } catch {
      return false
    }
  }

  async function startWechatSession() {
    return authApi.createWechatSession()
  }

  async function pollWechatSession(ticket: string) {
    return authApi.pollWechatSession(ticket)
  }

  function acceptToken(payload: authApi.TokenPayload) {
    user.value = applyToken(payload)
  }

  async function loginWithWechat(ticket: string) {
    try {
      const data = await withPending(() => authApi.confirmWechat(ticket))
      user.value = applyToken(data)
      lastMessage.value = '微信登录成功'
      tipOk(`微信登录成功，欢迎 ${user.value.name}`)
      return true
    } catch {
      return false
    }
  }

  async function restoreSession() {
    const token = getAccessToken()
    if (!token) return false
    try {
      const profile = await authApi.fetchMe()
      user.value = mapUser(profile)
      return true
    } catch {
      setAccessToken(null)
      user.value = null
      return false
    }
  }

  async function logout() {
    try {
      if (getAccessToken()) await authApi.logout()
      tipOk('已退出登录')
    } catch (err) {
      tipWarn(errText(err, '退出时发生异常，已清除本地登录态'))
    } finally {
      setAccessToken(null)
      user.value = null
      lastMessage.value = ''
    }
  }

  return {
    user,
    pending,
    lastMessage,
    isLoggedIn,
    login,
    loginByPhone,
    loginByEmail,
    register,
    sendLoginSms,
    sendLoginEmail,
    requestPasswordReset,
    resetPassword,
    startWechatSession,
    pollWechatSession,
    loginWithWechat,
    acceptToken,
    restoreSession,
    logout,
  }
})
