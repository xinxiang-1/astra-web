<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ApiError, getAccessToken } from '@/api/http'
import {
  fetchOwnedOrders,
  fetchOwnedEntitlements,
  type CommerceOrder,
  type CommerceEntitlement,
} from '@/api/commerce'
import ArtFooter from '@/components/ArtFooter.vue'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ collection: 'orders' | 'library' }>()
const auth = useAuthStore()
const orders = ref<CommerceOrder[]>([])
const entitlements = ref<CommerceEntitlement[]>([])
const cursor = ref<string | null>(null)
const busy = ref(false)
const error = ref('')
const needsLogin = ref(false)
const loaded = ref(false)
let controller: AbortController | undefined
const title = computed(() => (props.collection === 'orders' ? '我的订单' : '已购内容'))
const loginTarget = computed(() => ({
  path: '/login',
  query: { returnTo: `/account/${props.collection}` },
}))
const states: Record<string, string> = {
  PENDING_PAYMENT: '待付款',
  PAID: '已付款',
  CLOSED: '已关闭',
  NONE: '尚未发放',
  GRANTED: '已发放',
  REVIEW: '待核查',
  ACTIVE: '有效',
  FROZEN: '暂不可用',
  REVOKED: '已撤销',
  REQUESTED: '已申请',
  APPROVED: '已批准',
  PROCESSING: '处理中',
  SUCCEEDED: '已完成',
  FAILED: '处理失败',
  REJECTED: '已拒绝',
}
function state(value: string) {
  return states[value] ?? '状态待确认'
}
function date(value: string) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? '时间待确认'
    : new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(parsed)
}
function money(cents: number, currency: string) {
  return currency === 'CNY' && Number.isSafeInteger(cents) && cents >= 0
    ? `¥${(cents / 100).toFixed(2)}`
    : '金额待确认'
}
async function load(append = false) {
  controller?.abort()
  const attempt = new AbortController()
  controller = attempt
  const token = getAccessToken()
  error.value = ''
  needsLogin.value = !token
  if (!append) {
    orders.value = []
    entitlements.value = []
    cursor.value = null
    loaded.value = false
  }
  if (!token) {
    busy.value = false
    return
  }
  busy.value = true
  const collection = props.collection
  try {
    if (collection === 'orders') {
      const page = await fetchOwnedOrders(
        append ? (cursor.value ?? undefined) : undefined,
        attempt.signal,
      )
      if (attempt.signal.aborted || getAccessToken() !== token) return
      orders.value = append ? [...orders.value, ...page.items] : page.items
      cursor.value = page.nextCursor ?? null
    } else {
      const page = await fetchOwnedEntitlements(
        append ? (cursor.value ?? undefined) : undefined,
        attempt.signal,
      )
      if (attempt.signal.aborted || getAccessToken() !== token) return
      entitlements.value = append ? [...entitlements.value, ...page.items] : page.items
      cursor.value = page.nextCursor ?? null
    }
    loaded.value = true
  } catch (cause) {
    if (attempt.signal.aborted || getAccessToken() !== token) return
    if (cause instanceof ApiError && cause.status === 401) {
      needsLogin.value = true
      orders.value = []
      entitlements.value = []
      cursor.value = null
      loaded.value = false
    } else {
      error.value =
        cause instanceof ApiError && cause.status === 403
          ? '当前账户无法访问这些内容。'
          : '暂时无法读取，请稍后重试。你的购买记录以账户中的记录为准。'
    }
  } finally {
    if (controller === attempt) busy.value = false
  }
}
watch(
  [() => props.collection, () => auth.user?.id],
  () => {
    void load()
  },
  { immediate: true },
)
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="art-page account-page">
    <div class="art-wrap account-content">
      <header class="account-heading">
        <span class="art-eyebrow">ASTRA · YOUR COLLECTION</span>
        <h1>{{ title }}</h1>
        <p>在这里查看账户中的订单和内容。创作素材与本地项目仍保存在此浏览器。</p>
      </header>
      <nav class="account-tabs" aria-label="账户内容">
        <RouterLink
          to="/account/orders"
          :aria-current="collection === 'orders' ? 'page' : undefined"
          >我的订单</RouterLink
        >
        <RouterLink
          to="/account/library"
          :aria-current="collection === 'library' ? 'page' : undefined"
          >已购内容</RouterLink
        >
        <RouterLink to="/projects">本地项目 ↗</RouterLink>
      </nav>
      <section :aria-label="title" :aria-busy="busy">
        <div v-if="needsLogin" class="account-notice">
          <h2>登录后查看你的{{ collection === 'orders' ? '订单' : '已购内容' }}</h2>
          <p>请使用购买时的账户登录。</p>
          <RouterLink :to="loginTarget" class="art-button primary">前往登录</RouterLink>
        </div>
        <p v-if="busy" role="status">正在读取{{ title }}…</p>
        <div v-if="error" class="account-notice" role="alert">
          <p>{{ error }}</p>
          <button class="art-button" :disabled="busy" @click="load(Boolean(cursor && loaded))">
            重新读取
          </button>
        </div>
        <p
          v-if="
            loaded && !error && !(collection === 'orders' ? orders.length : entitlements.length)
          "
          class="account-notice"
        >
          {{ collection === 'orders' ? '还没有订单。' : '还没有已购内容。' }}
          <RouterLink to="/templates">先看看免费模板 ↗</RouterLink>
        </p>
        <ul v-if="collection === 'orders' && orders.length" class="account-list">
          <li v-for="order in orders" :key="order.id" class="account-row" :data-order="order.id">
            <div class="row-top">
              <h2>{{ order.item.productName }}</h2>
              <strong>{{ money(order.totalAmountCent, order.currency) }}</strong>
            </div>
            <p>订单 {{ order.orderNo }} · 版本 {{ order.item.releaseVersion }}</p>
            <p>付款：{{ state(order.state) }} · 内容：{{ state(order.fulfillmentState) }}</p>
            <p v-if="order.refund">
              退款：{{ state(order.refund.state) }} ·
              {{ money(order.refund.amountCent, order.currency) }}
            </p>
            <p v-if="order.issueCode">该订单需要核查，请保留订单号。</p>
            <time :datetime="order.createdAt">{{ date(order.createdAt) }}</time>
          </li>
        </ul>
        <ul v-else-if="collection === 'library' && entitlements.length" class="account-list">
          <li
            v-for="item in entitlements"
            :key="item.id"
            class="account-row"
            :data-entitlement="item.id"
          >
            <div class="row-top">
              <h2>内容版本 {{ item.release.version }}</h2>
              <strong>{{ state(item.state) }}</strong>
            </div>
            <p>来自订单 {{ item.sourceOrderId }} · {{ date(item.grantedAt) }}</p>
            <p v-for="content in item.release.deliveryContents" :key="content">{{ content }}</p>
            <ul class="file-list">
              <li v-for="file in item.release.assets" :key="file.id">
                {{ file.fileName }} · {{ (file.sizeBytes / 1024 / 1024).toFixed(2) }} MB
              </li>
            </ul>
            <details>
              <summary>查看购买许可</summary>
              <p class="policy-copy">{{ item.release.license.content }}</p>
            </details>
          </li>
        </ul>
        <button
          v-if="cursor && !needsLogin"
          class="art-button load-more"
          :disabled="busy"
          @click="load(true)"
        >
          读取更多
        </button>
        <button
          v-if="loaded && !needsLogin"
          class="art-button refresh-list"
          :disabled="busy"
          @click="load()"
        >
          刷新记录
        </button>
      </section>
    </div>
    <ArtFooter />
  </div>
</template>

<style scoped>
.account-content {
  padding-block: 56px 80px;
  min-height: 65vh;
}
.account-heading h1 {
  font: 500 clamp(32px, 5vw, 48px) var(--font-display);
  margin: 18px 0;
}
.account-heading p,
.account-row p,
time {
  color: var(--text-muted);
  font-size: 13px;
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
.account-notice {
  padding-block: 24px;
  line-height: 1.8;
}
.account-notice h2 {
  font-size: 22px;
}
.account-list {
  list-style: none;
  padding: 0;
}
.account-row {
  padding: 28px 0;
  border-bottom: 1px solid var(--border);
  overflow-wrap: anywhere;
}
.row-top {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 16px;
  align-items: baseline;
}
.row-top h2 {
  margin: 0;
  font: 500 22px var(--font-display);
}
.row-top strong {
  font-size: 15px;
}
.file-list {
  font-size: 13px;
  line-height: 1.8;
  padding-left: 20px;
}
summary {
  cursor: pointer;
  padding-block: 12px;
}
.policy-copy {
  white-space: pre-wrap;
}
.load-more,
.refresh-list {
  margin: 24px 16px 0 0;
}
@media (max-width: 600px) {
  .account-content {
    padding-block: 32px 48px;
  }
  .account-tabs {
    gap: 16px;
  }
}
</style>
