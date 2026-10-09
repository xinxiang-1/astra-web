import { ApiError, getAccessToken } from '../api/http'
import { fetchVerificationCommand, requestVerification, type VerificationContext, type VerificationJob } from '../api/payment-verification'
import { isCommerceId } from './account-return'
import { normalizeRefundReason } from './refund-request'

export const verificationPath = (id: string) => `/admin/orders/${id}/verification`
export const verificationStates = { READY: '等待后台查询', RUNNING: '正在后台查询', DONE: '查询已完成', DEAD: '查询已停止' }
export const paymentStates: Record<string, string> = { NONE: '尚无支付记录', INIT: '正在初始化', PENDING: '等待付款', UNKNOWN: '支付结果待核实', SUCCEEDED: '已确认支付成功', CLOSED: '支付已关闭' }
export const orderStates: Record<string, string> = { PENDING_PAYMENT: '等待付款', PAID: '已付款', CLOSED: '已关闭' }
export const fulfillmentStates: Record<string, string> = { NONE: '尚未授予', GRANTED: '已授予', REVIEW: '需要复核', REVOKED: '已撤销' }
export const verificationObservations: Record<string, string> = { NOT_FOUND: '渠道暂未查到原记录', PENDING: '渠道仍在等待付款', UNKNOWN: '渠道结果尚未确定', SUCCEEDED: '渠道确认支付成功', CLOSED: '渠道确认支付关闭', MISMATCH: '查询结果与原交易不一致' }
export const verificationErrors: Record<string, string> = { CHANNEL_UNKNOWN: '渠道结果暂未确定', CHANNEL_REJECTED: '渠道查询未通过校验', LOCAL_APPLY_UNAVAILABLE: '本地结果暂未写入', FACT_MISMATCH: '原交易与查询结果不一致', RESOURCE_MISSING: '原任务绑定异常', UNRESOLVED_LIMIT: '查询次数已用尽' }
const integer = (v: unknown, max = 2147483647): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max
const time = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v))
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export const activeVerification = (v: VerificationJob) => v.state === 'READY' || v.state === 'RUNNING'
export function verificationReason(text: string) {
  try {
    const reason = normalizeRefundReason(text)
    if (/[\ud800-\udfff]/u.test(reason)) throw new Error('Invalid Unicode')
    return reason
  } catch { throw new Error('请填写5至500字核查说明。') }
}
export function validateVerificationJob(v: VerificationJob, order?: string, payment?: string) {
  if (!v || ![v.taskId, v.orderId, v.paymentId, v.requestedBy].every(isCommerceId) || (order && v.orderId !== order) || (payment && v.paymentId !== payment) ||
    !integer(v.expectedVersion) || v.expectedVersion < 1 || !Object.hasOwn(verificationStates, v.state) || !integer(v.attempts, 9) ||
    typeof v.reason !== 'string' || verificationReason(v.reason) !== v.reason || typeof v.factApplied !== 'boolean' ||
    (v.observation !== undefined && !Object.hasOwn(verificationObservations, v.observation)) ||
    (v.lastErrorCode !== undefined && !Object.hasOwn(verificationErrors, v.lastErrorCode)) ||
    (v.lastObservedAt !== undefined && !time(v.lastObservedAt)) || !time(v.nextRunAt) || !time(v.createdAt) || !time(v.updatedAt) ||
    (v.factApplied && (v.state !== 'DONE' || !['SUCCEEDED', 'CLOSED'].includes(v.observation ?? ''))))
    throw new Error('核查任务与原订单不一致，请重新读取。')
  return v
}
export function validateVerificationContext(v: VerificationContext, order: string) {
  if (!v || !isCommerceId(v.actorId) || typeof v.executionEnabled !== 'boolean' || typeof v.mock !== 'boolean' ||
    !['development', 'test', 'production'].includes(v.environment) || (v.executionEnabled && (!v.mock || v.environment === 'production')) ||
    !integer(v.orderVersion) || v.orderVersion < 1 || typeof v.buyerAccountEnabled !== 'boolean' || !Object.hasOwn(paymentStates, v.paymentState) || !time(v.observedAt) ||
    !v.order || v.order.id !== order || !isCommerceId(v.order.id) || !Object.hasOwn(orderStates, v.order.state) || !Object.hasOwn(fulfillmentStates, v.order.fulfillmentState) ||
    !integer(v.order.totalAmountCent, 999900) || v.order.totalAmountCent < 1 || !integer(v.order.totalRefundedCent, v.order.totalAmountCent) || v.order.currency !== 'CNY' ||
    typeof v.order.orderNo !== 'string' || !v.order.item || typeof v.order.item.productName !== 'string' || typeof v.order.item.releaseVersion !== 'string' ||
    (v.paymentState === 'NONE' ? v.order.paymentId != null : !isCommerceId(v.order.paymentId)) || !time(v.order.createdAt) || !time(v.order.expiresAt) ||
    !Array.isArray(v.jobs) || v.jobs.length > 20 || typeof v.jobsTruncated !== 'boolean') throw new Error('原订单与后台核查状态暂不可确认，请重新读取。')
  v.jobs.forEach((job) => validateVerificationJob(job, order, v.order.paymentId ?? undefined))
  if (new Set(v.jobs.map((j) => j.taskId)).size !== v.jobs.length) throw new Error('核查历史重复，请重新读取。')
  return v
}

export interface PendingVerification { orderId: string; expectedVersion: number; key: string; bodyHash: string }
async function digest(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (v) => v.toString(16).padStart(2, '0')).join('')
}
function identity(token: string, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!token || getAccessToken() !== token) throw new DOMException('账户已改变', 'AbortError')
}
function storage(actor: string, token: string, signal: AbortSignal) {
  identity(token, signal)
  if (!isCommerceId(actor)) throw new Error('请先读取后台账户身份。')
  const storageKey = `astra.payment-verification-command.${actor}`
  try {
    const raw = sessionStorage.getItem(storageKey), prior = raw === null ? null : JSON.parse(raw) as PendingVerification
    if (raw !== null && (!prior || Object.keys(prior).sort().join(',') !== 'bodyHash,expectedVersion,key,orderId' || !isCommerceId(prior.orderId) ||
      !integer(prior.expectedVersion) || prior.expectedVersion < 1 || !uuid.test(prior.key) || !/^[a-f0-9]{64}$/.test(prior.bodyHash))) throw new Error('Invalid command')
    return { storageKey, prior }
  } catch { throw new Error('浏览器无法确认原操作标识，请恢复会话存储后重试。') }
}
export const pendingVerification = (actor: string, token: string, signal: AbortSignal) => storage(actor, token, signal).prior
async function finish(result: VerificationJob, pending: PendingVerification, actor: string, token: string, signal: AbortSignal, storageKey: string) {
  identity(token, signal); validateVerificationJob(result, pending.orderId)
  if (result.requestedBy !== actor || result.expectedVersion !== pending.expectedVersion ||
    await digest(JSON.stringify({ expectedVersion: pending.expectedVersion, reason: verificationReason(result.reason) })) !== pending.bodyHash)
    throw new Error('原操作结果不一致，请保留标识并重新读取。')
  identity(token, signal)
  if (storage(actor, token, signal).prior?.key === pending.key) sessionStorage.removeItem(storageKey)
  return result
}
export async function submitVerification(order: string, version: number, text: string, actor: string, token: string, signal: AbortSignal) {
  if (!isCommerceId(order) || !integer(version) || version < 1) throw new Error('请先核对原订单和版本。')
  const body = { expectedVersion: version, reason: verificationReason(text) }
  identity(token, signal)
  const bodyHash = await digest(JSON.stringify(body))
  // Re-read after hashing so concurrent callers see the first persisted original key.
  const { storageKey, prior } = storage(actor, token, signal)
  if (prior && (prior.orderId !== order || prior.expectedVersion !== version || prior.bodyHash !== bodyHash)) throw new Error('已有待确认操作，请先查询原任务；重试须保留原订单、版本与说明。')
  const pending = prior ?? { orderId: order, expectedVersion: version, key: crypto.randomUUID(), bodyHash }
  try { sessionStorage.setItem(storageKey, JSON.stringify(pending)) } catch { throw new Error('浏览器无法保存原操作标识，尚未发送请求。') }
  identity(token, signal)
  try { return await finish(await requestVerification(order, body, pending.key, signal), pending, actor, token, signal, storageKey) }
  catch (cause) {
    identity(token, signal)
    if (cause instanceof ApiError && [400, 409, 422, 429].includes(cause.status ?? 0) && cause.code !== 43001 && storage(actor, token, signal).prior?.key === pending.key) sessionStorage.removeItem(storageKey)
    throw cause
  }
}
export async function recoverVerification(actor: string, token: string, signal: AbortSignal) {
  const { storageKey, prior } = storage(actor, token, signal)
  if (!prior) throw new Error('当前会话没有待确认操作。')
  return finish(await fetchVerificationCommand(prior.orderId, prior.key, signal), prior, actor, token, signal, storageKey)
}
