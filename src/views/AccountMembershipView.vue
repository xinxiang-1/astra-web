<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ApiError, getAccessToken } from '@/api/http'
import {
  fetchMembershipStatus,
  type MembershipStatus,
  type MembershipState,
} from '@/api/membership'
import ArtFooter from '@/components/ArtFooter.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const status = ref<MembershipStatus | null>(null)
const busy = ref(false)
const needsLogin = ref(false)
const error = ref('')
let controller: AbortController | undefined
const states: Record<MembershipState, string> = {
  ACTIVE: '有效',
  FROZEN: '暂不可用',
  REVOKED: '已撤销',
  SCHEDULED: '尚未生效',
  EXPIRED: '已到期',
}
const stateDescriptions: Record<MembershipState, string> = {
  ACTIVE: '权益在有效期内；云服务开放后，以届时可用的服务为准。',
  FROZEN: '此项权益暂不可用，当前记录的剩余额度不能用于新任务。',
  REVOKED: '此项权益已撤销，剩余额度不再可用。你可以查看来源订单了解详情。',
  SCHEDULED: '此项权益尚未生效，生效前不能使用服务额度。',
  EXPIRED: '此项权益已到期，剩余额度不再可用。历史用量仍保留在此处。',
}
const count = (value: string) => new Intl.NumberFormat('zh-CN').format(BigInt(value))
function bytes(value: string) {
  const size = BigInt(value)
  for (const [unit, divisor] of [
    ['TiB', 1099511627776n],
    ['GiB', 1073741824n],
    ['MiB', 1048576n],
    ['KiB', 1024n],
  ] as const) {
    if (size >= divisor) {
      const tenth = (size * 10n) / divisor
      return `${count(String(tenth / 10n))}.${tenth % 10n} ${unit}`
    }
  }
  return `${count(value)} 字节`
}
function date(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
async function load() {
  controller?.abort()
  const attempt = new AbortController()
  controller = attempt
  const token = getAccessToken()
  status.value = null
  error.value = ''
  needsLogin.value = !token
  if (!token) {
    busy.value = false
    return
  }
  busy.value = true
  const current = () =>
    controller === attempt && !attempt.signal.aborted && getAccessToken() === token
  try {
    const result = await fetchMembershipStatus(attempt.signal)
    if (current()) status.value = result
  } catch (cause) {
    if (!current()) return
    if (cause instanceof ApiError && cause.status === 401) needsLogin.value = true
    else
      error.value = '暂时无法读取会员信息。请检查网络后重新读取；本次读取不会改变你的权益或额度。'
  } finally {
    if (controller === attempt) busy.value = false
  }
}
watch(
  [() => auth.user?.id, () => auth.sessionRevision],
  () => {
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="art-page membership-page">
    <div class="art-wrap membership-content">
      <header class="membership-heading">
        <h1>会员与服务额度</h1>
        <p>查看账户中的权益记录、有效期限和服务额度。你的创作素材与本地项目仍保存在此浏览器。</p>
      </header>
      <nav class="account-tabs" aria-label="账户内容">
        <RouterLink to="/account/orders">我的订单</RouterLink>
        <RouterLink to="/account/library">已购内容</RouterLink>
        <RouterLink to="/account/membership" aria-current="page">会员与额度</RouterLink>
        <RouterLink to="/projects">本地项目</RouterLink>
      </nav>
      <div v-if="!needsLogin" class="membership-refresh">
        <p role="status" aria-live="polite">
          <template v-if="busy">正在读取会员记录…</template>
          <template v-else-if="status"
            >状态更新时间：<time :datetime="status.serverTime">{{ date(status.serverTime) }}</time
            >（北京时间）</template
          >
          <template v-else>会员记录尚未载入</template>
        </p>
        <button class="art-button" :aria-disabled="busy" @click="!busy && load()">
          {{ error ? '重新读取' : '刷新记录' }}
        </button>
      </div>
      <section aria-label="会员记录" :aria-busy="busy">
        <div v-if="needsLogin" class="membership-notice">
          <h2>登录后查看你的会员记录</h2>
          <p>请使用购买时的账户登录。</p>
          <RouterLink
            :to="{ path: '/login', query: { returnTo: '/account/membership' } }"
            class="art-button primary"
            >前往登录</RouterLink
          >
        </div>
        <div v-else-if="!busy && error" class="membership-notice" role="alert">
          <h2>暂时无法读取</h2>
          <p>{{ error }}</p>
        </div>
        <template v-else-if="status">
          <div v-if="!status.enabled" class="membership-notice" data-membership-disabled>
            <h2>会员服务尚未开放</h2>
            <p>你可以继续免费制作作品，使用图片、视频、网页和项目导出。</p>
            <RouterLink to="/ascii-art" class="art-button primary">继续免费创作</RouterLink>
          </div>
          <template v-else>
            <p class="service-note">云备份与云端渲染尚未开放。这里展示账户的权益记录与额度。</p>
            <div v-if="!status.grants.length" class="membership-notice" data-membership-empty>
              <h2>当前没有会员权益</h2>
              <p>已购内容和免费创作工具可以继续使用。</p>
              <RouterLink to="/account/library" class="art-button">查看已购内容</RouterLink>
            </div>
            <ul v-else class="membership-list">
              <li
                v-for="item in status.grants"
                :key="item.id"
                class="membership-entry"
                :data-membership="item.id"
                :data-state="item.state"
              >
                <div class="entry-heading">
                  <h2>{{ item.plan.name }}</h2>
                  <strong class="membership-state">{{ states[item.state] }}</strong>
                </div>
                <p class="state-description">{{ stateDescriptions[item.state] }}</p>
                <dl class="membership-dates">
                  <div>
                    <dt>生效时间</dt>
                    <dd>
                      <time :datetime="item.startsAt">{{ date(item.startsAt) }}</time>
                    </dd>
                  </div>
                  <div>
                    <dt>到期时间</dt>
                    <dd>
                      <time :datetime="item.endsAt">{{ date(item.endsAt) }}</time>
                    </dd>
                  </div>
                </dl>
                <ul class="quota-list">
                  <li
                    v-for="quota in item.quotas"
                    :key="quota.capability"
                    :data-capability="quota.capability"
                  >
                    <h3>
                      {{
                        quota.capability === 'CLOUD_BACKUP_BYTES' ? '云备份空间' : '云端渲染次数'
                      }}
                    </h3>
                    <dl class="quota-values">
                      <div>
                        <dt>总额度</dt>
                        <dd
                          :title="
                            quota.capability === 'CLOUD_BACKUP_BYTES'
                              ? `${count(quota.capacity)} 字节`
                              : undefined
                          "
                        >
                          {{
                            quota.capability === 'CLOUD_BACKUP_BYTES'
                              ? bytes(quota.capacity)
                              : `${count(quota.capacity)} 次`
                          }}
                        </dd>
                      </div>
                      <div>
                        <dt>已使用</dt>
                        <dd
                          :title="
                            quota.capability === 'CLOUD_BACKUP_BYTES'
                              ? `${count(quota.used)} 字节`
                              : undefined
                          "
                        >
                          {{
                            quota.capability === 'CLOUD_BACKUP_BYTES'
                              ? bytes(quota.used)
                              : `${count(quota.used)} 次`
                          }}
                        </dd>
                      </div>
                      <div>
                        <dt>等待处理</dt>
                        <dd
                          :title="
                            quota.capability === 'CLOUD_BACKUP_BYTES'
                              ? `${count(quota.reserved)} 字节`
                              : undefined
                          "
                        >
                          {{
                            quota.capability === 'CLOUD_BACKUP_BYTES'
                              ? bytes(quota.reserved)
                              : `${count(quota.reserved)} 次`
                          }}
                        </dd>
                      </div>
                      <div>
                        <dt>账面剩余</dt>
                        <dd
                          :title="
                            quota.capability === 'CLOUD_BACKUP_BYTES'
                              ? `${count(quota.remaining)} 字节`
                              : undefined
                          "
                        >
                          {{
                            quota.capability === 'CLOUD_BACKUP_BYTES'
                              ? bytes(quota.remaining)
                              : `${count(quota.remaining)} 次`
                          }}
                        </dd>
                      </div>
                    </dl>
                  </li>
                </ul>
                <RouterLink :to="`/account/orders/${item.sourceOrderId}`">查看来源订单</RouterLink>
              </li>
            </ul>
          </template>
        </template>
      </section>
    </div>
    <ArtFooter />
  </div>
</template>

<style scoped>
.membership-content {
  padding-block: 56px 80px;
  min-height: 65vh;
}
.membership-heading h1 {
  font: 500 3rem var(--font-display);
  margin: 0 0 18px;
}
.membership-heading p {
  max-width: 68ch;
  line-height: 1.8;
}
.account-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  border-bottom: 1px solid var(--border);
  margin: 32px 0;
  padding-bottom: 16px;
}
.account-tabs a {
  padding-block: 10px;
  text-underline-offset: 8px;
}
.account-tabs a[aria-current] {
  color: var(--accent);
}
.membership-heading p,
dt,
.service-note,
.membership-refresh p,
.state-description {
  color: var(--text-muted);
}
.membership-notice {
  padding-block: 24px;
  line-height: 1.8;
}
.membership-notice h2,
.entry-heading h2 {
  font: 500 1.5rem var(--font-display);
  margin: 0 0 16px;
}
.membership-list,
.quota-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.membership-entry {
  padding-block: 28px;
  border-bottom: 1px solid var(--border);
  overflow-wrap: anywhere;
}
.entry-heading {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
}
.membership-state {
  font-weight: 500;
}
.state-description {
  max-width: 68ch;
  line-height: 1.8;
  margin: 0 0 24px;
}
.membership-dates {
  display: flex;
  flex-wrap: wrap;
  gap: 16px 48px;
  margin: 8px 0 28px;
}
dt {
  font-size: 14px;
  line-height: 1.8;
}
dd {
  margin: 4px 0 0;
  font-variant-numeric: tabular-nums;
}
.quota-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 32px;
  margin-bottom: 24px;
}
.quota-list h3 {
  font: 500 1rem var(--font-body);
  margin: 0 0 16px;
}
.quota-values {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px 24px;
  margin: 0;
}
.membership-refresh {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 24px;
  margin-bottom: 24px;
}
.membership-refresh p {
  font-size: 14px;
}
.membership-refresh .art-button {
  min-width: 112px;
}
.membership-refresh .art-button[aria-disabled='true'] {
  cursor: wait;
  opacity: 0.6;
}
.membership-page a:focus-visible,
.membership-page button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}
.membership-page a {
  text-underline-offset: 5px;
}
@media (max-width: 600px) {
  .membership-content {
    padding-block: 32px 48px;
  }
  .membership-heading h1 {
    font-size: 2rem;
  }
  .account-tabs {
    gap: 12px 20px;
  }
  .quota-list {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
