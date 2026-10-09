<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ApiError, getAccessToken } from '@/api/http'
import { fetchRefundVerificationContext, fetchRefundVerificationJob, type RefundVerificationContext, type RefundVerificationJob } from '@/api/refund-verification'
import { activeRefundVerification, eligibleRefundVerification, refundStates, fulfillmentStates, orderStates, paymentStates, pendingRefundVerification, recoverRefundVerification, submitRefundVerification, validateRefundVerificationContext, validateRefundVerificationJob, verificationErrors, refundVerificationObservations, refundVerificationPath, verificationReason, verificationStates, type PendingRefundVerification } from '@/lib/admin-refund-verification'
import { isCommerceId } from '@/lib/account-return'
import { useAuthStore } from '@/stores/auth'
import ArtFooter from '@/components/ArtFooter.vue'
import AdminNavigation from '@/components/commerce/AdminNavigation.vue'
import RenderFeedback from '@/components/ui/RenderFeedback.vue'

const props = defineProps<{ refundId: string }>()
const auth = useAuthStore(), context = ref<RefundVerificationContext | null>(null), job = ref<RefundVerificationJob | null>(null)
const pending = ref<PendingRefundVerification | null>(null), busy = ref(''), error = ref(''), notice = ref(''), needsLogin = ref(false)
const reason = ref(''), reviewed = ref(false)
let controller: AbortController | undefined
const ownPending = computed(() => pending.value?.refundId === props.refundId)
const validReason = computed(() => { try { verificationReason(reason.value); return true } catch { return false } })
const canRequest = computed(() => !!context.value && !busy.value && (pending.value ? ownPending.value : context.value.executionEnabled && eligibleRefundVerification(context.value) && !context.value.jobs.some(activeRefundVerification)))
const canSubmit = computed(() => canRequest.value && reviewed.value && validReason.value)
const version = computed(() => ownPending.value ? pending.value!.expectedVersion : context.value?.refund.version)
const money = (value: number) => `¥${(value / 100).toFixed(2)}`
const date = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
function clear() { context.value = null; job.value = null; pending.value = null; reason.value = ''; reviewed.value = false; error.value = ''; notice.value = '' }
function focusQuery() { document.getElementById('verification-reason')?.focus() }
function begin(title: string) {
  controller?.abort()
  const attempt = new AbortController(), token = getAccessToken(), order = props.refundId
  controller = attempt; busy.value = title; error.value = ''; needsLogin.value = !token
  return { attempt, token, order, current: () => !attempt.signal.aborted && getAccessToken() === token && props.refundId === order }
}
function failure(cause: unknown) {
  if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) {
    clear(); needsLogin.value = cause.status === 401
    error.value = cause.status === 403 ? '当前账户没有退款核查权限。' : '登录已失效，请重新登录。'
  } else error.value = cause instanceof Error ? cause.message : '暂时无法核查，请稍后重试。'
}
function applyJob(value: RefundVerificationJob) {
  validateRefundVerificationJob(value, props.refundId, context.value?.order.id, context.value?.order.paymentId ?? undefined)
  job.value = value
  if (context.value) {
    if (context.value.jobs.length === 20 && !context.value.jobs.some((item) => item.taskId === value.taskId)) context.value.jobsTruncated = true
    context.value.jobs = [value, ...context.value.jobs.filter((item) => item.taskId !== value.taskId)].slice(0, 20)
  }
}
async function load() {
  if (busy.value) return
  const { attempt, token, order, current } = begin('正在读取原退款与后台状态…')
  context.value = null; job.value = null; reviewed.value = false
  if (!isCommerceId(order)) { error.value = '退款地址无效，请从原对账差异或退款记录进入。'; busy.value = ''; return }
  if (!token) { clear(); busy.value = ''; return }
  try {
    const value = validateRefundVerificationContext(await fetchRefundVerificationContext(order, attempt.signal), order)
    if (!current()) return
    const original = pendingRefundVerification(value.actorId, token, attempt.signal)
    if (!current()) return
    context.value = value; pending.value = original; job.value = value.jobs[0] ?? null
  } catch (cause) { if (current()) failure(cause) }
  finally { if (controller === attempt) busy.value = '' }
}
async function select(task: string) {
  if (busy.value || !context.value) return
  const { attempt, token, order, current } = begin('正在读取这次核查的结果…')
  reviewed.value = false
  if (!token) { clear(); busy.value = ''; return }
  try {
    const value = validateRefundVerificationJob(await fetchRefundVerificationJob(order, task, attempt.signal), order, context.value.order.id, context.value.order.paymentId ?? undefined)
    if (!current()) return
    if (value.taskId !== task) throw new Error('返回的核查任务不一致，请重新读取。')
    job.value = value
  } catch (cause) { if (current()) failure(cause) }
  finally { if (controller === attempt) busy.value = '' }
}
async function submit() {
  if (!canSubmit.value || !context.value || !version.value) return
  const actor = context.value.actorId, expectedVersion = version.value, text = reason.value
  const binding = { orderId: context.value.order.id, paymentId: context.value.refund.paymentId }
  const { attempt, token, order, current } = begin('正在提交后台查询，请稍候…')
  reviewed.value = false; notice.value = ''
  if (!token) { clear(); busy.value = ''; return }
  try {
    const value = await submitRefundVerification(order, expectedVersion, text, actor, token, attempt.signal, binding)
    if (!current()) return
    applyJob(value); pending.value = null; reason.value = ''
    notice.value = '原退款查询已由后台受理。可离开此页，稍后刷新查看结果。'
  } catch (cause) {
    if (!current()) return
    failure(cause)
    if (context.value) {
      try { pending.value = pendingRefundVerification(actor, token, attempt.signal) } catch (storageCause) { failure(storageCause) }
      if (pending.value) error.value += ' 结果尚未确认，请先查询原请求。'
      else context.value = null // A version/task conflict requires a fresh authoritative context.
    }
  } finally { if (controller === attempt) busy.value = '' }
}
async function recover() {
  if (busy.value || !ownPending.value || !context.value) return
  const actor = context.value.actorId, binding = { orderId: context.value.order.id, paymentId: context.value.refund.paymentId }
  const { attempt, token, current } = begin('正在查回原请求，请稍候…')
  reviewed.value = false
  if (!token) { clear(); busy.value = ''; return }
  try {
    const value = await recoverRefundVerification(actor, token, attempt.signal, binding)
    if (!current()) return
    applyJob(value); pending.value = null; reason.value = ''
    notice.value = '已查回原任务，没有新增查询。请查看后台执行状态。'
  } catch (cause) { if (current()) failure(cause) }
  finally { if (controller === attempt) busy.value = '' }
}
function identityChanged() { controller?.abort(); busy.value = ''; clear(); void load() }
function storageChanged(event: StorageEvent) { if (event.key === 'astra_access_token' || event.key === null) identityChanged() }
window.addEventListener('storage', storageChanged)
watch([() => props.refundId, () => auth.user?.id], identityChanged, { immediate: true })
onBeforeUnmount(() => { controller?.abort(); window.removeEventListener('storage', storageChanged) })
</script>

<template>
  <div class="art-page verification-page">
    <div class="art-wrap admin-content" :aria-busy="!!busy">
      <header><span class="art-eyebrow">ASTRA · OPERATIONS</span><h1>原退款核查</h1><p>核对原退款，向渠道查询真实结果。资金与权益由后台依据可信事实处理，每次核查保留记录。</p><button v-if="context" class="art-button primary" :disabled="!canRequest" aria-controls="verification-query-panel" @click="focusQuery">发起查询</button></header>
      <AdminNavigation v-if="context" />
      <section v-if="needsLogin" class="panel"><h2>请登录运营账户</h2><RouterLink :to="{ path: '/login', query: { returnTo: isCommerceId(refundId) ? refundVerificationPath(refundId) : '/admin/reconciliations' } }" class="art-button primary">前往登录</RouterLink></section>
      <RenderFeedback v-if="busy" :title="busy" detail="正在与后台同步，请稍候。" />
      <div v-if="error" class="message warning" role="alert"><p>{{ error }}</p><button v-if="!needsLogin" class="art-button" :disabled="!!busy" @click="load">重新读取</button></div>
      <p v-if="notice" class="message" role="status">{{ notice }}</p>
      <template v-if="context">
        <div class="environment" data-verification-environment><strong>{{ context.mock ? '模拟渠道 · 开发联调' : '渠道查询未开放' }}</strong><span>本版本不作为真实资金或结算证明。</span></div>
        <section v-if="pending" class="panel pending-panel" aria-label="待确认的原请求"><h2>有一项请求尚未确认</h2><p>原退款 {{ pending.refundId }} · 提交版本 {{ pending.expectedVersion }}。优先查询原请求，未查到时仍保留原标识。</p><button v-if="ownPending" class="art-button primary" :disabled="!!busy" @click="recover">查询原请求</button><RouterLink v-else :to="refundVerificationPath(pending.refundId)" class="art-button primary">查看待确认的原退款</RouterLink><p class="muted">需要再次提交时，请填写原说明并使用原标识重试。</p></section>
        <div class="workspace">
          <div class="main-column">
            <section class="panel" aria-label="原退款核对" :data-refund-id="context.refund.id"><div class="panel-heading"><h2>原退款</h2><RouterLink to="/admin/refunds" class="art-button">退款工作台</RouterLink></div><p class="job-state" :data-local-refund-state="context.refund.state">{{ refundStates[context.refund.state] }}</p><dl><div><dt>申请全额退款 / 已退款</dt><dd>{{ money(context.refund.amountCent) }} / {{ money(context.order.totalRefundedCent) }}</dd></div><div><dt>当前退款版本</dt><dd data-refund-version>{{ context.refund.version }}</dd></div></dl><p class="reason">申请原因：{{ context.refund.reason }}</p><details><summary>原退款编号与审核信息</summary><p>退款编号 {{ refundId }}</p><p>申请于 {{ date(context.refund.createdAt) }}</p><p v-if="context.refund.decisionReason">审核说明：{{ context.refund.decisionReason }}</p><p v-if="context.refund.completedAt">渠道终态于 {{ date(context.refund.completedAt) }}</p><RouterLink :to="`/admin/orders/${context.order.id}/verification`" class="art-button">核查原支付</RouterLink></details></section>
            <section class="panel" aria-label="原订单核对"><div class="panel-heading"><h2>原订单</h2><button class="art-button" :disabled="!!busy" @click="load">刷新状态</button></div><h3>{{ context.order.item.productName }}</h3><p>订单 {{ context.order.orderNo }} · 内容版本 {{ context.order.item.releaseVersion }}</p><dl><div><dt>原订单金额 / 已退款</dt><dd>{{ money(context.order.totalAmountCent) }} / {{ money(context.order.totalRefundedCent) }}</dd></div><div><dt>本地订单 / 来源权益</dt><dd data-local-order-state>{{ orderStates[context.order.state] }} / {{ fulfillmentStates[context.order.fulfillmentState] }}</dd></div><div><dt>本地支付状态</dt><dd>{{ paymentStates[context.paymentState] }}</dd></div><div><dt>当前订单版本</dt><dd data-order-version>{{ context.orderVersion }}</dd></div><div><dt>读取时间</dt><dd>{{ date(context.observedAt) }}</dd></div></dl><p v-if="!context.buyerAccountEnabled" class="warning message">购买账户当前不可用，仍可核查其原交易。</p><details><summary>原订单编号与时间</summary><p>订单编号 {{ context.order.id }}</p><p v-if="context.order.paymentId">支付编号 {{ context.order.paymentId }}</p><p>创建于 {{ date(context.order.createdAt) }} · 期限 {{ date(context.order.expiresAt) }}</p><p v-if="context.order.issueCode">异常标识 {{ context.order.issueCode }}</p></details></section>
            <section class="panel" aria-label="核查结果"><div class="panel-heading"><h2>核查结果</h2><button v-if="job" class="art-button" :disabled="!!busy" @click="select(job.taskId)">刷新这次结果</button></div><p v-if="!job" class="muted">尚无核查记录，确认原退款后可发起查询。</p><template v-else><p class="job-state" :data-verification-state="job.state">{{ verificationStates[job.state] }} · 已尝试 {{ job.attempts }} 次</p><RenderFeedback v-if="activeRefundVerification(job) && !busy" :title="verificationStates[job.state]" detail="任务在后台继续。可离开此页，返回后刷新查看结果。" /><div class="result-banner" :data-verification-observation="job.observation ?? 'NONE'"><strong>{{ job.observation ? refundVerificationObservations[job.observation] : '尚未取得渠道查询结果' }}</strong><p>{{ job.factApplied ? '后台已处理这次可信事实；请刷新原订单，核对资金与来源权益。' : '此次查询尚未确认新的资金或权益变化。' }}</p><p v-if="job.state === 'DONE' && job.observation === 'PENDING'">查询已完成，退款仍在处理中；本次结果不代表退款到账。</p><p v-if="job.observation === 'FAILED'">退款未成功，资金与权益仍以原订单当前状态为准。</p><p v-if="job.state === 'DEAD'">后台已停止重试。请核对错误与原交易，确认后再决定是否发起新的查询。</p></div><p v-if="job.lastErrorCode" class="message warning">{{ verificationErrors[job.lastErrorCode] }}<template v-if="job.state === 'READY'"> · 下一次尝试 {{ date(job.nextRunAt) }}</template></p><p class="reason">核查说明：{{ job.reason }}</p><details><summary>执行信息</summary><p>任务 {{ job.taskId }}</p><p>提交人 {{ job.requestedBy }} · 提交退款版本 {{ job.expectedVersion }}</p><p>发起于 {{ date(job.createdAt) }}</p><p v-if="job.lastObservedAt">渠道观察于 {{ date(job.lastObservedAt) }}</p><p>更新于 {{ date(job.updatedAt) }}</p></details></template></section>
          </div>
          <aside class="side-column">
            <section id="verification-query-panel" class="panel" aria-label="发起原退款查询"><h2>{{ pending ? '恢复原查询' : '发起后台查询' }}</h2><p>查询原退款的渠道结果，保留原交易与审批记录。</p><p v-if="!context.executionEnabled && !ownPending" class="message warning">后台当前关闭新查询，已有记录仍可查看。</p><p v-if="!eligibleRefundVerification(context)" class="message">原退款尚不能查询，请在退款工作台核对审批与原支付。</p><p v-if="context.jobs.some(activeRefundVerification) && !ownPending" class="message">原退款仍有核查在后台执行，请查看原任务。</p><form @submit.prevent="submit"><p v-if="version" data-confirmed-version>将使用原退款版本 {{ version }}<template v-if="ownPending">与原请求标识</template>。</p><label for="verification-reason">核查说明（5至500字）</label><textarea id="verification-reason" v-model="reason" rows="4" maxlength="1000" autocomplete="off" :disabled="!canRequest" @input="reviewed = false" /><label class="consent"><input v-model="reviewed" type="checkbox" :disabled="!canRequest">我已核对原退款、版本与说明，确认查询原退款；结果仍由后台确认。</label><button class="art-button primary" :disabled="!canSubmit" type="submit">{{ ownPending ? '使用原标识重试' : '确认提交查询' }}</button></form></section>
            <section class="panel" aria-label="核查历史"><h2>最近核查记录</h2><p class="muted">保存每次说明与结果，最多显示最近20次。</p><p v-if="!context.jobs.length" class="muted">暂无核查记录。</p><div v-else class="history-scroll" role="region" aria-label="可滚动的核查记录" tabindex="0"><ul><li v-for="item in context.jobs" :key="item.taskId"><button class="history-row" :data-verification-job="item.taskId" :aria-pressed="job?.taskId === item.taskId" :disabled="!!busy" @click="select(item.taskId)"><strong>{{ verificationStates[item.state] }}</strong><span>{{ date(item.createdAt) }}</span><small>任务 {{ item.taskId }}</small></button></li></ul></div><p v-if="context.jobsTruncated" class="muted">更早记录未在本页展开，本列表不代表完整审计历史。</p></section>
          </aside>
        </div>
      </template>
    </div><ArtFooter />
  </div>
</template>

<style scoped>
.admin-content { padding-top: 110px; padding-bottom: 80px; }
header { max-width: 800px; } h1 { margin: 12px 0; font-size: clamp(34px, 5vw, 52px); } h2 { font-size: 22px; margin: 0; } h3 { font-size: 18px; }
p, dd, label { line-height: 1.7; } p, dd, strong, span, small { overflow-wrap: anywhere; } .muted, small { color: var(--text-muted); font-size: 13px; }
.environment { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 16px 0 24px; } .environment span { color: var(--text-muted); font-size: 13px; }
.workspace { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(280px, .8fr); gap: 24px; align-items: start; } .main-column, .side-column { display: grid; gap: 24px; min-width: 0; }
.panel { padding: 24px; border: 1px solid var(--border); border-radius: 18px; background: var(--bg-elevated); min-width: 0; } .panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
.message, .result-banner { padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-soft); margin: 18px 0; } .warning { border-color: color-mix(in srgb, #ab741b 65%, var(--border)); background: color-mix(in srgb, #ab741b 7%, var(--bg-elevated)); } .pending-panel { margin-bottom: 24px; }
dl { margin: 20px 0; } dl div { display: grid; grid-template-columns: minmax(140px, .7fr) minmax(0, 1fr); gap: 16px; padding: 12px 0; border-bottom: 1px solid var(--border); } dt { color: var(--text-muted); font-size: 14px; } dd { margin: 0; }
.job-state { font-weight: 600; } .reason { white-space: pre-wrap; } details { margin-top: 20px; border-top: 1px solid var(--border); padding-top: 16px; } summary { cursor: pointer; min-height: 44px; }
textarea { width: 100%; box-sizing: border-box; margin-top: 8px; padding: 12px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--bg); color: var(--text); font: inherit; resize: vertical; } .consent { display: flex; align-items: flex-start; gap: 10px; margin: 18px 0; } .consent input { flex-shrink: 0; margin-top: 6px; accent-color: var(--accent); }
.history-scroll { max-height: min(480px, 55vh); overflow-y: auto; scrollbar-gutter: stable; } ul { list-style: none; padding: 0; } li { margin-bottom: 12px; } .history-row { display: grid; gap: 8px; width: 100%; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.history-row:hover, .history-row[aria-pressed='true'] { border-color: var(--accent); } button:disabled, textarea:disabled { cursor: default; opacity: .5; } button:focus-visible, textarea:focus-visible, summary:focus-visible, .history-scroll:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
@media (max-width: 800px) { .workspace { grid-template-columns: 1fr; } .admin-content { padding-top: 90px; } .panel { padding: 18px; } dl div { grid-template-columns: 1fr; gap: 4px; } .panel-heading .art-button { padding: 10px 18px; } }
@media (prefers-reduced-motion: reduce) { .art-button { transition: none; } .art-button:hover { transform: none; } }
</style>
