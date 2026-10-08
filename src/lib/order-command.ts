import { ApiError, getAccessToken } from '../api/http'
import {
  createCommerceOrder,
  fetchOwnedOrder,
  type CommerceOrder,
  type CommerceOrderRequest,
  type CommerceSku,
} from '../api/commerce'
import { isCommerceId } from './account-return'

export interface OrderCommand {
  key: string
  request: CommerceOrderRequest
  orderId?: string
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const fields = ['skuId', 'offerVersion', 'termsVersion', 'refundPolicyVersion', 'licenseVersion']
function validRequest(value: unknown): value is CommerceOrderRequest {
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return (
    Object.keys(row).length === fields.length &&
    fields.every((f) => f in row) &&
    isCommerceId(row.skuId) &&
    Number.isInteger(row.offerVersion) &&
    Number(row.offerVersion) > 0 &&
    Number(row.offerVersion) <= 2147483647 &&
    fields
      .slice(2)
      .every((f) => typeof row[f] === 'string' && row[f].length > 0 && row[f].length <= 32)
  )
}
export function orderRequest(sku: CommerceSku): CommerceOrderRequest {
  const request = {
    skuId: sku.id,
    offerVersion: sku.offerVersion,
    termsVersion: sku.purchaseTerms.version,
    refundPolicyVersion: sku.refundPolicy.version,
    licenseVersion: sku.release.license.version,
  }
  if (!validRequest(request)) throw new Error('商品版本无法确认，请刷新内容。')
  return request
}
function current(token: string, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!token || getAccessToken() !== token) throw new DOMException('账户已改变', 'AbortError')
}
async function storageKey(slug: string, token: string, signal: AbortSignal) {
  current(token, signal)
  if (slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
    throw new Error('商品地址无效。')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  current(token, signal)
  const scope = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('')
  return `astra.order-command.${scope}.${slug}`
}
function read(key: string): OrderCommand | null {
  let raw: string | null
  try {
    raw = sessionStorage.getItem(key)
  } catch {
    throw new Error('浏览器无法读取订单恢复记录，请允许会话存储。')
  }
  if (raw === null) return null
  try {
    const value = JSON.parse(raw)
    if (
      !value ||
      !uuid.test(value.key) ||
      !validRequest(value.request) ||
      Object.keys(value).some((k) => !['key', 'request', 'orderId'].includes(k)) ||
      (value.orderId !== undefined && !isCommerceId(value.orderId))
    )
      throw new Error()
    return value as OrderCommand
  } catch {
    throw new Error('订单恢复记录损坏，请从我的订单核对结果，避免重复下单。')
  }
}
function write(key: string, command: OrderCommand) {
  try {
    sessionStorage.setItem(key, JSON.stringify(command))
  } catch {
    throw new Error('浏览器无法保存订单恢复记录，请允许会话存储。请从我的订单核对结果。')
  }
}
export async function readOrderCommand(slug: string, token: string, signal: AbortSignal) {
  return read(await storageKey(slug, token, signal))
}
/** Only a fresh server-confirmed CLOSED order permits explicitly starting another confirmation. */
export async function releaseClosedOrderCommand(slug: string, token: string, signal: AbortSignal) {
  const key = await storageKey(slug, token, signal)
  const command = read(key)
  if (!command?.orderId) throw new Error('请先核对原订单结果。')
  const order = bind(await fetchOwnedOrder(command.orderId, signal), command)
  current(token, signal)
  if (order.state !== 'CLOSED') throw new Error('原订单尚未关闭，请继续查看原订单。')
  try { sessionStorage.removeItem(key) }
  catch { throw new Error('无法更新会话记录，请继续查看原订单。') }
}
function bind(order: CommerceOrder, command: OrderCommand): CommerceOrder {
  if (
    !order ||
    !isCommerceId(order.id) ||
    (command.orderId && order.id !== command.orderId) ||
    order.item?.skuId !== command.request.skuId ||
    order.purchaseTerms?.version !== command.request.termsVersion ||
    order.refundPolicy?.version !== command.request.refundPolicyVersion ||
    order.item?.license?.version !== command.request.licenseVersion ||
    !Number.isSafeInteger(order.totalAmountCent) ||
    order.totalAmountCent <= 0 ||
    order.totalAmountCent !== order.item.amountCent ||
    order.item.quantity !== 1 ||
    order.currency !== 'CNY'
  )
    throw new Error('订单结果无法确认，请使用原请求恢复或从我的订单核对。')
  return order
}
/** Persist the exact command before POST. Never replace an unresolved command or auto retry a write. */
export async function submitOrderCommand(
  slug: string,
  token: string,
  signal: AbortSignal,
  confirmedRequest?: CommerceOrderRequest,
): Promise<CommerceOrder> {
  const key = await storageKey(slug, token, signal)
  let command = read(key)
  if (!command) {
    if (!validRequest(confirmedRequest)) throw new Error('没有可恢复的请求，请重新确认商品和条款。')
    command = { key: crypto.randomUUID(), request: { ...confirmedRequest } }
    write(key, command)
  } else if (confirmedRequest) throw new Error('已有订单请求，请先恢复原请求。')
  current(token, signal)
  let order: CommerceOrder
  try {
    order = command.orderId
      ? await fetchOwnedOrder(command.orderId, signal)
      : await createCommerceOrder(command.request, command.key, signal)
  } catch (cause) {
    current(token, signal)
    // This version rejection proves this exact command did not create an order. All ambiguous failures retain it.
    if (!command.orderId && cause instanceof ApiError && cause.code === 43002) {
      try {
        sessionStorage.removeItem(key)
      } catch {
        /* Retaining is safe; UI will still require recovery. */
      }
    }
    throw cause
  }
  current(token, signal)
  bind(order, command)
  write(key, { ...command, orderId: order.id })
  return order
}
