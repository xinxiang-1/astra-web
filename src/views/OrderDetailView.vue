<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ArtFooter from '@/components/ArtFooter.vue'
import { ApiError, getAccessToken } from '@/api/http'
import {
  fetchOwnedOrder,
  fetchOwnedPayment,
  fetchCommerceCapabilities,
  fetchOwnedRefund,
  type CommerceCapabilities,
  type CommerceOrder,
  type CommercePayment,
  type CommerceRefund,
} from '@/api/commerce'
import { isCommerceId } from '@/lib/account-return'
import { paymentForOrder, recoverExistingPayment } from '@/lib/payment-recovery'
import { canInitiateMockPayment, initiateMockPayment } from '@/lib/payment-initiation'
import { refundForOrder, submitRefundRequest } from '@/lib/refund-request'
import { formatPurchasedFileSize } from '@/lib/purchased-assets'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ orderId: string }>()
const auth = useAuthStore()
const order = ref<CommerceOrder | null>(null)
const payment = ref<CommercePayment | null>(null)
const capabilities = ref<CommerceCapabilities | null>(null)
const confirmingPayment = ref(false)
const paymentConsent = ref(false)
const refund = ref<CommerceRefund | null>(null)
const refundReason = ref('')
const refundConsent = ref(false)
const refundBusy = ref(false)
const refundError = ref('')
const busy = ref(false)
const recovering = ref(false)
const needsLogin = ref(false)
const notFound = ref(false)
const error = ref('')
const paymentError = ref('')
const notice = ref('')
let controller: AbortController | undefined
let loadedToken: string | null = null
const loginTarget = computed(() => ({
  path: '/login',
  query: { returnTo: `/account/orders/${props.orderId}` },
}))
const canRecover = computed(
  () =>
    order.value?.state === 'PENDING_PAYMENT' &&
    payment.value?.channel === 'wechat_native' &&
    ['INIT', 'PENDING', 'UNKNOWN'].includes(payment.value.state),
)
const canInitiate = computed(() => order.value && canInitiateMockPayment(order.value, capabilities.value))
const canRequestRefund = computed(() => order.value?.state === 'PAID' && order.value.totalRefundedCent === 0 && !order.value.refund && payment.value?.state === 'SUCCEEDED')
const states: Record<string, string> = {
  PENDING_PAYMENT: '待付款',
  PAID: '已付款',
  CLOSED: '已关闭',
  NONE: '尚未发放',
  GRANTED: '已发放',
  REVOKED: '已撤销',
  REVIEW: '待核查',
  REQUESTED: '已申请',
  APPROVED: '已批准',
  PROCESSING: '处理中',
  SUCCEEDED: '已完成',
  FAILED: '处理失败',
  REJECTED: '已拒绝',
}
const paymentStates: Record<string, string> = {
  INIT: '记录初始化中',
  PENDING: '等待后台确认付款',
  UNKNOWN: '结果确认中',
  SUCCEEDED: '后台已确认付款',
  CLOSED: '支付已关闭',
}
function money(cents: number, currency: string) {
  return currency === 'CNY' && Number.isSafeInteger(cents) && cents >= 0
    ? `¥${(cents / 100).toFixed(2)}`
    : '金额待确认'
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
function clearPrivate() {
  order.value = null
  payment.value = null
  loadedToken = null
  capabilities.value = null
  confirmingPayment.value = false
  paymentConsent.value = false
  refund.value = null
  refundReason.value = ''
  refundConsent.value = false
}
async function load(preserveNotice = false) {
  controller?.abort()
  const attempt = new AbortController()
  controller = attempt
  recovering.value = false
  refundBusy.value = false
  busy.value = true
  error.value = ''
  paymentError.value = ''
  refundError.value = ''
  notFound.value = false
  if (!preserveNotice) notice.value = ''
  clearPrivate()
  const token = getAccessToken()
  needsLogin.value = !token
  if (!token) {
    busy.value = false
    return
  }
  if (!isCommerceId(props.orderId)) {
    notFound.value = true
    error.value = '订单地址无效，请从我的订单重新进入。'
    busy.value = false
    return
  }
  try {
    const [result, flags] = await Promise.all([
      fetchOwnedOrder(props.orderId, attempt.signal),
      fetchCommerceCapabilities(attempt.signal).catch(() => null),
    ])
    if (attempt.signal.aborted || getAccessToken() !== token) return
    if (result.id !== props.orderId || (result.paymentId && !isCommerceId(result.paymentId)))
      throw new Error('Invalid order binding')
    order.value = result
    loadedToken = token
    capabilities.value = flags
    if (result.paymentId) {
      try {
        const row = await fetchOwnedPayment(result.paymentId, attempt.signal)
        if (attempt.signal.aborted || getAccessToken() !== token) return
        payment.value = paymentForOrder(row, result)
      } catch (cause) {
        if (attempt.signal.aborted || getAccessToken() !== token) return
        if (cause instanceof ApiError && cause.status === 401) {
          clearPrivate()
          needsLogin.value = true
        } else paymentError.value = '付款记录暂时无法读取，请刷新状态。不要重新创建订单或重复付款。'
      }
    }
    if (result.refund && !needsLogin.value) {
      try {
        const row = await fetchOwnedRefund(result.refund.id, attempt.signal)
        if (attempt.signal.aborted || getAccessToken() !== token) return
        refund.value = refundForOrder(row, result)
      } catch (cause) {
        if (attempt.signal.aborted || getAccessToken() !== token) return
        if (cause instanceof ApiError && cause.status === 401) { clearPrivate(); needsLogin.value = true }
        else refundError.value = '退款详情暂时无法读取，请刷新原订单；不要重复申请。'
      }
    }
  } catch (cause) {
    if (attempt.signal.aborted || getAccessToken() !== token) return
    clearPrivate()
    if (cause instanceof ApiError && cause.status === 401) needsLogin.value = true
    else {
      notFound.value = cause instanceof ApiError && cause.status === 404
      error.value = notFound.value
        ? '未找到这笔订单，请确认使用购买时的账户。'
        : '订单暂时无法读取，请稍后重新读取。'
    }
  } finally {
    if (controller === attempt) busy.value = false
  }
}
async function recover() {
  if (busy.value || recovering.value || !canRecover.value || !order.value || !payment.value) return
  const token = getAccessToken()
  if (!token || token !== loadedToken) {
    await load()
    return
  }
  const attempt = new AbortController()
  controller?.abort()
  controller = attempt
  recovering.value = true
  const orderId = order.value.id
  notice.value = ''
  paymentError.value = ''
  try {
    await recoverExistingPayment(order.value, payment.value, token, attempt.signal)
    if (attempt.signal.aborted || getAccessToken() !== token) return
    notice.value = '已恢复同一付款记录。'
    await load(true)
    if (getAccessToken() === token && order.value?.id === orderId && !busy.value)
      notice.value = '已恢复同一付款记录，订单状态已刷新。'
  } catch (cause) {
    if (attempt.signal.aborted || getAccessToken() !== token) return
    if (cause instanceof ApiError && cause.status === 401) {
      clearPrivate()
      needsLogin.value = true
    } else if (cause instanceof ApiError && (cause.status === 404 || cause.status === 403)) {
      clearPrivate()
      error.value = '当前账户无法读取这笔订单，请从我的订单重新进入。'
    } else
      paymentError.value =
        cause instanceof ApiError && cause.status === 429
          ? '恢复过于频繁，请稍后刷新或恢复原付款记录。'
          : cause instanceof Error &&
              !(cause instanceof ApiError) &&
              !(cause instanceof TypeError) &&
              !(cause instanceof DOMException)
            ? cause.message
            : '恢复结果尚未确认，请用“恢复付款记录”重试。不要新建订单或重复付款。'
  } finally {
    if (controller === attempt) recovering.value = false
  }
}
async function applyRefund() {
  if (busy.value || recovering.value || refundBusy.value || !canRequestRefund.value || !order.value || !refundConsent.value) return
  const token = getAccessToken()
  if (!token || token !== loadedToken) { await load(); return }
  const original = order.value
  const attempt = new AbortController()
  controller?.abort()
  controller = attempt
  refundBusy.value = true
  refundError.value = ''
  notice.value = ''
  const reason = refundReason.value
  refundConsent.value = false
  try {
    const result = await submitRefundRequest(original, reason, token, attempt.signal)
    if (attempt.signal.aborted || getAccessToken() !== token) return
    notice.value = result.state === 'REQUESTED'
      ? '退款申请已提交，等待后台审核。申请不代表退款到账。'
      : '已恢复原退款记录，处理状态以后台记录为准。'
    await load(true)
  } catch (cause) {
    if (attempt.signal.aborted || getAccessToken() !== token) return
    if (cause instanceof ApiError && cause.status === 401) { clearPrivate(); needsLogin.value = true }
    else if (cause instanceof ApiError && cause.status === 404) { clearPrivate(); error.value = '当前账户无法读取这笔订单，请从我的订单重新进入。' }
    else refundError.value = cause instanceof Error && !(cause instanceof ApiError) && !(cause instanceof TypeError) && !(cause instanceof DOMException)
      ? cause.message : '申请结果暂时无法确认。请先刷新原订单；仍无记录时，用相同原因恢复申请。'
  } finally { if (controller === attempt) refundBusy.value = false }
}
async function initiate() {
  if (busy.value || recovering.value || !canInitiate.value || !order.value || !confirmingPayment.value || !paymentConsent.value) return
  const token = getAccessToken()
  if (!token || token !== loadedToken) { await load(); return }
  const original = order.value
  const flags = capabilities.value
  const attempt = new AbortController()
  controller?.abort()
  controller = attempt
  recovering.value = true
  paymentConsent.value = false
  paymentError.value = ''
  notice.value = ''
  try {
    await initiateMockPayment(original, flags, token, attempt.signal)
    if (attempt.signal.aborted || getAccessToken() !== token) return
    notice.value = '模拟付款请求已受理，正在核对后台订单状态。'
    await load(true)
    if (getAccessToken() === token && order.value?.id === original.id)
      notice.value = '已核对模拟付款记录。付款与权益状态以后台确认为准。'
  } catch (cause) {
    if (attempt.signal.aborted || getAccessToken() !== token) return
    if (cause instanceof ApiError && cause.status === 401) { clearPrivate(); needsLogin.value = true }
    else if (cause instanceof ApiError && cause.status === 404) { clearPrivate(); error.value = '当前账户无法读取这笔订单，请从我的订单重新进入。' }
    else {
      confirmingPayment.value = false
      paymentError.value = cause instanceof ApiError && cause.code === 43005
        ? '后台已拒绝发起付款，请刷新原订单确认关闭状态。'
        : cause instanceof Error && !(cause instanceof ApiError) && !(cause instanceof TypeError) && !(cause instanceof DOMException)
          ? cause.message : '付款请求结果暂时无法确认。请先刷新原订单；如已有记录，只恢复原付款记录。'
    }
  } finally { if (controller === attempt) recovering.value = false }
}
function openPaymentConfirmation() {
  if (getAccessToken() !== loadedToken) { void load(); return }
  paymentConsent.value = false
  confirmingPayment.value = true
}
function closePaymentConfirmation() {
  confirmingPayment.value = false
  paymentConsent.value = false
}
function onStorage(event: StorageEvent) {
  if (event.key === 'astra_access_token' || event.key === null) void load()
}
watch([() => props.orderId, () => auth.user?.id], () => void load(), { immediate: true })
onMounted(() => window.addEventListener('storage', onStorage))
onBeforeUnmount(() => {
  controller?.abort()
  window.removeEventListener('storage', onStorage)
})
</script>

<template>
  <div class="art-page order-detail-page">
    <div class="art-wrap order-content">
      <nav class="order-links" aria-label="订单导航">
        <RouterLink to="/account/orders">我的订单</RouterLink
        ><RouterLink to="/account/library">已购内容 ↗</RouterLink>
      </nav>
      <header class="order-heading">
        <span class="art-eyebrow">ASTRA · YOUR ORDER</span>
        <h1>订单详情</h1>
        <p>查看购买时确认的版本、金额、条款与当前处理结果。</p>
      </header>
      <p v-if="busy" role="status">正在读取订单与付款记录…</p>
      <p v-if="notice" role="status">{{ notice }}</p>
      <div v-if="needsLogin" class="order-notice">
        <h2>登录后查看这笔订单</h2>
        <p>请使用购买时的账户登录。</p>
        <RouterLink :to="loginTarget" class="art-button primary">前往登录</RouterLink>
      </div>
      <div v-if="error" class="order-notice" role="alert">
        <p>{{ error }}</p>
        <RouterLink v-if="notFound" to="/account/orders" class="art-button">返回我的订单</RouterLink
        ><button v-else class="art-button" :disabled="busy" @click="load()">重新读取</button>
      </div>
      <article v-if="order" :data-order-detail="order.id" :aria-busy="busy || recovering">
        <div class="order-summary">
          <div>
            <h2>{{ order.item.productName }}</h2>
            <p>版本 {{ order.item.releaseVersion }} · 数量 {{ order.item.quantity }}</p>
          </div>
          <strong data-order-amount>{{ money(order.totalAmountCent, order.currency) }}</strong>
        </div>
        <p class="order-number">订单 {{ order.orderNo }}</p>
        <dl class="order-facts">
          <div>
            <dt>订单状态</dt>
            <dd>{{ states[order.state] ?? '状态待确认' }}</dd>
          </div>
          <div>
            <dt>内容交付</dt>
            <dd>{{ states[order.fulfillmentState] ?? '状态待确认' }}</dd>
          </div>
          <div>
            <dt>下单时间</dt>
            <dd>{{ date(order.createdAt) }}</dd>
          </div>
          <div>
            <dt>条款确认</dt>
            <dd>{{ date(order.consentAt) }}</dd>
          </div>
          <div>
            <dt>订单期限</dt>
            <dd>{{ date(order.expiresAt) }}</dd>
          </div>
          <div v-if="order.paidAt">
            <dt>付款确认</dt>
            <dd>{{ date(order.paidAt) }}</dd>
          </div>
          <div v-if="order.closedAt">
            <dt>关闭时间</dt>
            <dd>{{ date(order.closedAt) }}</dd>
          </div>
        </dl>
        <p v-if="order.issueCode" class="order-notice">
          这笔订单需要核查，请保留订单号并联系支持。
        </p>
        <section class="payment-section" aria-labelledby="payment-heading">
          <h2 id="payment-heading">付款记录</h2>
          <p v-if="paymentError" role="alert">{{ paymentError }}</p>
          <template v-if="payment">
            <p data-payment-state>{{ paymentStates[payment.state] }}</p>
            <p>
              {{ payment.channel === 'wechat_native' ? '微信支付' : '付款渠道' }} ·
              {{ money(payment.amountCent, payment.currency) }}
            </p>
            <p v-if="payment.mock" class="mock-note">这是一笔模拟支付记录，不涉及真实资金。</p>
            <p v-if="payment.state === 'INIT' || payment.state === 'UNKNOWN'">
              后台仍在确认原付款记录。请保留原订单，不要重复付款。
            </p>
            <p v-if="payment.state === 'SUCCEEDED' && order.state !== 'PAID'">
              付款已确认，订单仍在同步。请刷新状态或联系支持，不要重复付款。
            </p>
            <button
              v-if="canRecover"
              class="art-button"
              :disabled="busy || recovering"
              @click="recover()"
            >
              {{ recovering ? '正在恢复…' : '恢复付款记录' }}
            </button>
          </template>
          <template v-else-if="canInitiate">
            <p>这笔订单尚无付款记录。当前仅允许创建模拟记录，不涉及真实资金。</p>
            <button v-if="!confirmingPayment" class="art-button" :disabled="busy || recovering" @click="openPaymentConfirmation">
              核对模拟付款请求
            </button>
            <form v-else data-payment-confirmation @submit.prevent="initiate">
              <p>原订单 {{ order.orderNo }} · {{ money(order.totalAmountCent, order.currency) }}</p>
              <details v-for="entry in [
                { name: '使用许可', policy: order.item.license },
                { name: '购买条款', policy: order.purchaseTerms },
                { name: '退款说明', policy: order.refundPolicy },
              ]" :key="entry.name" open>
                <summary>{{ entry.name }} · {{ entry.policy.version }}</summary>
                <p class="policy-copy">{{ entry.policy.content }}</p>
              </details>
              <label class="payment-consent"><input v-model="paymentConsent" type="checkbox" :disabled="busy || recovering" />
                我已核对原订单金额和以上条款，确认仅创建模拟付款记录。</label>
              <button class="art-button" type="submit" :disabled="busy || recovering || !paymentConsent">确认创建模拟付款记录</button>
              <button class="art-button" type="button" :disabled="busy || recovering" @click="closePaymentConfirmation">返回核对</button>
            </form>
          </template>
          <p v-else-if="!paymentError">这笔订单尚无付款记录。新付款入口尚未开放。</p>
          <button class="art-button" :disabled="busy || recovering" @click="load()">
            刷新订单状态
          </button>
          <p class="muted">付款、关闭与交付结果以后台确认记录为准，页面上的时间不决定订单状态。</p>
        </section>
        <section class="refund-section" aria-labelledby="refund-heading">
          <h2 id="refund-heading">退款记录</h2>
          <template v-if="order.refund"
            ><p data-refund-state>
              {{ states[refund?.state ?? order.refund.state] ?? '状态待确认' }} ·
              {{ money(order.refund.amountCent, order.currency) }}
            </p>
            <p>已完成退款金额：{{ money(order.totalRefundedCent, order.currency) }}</p></template
          >
          <p v-else>尚无退款记录。</p>
          <template v-if="refund">
            <p class="refund-text">申请原因：{{ refund.reason }}</p>
            <p v-if="refund.decisionReason" class="refund-text">审核说明：{{ refund.decisionReason }}</p>
            <p class="muted">最近更新：{{ date(refund.updatedAt) }}</p>
            <p v-if="refund.state === 'REJECTED'" class="muted">如需补充材料或申诉，请联系订单支持，由后台重新审核原申请。</p>
          </template>
          <p v-if="refundError" role="alert">{{ refundError }}</p>
          <form v-if="canRequestRefund" class="refund-form" @submit.prevent="applyRefund">
            <p>申请原订单全额退款：{{ money(order.totalAmountCent, order.currency) }}</p>
            <p class="muted">申请将由后台审核。已开始领取、文件质量或描述问题仍可说明情况；请勿填写密码、支付密钥或银行卡信息。</p>
            <details><summary>查看这笔订单的退款说明</summary><p class="policy-copy">{{ order.refundPolicy.content }}</p></details>
            <label for="refund-reason">退款原因</label>
            <textarea id="refund-reason" v-model="refundReason" rows="4" maxlength="1000" :disabled="refundBusy" aria-describedby="refund-reason-help" required />
            <p id="refund-reason-help" class="muted">请填写5至500字。{{ Array.from(refundReason.trim()).length }}/500</p>
            <label class="payment-consent"><input v-model="refundConsent" type="checkbox" :disabled="refundBusy" />我已阅读该订单退款说明，确认提交全额退款申请。</label>
            <button class="art-button" type="submit" :disabled="busy || recovering || refundBusy || !refundConsent || Array.from(refundReason.trim()).length < 5 || Array.from(refundReason.trim()).length > 500">{{ refundBusy ? '正在提交申请…' : '提交退款申请' }}</button>
          </form>
          <p class="muted">退款申请和到账是不同状态，处理结果以后台记录及渠道到账为准。</p>
        </section>
        <section class="order-files" aria-labelledby="order-files-heading">
          <h2 id="order-files-heading">购买版本的文件</h2>
          <ul>
            <li v-for="file in order.item.assets" :key="file.id">
              {{ file.fileName }} · {{ formatPurchasedFileSize(file.sizeBytes) }}
            </li>
          </ul>
          <RouterLink
            v-if="order.fulfillmentState === 'GRANTED'"
            to="/account/library"
            class="art-button"
            >前往已购内容领取 ↗</RouterLink
          >
          <p class="muted">交付资格由后台核验。领取开始记录不等于文件已完整保存。</p>
        </section>
        <section class="order-policies" aria-label="购买时确认的条款">
          <h2>购买时确认的条款</h2>
          <details
            v-for="entry in [
              { name: '使用许可', policy: order.item.license },
              { name: '购买条款', policy: order.purchaseTerms },
              { name: '退款说明', policy: order.refundPolicy },
            ]"
            :key="entry.name"
          >
            <summary>{{ entry.name }} · {{ entry.policy.version }}</summary>
            <p class="policy-copy">{{ entry.policy.content }}</p>
          </details>
        </section>
      </article>
    </div>
    <ArtFooter />
  </div>
</template>

<style scoped>
.order-content {
  padding-block: 40px 72px;
  max-width: 1000px;
  min-height: 70vh;
}
.order-links {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
  font-size: 13px;
}
.order-heading {
  padding-block: 36px 24px;
}
.order-heading h1 {
  font: 500 clamp(32px, 5vw, 48px) var(--font-display);
  margin: 16px 0;
}
.order-heading p,
article p {
  line-height: 1.9;
}
article {
  overflow-wrap: anywhere;
}
article h2,
.order-notice h2 {
  font: 500 24px var(--font-display);
  line-height: 1.5;
  margin: 16px 0;
}
.order-summary {
  border-top: 1px solid var(--border);
  padding-top: 24px;
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 24px;
}
.order-summary strong {
  font: 500 36px var(--font-display);
  padding-top: 16px;
}
.order-number,
.muted {
  color: var(--text-muted);
  font-size: 13px;
}
.order-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24px;
  padding-block: 24px;
  border-block: 1px solid var(--border);
}
.order-facts dt {
  color: var(--text-muted);
  font-size: 13px;
  margin-bottom: 8px;
}
.order-facts dd {
  margin: 0;
  line-height: 1.8;
}
.order-notice,
.payment-section,
.refund-section,
.order-files,
.order-policies {
  padding-block: 20px;
}
.payment-section,
.refund-section,
.order-files {
  border-bottom: 1px solid var(--border);
}
.payment-section button {
  margin: 12px 16px 8px 0;
}
.mock-note {
  border-left: 3px solid var(--accent);
  padding: 8px 16px;
}
.payment-consent {
  display: flex;
  align-items: start;
  gap: 12px;
  margin-block: 20px;
  line-height: 1.8;
}
.payment-consent input {
  margin-top: 7px;
  flex-shrink: 0;
}
.payment-section details {
  padding-block: 14px;
  border-bottom: 1px solid var(--border);
}
.payment-section summary { cursor: pointer; }
.order-files ul {
  padding-left: 20px;
  line-height: 1.9;
}
.order-policies details {
  border-bottom: 1px solid var(--border);
  padding: 18px 0;
}
.order-policies summary {
  cursor: pointer;
}
.policy-copy {
  white-space: pre-wrap;
  line-height: 1.9;
}
.refund-form { display: grid; gap: 12px; margin-block: 20px; }
.refund-form textarea {
  width: 100%; box-sizing: border-box; padding: 12px; border: 1px solid var(--border);
  border-radius: 8px; background: var(--bg); color: var(--text); font: inherit;
  line-height: 1.7; resize: vertical;
}
.refund-form textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.refund-form summary { cursor: pointer; }
.refund-form .art-button { justify-self: start; }
.refund-text { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.8; }
@media (max-width: 540px) {
  .order-facts {
    grid-template-columns: minmax(0, 1fr);
    gap: 18px;
  }
  .order-content {
    padding-top: 28px;
  }
}
</style>
