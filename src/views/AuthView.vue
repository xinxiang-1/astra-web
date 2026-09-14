<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import FxButton from '@/components/ui/FxButton.vue'
import FxStage from '@/components/ui/FxStage.vue'
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

const form = reactive({
  name: '',
  email: '',
  password: '',
  confirm: '',
  agree: true,
})

watch(
  () => props.initialMode,
  (value) => {
    mode.value = value
    error.value = ''
  },
)

const title = computed(() => (mode.value === 'login' ? '欢迎回来' : '创建账户'))
const subtitle = computed(() =>
  mode.value === 'login'
    ? '登录 Astra，继续你的特效与创作'
    : '注册后即可保存偏好与作品入口',
)
const submitLabel = computed(() => {
  if (auth.pending) return mode.value === 'login' ? '登录中…' : '创建中…'
  return mode.value === 'login' ? '登录' : '注册'
})

function switchMode(next: AuthMode) {
  mode.value = next
  error.value = ''
  void router.replace(next === 'login' ? '/login' : '/register')
}

function validate(): string | null {
  if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
    return '请输入有效邮箱'
  }
  if (form.password.length < 6) {
    return '密码至少 6 位'
  }
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

  const ok =
    mode.value === 'login'
      ? await auth.login(form.email.trim(), form.password)
      : await auth.register(form.name.trim(), form.email.trim(), form.password)

  if (ok) {
    await router.push('/')
  }
}
</script>

<template>
  <FxStage intensity="soft">
    <section class="auth">
      <div class="panel">
        <div class="brand-row">
          <span class="mark">Astra</span>
          <span class="badge">前端演示</span>
        </div>

        <div class="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'login'"
            :class="{ active: mode === 'login' }"
            @click="switchMode('login')"
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'register'"
            :class="{ active: mode === 'register' }"
            @click="switchMode('register')"
          >
            注册
          </button>
        </div>

        <header class="head">
          <h1>{{ title }}</h1>
          <p>{{ subtitle }}</p>
        </header>

        <form class="form" @submit.prevent="onSubmit">
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

          <label class="field">
            <span>密码</span>
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
        </form>

        <p class="foot">
          <template v-if="mode === 'login'">
            还没有账号？
            <button type="button" class="link" @click="switchMode('register')">
              去注册
            </button>
          </template>
          <template v-else>
            已有账号？
            <button type="button" class="link" @click="switchMode('login')">
              去登录
            </button>
          </template>
        </p>
      </div>
    </section>
  </FxStage>
</template>

<style scoped>
.auth {
  display: grid;
  place-items: center;
  height: 100%;
  min-height: 0;
  padding: 5.5rem 1.25rem 2rem;
  overflow: auto;
}

.panel {
  width: min(420px, 100%);
  padding: 1.4rem 1.35rem 1.25rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  backdrop-filter: blur(18px);
  box-shadow: var(--shadow);
}

.brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.mark {
  font-weight: 750;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-size: 0.85rem;
}

.badge {
  padding: 0.2rem 0.55rem;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border);
  color: var(--text-faint);
  font-size: 0.72rem;
}

.tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.35rem;
  margin-bottom: 1.1rem;
  padding: 0.28rem;
  border-radius: var(--radius-md);
  background: var(--bg-soft);
}

.tabs button {
  min-height: 2.35rem;
  border: 0;
  border-radius: 11px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.92rem;
}

.tabs button.active {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-soft-hover));
  color: var(--text);
  font-weight: 600;
}

.head h1 {
  margin: 0 0 0.35rem;
  font-size: 1.55rem;
  letter-spacing: -0.03em;
}

.head p {
  margin: 0 0 1.15rem;
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.5;
}

.form {
  display: grid;
  gap: 0.75rem;
}

.field {
  display: grid;
  gap: 0.35rem;
}

.field > span {
  color: var(--text-muted);
  font-size: 0.8rem;
}

input[type='text'],
input[type='email'],
input[type='password'] {
  width: 100%;
  min-height: 2.7rem;
  padding: 0 0.9rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--input-bg);
  color: var(--text);
  outline: none;
  font: inherit;
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
  min-width: 3.6rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-soft);
  color: var(--text-muted);
  cursor: pointer;
  font-size: 0.8rem;
}

.check {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-muted);
  font-size: 0.82rem;
}

.error,
.ok {
  margin: 0;
  font-size: 0.84rem;
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

.foot {
  margin: 1rem 0 0;
  text-align: center;
  color: var(--text-faint);
  font-size: 0.86rem;
}

.link {
  border: 0;
  background: none;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  padding: 0;
}
</style>
