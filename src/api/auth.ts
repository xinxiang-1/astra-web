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
) {
  return http<TokenPayload>('/auth/login/password', {
    method: 'POST',
    body: JSON.stringify({ account, password, ...captcha }),
  })
}

export function loginByPhone(phone: string, code: string) {
  return http<TokenPayload>('/auth/login/phone', {
    method: 'POST',
    body: JSON.stringify({ phone, code }),
  })
}

export function sendEmailCode(
  email: string,
  scene: 'login' | 'reset' | 'register',
  captcha: CaptchaFields,
) {
  return http<string>('/auth/email/send', {
    method: 'POST',
    body: JSON.stringify({ email, scene, ...captcha }),
  })
}

export function loginByEmail(email: string, code: string) {
  return http<TokenPayload>('/auth/login/email', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  })
}

export function register(payload: {
  nickname: string
  email: string
  password: string
  phone?: string
  captchaId: string
  captchaCode: string
}) {
  return http<TokenPayload>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
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

export function forgotPassword(account: string, captcha: CaptchaFields) {
  return http<string>('/auth/password/forgot', {
    method: 'POST',
    body: JSON.stringify({ account, ...captcha }),
  })
}

export function resetPassword(account: string, code: string, newPassword: string) {
  return http<void>('/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ account, code, newPassword }),
  })
}

export function createWechatSession() {
  return http<WechatSession>('/auth/wechat/session', { method: 'POST' })
}

export function pollWechatSession(ticket: string) {
  return http<WechatSession>(`/auth/wechat/session/${encodeURIComponent(ticket)}`)
}

export function confirmWechat(ticket: string) {
  return http<TokenPayload>('/auth/wechat/confirm', {
    method: 'POST',
    body: JSON.stringify({ ticket }),
  })
}

export function fetchMe() {
  return http<AuthUserProfile>('/auth/me')
}

export function logout() {
  return http<void>('/auth/logout', { method: 'POST' })
}
