<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'

import { AtmosphereStage } from '@/components/styles'
import FxButton from '@/components/ui/FxButton.vue'
import { fetchCaptcha } from '@/api/auth'
import { useAuthStore, type AuthMode } from '@/stores/auth'

const props = withDefaults(
  defineProps<{
    initialMode?: AuthMode
  }>(),
  {
    initialMode: 'login',
  },
)

const router = useRouter()
const auth = useAuthStore()

const mode = ref<AuthMode>(props.initialMode)
const error = ref('')
const showPassword = ref(false)
const resetSent = ref(false)
const loginTab = ref<'password' | 'email' | 'phone'>('password')
/** 手机号登录暂未接真实短信，先隐藏入口 */
const phoneLoginEnabled = false
/** 邮箱验证码登录 */
const emailLoginEnabled = true
const smsCooldown = ref(0)
let smsTimer: number | undefined

const wechatTicket = ref('')
const wechatStatus = ref<'waiting' | 'scanned' | 'confirmed' | 'expired'>('waiting')
let wechatPollTimer: number | undefined
let wechatExpireTimer: number | undefined

const form = reactive({
  name: '',
  email: '',
  phone: '',
  code: '',
  password: '',
  confirm: '',
  agree: true,
  captchaCode: '',
})

const captchaId = ref('')
const captchaImage = ref('')
const captchaLoading = ref(false)
/** 失败后才展示图形验证码 */
const showCaptcha = ref(false)

const modePath: Record<AuthMode, string> = {
  login: '/login',
  register: '/register',
  forgot: '/forgot',
  wechat: '/login/wechat',
}

watch(
  () => props.initialMode,
  (value) => {
    mode.value = value
    error.value = ''
    resetSent.value = false
    auth.lastMessage = ''
  },
)

watch(
  mode,
  (value) => {
    if (value === 'wechat') startWechatSession()
    else {
      stopWechatSession()
      showCaptcha.value = false
      captchaId.value = ''
      captchaImage.value = ''
      form.captchaCode = ''
    }
  },
  { immediate: true },
)

watch(loginTab, () => {
  form.code = ''
  form.captchaCode = ''
  // 切到邮箱验证码时放开图形码门槛，保证首次「获取验证码」一定打接口
  if (loginTab.value === 'email') {
    showCaptcha.value = false
    captchaId.value = ''
    captchaImage.value = ''
  } else if (showCaptcha.value) {
    void refreshCaptcha()
  }
})

async function enableCaptcha() {
  showCaptcha.value = true
  await refreshCaptcha()
}

async function refreshCaptcha() {
  if (mode.value === 'wechat' || !showCaptcha.value) return
  captchaLoading.value = true
  try {
    const data = await fetchCaptcha()
    captchaId.value = data.captchaId
    captchaImage.value = data.image
    form.captchaCode = ''
  } catch (err) {
    captchaImage.value = ''
    captchaId.value = ''
    const msg = err instanceof Error ? err.message : '验证码加载失败'
    ElMessage.error(msg)
  } finally {
    captchaLoading.value = false
  }
}

function captchaPayload() {
  if (!showCaptcha.value) {
    return { captchaId: '', captchaCode: '' }
  }
  return {
    captchaId: captchaId.value,
    captchaCode: form.captchaCode.trim(),
  }
}

function startSmsCooldown(seconds = 60) {
  stopSmsCooldown()
  smsCooldown.value = seconds
  smsTimer = window.setInterval(() => {
    smsCooldown.value -= 1
    if (smsCooldown.value <= 0) stopSmsCooldown()
  }, 1000)
}

function stopSmsCooldown() {
  if (smsTimer !== undefined) {
    window.clearInterval(smsTimer)
    smsTimer = undefined
  }
  smsCooldown.value = 0
}

onBeforeUnmount(() => {
  stopWechatSession()
  stopSmsCooldown()
})

const title = computed(() => {
  switch (mode.value) {
    case 'register':
      return '创建账户'
    case 'forgot':
      return '找回密码'
    case 'wechat':
      return '微信登录'
    default:
      return '欢迎回来'
  }
})

const subtitle = computed(() => {
  switch (mode.value) {
    case 'register':
      return '几步即可保存偏好与作品入口'
    case 'forgot':
      return '验证码将发到绑定邮箱（本地 mock 看 Auth 日志）'
    case 'wechat':
      return '使用微信扫一扫完成登录'
    default:
      return '登录后继续探索特效与创作'
  }
})

const submitLabel = computed(() => {
  if (auth.pending) {
    if (mode.value === 'forgot') return resetSent.value ? '重置中…' : '发送中…'
    if (mode.value === 'register') return '创建中…'
    return '登录中…'
  }
  if (mode.value === 'forgot') return resetSent.value ? '重置密码' : '发送验证码'
  if (mode.value === 'register') return '创建账户'
  return '继续'
})

/** Deterministic pseudo-QR cells for demo (21×21). */
const qrCells = computed(() => {
  const size = 21
  const seed = hashString(wechatTicket.value || 'astra-wechat')
  const cells: boolean[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFinder(x, y, size)) {
        cells.push(isFinderDark(x, y))
        continue
      }
      const n = (seed ^ (x * 73856093) ^ (y * 19349663)) >>> 0
      cells.push(n % 3 !== 0)
    }
  }
  return { size, cells }
})

function hashString(input: string) {
  let h = 2166136261
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function isFinder(x: number, y: number, size: number) {
  const inCorner = (cx: number, cy: number) =>
    x >= cx && x < cx + 7 && y >= cy && y < cy + 7
  return inCorner(0, 0) || inCorner(size - 7, 0) || inCorner(0, size - 7)
}

function isFinderDark(x: number, y: number) {
  const local = (ox: number, oy: number) => {
    const lx = x - ox
    const ly = y - oy
    const edge = lx === 0 || ly === 0 || lx === 6 || ly === 6
    const core = lx >= 2 && lx <= 4 && ly >= 2 && ly <= 4
    return edge || core
  }
  if (x < 7 && y < 7) return local(0, 0)
  if (x >= 14 && y < 7) return local(14, 0)
  return local(0, 14)
}

function switchMode(next: AuthMode) {
  mode.value = next
  error.value = ''
  resetSent.value = false
  auth.lastMessage = ''
  void router.replace(modePath[next])
}

async function startWechatSession() {
  stopWechatSession()
  wechatStatus.value = 'waiting'
  try {
    const session = await auth.startWechatSession()
    wechatTicket.value = session.ticket
    wechatStatus.value = (session.status as typeof wechatStatus.value) || 'waiting'
    const ttl = (session.expireSeconds || 120) * 1000
    wechatExpireTimer = window.setTimeout(() => {
      wechatStatus.value = 'expired'
      stopWechatPoll()
      ElMessage.warning('二维码已过期，请刷新')
    }, ttl)
    scheduleWechatPoll()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '无法创建微信会话'
    wechatStatus.value = 'expired'
    ElMessage.error(error.value)
  }
}

function scheduleWechatPoll() {
  stopWechatPoll()
  wechatPollTimer = window.setTimeout(async () => {
    if (!wechatTicket.value || wechatStatus.value === 'expired') return
    try {
      const session = await auth.pollWechatSession(wechatTicket.value)
      wechatStatus.value = session.status as typeof wechatStatus.value
      if (session.status === 'confirmed' && session.token) {
        auth.acceptToken(session.token)
        auth.lastMessage = '微信登录成功'
        ElMessage.success(`微信登录成功，欢迎 ${session.token.user.nickname}`)
        await router.push('/')
        return
      }
      if (session.status !== 'expired' && session.status !== 'confirmed') {
        scheduleWechatPoll()
      }
    } catch {
      scheduleWechatPoll()
    }
  }, 1500)
}

function stopWechatPoll() {
  if (wechatPollTimer !== undefined) {
    window.clearTimeout(wechatPollTimer)
    wechatPollTimer = undefined
  }
}

function stopWechatSession() {
  stopWechatPoll()
  if (wechatExpireTimer !== undefined) {
    window.clearTimeout(wechatExpireTimer)
    wechatExpireTimer = undefined
  }
}

function refreshWechatQr() {
  error.value = ''
  void startWechatSession()
}

async function confirmWechatScan() {
  if (wechatStatus.value === 'expired') {
    error.value = '二维码已过期，请刷新'
    ElMessage.warning(error.value)
    return
  }
  wechatStatus.value = 'scanned'
  error.value = ''
  const ok = await auth.loginWithWechat(wechatTicket.value)
  if (ok) await router.push('/')
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function isPhone(value: string) {
  return /^1\d{10}$/.test(value)
}

function needsImageCaptcha() {
  if (!showCaptcha.value) return false
  if (mode.value === 'wechat') return false
  if (mode.value === 'forgot' && resetSent.value) return false
  return true
}

function validate(): string | null {
  if (needsImageCaptcha()) {
    const captchaErr = requireCaptchaCode()
    if (captchaErr) return captchaErr
  }

  if (mode.value === 'login' && loginTab.value === 'email') {
    if (!isEmail(form.email.trim())) return '请输入有效邮箱'
    if (!/^\d{4,8}$/.test(form.code.trim())) return '请输入验证码'
    return null
  }

  if (mode.value === 'login' && loginTab.value === 'phone') {
    if (!isPhone(form.phone.trim())) return '请输入有效手机号'
    if (!/^\d{4,8}$/.test(form.code.trim())) return '请输入验证码'
    return null
  }

  if (mode.value === 'forgot') {
    const account = form.email.trim()
    if (!account) return '请输入邮箱或手机号'
    if (!isEmail(account) && !isPhone(account)) return '请输入有效邮箱或手机号'
    if (resetSent.value) {
      if (!form.code.trim()) return '请输入验证码'
      if (form.password.length < 6) return '密码至少 6 位'
      if (form.password !== form.confirm) return '两次密码不一致'
    }
    return null
  }

  if (mode.value === 'login') {
    const account = form.email.trim()
    if (!account) return '请输入账号'
    if (form.password.length < 6) return '密码至少 6 位'
    return null
  }

  if (!form.email.trim() || !isEmail(form.email)) {
    return '请输入有效邮箱'
  }
  if (form.password.length < 6) return '密码至少 6 位'
  if (mode.value === 'register') {
    if (!form.name.trim()) return '请填写昵称'
    if (form.phone.trim() && !isPhone(form.phone.trim())) return '手机号格式不正确'
    if (form.password !== form.confirm) return '两次密码不一致'
    if (!form.agree) return '请先同意服务条款'
  }
  return null
}

function requireCaptchaCode(): string | null {
  if (!captchaId.value) return '验证码加载中，请稍候'
  if (!/^[A-Za-z0-9]{4,6}$/.test(form.captchaCode.trim())) return '请输入图形验证码'
  return null
}

async function onSendEmailCode() {
  error.value = ''
  const email = form.email.trim()
  if (!email) {
    error.value = '请输入邮箱'
    ElMessage.warning(error.value)
    return
  }
  if (!isEmail(email)) {
    error.value = '请输入有效邮箱'
    ElMessage.warning(error.value)
    return
  }
  if (smsCooldown.value > 0) {
    ElMessage.warning(`请 ${smsCooldown.value} 秒后再获取`)
    return
  }
  if (auth.pending) return

  if (showCaptcha.value) {
    if (!captchaId.value) {
      await refreshCaptcha()
      ElMessage.warning('请先填写图形验证码')
      return
    }
    const captchaErr = requireCaptchaCode()
    if (captchaErr) {
      error.value = captchaErr
      ElMessage.warning(captchaErr)
      return
    }
  }

  const ok = await auth.sendLoginEmail(email, captchaPayload())
  if (ok) {
    startSmsCooldown(60)
    if (showCaptcha.value) void refreshCaptcha()
  } else {
    error.value = auth.lastMessage || '发送失败'
    await enableCaptcha()
  }
}

async function onSendSms() {
  error.value = ''
  if (!isPhone(form.phone.trim())) {
    error.value = '请输入有效手机号'
    ElMessage.warning(error.value)
    return
  }
  if (showCaptcha.value) {
    const captchaErr = requireCaptchaCode()
    if (captchaErr) {
      error.value = captchaErr
      ElMessage.warning(captchaErr)
      return
    }
  }
  if (smsCooldown.value > 0) return
  const ok = await auth.sendLoginSms(form.phone.trim(), captchaPayload())
  if (ok) {
    startSmsCooldown(60)
    if (showCaptcha.value) void refreshCaptcha()
  } else {
    error.value = auth.lastMessage || '发送失败'
    await enableCaptcha()
  }
}

async function onSubmit() {
  error.value = ''
  const invalid = validate()
  if (invalid) {
    error.value = invalid
    ElMessage.warning(invalid)
    return
  }

  if (mode.value === 'forgot') {
    if (!resetSent.value) {
      const ok = await auth.requestPasswordReset(form.email.trim(), captchaPayload())
      if (ok) {
        resetSent.value = true
        showCaptcha.value = false
      } else {
        error.value = auth.lastMessage || '发送失败'
        await enableCaptcha()
      }
      return
    }
    const ok = await auth.resetPassword(
      form.email.trim(),
      form.code.trim(),
      form.password,
    )
    if (ok) {
      resetSent.value = false
      form.password = ''
      form.confirm = ''
      form.code = ''
      switchMode('login')
    } else {
      error.value = auth.lastMessage || '重置失败'
    }
    return
  }

  let ok = false
  if (mode.value === 'login' && loginTab.value === 'email') {
    ok = await auth.loginByEmail(form.email.trim(), form.code.trim())
  } else if (mode.value === 'login' && loginTab.value === 'phone') {
    ok = await auth.loginByPhone(form.phone.trim(), form.code.trim())
  } else if (mode.value === 'login') {
    ok = await auth.login(form.email.trim(), form.password, captchaPayload())
  } else {
    ok = await auth.register(
      form.name.trim(),
      form.email.trim(),
      form.password,
      captchaPayload(),
      form.phone.trim() || undefined,
    )
  }

  if (ok) await router.push('/')
  else {
    error.value = auth.lastMessage || '操作失败'
    await enableCaptcha()
  }
}
</script>

<template>
  <AtmosphereStage preset="auth">
    <section class="auth fx-scroll">
      <div class="stage">
        <header class="hero">
          <p class="wordmark">Astra</p>
          <h1>{{ title }}</h1>
          <p class="lede">{{ subtitle }}</p>
        </header>

        <!-- WeChat QR panel -->
        <div v-if="mode === 'wechat'" class="panel wechat-panel">
          <div
            class="qr-frame"
            :class="{ expired: wechatStatus === 'expired', scanned: wechatStatus === 'scanned' }"
            aria-hidden="true"
          >
            <svg
              class="qr"
              viewBox="0 0 21 21"
              xmlns="http://www.w3.org/2000/svg"
            >
              <rect width="21" height="21" fill="#fff" />
              <rect
                v-for="(dark, i) in qrCells.cells"
                :key="i"
                v-show="dark"
                :x="i % qrCells.size"
                :y="Math.floor(i / qrCells.size)"
                width="1"
                height="1"
                fill="#111"
              />
            </svg>
            <div class="qr-badge">微</div>
            <div v-if="wechatStatus === 'expired'" class="qr-mask">
              <p>二维码已过期</p>
              <button type="button" class="link" @click="refreshWechatQr">
                点击刷新
              </button>
            </div>
            <div v-else-if="wechatStatus === 'scanned'" class="qr-mask ok-mask">
              <p>扫码成功</p>
              <p class="hint">正在登录…</p>
            </div>
          </div>

          <p class="qr-tip">打开微信扫一扫</p>
          <p class="qr-sub">演示环境可点击下方按钮模拟确认</p>

          <p v-if="error" class="error">{{ error }}</p>
          <p v-else-if="auth.lastMessage" class="ok">{{ auth.lastMessage }}</p>

          <FxButton
            class="submit"
            variant="primary"
            type="button"
            :disabled="auth.pending || wechatStatus === 'expired'"
            @click="confirmWechatScan"
          >
            {{ auth.pending ? '登录中…' : '模拟扫码确认' }}
          </FxButton>

          <button type="button" class="text-btn" @click="refreshWechatQr">
            刷新二维码
          </button>
        </div>

        <!-- Account forms -->
        <form v-else class="panel" @submit.prevent="onSubmit">
          <div
            v-if="mode === 'login' && (emailLoginEnabled || phoneLoginEnabled)"
            class="tabs"
            :class="{ 'tabs-email': loginTab === 'email', 'tabs-phone': loginTab === 'phone' }"
            role="tablist"
          >
            <span class="tab-thumb" aria-hidden="true" />
            <button
              type="button"
              role="tab"
              class="tab"
              :aria-selected="loginTab === 'password'"
              :class="{ active: loginTab === 'password' }"
              @click="loginTab = 'password'"
            >
              密码
            </button>
            <button
              v-if="emailLoginEnabled"
              type="button"
              role="tab"
              class="tab"
              :aria-selected="loginTab === 'email'"
              :class="{ active: loginTab === 'email' }"
              @click="loginTab = 'email'"
            >
              邮箱
            </button>
            <button
              v-if="phoneLoginEnabled"
              type="button"
              role="tab"
              class="tab"
              :aria-selected="loginTab === 'phone'"
              :class="{ active: loginTab === 'phone' }"
              @click="loginTab = 'phone'"
            >
              手机号
            </button>
          </div>

          <label v-if="mode === 'register'" class="field">
            <span>昵称</span>
            <input
              v-model="form.name"
              type="text"
              name="name"
              autocomplete="nickname"
              placeholder="你的名字"
            />
          </label>

          <template v-if="mode === 'login' && emailLoginEnabled && loginTab === 'email'">
            <label class="field">
              <span>邮箱</span>
              <input
                v-model="form.email"
                type="email"
                name="email"
                autocomplete="username"
                placeholder="你的邮箱"
              />
            </label>
            <label class="field">
              <span>验证码</span>
              <div class="code-row">
                <input
                  v-model="form.code"
                  type="text"
                  name="code"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="8"
                  placeholder="邮箱收到的 6 位码"
                />
                <button
                  type="button"
                  class="sms-btn"
                  :disabled="auth.pending || smsCooldown > 0"
                  @click.stop.prevent="onSendEmailCode"
                >
                  {{ smsCooldown > 0 ? `${smsCooldown}s` : '获取验证码' }}
                </button>
              </div>
            </label>
            <label v-if="showCaptcha" class="field captcha-field">
              <span class="label-row">
                <span>图形验证码</span>
                <button
                  type="button"
                  class="link tiny"
                  :disabled="captchaLoading"
                  @click="refreshCaptcha"
                >
                  换一张
                </button>
              </span>
              <div class="captcha-shell">
                <input
                  v-model="form.captchaCode"
                  class="captcha-input"
                  type="text"
                  name="captcha"
                  maxlength="6"
                  autocomplete="off"
                  placeholder="输入右侧字符"
                  @keyup.enter.prevent="onSendEmailCode"
                />
                <button
                  type="button"
                  class="captcha-shot"
                  :disabled="captchaLoading"
                  title="点击刷新"
                  @click="refreshCaptcha"
                >
                  <img
                    v-if="captchaImage"
                    :src="captchaImage"
                    alt="验证码"
                    draggable="false"
                  />
                  <span v-else class="captcha-placeholder">
                    {{ captchaLoading ? '…' : '加载' }}
                  </span>
                </button>
              </div>
            </label>
          </template>

          <template v-else-if="mode === 'login' && phoneLoginEnabled && loginTab === 'phone'">
            <label class="field">
              <span>手机号</span>
              <div class="phone-row">
                <span class="phone-prefix" aria-hidden="true">+86</span>
                <input
                  v-model="form.phone"
                  class="phone-input"
                  type="tel"
                  name="phone"
                  autocomplete="tel"
                  inputmode="numeric"
                  maxlength="11"
                  placeholder="请输入手机号"
                />
              </div>
            </label>
            <label class="field">
              <span>验证码</span>
              <div class="code-row">
                <input
                  v-model="form.code"
                  type="text"
                  name="code"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  maxlength="8"
                  placeholder="6 位验证码"
                />
                <button
                  type="button"
                  class="sms-btn"
                  :disabled="auth.pending || smsCooldown > 0"
                  @click="onSendSms"
                >
                  {{ smsCooldown > 0 ? `${smsCooldown}s` : '获取验证码' }}
                </button>
              </div>
            </label>
            <label v-if="showCaptcha" class="field captcha-field">
              <span class="label-row">
                <span>图形验证码</span>
                <button
                  type="button"
                  class="link tiny"
                  :disabled="captchaLoading"
                  @click="refreshCaptcha"
                >
                  换一张
                </button>
              </span>
              <div class="captcha-shell">
                <input
                  v-model="form.captchaCode"
                  class="captcha-input"
                  type="text"
                  name="captcha"
                  maxlength="6"
                  autocomplete="off"
                  placeholder="输入右侧字符"
                  @keyup.enter.prevent="onSendSms"
                />
                <button
                  type="button"
                  class="captcha-shot"
                  :disabled="captchaLoading"
                  title="点击刷新"
                  @click="refreshCaptcha"
                >
                  <img
                    v-if="captchaImage"
                    :src="captchaImage"
                    alt="验证码"
                    draggable="false"
                  />
                  <span v-else class="captcha-placeholder">
                    {{ captchaLoading ? '…' : '加载' }}
                  </span>
                </button>
              </div>
            </label>
          </template>

          <template v-else>
            <label class="field">
              <span>{{ mode === 'login' ? '账号' : mode === 'forgot' ? '邮箱 / 手机号' : '邮箱' }}</span>
              <input
                v-model="form.email"
                :type="mode === 'register' ? 'email' : 'text'"
                name="email"
                autocomplete="username"
                :placeholder="mode === 'login' ? '邮箱 / 手机号 / 用户名' : 'you@example.com'"
              />
            </label>

            <label v-if="mode === 'register'" class="field">
              <span>手机号（可选）</span>
              <input
                v-model="form.phone"
                type="tel"
                name="phone"
                autocomplete="tel"
                placeholder="可用于验证码登录"
              />
            </label>

            <template v-if="mode === 'forgot' && resetSent">
              <label class="field">
                <span>验证码</span>
                <input
                  v-model="form.code"
                  type="text"
                  name="code"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  placeholder="邮箱收到的 6 位验证码"
                />
              </label>
            </template>

            <template v-if="mode !== 'forgot' || resetSent">
              <label class="field">
                <span class="label-row">
                  <span>{{ mode === 'forgot' ? '新密码' : '密码' }}</span>
                  <button
                    v-if="mode === 'login'"
                    type="button"
                    class="link tiny"
                    @click="switchMode('forgot')"
                  >
                    忘记密码？
                  </button>
                </span>
                <div class="password-row">
                  <input
                    v-model="form.password"
                    :type="showPassword ? 'text' : 'password'"
                    name="password"
                    :autocomplete="
                      mode === 'login' ? 'current-password' : 'new-password'
                    "
                    placeholder="至少 6 位"
                  />
                  <button
                    type="button"
                    class="ghost"
                    @click="showPassword = !showPassword"
                  >
                    {{ showPassword ? '隐藏' : '显示' }}
                  </button>
                </div>
              </label>

              <label
                v-if="mode === 'register' || (mode === 'forgot' && resetSent)"
                class="field"
              >
                <span>确认密码</span>
                <input
                  v-model="form.confirm"
                  :type="showPassword ? 'text' : 'password'"
                  name="confirm"
                  autocomplete="new-password"
                  placeholder="再输入一次"
                />
              </label>
            </template>

            <label v-if="mode === 'register'" class="check">
              <input v-model="form.agree" type="checkbox" />
              <span>我已阅读并同意服务条款</span>
            </label>

            <label
              v-if="showCaptcha && !(mode === 'forgot' && resetSent)"
              class="field captcha-field"
            >
              <span class="label-row">
                <span>图形验证码</span>
                <button
                  type="button"
                  class="link tiny"
                  :disabled="captchaLoading"
                  @click="refreshCaptcha"
                >
                  换一张
                </button>
              </span>
              <div class="captcha-shell">
                <input
                  v-model="form.captchaCode"
                  class="captcha-input"
                  type="text"
                  name="captcha"
                  maxlength="6"
                  autocomplete="off"
                  placeholder="输入右侧字符"
                />
                <button
                  type="button"
                  class="captcha-shot"
                  :disabled="captchaLoading"
                  title="点击刷新"
                  @click="refreshCaptcha"
                >
                  <img
                    v-if="captchaImage"
                    :src="captchaImage"
                    alt="验证码"
                    draggable="false"
                  />
                  <span v-else class="captcha-placeholder">
                    {{ captchaLoading ? '…' : '加载' }}
                  </span>
                </button>
              </div>
            </label>
          </template>

          <p v-if="error" class="error">{{ error }}</p>
          <p v-else-if="auth.lastMessage" class="ok">{{ auth.lastMessage }}</p>

          <FxButton
            class="submit"
            variant="primary"
            type="submit"
            :disabled="auth.pending"
          >
            {{ submitLabel }}
          </FxButton>

          <div v-if="mode === 'login'" class="alt">
            <div class="divider"><span>其他方式</span></div>
            <button
              type="button"
              class="wechat-entry"
              @click="switchMode('wechat')"
            >
              <span class="wx-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path
                    fill="currentColor"
                    d="M9.6 3.2c-3.9 0-7 2.6-7 5.9 0 1.9 1.1 3.6 2.8 4.7l-.7 2.2a.4.4 0 0 0 .6.4l2.5-1.2c.6.2 1.2.2 1.8.2.3 0 .6 0 .9-.1-.2-.6-.3-1.2-.3-1.8 0-3.2 3-5.8 6.7-5.8.2 0 .5 0 .7.1C16.4 5.1 13.3 3.2 9.6 3.2zm8.2 6.5c-3.2 0-5.8 2.1-5.8 4.8s2.6 4.8 5.8 4.8c.5 0 1-.1 1.4-.2l2 .9a.35.35 0 0 0 .5-.4l-.5-1.8c1.3-.9 2.1-2.2 2.1-3.7 0-2.7-2.6-4.8-5.5-4.8z"
                  />
                </svg>
              </span>
              微信扫码登录
            </button>
          </div>
        </form>

        <p class="foot">
          <template v-if="mode === 'login'">
            还没有账号？
            <button type="button" class="link" @click="switchMode('register')">
              注册
            </button>
          </template>
          <template v-else-if="mode === 'register'">
            已有账号？
            <button type="button" class="link" @click="switchMode('login')">
              登录
            </button>
          </template>
          <template v-else-if="mode === 'forgot'">
            想起密码了？
            <button type="button" class="link" @click="switchMode('login')">
              返回登录
            </button>
          </template>
          <template v-else>
            使用邮箱登录？
            <button type="button" class="link" @click="switchMode('login')">
              返回
            </button>
          </template>
        </p>
      </div>
    </section>
  </AtmosphereStage>
</template>

<style scoped>
.auth {
  display: grid;
  align-content: safe center;
  justify-items: center;
  height: 100%;
  min-height: 0;
  padding: max(3.5rem, env(safe-area-inset-top, 0px) + 2.5rem)
    1.25rem
    max(1.5rem, env(safe-area-inset-bottom, 0px) + 1rem);
  overflow: auto;
  font-size: 0.9375rem;
}

.stage {
  width: min(420px, 100%);
  display: grid;
  gap: 1.15rem;
  margin-top: -1.5vh;
  animation: rise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.hero {
  text-align: center;
}

.wordmark {
  margin: 0 0 0.95rem;
  font-family: Syne, 'Segoe UI', sans-serif;
  font-weight: 700;
  font-size: 0.78rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--text);
}

.hero h1 {
  margin: 0 0 0.35rem;
  font-size: 1.45rem;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.25;
}

.lede {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.5;
}

.panel {
  display: grid;
  gap: 0.85rem;
  padding: 1.35rem 1.25rem 1.25rem;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
  backdrop-filter: blur(18px) saturate(1.3);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
  box-shadow: var(--shadow);
  animation: panel-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.06s both;
}

.tabs {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.2rem;
  padding: 0.22rem;
  border: 1px solid var(--border);
  border-radius: 11px;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
}

.tab-thumb {
  position: absolute;
  top: 0.22rem;
  bottom: 0.22rem;
  left: 0.22rem;
  width: calc((100% - 0.44rem - 0.2rem) / 2);
  border-radius: 8px;
  background: linear-gradient(120deg, var(--accent), var(--accent-2));
  box-shadow: 0 4px 14px color-mix(in srgb, var(--accent) 28%, transparent);
  transition: transform 0.32s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.tabs-email .tab-thumb {
  transform: translateX(calc(100% + 0.2rem));
}

.tabs-phone .tab-thumb {
  transform: translateX(calc(200% + 0.4rem));
}

.tab {
  position: relative;
  z-index: 1;
  border: 0;
  border-radius: 8px;
  padding: 0.52rem 0.6rem;
  background: transparent;
  color: var(--text-muted);
  font: inherit;
  font-size: 0.875rem;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: color 0.22s ease;
}

.tab:hover {
  color: var(--text);
}

.tab.active {
  color: var(--accent-text);
  font-weight: 600;
}

.tab.active:hover {
  color: var(--accent-text);
}

.wechat-panel {
  justify-items: center;
  text-align: center;
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field > span,
.label-row {
  color: var(--text-muted);
  font-size: 0.8125rem;
  letter-spacing: 0.01em;
}

.label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

input[type='text'],
input[type='email'],
input[type='password'],
input[type='tel'] {
  width: 100%;
  min-height: 2.75rem;
  padding: 0 0.9rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--input-bg);
  color: var(--text);
  outline: none;
  font: inherit;
  font-size: 0.9375rem;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.phone-row {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: stretch;
  min-height: 2.75rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--input-bg);
  overflow: hidden;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.phone-row:hover {
  border-color: var(--border-strong);
}

.phone-row:focus-within {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.phone-prefix {
  display: grid;
  place-items: center;
  padding: 0 0.7rem;
  border-right: 1px solid var(--border);
  color: var(--text-muted);
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  user-select: none;
}

.phone-input {
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
  min-height: 2.7rem;
  letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}

.phone-input:hover,
.phone-input:focus {
  border-color: transparent !important;
  box-shadow: none !important;
}

.code-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem;
  align-items: stretch;
}

.sms-btn {
  min-width: 6.5rem;
  padding: 0 0.85rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-soft);
  color: var(--text);
  cursor: pointer;
  font: inherit;
  font-size: 0.8125rem;
  white-space: nowrap;
  transition:
    color 0.15s ease,
    background 0.15s ease,
    border-color 0.15s ease,
    opacity 0.15s ease;
}

.sms-btn:hover:not(:disabled) {
  background: var(--bg-soft-hover);
  border-color: var(--border-strong);
}

.sms-btn:disabled {
  opacity: 0.55;
  cursor: default;
  color: var(--text-muted);
}

.captcha-shell {
  display: grid;
  grid-template-columns: 1fr 148px;
  align-items: stretch;
  min-height: 2.75rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--input-bg);
  overflow: hidden;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}

.captcha-shell:hover {
  border-color: var(--border-strong);
}

.captcha-shell:focus-within {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.captcha-input {
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
  min-height: 2.7rem;
  letter-spacing: 0.12em;
  font-variant-numeric: tabular-nums;
  text-transform: uppercase;
}

.captcha-input:hover,
.captcha-input:focus {
  border-color: transparent !important;
  box-shadow: none !important;
}

.captcha-shot {
  position: relative;
  width: 148px;
  min-height: 2.7rem;
  padding: 0;
  border: 0;
  border-left: 1px solid var(--border);
  border-radius: 0;
  overflow: hidden;
  background: #eef1f5;
  cursor: pointer;
  transition: opacity 0.15s ease, filter 0.15s ease;
}

.captcha-shot:hover:not(:disabled) {
  filter: brightness(0.97);
}

.captcha-shot:disabled {
  opacity: 0.75;
  cursor: wait;
}

.captcha-shot img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
  pointer-events: none;
}

.captcha-placeholder {
  display: grid;
  place-items: center;
  height: 100%;
  color: #64748b;
  font-size: 0.75rem;
  letter-spacing: 0.04em;
}

.captcha-field .link.tiny:disabled {
  opacity: 0.45;
  cursor: wait;
}

input:hover {
  border-color: var(--border-strong);
}

input:focus {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
  box-shadow: 0 0 0 3px var(--focus-ring);
}

.password-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.45rem;
}

.ghost {
  min-width: 3.25rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-soft);
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.8125rem;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}

.ghost:hover {
  color: var(--text);
  background: var(--bg-soft-hover);
}

.check {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  color: var(--text-muted);
  font-size: 0.8125rem;
}

.error,
.ok {
  margin: 0;
  font-size: 0.8125rem;
}

.error {
  color: var(--danger);
}

.ok {
  color: var(--ok);
}

.submit {
  width: 100%;
  margin-top: 0.2rem;
}

:deep(.submit) {
  width: 100%;
  min-height: 2.75rem;
  font-size: 0.9375rem;
  font-weight: 600;
  border-radius: 10px;
}

.alt {
  display: grid;
  gap: 0.75rem;
  margin-top: 0.2rem;
}

.divider {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.6rem;
  color: var(--text-faint);
  font-size: 0.78rem;
}

.divider::before,
.divider::after {
  content: '';
  height: 1px;
  background: var(--border);
}

.wechat-entry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  min-height: 2.75rem;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-soft);
  color: var(--text);
  cursor: pointer;
  font: inherit;
  font-size: 0.875rem;
  transition:
    background 0.15s ease,
    border-color 0.15s ease;
}

.wechat-entry:hover {
  background: var(--bg-soft-hover);
  border-color: var(--border-strong);
}

.wx-icon {
  display: inline-flex;
  color: #07c160;
}

.qr-frame {
  position: relative;
  width: 188px;
  height: 188px;
  padding: 0.6rem;
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 0 0 1px color-mix(in srgb, #07c160 35%, transparent);
}

.qr {
  display: block;
  width: 100%;
  height: 100%;
}

.qr-badge {
  position: absolute;
  inset: 50% auto auto 50%;
  translate: -50% -50%;
  width: 1.55rem;
  height: 1.55rem;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: #07c160;
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
}

.qr-mask {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 0.25rem;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.92);
  color: #222;
  font-size: 0.8rem;
}

.ok-mask {
  background: rgba(7, 193, 96, 0.92);
  color: #fff;
}

.qr-mask .hint {
  margin: 0;
  opacity: 0.85;
  font-size: 0.72rem;
}

.qr-mask p {
  margin: 0;
}

.qr-tip {
  margin: 0.15rem 0 0;
  font-size: 0.8125rem;
  color: var(--text);
}

.qr-sub {
  margin: 0;
  font-size: 0.72rem;
  color: var(--text-faint);
}

.text-btn {
  border: 0;
  background: none;
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
  padding: 0;
}

.text-btn:hover {
  color: var(--text);
}

.foot {
  margin: 0;
  text-align: center;
  color: var(--text-faint);
  font-size: 0.875rem;
}

.link {
  border: 0;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  padding: 0;
}

.link.tiny {
  font-size: 0.8125rem;
}

.link:hover {
  text-decoration: underline;
  text-underline-offset: 0.16em;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes panel-in {
  from {
    opacity: 0;
    transform: translateY(12px) scale(0.99);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 480px) {
  .stage {
    width: min(100%, 352px);
  }

  .panel {
    padding: 1rem 0.9rem 0.95rem;
  }
}
</style>
