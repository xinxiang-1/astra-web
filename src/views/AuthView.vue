<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { AtmosphereStage } from '@/components/styles'
import FxButton from '@/components/ui/FxButton.vue'
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

const wechatTicket = ref('')
const wechatStatus = ref<'waiting' | 'scanned' | 'expired'>('waiting')
let wechatTimer: number | undefined
let wechatExpireTimer: number | undefined

const form = reactive({
  name: '',
  email: '',
  password: '',
  confirm: '',
  agree: true,
})

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
    else stopWechatSession()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  stopWechatSession()
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
      return '输入注册邮箱，我们将发送重置链接'
    case 'wechat':
      return '使用微信扫一扫完成登录'
    default:
      return '登录后继续探索特效与创作'
  }
})

const submitLabel = computed(() => {
  if (auth.pending) {
    if (mode.value === 'forgot') return '发送中…'
    if (mode.value === 'register') return '创建中…'
    return '登录中…'
  }
  if (mode.value === 'forgot') return resetSent.value ? '再次发送' : '发送重置链接'
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

function startWechatSession() {
  stopWechatSession()
  wechatTicket.value = `astra-wx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  wechatStatus.value = 'waiting'
  wechatExpireTimer = window.setTimeout(() => {
    wechatStatus.value = 'expired'
  }, 120_000)
}

function stopWechatSession() {
  if (wechatTimer !== undefined) {
    window.clearTimeout(wechatTimer)
    wechatTimer = undefined
  }
  if (wechatExpireTimer !== undefined) {
    window.clearTimeout(wechatExpireTimer)
    wechatExpireTimer = undefined
  }
}

function refreshWechatQr() {
  error.value = ''
  startWechatSession()
}

async function confirmWechatScan() {
  if (wechatStatus.value === 'expired') {
    error.value = '二维码已过期，请刷新'
    return
  }
  wechatStatus.value = 'scanned'
  error.value = ''
  const ok = await auth.loginWithWechat(wechatTicket.value)
  if (ok) await router.push('/')
}

function validate(): string | null {
  if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    return '请输入有效邮箱'
  }
  if (mode.value === 'forgot') return null
  if (form.password.length < 6) return '密码至少 6 位'
  if (mode.value === 'register') {
    if (!form.name.trim()) return '请填写昵称'
    if (form.password !== form.confirm) return '两次密码不一致'
    if (!form.agree) return '请先同意服务条款'
  }
  return null
}

async function onSubmit() {
  error.value = ''
  const invalid = validate()
  if (invalid) {
    error.value = invalid
    return
  }

  if (mode.value === 'forgot') {
    const ok = await auth.requestPasswordReset(form.email.trim())
    if (ok) resetSent.value = true
    return
  }

  const ok =
    mode.value === 'login'
      ? await auth.login(form.email.trim(), form.password)
      : await auth.register(form.name.trim(), form.email.trim(), form.password)

  if (ok) await router.push('/')
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

          <label class="field">
            <span>邮箱</span>
            <input
              v-model="form.email"
              type="email"
              name="email"
              autocomplete="email"
              placeholder="you@example.com"
            />
          </label>

          <template v-if="mode !== 'forgot'">
            <label class="field">
              <span class="label-row">
                <span>密码</span>
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

            <label v-if="mode === 'register'" class="field">
              <span>确认密码</span>
              <input
                v-model="form.confirm"
                :type="showPassword ? 'text' : 'password'"
                name="confirm"
                autocomplete="new-password"
                placeholder="再输入一次"
              />
            </label>

            <label v-if="mode === 'register'" class="check">
              <input v-model="form.agree" type="checkbox" />
              <span>我已阅读并同意服务条款</span>
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
  padding: max(3.25rem, env(safe-area-inset-top, 0px) + 2.25rem)
    1rem
    max(1.25rem, env(safe-area-inset-bottom, 0px) + 0.75rem);
  overflow: auto;
  font-size: 0.875rem;
}

.stage {
  width: min(352px, 100%);
  display: grid;
  gap: 1rem;
  margin-top: -2vh;
  animation: rise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both;
}

.hero {
  text-align: center;
}

.wordmark {
  margin: 0 0 0.85rem;
  font-family: Syne, 'Segoe UI', sans-serif;
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--text);
}

.hero h1 {
  margin: 0 0 0.3rem;
  font-size: 1.25rem;
  font-weight: 600;
  letter-spacing: -0.03em;
  line-height: 1.25;
}

.lede {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.8125rem;
  line-height: 1.45;
}

.panel {
  display: grid;
  gap: 0.7rem;
  padding: 1.1rem 1.05rem 1.05rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
  backdrop-filter: blur(18px) saturate(1.3);
  -webkit-backdrop-filter: blur(18px) saturate(1.3);
  box-shadow: var(--shadow);
  animation: panel-in 0.7s cubic-bezier(0.22, 1, 0.36, 1) 0.06s both;
}

.wechat-panel {
  justify-items: center;
  text-align: center;
}

.field {
  display: grid;
  gap: 0.28rem;
}

.field > span,
.label-row {
  color: var(--text-muted);
  font-size: 0.75rem;
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
input[type='password'] {
  width: 100%;
  min-height: 2.35rem;
  padding: 0 0.75rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--input-bg);
  color: var(--text);
  outline: none;
  font: inherit;
  font-size: 0.875rem;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
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
  gap: 0.4rem;
}

.ghost {
  min-width: 3rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-soft);
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.75rem;
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
  gap: 0.4rem;
  color: var(--text-muted);
  font-size: 0.75rem;
}

.error,
.ok {
  margin: 0;
  font-size: 0.75rem;
}

.error {
  color: var(--danger);
}

.ok {
  color: var(--ok);
}

.submit {
  width: 100%;
  margin-top: 0.15rem;
}

:deep(.submit) {
  width: 100%;
  min-height: 2.35rem;
  font-size: 0.875rem;
  font-weight: 600;
  border-radius: 8px;
}

.alt {
  display: grid;
  gap: 0.65rem;
  margin-top: 0.15rem;
}

.divider {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 0.55rem;
  color: var(--text-faint);
  font-size: 0.72rem;
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
  gap: 0.4rem;
  min-height: 2.35rem;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-soft);
  color: var(--text);
  cursor: pointer;
  font: inherit;
  font-size: 0.8125rem;
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
  width: 168px;
  height: 168px;
  padding: 0.55rem;
  border-radius: 10px;
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
  font-size: 0.8125rem;
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
  font-size: 0.75rem;
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
