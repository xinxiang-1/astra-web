<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ApiError, getAccessToken } from '@/api/http'
import { fetchCommerceAdminAccess, fetchAdminRefunds, fetchAdminRefundContext, type CommerceRefund, type CommerceRefundContext, type RefundDecision } from '@/api/commerce'
import { availableRefundDecisions, submitRefundDecision, validateRefundContext } from '@/lib/admin-refunds'
import { normalizeRefundReason } from '@/lib/refund-request'
import { useAuthStore } from '@/stores/auth'
import ArtFooter from '@/components/ArtFooter.vue'

const auth = useAuthStore()
const allowed = ref(false), needsLogin = ref(false), busy = ref(false), loaded = ref(false)
const error = ref(''), notice = ref(''), filter = ref('REQUESTED'), cursor = ref<string | null>(null)
const refunds = ref<CommerceRefund[]>([]), detail = ref<CommerceRefundContext | null>(null)
const reason = ref(''), reviewed = ref(false)
let controller: AbortController | undefined
const labels: Record<string, string> = { REQUESTED: '待审核', APPROVED: '已批准，等待退款', PROCESSING: '渠道处理中', SUCCEEDED: '退款完成', REJECTED: '已拒绝', FAILED: '退款失败', REVIEW: '待人工核查' }
const factLabels: Record<string, string> = { PAID: '已付款', PENDING_PAYMENT: '待付款', CLOSED: '已关闭', GRANTED: '已发放', REVOKED: '已撤销', NONE: '尚未发放', REVIEW: '待核查', READY: '等待执行', RUNNING: '正在执行', DONE: '执行完成', DEAD: '执行异常', REFUND_APPROVE: '批准退款', REFUND_REJECT: '拒绝申请', REFUND_REOPEN: '重新受理' }
const actionLabels: Record<RefundDecision, string> = { APPROVE: '批准全额退款', REJECT: '拒绝申请', REOPEN: '重新受理' }
const decisions = computed(() => detail.value ? availableRefundDecisions(detail.value) : [])
const validReason = computed(() => { try { normalizeRefundReason(reason.value); return true } catch { return false } })
const canDecide = computed(() => !busy.value && reviewed.value && validReason.value && !!decisions.value.length)
function state(value: string) { return labels[value] ?? '状态待确认' }
function money(value: number) { return Number.isSafeInteger(value) && value >= 0 ? `¥${(value / 100).toFixed(2)}` : '金额待确认' }
function date(value: string) { return Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '时间待确认' }
function clear() { allowed.value = false; loaded.value = false; refunds.value = []; cursor.value = null; detail.value = null; reason.value = ''; reviewed.value = false; error.value = ''; notice.value = '' }
function begin() {
  controller?.abort()
  const attempt = new AbortController(), token = getAccessToken()
  controller = attempt; busy.value = true; error.value = ''; needsLogin.value = !token
  return { attempt, token, current: () => !attempt.signal.aborted && getAccessToken() === token }
}
function failure(cause: unknown) {
  if (cause instanceof ApiError && (cause.status === 401 || cause.status === 403)) {
    clear(); needsLogin.value = cause.status === 401
    error.value = cause.status === 403 ? '当前账户没有退款管理权限。' : '登录已失效，请重新登录。'
  } else error.value = cause instanceof Error ? cause.message : '暂时无法读取，请稍后重试。'
}
async function load(append = false) {
  if (busy.value) return
  const { attempt, token, current } = begin()
  if (!append) { refunds.value = []; cursor.value = null; loaded.value = false; detail.value = null; reason.value = ''; reviewed.value = false; notice.value = '' }
  if (!token) { clear(); busy.value = false; return }
  try {
    allowed.value = false
    const access = await fetchCommerceAdminAccess(attempt.signal)
    if (!current()) return
    if (access.role !== 'COMMERCE_ADMIN') throw new Error('管理权限暂不可确认。')
    allowed.value = true
    const page = await fetchAdminRefunds(filter.value || undefined, append ? cursor.value ?? undefined : undefined, attempt.signal)
    if (!current()) return
    const combined = append ? [...refunds.value, ...page.items] : page.items
    refunds.value = [...new Map(combined.map((item) => [item.id, item])).values()]
    cursor.value = page.nextCursor ?? null; loaded.value = true
  } catch (cause) { if (current()) failure(cause) }
  finally { if (controller === attempt) busy.value = false }
}
async function select(id: string) {
  if (busy.value) return
  const { attempt, token, current } = begin()
  detail.value = null; reason.value = ''; reviewed.value = false; notice.value = ''
  if (!token) { clear(); busy.value = false; return }
  try {
    const result = validateRefundContext(await fetchAdminRefundContext(id, attempt.signal))
    if (!current()) return
    if (result.refund.id !== id) throw new Error('返回的申请不一致，请重新读取。')
    detail.value = result
    refunds.value = refunds.value.map((item) => item.id === id ? result.refund : item)
  } catch (cause) { if (current()) failure(cause) }
  finally { if (controller === attempt) busy.value = false }
}
async function decide(action: RefundDecision) {
  if (!canDecide.value || !detail.value) return
  const context = detail.value, text = reason.value
  const { attempt, token, current } = begin()
  reviewed.value = false; notice.value = ''
  if (!token) { clear(); busy.value = false; return }
  try {
    const result = await submitRefundDecision(context, action, text, token, attempt.signal)
    if (!current()) return
    // Discard the old version before any subsequent read; never approve using stale UI facts.
    detail.value = null; reason.value = ''
    refunds.value = refunds.value.map((item) => item.id === result.id ? result : item)
    const fresh = validateRefundContext(await fetchAdminRefundContext(result.id, attempt.signal))
    if (!current()) return
    detail.value = fresh
    notice.value = `后台当前状态：${state(fresh.refund.state)}。批准后仍需渠道确认到账；重新受理后须再次审核。`
  } catch (cause) {
    if (!current()) return
    if (cause instanceof ApiError && cause.code === 43008) {
      detail.value = null; reason.value = ''; error.value = '申请已被其他操作更新，请重新选择并核对最新版本。'
    } else {
      failure(cause)
      if (detail.value) error.value += ' 结果未确认时，请先重新读取；需要恢复请求时使用原操作与说明。'
    }
  } finally { if (controller === attempt) busy.value = false }
}
function identityChanged() { controller?.abort(); busy.value = false; clear(); void load() }
function storageChanged(event: StorageEvent) { if (event.key === 'astra_access_token' || event.key === null) identityChanged() }
window.addEventListener('storage', storageChanged)
watch(() => auth.user?.id, identityChanged, { immediate: true })
onBeforeUnmount(() => { controller?.abort(); window.removeEventListener('storage', storageChanged) })
</script>

<template>
  <div class="art-page admin-page">
    <div class="art-wrap admin-content" :aria-busy="busy">
      <header><span class="art-eyebrow">ASTRA · OPERATIONS</span><h1>退款工作台</h1><p>先核对申请与原订单，再提交审核。金额、权限和最终退款状态由后台确认。</p><RouterLink to="/account/orders">返回我的订单 ↗</RouterLink></header>
      <section v-if="needsLogin" class="panel"><h2>请登录运营账户</h2><RouterLink :to="{ path: '/login', query: { returnTo: '/admin/refunds' } }" class="art-button primary">前往登录</RouterLink></section>
      <p v-if="busy" role="status">正在核对后台记录…</p>
      <div v-if="error" class="panel" role="alert"><p>{{ error }}</p><button class="art-button" :disabled="busy" @click="load()">重新读取</button></div>
      <p v-if="notice" class="panel" role="status">{{ notice }}</p>
      <div v-if="allowed" class="workspace">
        <section class="panel queue" aria-label="退款申请列表">
          <div class="queue-header"><h2>申请列表</h2><button class="art-button" :disabled="busy" @click="load()">刷新列表</button></div>
          <label for="refund-filter">申请状态</label><select id="refund-filter" v-model="filter" :disabled="busy" @change="load()"><option value="">全部状态</option><option v-for="(label, code) in labels" :key="code" :value="code">{{ label }}</option></select>
          <p class="queue-note">列表按读取时的状态筛选，审核后可刷新列表更新筛选结果。</p><p v-if="loaded && !refunds.length">当前没有此状态的申请。</p>
          <ul><li v-for="item in refunds" :key="item.id"><button class="refund-row" :data-refund="item.id" :aria-pressed="detail?.refund.id === item.id" :disabled="busy" @click="select(item.id)"><strong>{{ money(item.amountCent) }} · {{ state(item.state) }}</strong><span>申请 {{ item.id }}</span><span>{{ date(item.createdAt) }}</span></button></li></ul>
          <button v-if="cursor" class="art-button" :disabled="busy" @click="load(true)">加载更多</button>
        </section>
        <section class="panel review" aria-label="退款审核详情">
          <p v-if="!detail">选择一条申请，核对原订单与领取记录。</p>
          <template v-else>
            <div class="queue-header"><h2>审核详情</h2><button class="art-button" :disabled="busy" @click="select(detail.refund.id)">重新核对</button></div>
            <p :data-refund-state="detail.refund.state">{{ state(detail.refund.state) }} · 版本 {{ detail.refund.version }}</p>
            <p>申请 {{ detail.refund.id }} · 核对时间 {{ date(detail.observedAt) }}</p>
            <h3>{{ detail.order.item.productName }}</h3><p>订单 {{ detail.order.orderNo }} · 内容版本 {{ detail.order.item.releaseVersion }}</p>
            <dl><div><dt>原订单金额 / 申请退款</dt><dd>{{ money(detail.order.totalAmountCent) }} / {{ money(detail.refund.amountCent) }}</dd></div><div><dt>已退金额</dt><dd>{{ money(detail.order.totalRefundedCent) }}</dd></div><div><dt>付款时间</dt><dd>{{ detail.order.paidAt ? date(detail.order.paidAt) : '待确认' }}</dd></div><div><dt>付款 / 交付状态</dt><dd>{{ factLabels[detail.order.state] ?? '待确认' }} / {{ factLabels[detail.order.fulfillmentState] ?? '待确认' }}</dd></div></dl>
            <p class="complaint">申请原因：{{ detail.refund.reason }}</p><p v-if="detail.refund.decisionReason">审核说明：{{ detail.refund.decisionReason }}</p>
            <p v-if="!detail.buyerAccountEnabled" class="warning">购买账户当前不可用，仍须核查其原交易与售后诉求。</p><p v-if="!detail.paymentFactsConsistent" class="warning">原订单与支付事实存在异常，暂停此处审批，先核查交易来源。</p>
            <details><summary>原购买条款与退款政策</summary><h3>购买条款 {{ detail.order.purchaseTerms.version }}</h3><p class="policy">{{ detail.order.purchaseTerms.content }}</p><h3>退款政策 {{ detail.order.refundPolicy.version }}</h3><p class="policy">{{ detail.order.refundPolicy.content }}</p><h3>内容许可 {{ detail.order.item.license.version }}</h3><p class="policy">{{ detail.order.item.license.content }}</p></details>
            <h3>领取记录</h3><p>传输开始不等于完整收到或成功使用文件；已领取和超过七天的质量诉求仍需人工核查。</p><p>首次开始：{{ detail.order.accessStartedAt ? date(detail.order.accessStartedAt) : '尚无开始记录' }}</p><ul><li v-for="entry in detail.deliveryStarts" :key="entry.id">文件 {{ entry.assetId }} · {{ date(entry.startedAt) }}</li></ul><p v-if="detail.deliveryStartsTruncated">仅显示最近20条领取开始记录。</p>
            <form v-if="decisions.length" class="decision-form" @submit.prevent>
              <label for="decision-reason">审核说明（5至500字）</label><textarea id="decision-reason" v-model="reason" :disabled="busy" rows="4" maxlength="1000" autocomplete="off" />
              <label class="consent"><input v-model="reviewed" type="checkbox" :disabled="busy">我已核对原订单、申请原因和领取记录；批准仅提交全额退款任务，最终到账以后台确认结果为准。</label>
              <div class="actions"><button v-for="action in decisions" :key="action" class="art-button" :class="{ primary: action === 'APPROVE' }" :disabled="!canDecide" @click="decide(action)">{{ actionLabels[action] }}</button></div>
            </form>
            <p v-else class="warning">此状态暂不提供审批操作。处理中请等待渠道结果；失败或待核查应先核对渠道和账单，不能直接重复退款。</p>
            <h3>审核历史</h3><p v-if="!detail.audits.length">暂无人工审核记录。</p><ul class="history"><li v-for="entry in detail.audits" :key="entry.id"><strong>{{ factLabels[entry.action] ?? entry.action }} · {{ date(entry.createdAt) }}</strong><p>{{ entry.reason }}</p><span>操作人 {{ entry.actorUserId }} · 请求 {{ entry.traceId }}</span></li></ul><p v-if="detail.auditsTruncated">仅显示最近20条审核记录。</p>
            <h3>后台退款任务</h3><p v-if="!detail.tasks.length">尚无渠道退款任务。</p><ul><li v-for="(task, index) in detail.tasks" :key="index">{{ factLabels[task.state] ?? '待确认' }} · 已尝试 {{ task.attempts }} 次<span v-if="task.lastErrorCode"> · {{ task.lastErrorCode }}</span></li></ul>
          </template>
        </section>
      </div>
    </div><ArtFooter />
  </div>
</template>

<style scoped>
.admin-content { padding-top: 110px; padding-bottom: 80px; }
header { margin-bottom: 32px; max-width: 760px; } h1 { font-size: clamp(32px, 5vw, 52px); margin: 12px 0; } h2 { font-size: 22px; } h3 { margin-top: 26px; font-size: 17px; }
p, li, dd { line-height: 1.7; } p, span, dd { overflow-wrap: anywhere; }
.workspace { display: grid; grid-template-columns: minmax(240px, .75fr) minmax(0, 1.6fr); gap: 24px; align-items: start; }
.panel { border: 1px solid var(--art-line, #d3d2c9); padding: 24px; border-radius: 18px; margin-bottom: 20px; min-width: 0; }
.queue-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.queue-note { font-size: 13px; } .queue ul { list-style: none; padding: 0; } .refund-row { width: 100%; display: grid; gap: 6px; text-align: left; border: 1px solid #b8b9ad; padding: 16px; border-radius: 10px; background: transparent; color: inherit; margin-top: 12px; cursor: pointer; font: inherit; } .refund-row[aria-pressed='true'] { border-color: #10776f; background: #10776f0d; } .refund-row span { font-size: 13px; }
select, textarea { width: 100%; box-sizing: border-box; margin-top: 10px; background: transparent; color: inherit; font: inherit; padding: 12px; border: 1px solid #858980; border-radius: 8px; } textarea { resize: vertical; } .decision-form { margin-top: 28px; } .consent { display: flex; align-items: flex-start; gap: 10px; margin: 16px 0; line-height: 1.7; } .consent input { margin-top: 6px; flex-shrink: 0; } .actions { display: flex; flex-wrap: wrap; gap: 12px; } button:disabled { opacity: .5; cursor: default; }
dl { margin: 20px 0; } dl div { display: grid; grid-template-columns: 160px minmax(0, 1fr); padding: 8px 0; border-bottom: 1px solid #8883; } dd { margin: 0; } dt { line-height: 1.7; } .warning { background: #ac78100f; border-left: 3px solid #ac7810; padding: 12px; } .complaint, .policy { white-space: pre-wrap; } details { margin: 24px 0; } summary { cursor: pointer; } .history { padding-left: 20px; } .history li { margin-bottom: 16px; } .history p { margin: 4px 0; } .history span { font-size: 12px; }
@media (max-width: 760px) { .workspace { grid-template-columns: 1fr; } .admin-content { padding-top: 90px; } .panel { padding: 18px; } dl div { grid-template-columns: 1fr; gap: 4px; } }
</style>
