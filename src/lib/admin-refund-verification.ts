import { ApiError, getAccessToken } from '../api/http'
import { fetchRefundVerificationCommand, requestRefundVerification, type RefundVerificationContext, type RefundVerificationJob } from '../api/refund-verification'
import { isCommerceId } from './account-return'
import { refundForOrder } from './refund-request'
import { fulfillmentStates, orderStates, paymentStates, verificationErrors, verificationReason, verificationStates } from './admin-payment-verification'

export { fulfillmentStates, orderStates, paymentStates, verificationErrors, verificationReason, verificationStates }
export const refundVerificationPath = (id: string) => `/admin/refunds/${id}/verification`
export const refundStates: Record<string, string> = { REQUESTED: '等待审核', APPROVED: '已批准退款', PROCESSING: '正在退款', SUCCEEDED: '已确认退款成功', REJECTED: '申请已拒绝', FAILED: '退款未成功', REVIEW: '退款待核查' }
export const refundVerificationObservations: Record<string, string> = { NOT_FOUND: '渠道暂未查到原退款', PENDING: '渠道仍在处理退款', UNKNOWN: '退款结果尚未确定', SUCCEEDED: '渠道确认退款成功', FAILED: '渠道确认退款未成功', MISMATCH: '查询结果与原退款不一致' }
const integer = (v: unknown, max = 2147483647): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= max
const time = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v))
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
export const activeRefundVerification = (v: RefundVerificationJob) => v.state === 'READY' || v.state === 'RUNNING'
export const eligibleRefundVerification = (v: RefundVerificationContext) => ['APPROVED', 'PROCESSING', 'REVIEW', 'SUCCEEDED', 'FAILED'].includes(v.refund.state) && v.order.state === 'PAID' && v.paymentState === 'SUCCEEDED'
export function validateRefundVerificationJob(v: RefundVerificationJob, refund?: string, order?: string, payment?: string) {
  if (!v || ![v.taskId, v.refundId, v.orderId, v.paymentId, v.requestedBy].every(isCommerceId) || (refund && v.refundId !== refund) || (order && v.orderId !== order) || (payment && v.paymentId !== payment) ||
    !integer(v.expectedVersion) || v.expectedVersion < 1 || !Object.hasOwn(verificationStates, v.state) || !integer(v.attempts, 9) ||
    typeof v.reason !== 'string' || verificationReason(v.reason) !== v.reason || typeof v.factApplied !== 'boolean' ||
    (v.observation !== undefined && !Object.hasOwn(refundVerificationObservations, v.observation)) ||
    (v.lastErrorCode !== undefined && !Object.hasOwn(verificationErrors, v.lastErrorCode)) ||
    (v.lastObservedAt !== undefined && !time(v.lastObservedAt)) || !time(v.nextRunAt) || !time(v.createdAt) || !time(v.updatedAt) ||
    (v.factApplied && (v.state !== 'DONE' || !['SUCCEEDED', 'FAILED'].includes(v.observation ?? ''))))
    throw new Error('核查任务与原退款不一致，请重新读取。')
  return v
}
export function validateRefundVerificationContext(v: RefundVerificationContext, refund: string) {
  if (!v || !isCommerceId(v.actorId) || typeof v.executionEnabled !== 'boolean' || typeof v.mock !== 'boolean' ||
    !['development', 'test', 'production'].includes(v.environment) || (v.executionEnabled && (!v.mock || v.environment === 'production')) ||
    !integer(v.orderVersion) || v.orderVersion < 1 || typeof v.buyerAccountEnabled !== 'boolean' || v.paymentState === 'NONE' || !Object.hasOwn(paymentStates, v.paymentState) || !time(v.observedAt) ||
    !v.order || !isCommerceId(v.order.id) || !Object.hasOwn(orderStates, v.order.state) || !Object.hasOwn(fulfillmentStates, v.order.fulfillmentState) ||
    !integer(v.order.totalAmountCent, 999900) || v.order.totalAmountCent < 1 || !integer(v.order.totalRefundedCent, v.order.totalAmountCent) || v.order.currency !== 'CNY' ||
    typeof v.order.orderNo !== 'string' || !v.order.item || typeof v.order.item.productName !== 'string' || typeof v.order.item.releaseVersion !== 'string' ||
    !isCommerceId(v.order.paymentId) || !time(v.order.createdAt) || !time(v.order.expiresAt) ||
    !v.refund || v.refund.id !== refund || !integer(v.refund.version) || v.refund.version < 1 || !time(v.refund.createdAt) || !time(v.refund.updatedAt) ||
    (v.refund.completedAt !== undefined && !time(v.refund.completedAt)) || !v.order.refund || v.order.refund.id !== refund ||
    v.order.refund.state !== v.refund.state || v.order.refund.amountCent !== v.refund.amountCent ||
    !Array.isArray(v.jobs) || v.jobs.length > 20 || typeof v.jobsTruncated !== 'boolean') throw new Error('原退款与后台核查状态暂不可确认，请重新读取。')
  refundForOrder(v.refund, v.order)
  v.jobs.forEach((job) => validateRefundVerificationJob(job, refund, v.order.id, v.order.paymentId ?? undefined))
  if (new Set(v.jobs.map((j) => j.taskId)).size !== v.jobs.length) throw new Error('核查历史重复，请重新读取。')
  return v
}

export interface PendingRefundVerification { refundId: string; expectedVersion: number; key: string; bodyHash: string }
export interface RefundVerificationBinding { orderId: string; paymentId: string }
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
  const storageKey = `astra.refund-verification-command.${actor}`
  try {
    const raw = sessionStorage.getItem(storageKey), prior = raw === null ? null : JSON.parse(raw) as PendingRefundVerification
    if (raw !== null && (!prior || Object.keys(prior).sort().join(',') !== 'bodyHash,expectedVersion,key,refundId' || !isCommerceId(prior.refundId) ||
      !integer(prior.expectedVersion) || prior.expectedVersion < 1 || !uuid.test(prior.key) || !/^[a-f0-9]{64}$/.test(prior.bodyHash))) throw new Error('Invalid command')
    return { storageKey, prior }
  } catch { throw new Error('浏览器无法确认原操作标识，请恢复会话存储后重试。') }
}
export const pendingRefundVerification = (actor: string, token: string, signal: AbortSignal) => storage(actor, token, signal).prior
async function finish(result: RefundVerificationJob, pending: PendingRefundVerification, actor: string, token: string, signal: AbortSignal, storageKey: string, binding?: RefundVerificationBinding) {
  identity(token, signal); validateRefundVerificationJob(result, pending.refundId, binding?.orderId, binding?.paymentId)
  if (result.requestedBy !== actor || result.expectedVersion !== pending.expectedVersion ||
    await digest(JSON.stringify({ expectedVersion: pending.expectedVersion, reason: verificationReason(result.reason) })) !== pending.bodyHash)
    throw new Error('原操作结果不一致，请保留标识并重新读取。')
  identity(token, signal)
  if (storage(actor, token, signal).prior?.key === pending.key) sessionStorage.removeItem(storageKey)
  return result
}
export async function submitRefundVerification(refund: string, version: number, text: string, actor: string, token: string, signal: AbortSignal, binding?: RefundVerificationBinding) {
  if (!isCommerceId(refund) || !integer(version) || version < 1 || (binding && (!isCommerceId(binding.orderId) || !isCommerceId(binding.paymentId)))) throw new Error('请先核对原退款和版本。')
  const body = { expectedVersion: version, reason: verificationReason(text) }
  identity(token, signal)
  const bodyHash = await digest(JSON.stringify(body))
  const { storageKey, prior } = storage(actor, token, signal)
  if (prior && (prior.refundId !== refund || prior.expectedVersion !== version || prior.bodyHash !== bodyHash)) throw new Error('已有待确认操作，请先查询原任务；重试须保留原退款、版本与说明。')
  const pending = prior ?? { refundId: refund, expectedVersion: version, key: crypto.randomUUID(), bodyHash }
  try { sessionStorage.setItem(storageKey, JSON.stringify(pending)) } catch { throw new Error('浏览器无法保存原操作标识，尚未发送请求。') }
  identity(token, signal)
  try { return await finish(await requestRefundVerification(refund, body, pending.key, signal), pending, actor, token, signal, storageKey, binding) }
  catch (cause) {
    identity(token, signal)
    if (cause instanceof ApiError && [400, 409, 422, 429].includes(cause.status ?? 0) && cause.code !== 43001 && storage(actor, token, signal).prior?.key === pending.key) sessionStorage.removeItem(storageKey)
    throw cause
  }
}
export async function recoverRefundVerification(actor: string, token: string, signal: AbortSignal, binding?: RefundVerificationBinding) {
  const { storageKey, prior } = storage(actor, token, signal)
  if (!prior) throw new Error('当前会话没有待确认操作。')
  return finish(await fetchRefundVerificationCommand(prior.refundId, prior.key, signal), prior, actor, token, signal, storageKey, binding)
}
