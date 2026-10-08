import { getAccessToken } from '../api/http'
import { recoverOrderPayment, type CommerceOrder, type CommercePayment } from '../api/commerce'
import { isCommerceId } from './account-return'

/** Presentation binding, not authorization. Drop any checkout URL before exposing payment data. */
export function paymentForOrder(payment: CommercePayment, order: CommerceOrder): CommercePayment {
  if (
    !payment ||
    !isCommerceId(payment.id) ||
    payment.id !== order.paymentId ||
    payment.orderId !== order.id ||
    !Number.isSafeInteger(payment.amountCent) ||
    payment.amountCent !== order.totalAmountCent ||
    payment.currency !== order.currency ||
    typeof payment.mock !== 'boolean' ||
    typeof payment.channel !== 'string' ||
    !['INIT', 'PENDING', 'UNKNOWN', 'SUCCEEDED', 'CLOSED'].includes(payment.state) ||
    !Number.isFinite(Date.parse(payment.expiresAt))
  )
    throw new Error('付款记录与订单不一致，请刷新订单或联系支持。')
  return {
    id: payment.id,
    orderId: payment.orderId,
    state: payment.state,
    channel: payment.channel,
    amountCent: payment.amountCent,
    currency: payment.currency,
    expiresAt: payment.expiresAt,
    mock: payment.mock,
  }
}

/** Persist only a command UUID; backend owns the fixed payment number, amount and state. */
export async function recoverExistingPayment(
  order: CommerceOrder,
  payment: CommercePayment,
  token: string,
  signal: AbortSignal,
): Promise<CommercePayment> {
  paymentForOrder(payment, order)
  if (
    !isCommerceId(order.id) ||
    order.state !== 'PENDING_PAYMENT' ||
    payment.channel !== 'wechat_native' ||
    !['INIT', 'PENDING', 'UNKNOWN'].includes(payment.state)
  )
    throw new Error('当前记录不需要恢复，请刷新订单状态。')
  const current = () => {
    signal.throwIfAborted()
    if (getAccessToken() !== token) throw new DOMException('账户已改变', 'AbortError')
  }
  current()
  const scope = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
    (n) => n.toString(16).padStart(2, '0'),
  ).join('')
  current()
  const storageKey = `astra.payment-recovery.${scope}.${order.id}`
  let key: string
  try {
    const previous = sessionStorage.getItem(storageKey)
    key =
      previous &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(previous)
        ? previous
        : crypto.randomUUID()
    sessionStorage.setItem(storageKey, key)
  } catch {
    throw new Error('浏览器无法保存恢复标识，请允许会话存储后重试。请勿重新创建订单。')
  }
  current()
  const result = await recoverOrderPayment(order.id, key, signal)
  current()
  return paymentForOrder(result, order)
}
