import { getAccessToken } from '../api/http'
import {
  recoverOrderPayment,
  type CommerceCapabilities,
  type CommerceOrder,
  type CommercePayment,
} from '../api/commerce'
import { isCommerceId } from './account-return'
import { paymentForOrder } from './payment-recovery'

export function canInitiateMockPayment(
  order: CommerceOrder,
  capabilities: CommerceCapabilities | null,
) {
  return (
    isCommerceId(order.id) &&
    order.state === 'PENDING_PAYMENT' &&
    !order.paymentId &&
    capabilities?.mockPaymentInitiationEnabled === true &&
    ['test', 'development'].includes(capabilities.environment) &&
    capabilities.paymentChannel === 'wechat_native' &&
    order.currency === 'CNY' &&
    Number.isSafeInteger(order.totalAmountCent) &&
    order.totalAmountCent > 0
  )
}

/** First POST and existing-payment recovery share one persisted command. No local authority over payment/rights. */
export async function initiateMockPayment(
  order: CommerceOrder,
  capabilities: CommerceCapabilities | null,
  token: string,
  signal: AbortSignal,
): Promise<CommercePayment> {
  if (!canInitiateMockPayment(order, capabilities))
    throw new Error('当前订单不能创建模拟付款记录，请刷新后台状态。')
  const current = () => {
    signal.throwIfAborted()
    if (!token || getAccessToken() !== token) throw new DOMException('账户已改变', 'AbortError')
  }
  current()
  const scope = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))),
    (v) => v.toString(16).padStart(2, '0'),
  ).join('')
  current()
  const storageKey = `astra.payment-recovery.${scope}.${order.id}`
  let key: string
  try {
    const previous = sessionStorage.getItem(storageKey)
    if (
      previous !== null &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(previous)
    )
      throw new Error('Corrupt command')
    key = previous ?? crypto.randomUUID()
    sessionStorage.setItem(storageKey, key)
  } catch {
    throw new Error('浏览器无法确认原付款请求标识，请允许会话存储，并从原订单核对结果。')
  }
  current()
  const result = await recoverOrderPayment(order.id, key, signal)
  current()
  const payment = paymentForOrder(result, { ...order, paymentId: result?.id })
  if (!payment.mock || payment.channel !== 'wechat_native')
    throw new Error('模拟付款记录无法确认，请刷新原订单状态。')
  return payment
}
