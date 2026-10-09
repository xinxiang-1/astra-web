import { http } from './http'

export interface AuthUserProfile {
  id: string
  nickname: string
  avatar?: string | null
  email?: string | null
  phone?: string | null
}

export interface TokenPayload {
  accessToken: string
  expiresIn: number
  user: AuthUserProfile
}

export interface WechatSession {
  ticket: string
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired' | string
  expireSeconds: number
  token?: TokenPayload | null
}

export interface CaptchaPayload {
  captchaId: string
  image: string
  expireSeconds: number
}

export type CaptchaFields = {
  captchaId: string
  captchaCode: string
}

export function fetchCaptcha() {
  return http<CaptchaPayload>('/auth/captcha')
}

export function loginByPassword(
  account: string,
  password: string,
  captcha: CaptchaFields,
  signal?: AbortSignal,
) {
  return http<TokenPayload>('/auth/login/password', {
    method: 'POST',
    body: JSON.stringify({ account, password, ...captcha }),
    signal,
  })
}

export function loginByPhone(phone: string, code: string, signal?: AbortSignal) {
  return http<TokenPayload>('/auth/login/phone', {
    method: 'POST',
    body: JSON.stringify({ phone, code }),
    signal,
  })
}

export function sendEmailCode(
  email: string,
  scene: 'login' | 'reset' | 'register',
  captcha: CaptchaFields,
  signal?: AbortSignal,
) {
  return http<string>('/auth/email/send', {
    method: 'POST',
    body: JSON.stringify({ email, scene, ...captcha }),
    signal,
  })
}

export function loginByEmail(email: string, code: string, signal?: AbortSignal) {
  return http<TokenPayload>('/auth/login/email', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
    signal,
  })
}

export function register(
  payload: {
    nickname: string
    email: string
    password: string
    emailCode: string
    captchaId: string
    captchaCode: string
  },
  signal?: AbortSignal,
) {
  return http<TokenPayload>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
    signal,
  })
}

export function sendSms(
  phone: string,
  scene: 'login' | 'reset' | 'register',
  captcha: CaptchaFields,
) {
  return http<void>('/auth/sms/send', {
    method: 'POST',
    body: JSON.stringify({ phone, scene, ...captcha }),
  })
}

export function forgotPassword(account: string, captcha: CaptchaFields, signal?: AbortSignal) {
  return http<string>('/auth/password/forgot', {
    method: 'POST',
    body: JSON.stringify({ account, ...captcha }),
    signal,
  })
}

export function resetPassword(
  account: string,
  code: string,
  newPassword: string,
  signal?: AbortSignal,
) {
  return http<void>('/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ account, code, newPassword }),
    signal,
  })
}

export function createWechatSession(signal?: AbortSignal) {
  return http<WechatSession>('/auth/wechat/session', { method: 'POST', signal })
}

export function pollWechatSession(ticket: string, signal?: AbortSignal) {
  return http<WechatSession>(`/auth/wechat/session/${encodeURIComponent(ticket)}`, { signal })
}

export function confirmWechat(ticket: string, signal?: AbortSignal) {
  return http<TokenPayload>('/auth/wechat/confirm', {
    method: 'POST',
    body: JSON.stringify({ ticket }),
    signal,
  })
}

export function fetchMe(signal?: AbortSignal) {
  return http<AuthUserProfile>('/auth/me', { signal, cache: 'no-store' })
}

export function logout(accessToken: string) {
  return http<void>('/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}
