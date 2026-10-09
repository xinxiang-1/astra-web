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
  const revision = ref(0)
  let sessionController: AbortController | null = null
  let pendingOwner: symbol | null = null
  let observedToken = getAccessToken()

  const isLoggedIn = computed(() => user.value !== null)

  function invalidateSessionRequests() {
    revision.value++
    sessionController?.abort()
    sessionController = null
    pendingOwner = null
    pending.value = false
    lastMessage.value = ''
  }

  function beginSessionRequest(signal?: AbortSignal) {
    invalidateSessionRequests()
    const generation = revision.value,
      token = getAccessToken()
    if (token !== observedToken) user.value = null
    observedToken = token
    const controller = new AbortController()
    sessionController = controller
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    return {
      controller,
      signal: combined,
      token,
      current: () =>
        revision.value === generation && getAccessToken() === token && !combined.aborted,
    }
  }

  async function withPending<T>(
    fn: () => Promise<T>,
    opts?: { signal?: AbortSignal; current?: () => boolean },
  ): Promise<T> {
    const owner = Symbol(),
      generation = revision.value
    pendingOwner = owner
    pending.value = true
    lastMessage.value = ''
    try {
      const result = await fn()
      if (
        pendingOwner !== owner ||
        revision.value !== generation ||
        opts?.signal?.aborted ||
        opts?.current?.() === false
      )
        throw new DOMException('操作已取消', 'AbortError')
      return result
    } catch (err) {
      const msg = errText(err)
      if (
        pendingOwner === owner &&
        revision.value === generation &&
        !opts?.signal?.aborted &&
        opts?.current?.() !== false
      ) {
        lastMessage.value = msg
        tipErr(msg)
      }
      throw err
    } finally {
      if (pendingOwner === owner) {
        pendingOwner = null
        pending.value = false
      }
    }
  }

  async function authenticate(
    request: (signal: AbortSignal) => Promise<authApi.TokenPayload>,
    success: (name: string) => string,
    message = '登录成功',
    signal?: AbortSignal,
  ) {
    if (signal?.aborted) return false
    const attempt = beginSessionRequest(signal)
    try {
      const data = await withPending(() => request(attempt.signal), { signal: attempt.signal })
      if (!attempt.current()) return false
      user.value = applyToken(data)
      observedToken = data.accessToken
      lastMessage.value = message
      tipOk(success(user.value.name))
      return true
    } catch {
      return false
    } finally {
      if (sessionController === attempt.controller) sessionController = null
    }
  }

  function login(
    account: string,
    password: string,
    captcha: authApi.CaptchaFields,
    signal?: AbortSignal,
  ) {
    return authenticate(
      (s) => authApi.loginByPassword(account, password, captcha, s),
      (name) => `欢迎回来，${name}`,
      '登录成功',
      signal,
    )
  }

  function loginByPhone(phone: string, code: string, signal?: AbortSignal) {
    return authenticate(
      (s) => authApi.loginByPhone(phone, code, s),
      (name) => `欢迎回来，${name}`,
      '登录成功',
      signal,
    )
  }

  function loginByEmail(email: string, code: string, signal?: AbortSignal) {
    return authenticate(
      (s) => authApi.loginByEmail(email, code, s),
      (name) => `欢迎回来，${name}`,
      '登录成功',
      signal,
    )
  }

  function register(
    name: string,
    email: string,
    password: string,
    emailCode: string,
    captcha: authApi.CaptchaFields,
    signal?: AbortSignal,
  ) {
    return authenticate(
      (s) =>
        authApi.register(
          {
            nickname: name,
            email,
            password,
            emailCode,
            ...captcha,
          },
          s,
        ),
      () => '注册成功，已自动登录',
      '注册成功',
      signal,
    )
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

  async function requestEmailCode(
    email: string,
    scene: 'login' | 'register',
    captcha: authApi.CaptchaFields,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; code?: number }> {
    const generation = revision.value,
      token = getAccessToken()
    try {
      const msg = await withPending(() => authApi.sendEmailCode(email, scene, captcha, signal), {
        signal,
      })
      if (signal?.aborted || revision.value !== generation || getAccessToken() !== token)
        return { ok: false }
      lastMessage.value = msg || '验证码已发送至邮箱'
      tipOk(lastMessage.value)
      return { ok: true }
    } catch (err) {
      return { ok: false, code: err instanceof ApiError ? err.code : undefined }
    }
  }

  async function sendLoginEmail(email: string, captcha: authApi.CaptchaFields) {
    return (await requestEmailCode(email, 'login', captcha)).ok
  }

  async function requestPasswordReset(
    account: string,
    captcha: authApi.CaptchaFields,
    signal?: AbortSignal,
  ) {
    const generation = revision.value,
      token = getAccessToken()
    const current = () =>
      !signal?.aborted && revision.value === generation && getAccessToken() === token
    try {
      const msg = await withPending(() => authApi.forgotPassword(account, captcha, signal), {
        signal,
        current,
      })
      if (!current()) return { ok: false }
      lastMessage.value = msg || '验证码已发送'
      tipOk(lastMessage.value)
      return { ok: true }
    } catch (err) {
      return { ok: false, code: err instanceof ApiError ? err.code : undefined }
    }
  }

  async function resetPassword(
    account: string,
    code: string,
    newPassword: string,
    signal?: AbortSignal,
  ) {
    const generation = revision.value,
      token = getAccessToken()
    const current = () =>
      !signal?.aborted && revision.value === generation && getAccessToken() === token
    try {
      await withPending(() => authApi.resetPassword(account, code, newPassword, signal), {
        signal,
        current,
      })
      if (!current()) return false
      if (user.value?.email.trim().toLowerCase() === account.trim().toLowerCase()) {
        invalidateSessionRequests()
        setAccessToken(null)
        observedToken = null
        user.value = null
      }
      lastMessage.value = '密码已重置，请登录'
      tipOk(lastMessage.value)
      return true
    } catch {
      return false
    }
  }

  async function startWechatSession(signal?: AbortSignal) {
    return authApi.createWechatSession(signal)
  }

  async function pollWechatSession(ticket: string, signal?: AbortSignal) {
    return authApi.pollWechatSession(ticket, signal)
  }

  function acceptToken(payload: authApi.TokenPayload) {
    invalidateSessionRequests()
    user.value = applyToken(payload)
    observedToken = payload.accessToken
  }

  function loginWithWechat(ticket: string, signal?: AbortSignal) {
    return authenticate(
      (s) => authApi.confirmWechat(ticket, s),
      (name) => `微信登录成功，欢迎 ${name}`,
      '微信登录成功',
      signal,
    )
  }

  async function restoreSession() {
    // A background refresh must not supersede the user's current login attempt.
    if (pending.value && getAccessToken() === observedToken) return false
    const attempt = beginSessionRequest()
    if (!attempt.token) {
      user.value = null
      sessionController = null
      return false
    }
    try {
      const profile = await authApi.fetchMe(attempt.signal)
      if (!attempt.current()) return false
      user.value = mapUser(profile)
      return true
    } catch (err) {
      if (!attempt.current()) return false
      if (
        err instanceof ApiError &&
        (err.status === 401 || ((!err.status || err.status === 200) && err.code === 401))
      ) {
        setAccessToken(null)
        observedToken = null
        user.value = null
      }
      return false
    } finally {
      if (sessionController === attempt.controller) sessionController = null
    }
  }

  function synchronizeSession() {
    // Storage events may be delayed; read the current value rather than trusting event.newValue.
    if (getAccessToken() !== observedToken) return restoreSession()
    return Promise.resolve(false)
  }

  async function logout() {
    const token = getAccessToken()
    invalidateSessionRequests()
    const generation = revision.value
    setAccessToken(null)
    observedToken = null
    user.value = null
    try {
      if (token) await authApi.logout(token)
      if (revision.value === generation && !getAccessToken()) tipOk('已退出登录')
    } catch (err) {
      if (revision.value === generation && !getAccessToken())
        tipWarn(errText(err, '退出时发生异常，已清除本地登录态'))
    }
  }

  return {
    user,
    pending,
    lastMessage,
    isLoggedIn,
    sessionRevision: computed(() => revision.value),
    login,
    loginByPhone,
    loginByEmail,
    register,
    sendLoginSms,
    sendLoginEmail,
    requestEmailCode,
    requestPasswordReset,
    resetPassword,
    startWechatSession,
    pollWechatSession,
    loginWithWechat,
    acceptToken,
    restoreSession,
    synchronizeSession,
    logout,
  }
})
