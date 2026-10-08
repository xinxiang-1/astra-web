import { ApiError, getAccessToken } from '../api/http'
import { fetchReconciliationCommand, runReconciliation, type ReconciliationAccess, type ReconciliationDetail, type ReconciliationIssue, type ReconciliationJob } from '../api/reconciliation'
import type { CommercePage } from '../api/commerce'
import { isCommerceId } from './account-return'
import { normalizeRefundReason } from './refund-request'

export const reconciliationStates = { READY: '等待后台执行', RUNNING: '正在后台核对', DONE: '核对已完成', DEAD: '执行异常' }
export const reconciliationErrors: Record<string, string> = {
  PROVIDER_TIMEOUT: '账单读取超时', PROVIDER_UNAVAILABLE: '账单渠道暂不可用', INVALID_STATEMENT: '账单校验未通过',
  STATEMENT_TOO_LARGE: '账单超过处理范围', LEDGER_TOO_LARGE: '本地账本超过处理范围', INVALID_LEDGER: '本地账本异常',
  INVALID_BINDING: '任务绑定异常', LEASE_EXPIRED: '执行中断后已接管', ATTEMPTS_EXHAUSTED: '尝试次数已用尽',
}
export const reconciliationDifferences: Record<string, string> = {
  STATEMENT_ONLY: '仅账单有记录', LOCAL_ONLY: '仅本地有记录', LOCAL_NOT_SETTLED: '本地尚未确认成功', LOCAL_BINDING_INVALID: '本地交易绑定异常',
  AMOUNT_MISMATCH: '金额不同', CURRENCY_MISMATCH: '币种不同', PARENT_MISMATCH: '原交易不同',
  PROVIDER_ID_MISMATCH: '渠道记录不同', EFFECTIVE_TIME_MISMATCH: '生效时间不同',
}
const integer = (value: unknown, max = 2147483647): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max
const time = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))
export function isBillDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
export function validateReconciliationAccess(value: ReconciliationAccess) {
  if (!value || !isCommerceId(value.actorId) || typeof value.executionEnabled !== 'boolean' || typeof value.mock !== 'boolean' ||
    !['development', 'test', 'production'].includes(value.environment) || !isBillDate(value.latestBillDate) || !isBillDate(value.earliestBillDate) ||
    value.earliestBillDate > value.latestBillDate || !time(value.observedAt) || (value.executionEnabled && (!value.mock || value.environment === 'production')))
    throw new Error('后台执行状态暂不可确认，请重新读取。')
  return value
}
export function validateReconciliationJob(value: ReconciliationJob) {
  if (!value || !isCommerceId(value.id) || !isBillDate(value.billDate) || value.timeZone !== 'Asia/Shanghai' ||
    !integer(value.generation) || value.generation < 1 || !Object.hasOwn(reconciliationStates, value.state) ||
    !['AUTO', 'MANUAL'].includes(value.source) || (value.source === 'MANUAL' && !isCommerceId(value.requestedBy)) ||
    (value.source === 'AUTO' && value.requestedBy !== undefined) || !integer(value.attempts, 9) || !time(value.createdAt) ||
    (value.lastErrorCode !== undefined && !Object.hasOwn(reconciliationErrors, value.lastErrorCode)) ||
    (value.state === 'DONE' ? !time(value.completedAt) || !integer(value.issueCount, 20000) : value.completedAt !== undefined || value.issueCount !== undefined))
    throw new Error('对账任务信息不完整，请重新读取。')
  return value
}
export function validateReconciliationDetail(value: ReconciliationDetail) {
  validateReconciliationJob(value?.job)
  if (!integer(value.latestGeneration) || value.latestGeneration < value.job.generation || typeof value.reason !== 'string' ||
    !Array.isArray(value.attempts) || value.attempts.length > 9) throw new Error('报告信息不完整，请重新读取。')
  for (const [index, attempt] of value.attempts.entries()) {
    if (attempt.attempt !== index + 1 || attempt.attempt > value.job.attempts || !['RUNNING', 'SUCCEEDED', 'RETRY', 'DEAD', 'ABANDONED'].includes(attempt.result) ||
      !time(attempt.startedAt) || (attempt.result !== 'RUNNING' && !time(attempt.finishedAt)) ||
      (attempt.errorCode !== undefined && !Object.hasOwn(reconciliationErrors, attempt.errorCode))) throw new Error('执行记录暂不可确认，请重新读取。')
  }
  if (value.job.state === 'DONE') {
    if (!value.summary || !time(value.observedAt) || !/^[a-f0-9]{64}$/.test(value.statementSha256 ?? '')) throw new Error('完整报告暂不可用，请重新读取。')
    for (const name of ['statementPaymentCount', 'statementPaymentCent', 'statementRefundCount', 'statementRefundCent', 'localPaymentCount', 'localPaymentCent', 'localRefundCount', 'localRefundCent', 'matchedPayments', 'matchedRefunds'] as const)
      if (!integer(value.summary[name], name.endsWith('Cent') ? 19998000000 : 20000)) throw new Error('报告金额或条数暂不可确认，请重新读取。')
  } else if (value.summary !== undefined || value.observedAt !== undefined || value.statementSha256 !== undefined) throw new Error('报告状态不一致，请重新读取。')
  return value
}
export function validateReconciliationIssue(value: ReconciliationIssue) {
  if (!value || !isCommerceId(value.id) || !['PAYMENT', 'REFUND'].includes(value.kind) ||
    [value.orderId, value.paymentId, value.refundId].some((id) => id !== undefined && !isCommerceId(id)) ||
    [value.localAmountCent, value.statementAmountCent].some((amount) => amount !== undefined && !integer(amount, 999900)) ||
    !Array.isArray(value.differences) || !value.differences.length || value.differences.length > 9 ||
    new Set(value.differences).size !== value.differences.length || value.differences.some((code) => !Object.hasOwn(reconciliationDifferences, code)))
    throw new Error('差异信息暂不可确认，请重新读取。')
  return value
}
export function validateReconciliationPage<T>(value: CommercePage<T>, validate: (item: T) => T) {
  if (!value || !Array.isArray(value.items) || value.items.length > 50 ||
    (value.nextCursor != null && !/^[A-Za-z0-9_-]{1,1024}$/.test(value.nextCursor))) throw new Error('分页信息暂不可确认，请重新读取。')
  value.items.forEach(validate)
  return value
}
export function normalizeReconciliationReason(text: string) {
  try { return normalizeRefundReason(text) } catch { throw new Error('请填写5至500字核对说明。') }
}
export interface PendingReconciliation { billDate: string; expectedGeneration: number; key: string; bodyHash: string }
async function digest(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (v) => v.toString(16).padStart(2, '0')).join('')
}
function identity(token: string, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!token || getAccessToken() !== token) throw new DOMException('账户已改变', 'AbortError')
}
async function storage(actor: string, token: string, signal: AbortSignal) {
  identity(token, signal)
  if (!isCommerceId(actor)) throw new Error('请先读取后台账户身份。')
  const storageKey = `astra.reconcile-command.${actor}`
  try {
    const raw = sessionStorage.getItem(storageKey), prior = raw === null ? null : JSON.parse(raw) as PendingReconciliation
    if (prior && (Object.keys(prior).sort().join(',') !== 'billDate,bodyHash,expectedGeneration,key' || !isBillDate(prior.billDate) ||
      !integer(prior.expectedGeneration) || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(prior.key) || !/^[a-f0-9]{64}$/.test(prior.bodyHash))) throw new Error('Invalid command')
    if (raw !== null && !prior) throw new Error('Invalid command')
    return { storageKey, prior }
  } catch { throw new Error('浏览器无法确认原操作标识，请恢复会话存储后重试。') }
}
export async function pendingReconciliation(actor: string, token: string, signal: AbortSignal) { return (await storage(actor, token, signal)).prior }
async function finish(result: ReconciliationDetail, pending: PendingReconciliation, actor: string, token: string, signal: AbortSignal, storageKey: string) {
  identity(token, signal);validateReconciliationDetail(result)
  if (result.job.source !== 'MANUAL' || result.job.requestedBy !== actor || result.job.billDate !== pending.billDate || result.job.generation !== pending.expectedGeneration + 1 ||
    await digest(JSON.stringify({ expectedGeneration: pending.expectedGeneration, reason: normalizeReconciliationReason(result.reason) })) !== pending.bodyHash)
    throw new Error('原操作结果不一致，请保留标识并重新读取。')
  identity(token, signal)
  sessionStorage.removeItem(storageKey)
  return result
}
export async function submitReconciliation(date: string, generation: number, text: string, actor: string, token: string, signal: AbortSignal) {
  if (!isBillDate(date) || !integer(generation)) throw new Error('请先核对账单日期和当前轮次。')
  const body = { expectedGeneration: generation, reason: normalizeReconciliationReason(text) }
  const { storageKey, prior } = await storage(actor, token, signal), bodyHash = await digest(JSON.stringify(body))
  identity(token, signal)
  if (prior && (prior.billDate !== date || prior.expectedGeneration !== generation || prior.bodyHash !== bodyHash))
    throw new Error('已有待确认操作，请先查询原任务；重试必须保留原日期、轮次与说明。')
  const pending = prior ?? { billDate: date, expectedGeneration: generation, key: crypto.randomUUID(), bodyHash }
  try { sessionStorage.setItem(storageKey, JSON.stringify(pending)) } catch { throw new Error('浏览器无法保存原操作标识，尚未发送请求。') }
  identity(token, signal)
  try { return await finish(await runReconciliation(date, body, pending.key, signal), pending, actor, token, signal, storageKey) }
  catch (cause) {
    identity(token, signal)
    // Only explicit pre-commit business rejection releases the intent. Transport/5xx retain the original key.
    if (cause instanceof ApiError && [400, 409, 422, 429].includes(cause.status ?? 0) && cause.code !== 43001)
      sessionStorage.removeItem(storageKey)
    throw cause
  }
}
export async function recoverReconciliation(actor: string, token: string, signal: AbortSignal) {
  const { storageKey, prior } = await storage(actor, token, signal)
  if (!prior) throw new Error('当前会话没有待确认操作。')
  const result = await fetchReconciliationCommand(prior.billDate, prior.key, signal)
  return finish(result, prior, actor, token, signal, storageKey)
}
