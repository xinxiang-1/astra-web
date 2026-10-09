<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ApiError, getAccessToken } from '@/api/http'
import { fetchReconciliationAccess, fetchReconciliationJobs, fetchReconciliationDetail, fetchReconciliationIssues, type ReconciliationAccess, type ReconciliationJob, type ReconciliationDetail, type ReconciliationIssue } from '@/api/reconciliation'
import { isBillDate, normalizeReconciliationReason, pendingReconciliation, recoverReconciliation, submitReconciliation, validateReconciliationAccess, validateReconciliationDetail, validateReconciliationIssue, validateReconciliationJob, validateReconciliationPage, reconciliationStates, reconciliationDifferences, reconciliationErrors, type PendingReconciliation } from '@/lib/admin-reconciliations'
import { useAuthStore } from '@/stores/auth'
import ArtFooter from '@/components/ArtFooter.vue'
import AdminNavigation from '@/components/commerce/AdminNavigation.vue'
import UiInput from '@/components/ui/UiInput.vue'
import UiSelect from '@/components/ui/UiSelect.vue'
import RenderFeedback from '@/components/ui/RenderFeedback.vue'

const auth = useAuthStore()
const access = ref<ReconciliationAccess | null>(null), needsLogin = ref(false), loaded = ref(false)
const busy = ref(''), error = ref(''), notice = ref(''), filterDate = ref(''), filterState = ref('')
const appliedFilters = ref({ date: '', state: '' })
const jobs = ref<ReconciliationJob[]>([]), cursor = ref<string | null>(null), detail = ref<ReconciliationDetail | null>(null)
const issues = ref<ReconciliationIssue[]>([]), issueCursor = ref<string | null>(null)
const targetDate = ref(''), reason = ref(''), reviewed = ref(false), pending = ref<PendingReconciliation | null>(null)
const prepared = ref<{ date: string; generation: number } | null>(null)
const detailHeading = ref<HTMLHeadingElement>()
let controller: AbortController | undefined
const validReason = computed(() => { try { normalizeReconciliationReason(reason.value); return true } catch { return false } })
const inRange = computed(() => !!access.value && isBillDate(targetDate.value) && targetDate.value >= access.value.earliestBillDate && targetDate.value <= access.value.latestBillDate)
const canRun = computed(() => !busy.value && access.value?.executionEnabled && reviewed.value && validReason.value && !!prepared.value && prepared.value.date === targetDate.value)
const canPrepare = computed(() => !busy.value && !pending.value && access.value?.executionEnabled && inRange.value)
const terminal = (value: ReconciliationJob) => value.state === 'DONE' || value.state === 'DEAD'
const money = (value: number | undefined) => value === undefined ? '无记录' : `¥${(value / 100).toFixed(2)}`
const dateTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
const attemptLabels: Record<string, string> = { RUNNING: '正在执行', SUCCEEDED: '完成', RETRY: '等待再次尝试', DEAD: '停止执行', ABANDONED: '中断后已接管' }
function clear() {
  access.value = null; loaded.value = false; jobs.value = []; cursor.value = null; detail.value = null; issues.value = []; issueCursor.value = null
  prepared.value = null; pending.value = null; reason.value = ''; reviewed.value = false; notice.value = ''; error.value = ''
  appliedFilters.value = { date: '', state: '' }
}
function begin(title: string) {
  controller?.abort()
  const attempt = new AbortController(), token = getAccessToken()
  controller = attempt; busy.value = title; error.value = ''; needsLogin.value = !token
  return { attempt, token, current: () => !attempt.signal.aborted && getAccessToken() === token }
}
function failure(cause: unknown) {
  if (cause instanceof ApiError && [401, 403].includes(cause.status ?? 0)) {
    clear(); needsLogin.value = cause.status === 401
    error.value = cause.status === 403 ? '当前账户没有对账管理权限。' : '登录已失效，请重新登录。'
  } else error.value = cause instanceof Error ? cause.message : '暂时无法核对，请稍后重试。'
}
function applyDetail(value: ReconciliationDetail) {
  detail.value = value; issues.value = []; issueCursor.value = null
  jobs.value = jobs.value.map((job) => job.id === value.job.id ? value.job : job)
}
async function load(append = false) {
  if (busy.value) return
  const filters = append ? { ...appliedFilters.value } : { date: filterDate.value, state: filterState.value }
  const { attempt, token, current } = begin('正在读取后台对账记录…')
  if (!token) { clear(); busy.value = ''; return }
  if (!append) { jobs.value = []; cursor.value = null; detail.value = null; issues.value = []; issueCursor.value = null; prepared.value = null; reviewed.value = false; loaded.value = false }
  try {
    const capability = validateReconciliationAccess(await fetchReconciliationAccess(attempt.signal))
    if (!current()) return
    access.value = capability
    const original = await pendingReconciliation(capability.actorId, token, attempt.signal)
    if (!current()) return
    pending.value = original
    if (original) { targetDate.value = original.billDate; prepared.value = { date: original.billDate, generation: original.expectedGeneration } }
    else if (!targetDate.value) targetDate.value = capability.latestBillDate
    const page = validateReconciliationPage(await fetchReconciliationJobs(filters.date || undefined, filters.state || undefined, append ? cursor.value ?? undefined : undefined, attempt.signal), validateReconciliationJob)
    if (!current()) return
    jobs.value = [...new Map((append ? [...jobs.value, ...page.items] : page.items).map((job) => [job.id, job])).values()]
    cursor.value = page.nextCursor ?? null; loaded.value = true; appliedFilters.value = filters
  } catch (cause) { if (current()) failure(cause) }
  finally { if (controller === attempt) busy.value = '' }
}
async function select(id: string) {
  if (busy.value) return
  const { attempt, token, current } = begin('正在读取报告和差异…')
  detail.value = null; issues.value = []; issueCursor.value = null; prepared.value = pending.value ? { date: pending.value.billDate, generation: pending.value.expectedGeneration } : null; reviewed.value = false
  if (!token) { clear(); busy.value = ''; return }
  try {
    const value = validateReconciliationDetail(await fetchReconciliationDetail(id, attempt.signal))
    if (!current()) return
    if (value.job.id !== id) throw new Error('返回的任务不一致，请重新读取。')
    const page = validateReconciliationPage(await fetchReconciliationIssues(id, undefined, attempt.signal), validateReconciliationIssue)
    if (!current()) return
    applyDetail(value); issues.value = page.items; issueCursor.value = page.nextCursor ?? null
    await nextTick(); if (current()) detailHeading.value?.focus({ preventScroll: true })
  } catch (cause) { if (current()) failure(cause) }
  finally { if (controller === attempt) busy.value = '' }
}
async function moreIssues() {
  if (busy.value || !detail.value || !issueCursor.value) return
  const id = detail.value.job.id, position = issueCursor.value
  const { attempt, token, current } = begin('正在读取更多差异…')
  if (!token) { clear(); busy.value = ''; return }
  try {
    const page = validateReconciliationPage(await fetchReconciliationIssues(id, position, attempt.signal), validateReconciliationIssue)
    if (!current() || detail.value?.job.id !== id) return
    issues.value = [...new Map([...issues.value, ...page.items].map((issue) => [issue.id, issue])).values()]; issueCursor.value = page.nextCursor ?? null
  } catch (cause) { if (current()) failure(cause) }
  finally { if (controller === attempt) busy.value = '' }
}
function changeTarget() { prepared.value = null; reviewed.value = false; reason.value = ''; notice.value = '' }
function focusRun() { document.getElementById('reconcile-bill-date')?.focus() }
async function prepare() {
  if (!canPrepare.value) return
  const date = targetDate.value
  const { attempt, token, current } = begin('正在核对当天的最新轮次…')
  prepared.value = null; reviewed.value = false; notice.value = ''
  if (!token) { clear(); busy.value = ''; return }
  try {
    const capability = validateReconciliationAccess(await fetchReconciliationAccess(attempt.signal))
    if (!current()) return
    access.value = capability
    if (!capability.executionEnabled || date < capability.earliestBillDate || date > capability.latestBillDate) throw new Error('当前日期尚不能执行，请核对后台开放状态。')
    const page = validateReconciliationPage(await fetchReconciliationJobs(date, undefined, undefined, attempt.signal), validateReconciliationJob)
    if (!current()) return
    const latest = page.items.reduce<ReconciliationJob | undefined>((selected, job) => !selected || job.generation > selected.generation ? job : selected, undefined)
    if (latest) {
      const value = validateReconciliationDetail(await fetchReconciliationDetail(latest.id, attempt.signal))
      if (!current()) return
      if (value.job.billDate !== date || value.latestGeneration !== value.job.generation) throw new Error('当天轮次已改变，请刷新后重新核对。')
      applyDetail(value)
      if (!terminal(value.job)) throw new Error('当天任务仍在后台执行，请查看原任务，结束后再重核。')
      prepared.value = { date, generation: value.latestGeneration }
    } else { detail.value = null; issues.value = []; issueCursor.value = null; prepared.value = { date, generation: 0 } }
    notice.value = prepared.value.generation === 0 ? '当天尚无任务。请确认说明，创建首次核对。' : `已核对第${prepared.value.generation}轮；提交会建立新一轮，保留原报告。`
  } catch (cause) { if (current()) failure(cause) }
  finally { if (controller === attempt) busy.value = '' }
}
async function submit() {
  if (!canRun.value || !prepared.value) return
  const original = { ...prepared.value }, text = reason.value
  const { attempt, token, current } = begin('正在提交核对任务，请稍候…')
  reviewed.value = false; notice.value = ''
  if (!token) { clear(); busy.value = ''; return }
  try {
    const value = await submitReconciliation(original.date, original.generation, text, access.value!.actorId, token, attempt.signal)
    if (!current()) return
    applyDetail(value); pending.value = null; prepared.value = null; reason.value = ''
    if ((!appliedFilters.value.date || appliedFilters.value.date === value.job.billDate) && (!appliedFilters.value.state || appliedFilters.value.state === value.job.state)) jobs.value = [value.job, ...jobs.value.filter((job) => job.id !== value.job.id)]
    notice.value = '任务已由后台受理。可离开此页，稍后刷新查看结果；原报告保留。'
  } catch (cause) {
    if (!current()) return
    failure(cause)
    if (access.value) {
      try { pending.value = await pendingReconciliation(access.value.actorId, token, attempt.signal) } catch (storageCause) { if (current()) failure(storageCause) }
      if (!pending.value) prepared.value = null
      if (pending.value) error.value += ' 结果尚未确认，请先查询原任务；重试须使用原日期、轮次与说明。'
    }
  } finally { if (controller === attempt) busy.value = '' }
}
async function recover() {
  if (busy.value || !pending.value) return
  const { attempt, token, current } = begin('正在查回原操作结果…')
  if (!token) { clear(); busy.value = ''; return }
  try {
    const value = await recoverReconciliation(access.value!.actorId, token, attempt.signal)
    if (!current()) return
    applyDetail(value); pending.value = null; prepared.value = null; reason.value = ''; reviewed.value = false
    notice.value = '已查回原任务，没有创建新一轮。请查看当前执行状态。'
  } catch (cause) { if (current()) failure(cause) }
  finally { if (controller === attempt) busy.value = '' }
}
function identityChanged() { controller?.abort(); busy.value = ''; clear(); void load() }
function storageChanged(event: StorageEvent) { if (event.key === 'astra_access_token' || event.key === null) identityChanged() }
window.addEventListener('storage', storageChanged)
watch(() => auth.user?.id, identityChanged, { immediate: true })
onBeforeUnmount(() => { controller?.abort(); window.removeEventListener('storage', storageChanged) })
</script>

<template>
  <div class="art-page reconciliation-page">
    <div class="art-wrap admin-content" :aria-busy="!!busy">
      <header><span class="art-eyebrow">ASTRA · OPERATIONS</span><h1>每日对账</h1><p>核对账单与本地交易，保留每一轮报告。发现差异后再核查来源，付款与权益仍由后台确认。</p><button v-if="access" class="art-button primary" :disabled="!!busy || !!pending || !access.executionEnabled" aria-controls="reconcile-run-panel" @click="focusRun">发起核对</button></header>
      <AdminNavigation v-if="access" />
      <section v-if="needsLogin" class="panel"><h2>请登录运营账户</h2><RouterLink :to="{ path: '/login', query: { returnTo: '/admin/reconciliations' } }" class="art-button primary">前往登录</RouterLink></section>
      <RenderFeedback v-if="busy" :title="busy" detail="页面保持响应；离开后可回来查询已受理任务。" />
      <div v-if="error" class="message warning" role="alert"><p>{{ error }}</p><button class="art-button" :disabled="!!busy" @click="load()">重新读取</button></div>
      <p v-if="notice" class="message" role="status">{{ notice }}</p>
      <template v-if="access">
        <div class="environment" data-reconcile-environment><strong>{{ access.mock ? '模拟账单 · 开发联调' : '对账执行未开放' }}</strong><span>本版本仅接入测试账单，不能作为真实资金或结算证明。</span></div>
        <section v-if="pending" class="message warning" aria-label="待确认对账操作"><h2>有一笔操作结果待确认</h2><p>{{ pending.billDate }} · 原第{{ pending.expectedGeneration }}轮。先查回原任务；未查到时，保留原说明和标识重试。</p><button class="art-button" :disabled="!!busy" @click="recover">查询原任务</button></section>
        <div class="workspace">
          <section class="panel queue" aria-label="对账任务列表">
            <div class="panel-heading"><h2>任务与历史</h2><button class="art-button" :disabled="!!busy" @click="load()">刷新列表</button></div>
            <div class="filters"><label>账单日期<UiInput v-model="filterDate" type="date" :disabled="!!busy" /></label><label>执行状态<UiSelect v-model="filterState" :disabled="!!busy"><option value="">全部状态</option><option v-for="(label, code) in reconciliationStates" :key="code" :value="code">{{ label }}</option></UiSelect></label></div>
            <button class="art-button apply-filter" :disabled="!!busy" @click="load()">应用筛选</button>
            <p class="muted">每次读取保留当时筛选结果，刷新可查看最新状态。</p>
            <p v-if="loaded && !jobs.length" class="empty">当前筛选下暂无对账任务。</p>
            <ul class="job-list"><li v-for="job in jobs" :key="job.id"><button class="job-row" :data-reconciliation="job.id" :aria-pressed="detail?.job.id === job.id" :disabled="!!busy" @click="select(job.id)"><strong>{{ job.billDate }} <span>第{{ job.generation }}轮</span></strong><span>{{ reconciliationStates[job.state] }}<template v-if="job.issueCount !== undefined"> · {{ job.issueCount }}项差异</template></span><small>{{ job.source === 'AUTO' ? '自动核对' : '人工发起' }} · {{ dateTime(job.createdAt) }}</small></button></li></ul>
            <button v-if="cursor" class="art-button" :disabled="!!busy" @click="load(true)">加载更多任务</button>
          </section>
          <div class="report-column">
            <section class="panel report" aria-label="对账报告详情">
              <p v-if="!detail" class="empty">选择一条任务，查看报告、差异和执行记录。</p>
              <template v-else>
                <div class="panel-heading"><h2 ref="detailHeading" tabindex="-1">{{ detail.job.billDate }} 的对账报告</h2><button class="art-button" :disabled="!!busy" @click="select(detail.job.id)">刷新报告</button></div>
                <p class="report-status" :data-reconcile-state="detail.job.state">{{ reconciliationStates[detail.job.state] }} · 第{{ detail.job.generation }}轮 / 最新第{{ detail.latestGeneration }}轮</p>
                <RenderFeedback v-if="!terminal(detail.job)" title="任务在后台核对中" detail="可以离开此页。稍后刷新报告查看结果，无需再次提交。" />
                <p v-if="detail.job.state === 'DEAD'" class="warning message">执行未完成：{{ reconciliationErrors[detail.job.lastErrorCode ?? ''] ?? '请核查执行记录' }}。此任务没有完整报告。</p>
                <p class="muted">{{ detail.job.source === 'AUTO' ? '自动发起' : `操作人 ${detail.job.requestedBy}` }} · 已尝试{{ detail.job.attempts }}次</p>
                <p class="reason">核对说明：{{ detail.reason }}</p>
                <template v-if="detail.summary">
                  <div class="result-banner" :class="{ warning: !!detail.job.issueCount }"><strong>{{ detail.job.issueCount ? `发现${detail.job.issueCount}项差异，需进一步核查` : '本轮未发现差异' }}</strong><span>仅代表本次账单与本地快照的比较结果。</span></div>
                  <div class="table-scroll"><table><caption>渠道账单与本地账本汇总（人民币）</caption><thead><tr><th scope="col">交易类型</th><th scope="col">渠道账单</th><th scope="col">本地账本</th><th scope="col">匹配条数</th></tr></thead><tbody><tr><th scope="row">付款</th><td>{{ money(detail.summary.statementPaymentCent) }}<small>{{ detail.summary.statementPaymentCount }}笔</small></td><td>{{ money(detail.summary.localPaymentCent) }}<small>{{ detail.summary.localPaymentCount }}笔</small></td><td>{{ detail.summary.matchedPayments }}笔</td></tr><tr><th scope="row">退款</th><td>{{ money(detail.summary.statementRefundCent) }}<small>{{ detail.summary.statementRefundCount }}笔</small></td><td>{{ money(detail.summary.localRefundCent) }}<small>{{ detail.summary.localRefundCount }}笔</small></td><td>{{ detail.summary.matchedRefunds }}笔</td></tr></tbody></table></div>
                  <p class="muted">快照观察时间：{{ dateTime(detail.observedAt!) }}（上海时区）</p>
                  <h3>差异记录</h3><p v-if="!detail.job.issueCount">本轮没有差异记录。</p><p v-else-if="!issues.length">差异列表尚未读取，请刷新报告。</p>
                  <p v-if="issues.length" id="reconcile-issue-count" class="muted">已读取 {{ issues.length }} / {{ detail.job.issueCount }} 项，列表可滚动查看。</p>
                  <div v-if="issues.length" class="issue-scroll" role="region" aria-label="差异记录列表" aria-describedby="reconcile-issue-count" tabindex="0">
                    <ul class="issue-list"><li v-for="issue in issues" :key="issue.id" :data-reconcile-issue="issue.id"><strong>{{ issue.kind === 'PAYMENT' ? '付款' : '退款' }} · {{ issue.differences.map((code) => reconciliationDifferences[code]).join(' / ') }}</strong><small class="issue-id">差异编号 {{ issue.id }}</small><p>账单 {{ money(issue.statementAmountCent) }} · 本地 {{ money(issue.localAmountCent) }}</p><p v-if="issue.orderId">订单 {{ issue.orderId }}</p><small v-if="issue.paymentId">支付 {{ issue.paymentId }}</small><small v-if="issue.refundId">退款 {{ issue.refundId }}</small><RouterLink v-if="issue.kind === 'PAYMENT' && issue.orderId" :to="`/admin/orders/${issue.orderId}/verification`" class="art-button">核查原支付</RouterLink><RouterLink v-if="issue.kind === 'REFUND' && issue.refundId" :to="`/admin/refunds/${issue.refundId}/verification`" class="art-button">核查原退款</RouterLink><p v-if="!issue.orderId" class="muted">尚未匹配到本地订单，需核查渠道来源。</p></li></ul>
                  </div>
                  <button v-if="issueCursor" class="art-button" :disabled="!!busy" @click="moreIssues">加载更多差异</button>
                </template>
                <details><summary>执行记录与报告信息</summary><p>任务 {{ detail.job.id }}</p><p v-if="detail.job.completedAt">完成时间 {{ dateTime(detail.job.completedAt) }}</p><p v-if="detail.statementSha256" class="fingerprint">账单摘要 {{ detail.statementSha256 }}</p><p v-if="!detail.attempts.length">尚未开始执行。</p><ol class="attempt-list"><li v-for="attempt in detail.attempts" :key="attempt.attempt">第{{ attempt.attempt }}次 · {{ attemptLabels[attempt.result] }} · {{ dateTime(attempt.startedAt) }}<span v-if="attempt.errorCode"> · {{ reconciliationErrors[attempt.errorCode] }}</span></li></ol></details>
              </template>
            </section>
            <section id="reconcile-run-panel" class="panel run-panel" aria-label="新建或重新核对">
              <h2>新建或重新核对</h2><p>先读取当天状态，再确认新一轮。历史报告保留；后台尚在执行时不能重复发起。</p>
              <p v-if="!access.executionEnabled" class="message warning">后台当前关闭执行，既有报告仍可查看。</p>
              <form @submit.prevent="submit">
                <label>核对的账单日<UiInput id="reconcile-bill-date" v-model="targetDate" type="date" :min="access.earliestBillDate" :max="access.latestBillDate" :disabled="!!busy || !!pending || !access.executionEnabled" @change="changeTarget" /></label>
                <button class="art-button read-target" :disabled="!canPrepare" type="button" @click="prepare">核对当天状态</button>
                <p v-if="prepared" data-confirmed-generation>确认 {{ prepared.date }}，当前第{{ prepared.generation }}轮；将提交第{{ prepared.generation + 1 }}轮。</p>
                <label for="reconcile-reason">核对说明（5至500字）</label><textarea id="reconcile-reason" v-model="reason" rows="3" :disabled="!!busy || !prepared || !access.executionEnabled" maxlength="1000" autocomplete="off" />
                <label class="consent"><input v-model="reviewed" type="checkbox" :disabled="!!busy || !prepared || !access.executionEnabled">我已核对日期、当前轮次与说明；本操作只创建对账任务，不直接确认付款或改变权益。</label>
                <button class="art-button primary" :disabled="!canRun" type="submit">{{ pending ? '使用原请求重试' : '确认提交核对' }}</button>
              </form>
            </section>
          </div>
        </div>
      </template>
    </div><ArtFooter />
  </div>
</template>

<style scoped>
.admin-content { padding-top: 110px; padding-bottom: 80px; }
header { max-width: 800px; } h1 { margin: 12px 0; font-size: clamp(34px, 5vw, 52px); } h2 { font-size: 22px; margin: 0; } h3 { font-size: 18px; margin-top: 24px; }
p, li { line-height: 1.7; } p, strong, small, span { overflow-wrap: anywhere; } .muted, small { color: var(--text-muted); font-size: 13px; }
.workspace { display: grid; grid-template-columns: minmax(260px, .8fr) minmax(0, 1.6fr); gap: 24px; align-items: start; }
.panel { padding: 24px; border: 1px solid var(--border); border-radius: 18px; background: var(--bg-elevated); min-width: 0; }
.report-column { display: grid; gap: 24px; min-width: 0; } .panel-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 22px; }
.message { border: 1px solid var(--border); background: var(--bg-soft); padding: 18px; border-radius: 12px; margin: 18px 0; } .message p { margin-top: 0; } .warning { border-color: color-mix(in srgb, #ab741b 65%, var(--border)); background: color-mix(in srgb, #ab741b 7%, var(--bg-elevated)); }
.environment { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 16px 0 24px; } .environment span { color: var(--text-muted); font-size: 13px; }
.filters { display: grid; gap: 16px; } label { display: grid; gap: 8px; font-size: 14px; } .apply-filter, .read-target { margin: 16px 0; }
.job-list, .issue-list { list-style: none; padding: 0; margin: 20px 0; } .job-list li { margin-bottom: 12px; }
.job-row { display: grid; gap: 8px; width: 100%; padding: 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.job-row strong { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; } .job-row strong span { font-size: 13px; font-weight: 400; } .job-row[aria-pressed='true'] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 6%, var(--bg)); }
.job-row:hover { border-color: var(--accent); } button:disabled { cursor: default; opacity: .5; } button:focus-visible, summary:focus-visible, h2:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.empty { color: var(--text-muted); padding: 20px 0; } .report-status { font-weight: 600; } .reason { white-space: pre-wrap; }
.result-banner { display: grid; gap: 8px; padding: 18px; border: 1px solid var(--border); border-radius: 12px; background: var(--bg-soft); }
.result-banner span { font-size: 13px; color: var(--text-muted); } .table-scroll { overflow-x: auto; margin-top: 20px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; } caption { text-align: left; margin-bottom: 12px; color: var(--text-muted); font-size: 13px; } th, td { padding: 14px 10px; text-align: left; border-bottom: 1px solid var(--border); white-space: nowrap; } td small { display: block; margin-top: 6px; }
.issue-scroll { max-height: min(560px, 65vh); overflow-y: auto; scrollbar-gutter: stable; border: 1px solid var(--border); border-radius: 10px; padding: 0 14px; }
.issue-scroll:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
.issue-list { margin: 0; } .issue-list li { padding: 14px 0; border-bottom: 1px solid var(--border); } .issue-list li:last-child { border-bottom: 0; } .issue-list p { margin: 6px 0; } .issue-list small { display: block; } .issue-id { margin-top: 6px; font-family: var(--font-mono); }
details { margin-top: 24px; border-top: 1px solid var(--border); padding-top: 20px; } summary { cursor: pointer; min-height: 44px; } .fingerprint { font-family: var(--font-mono); font-size: 12px; } .attempt-list { padding-left: 24px; }
textarea { width: 100%; box-sizing: border-box; margin-top: 8px; padding: 12px; border: 1px solid var(--border-strong); border-radius: 8px; background: var(--bg); color: var(--text); font: inherit; resize: vertical; } textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.consent { display: flex; align-items: flex-start; gap: 10px; margin: 18px 0; line-height: 1.7; } .consent input { flex-shrink: 0; margin-top: 5px; accent-color: var(--accent); }
@media (max-width: 800px) { .workspace { grid-template-columns: 1fr; } .admin-content { padding-top: 90px; } .panel { padding: 18px; } .panel-heading .art-button { padding: 10px 18px; } }
@media (prefers-reduced-motion: reduce) { .art-button { transition: none; } .art-button:hover { transform: none; } }
</style>
