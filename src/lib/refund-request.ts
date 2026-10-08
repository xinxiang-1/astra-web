import { getAccessToken } from '../api/http'
import { requestOrderRefund, type CommerceOrder, type CommerceRefund } from '../api/commerce'
import { isCommerceId } from './account-return'

export function refundForOrder(refund: CommerceRefund, order: CommerceOrder): CommerceRefund {
  if (
    !refund || !isCommerceId(refund.id) || refund.orderId !== order.id ||
    refund.paymentId !== order.paymentId || (order.refund && refund.id !== order.refund.id) ||
    !Number.isSafeInteger(refund.amountCent) || refund.amountCent !== order.totalAmountCent ||
    refund.currency !== order.currency || !['REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED', 'REJECTED', 'FAILED', 'REVIEW'].includes(refund.state) ||
    !Number.isSafeInteger(refund.version) || refund.version < 1 || typeof refund.reason !== 'string' ||
    !Number.isFinite(Date.parse(refund.createdAt)) || !Number.isFinite(Date.parse(refund.updatedAt))
  ) throw new Error('退款记录与原订单不一致，请刷新后台状态。')
  return refund
}

export function normalizeRefundReason(value: string) {
  const reason = value.trim()
  if (Array.from(reason).length < 5 || Array.from(reason).length > 500 || /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(reason))
    throw new Error('请填写5至500字的退款原因。')
  return reason
}

async function digest(text: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (v) => v.toString(16).padStart(2, '0')).join('')
}

/** Persist only UUID and body hash: no token or complaint text. Server owns amount, approval and rights. */
export async function submitRefundRequest(order: CommerceOrder, text: string, token: string, signal: AbortSignal) {
  if (!isCommerceId(order.id) || !isCommerceId(order.paymentId ?? '') || order.state !== 'PAID' || order.totalRefundedCent !== 0 || order.refund)
    throw new Error('请先刷新原订单和退款记录。')
  const current = () => {
    signal.throwIfAborted()
    if (!token || getAccessToken() !== token) throw new DOMException('账户已改变', 'AbortError')
  }
  current()
  const reason = normalizeRefundReason(text)
  const [scope, reasonHash] = await Promise.all([digest(token), digest(reason)])
  current()
  const storageKey = `astra.refund-request.${scope}.${order.id}`
  let key: string
  try {
    const raw = sessionStorage.getItem(storageKey)
    const previous = raw === null ? null : JSON.parse(raw)
    if (previous && (typeof previous !== 'object' || typeof previous.key !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(previous.key) ||
      !/^[a-f0-9]{64}$/.test(previous.reasonHash))) throw new Error('Corrupt command')
    if (raw !== null && !previous) throw new Error('Corrupt command')
    if (previous && previous.reasonHash !== reasonHash)
      throw new Error('已有待确认请求，请先刷新订单，并使用原申请原因恢复。')
    key = previous?.key ?? crypto.randomUUID()
    sessionStorage.setItem(storageKey, JSON.stringify({ key, reasonHash }))
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('已有待确认请求')) throw cause
    throw new Error('浏览器无法确认原退款请求标识，请允许会话存储并核对原订单。')
  }
  current()
  const result = await requestOrderRefund(order.id, reason, key, signal)
  current()
  return refundForOrder(result, order)
}
