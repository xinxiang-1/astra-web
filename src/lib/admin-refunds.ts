import { getAccessToken } from '../api/http'
import { decideAdminRefund, type CommerceRefundContext, type RefundDecision } from '../api/commerce'
import { isCommerceId } from './account-return'
import { normalizeRefundReason, refundForOrder } from './refund-request'

/** Diagnostic flags never grant authority: the decision service checks locks/role/facts/version again. */
export function validateRefundContext(context: CommerceRefundContext) {
  if (!context?.order || !isCommerceId(context.order.id) || !isCommerceId(context.order.paymentId) ||
    context.order.state !== 'PAID' || !context.order.refund ||
    context.order.refund.state !== context.refund?.state || context.order.refund.amountCent !== context.refund.amountCent ||
    typeof context.buyerAccountEnabled !== 'boolean' || typeof context.paymentFactsConsistent !== 'boolean' ||
    !Number.isFinite(Date.parse(context.observedAt)) || !Array.isArray(context.deliveryStarts) ||
    !Array.isArray(context.audits) || !Array.isArray(context.tasks))
    throw new Error('审核信息与原订单不一致，请重新读取。')
  refundForOrder(context.refund, context.order)
  return context
}
export function availableRefundDecisions(context: CommerceRefundContext): RefundDecision[] {
  validateRefundContext(context)
  if (!context.paymentFactsConsistent) return []
  return context.refund.state === 'REQUESTED' ? ['APPROVE', 'REJECT'] : context.refund.state === 'REJECTED' ? ['REOPEN'] : []
}
async function digest(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (v) => v.toString(16).padStart(2, '0')).join('')
}
/** Save an original command before transport, without saving JWT or review text. */
export async function submitRefundDecision(context: CommerceRefundContext, decision: RefundDecision, text: string, token: string, signal: AbortSignal) {
  if (!availableRefundDecisions(context).includes(decision)) throw new Error('当前状态不能执行此操作，请重新读取。')
  const current = () => {
    signal.throwIfAborted()
    if (!token || getAccessToken() !== token) throw new DOMException('账户已改变', 'AbortError')
  }
  current()
  const body = { decision, expectedVersion: context.refund.version, reason: normalizeRefundReason(text) }
  const [scope, bodyHash] = await Promise.all([digest(token), digest(JSON.stringify(body))])
  current()
  const storageKey = `astra.refund-decision.${scope}.${context.refund.id}.${body.expectedVersion}`
  let key: string
  try {
    const raw = sessionStorage.getItem(storageKey)
    const prior = raw === null ? null : JSON.parse(raw)
    if (raw !== null && (!prior || typeof prior.key !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(prior.key) ||
      typeof prior.bodyHash !== 'string' || !/^[a-f0-9]{64}$/.test(prior.bodyHash))) throw new Error('Corrupt command')
    if (prior && prior.bodyHash !== bodyHash) throw new Error('已有待确认审核，请先刷新状态；恢复时须使用原操作与说明。')
    key = prior?.key ?? crypto.randomUUID()
    sessionStorage.setItem(storageKey, JSON.stringify({ key, bodyHash }))
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('已有待确认审核')) throw cause
    throw new Error('浏览器无法确认原审核标识，请允许会话存储并重新核对状态。')
  }
  current()
  const refund = await decideAdminRefund(context.refund.id, body, key, signal)
  current()
  // The returned state can advance after a replay; bind IDs/amount/version, not the old state.
  refundForOrder(refund, context.order)
  if (refund.id !== context.refund.id || refund.version < context.refund.version) throw new Error('审核结果不一致，请重新读取。')
  return refund
}
