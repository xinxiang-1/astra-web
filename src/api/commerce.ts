import { http } from './http'

export interface CommercePage<T> {
  items: T[]
  nextCursor?: string | null
}
export interface CommercePolicy {
  code: string
  kind: string
  version: string
  sha256: string
  content: string
}
export interface CommerceAsset {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  sha256: string
}
export interface CommerceRelease {
  id: string
  version: string
  engineVersion: string
  projectSchemaVersion: number
  license: CommercePolicy
  assets: CommerceAsset[]
  deliveryContents: string[]
}
export interface CommerceOrder {
  id: string
  orderNo: string
  state: string
  fulfillmentState: string
  issueCode?: string | null
  totalAmountCent: number
  totalRefundedCent: number
  currency: string
  createdAt: string
  consentAt: string
  paidAt?: string | null
  closedAt?: string | null
  accessStartedAt?: string | null
  expiresAt: string
  paymentId?: string | null
  item: {
    skuId: string
    releaseId: string
    productName: string
    productKind: string
    releaseVersion: string
    quantity: number
    amountCent: number
    license: CommercePolicy
    assets: CommerceAsset[]
  }
  purchaseTerms: CommercePolicy
  refundPolicy: CommercePolicy
  refund?: { id: string; state: string; amountCent: number } | null
}
export interface CommerceEntitlement {
  id: string
  releaseId: string
  sourceOrderId: string
  state: string
  grantedAt: string
  revokedAt?: string | null
  release: CommerceRelease
}

export interface CommerceCapabilities {
  mockPaymentInitiationEnabled: boolean
  orderCreationEnabled: boolean
  paymentEnabled: boolean
  paymentChannel: string
  supportedCheckoutDevices: string[]
  creationKitReady: boolean
  environment: string
  mockPayment: boolean
}
export type CommerceProductKind = 'TEMPLATE_PACK' | 'CREATION_KIT'
export interface CommerceProductCard {
  id: string
  slug: string
  name: string
  kind: CommerceProductKind
  summary: string
  previewUrls: string[]
}
export interface CommerceSku {
  id: string
  offerVersion: number
  amountCent: number
  currency: string
  release: CommerceRelease
  purchaseTerms: CommercePolicy
  refundPolicy: CommercePolicy
}
export interface CommerceProduct extends CommerceProductCard {
  skus: CommerceSku[]
}
export function fetchCommerceCapabilities(signal?: AbortSignal) {
  return http<CommerceCapabilities>('/system/catalog/capabilities', { signal })
}
export function fetchCommerceProducts(
  kind?: CommerceProductKind,
  cursor?: string,
  signal?: AbortSignal,
) {
  const params = new URLSearchParams({ limit: '20' })
  if (kind) params.set('kind', kind)
  if (cursor) params.set('cursor', cursor)
  return http<CommercePage<CommerceProductCard>>(`/system/catalog/products?${params}`, { signal })
}
export function fetchCommerceProduct(slug: string, signal?: AbortSignal) {
  return http<CommerceProduct>(`/system/catalog/products/${encodeURIComponent(slug)}`, { signal })
}

function query(cursor?: string) {
  const params = new URLSearchParams({ limit: '20' })
  if (cursor) params.set('cursor', cursor)
  return params.toString()
}
export function fetchOwnedOrders(cursor?: string, signal?: AbortSignal) {
  return http<CommercePage<CommerceOrder>>(`/system/orders?${query(cursor)}`, { signal })
}
export function fetchOwnedOrder(orderId: string, signal?: AbortSignal) {
  return http<CommerceOrder>(`/system/orders/${orderId}`, { signal, cache: 'no-store' })
}
export interface CommerceOrderRequest {
  skuId: string
  offerVersion: number
  termsVersion: string
  refundPolicyVersion: string
  licenseVersion: string
}
export function createCommerceOrder(body: CommerceOrderRequest, key: string, signal?: AbortSignal) {
  return http<CommerceOrder>('/system/orders', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(body),
    signal,
    cache: 'no-store',
  })
}
export interface CommercePayment {
  id: string
  orderId: string
  state: string
  channel: string
  amountCent: number
  currency: string
  expiresAt: string
  mock: boolean
}
export function fetchOwnedPayment(paymentId: string, signal?: AbortSignal) {
  return http<CommercePayment>(`/system/payments/${paymentId}`, { signal, cache: 'no-store' })
}
export interface CommerceRefund {
  id: string
  orderId: string
  paymentId: string
  state: string
  amountCent: number
  currency: string
  reason: string
  decisionReason?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  version: number
}
export function fetchOwnedRefund(refundId: string, signal?: AbortSignal) {
  return http<CommerceRefund>(`/system/refunds/${refundId}`, { signal, cache: 'no-store' })
}
export function requestOrderRefund(orderId: string, reason: string, key: string, signal?: AbortSignal) {
  return http<CommerceRefund>(`/system/orders/${orderId}/refund-requests`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ reason }),
    signal,
    cache: 'no-store',
  })
}
export function recoverOrderPayment(orderId: string, key: string, signal?: AbortSignal) {
  return http<CommercePayment>(`/system/orders/${orderId}/payments`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify({ channel: 'wechat_native' }),
    signal,
    cache: 'no-store',
  })
}
export function fetchOwnedEntitlements(cursor?: string, signal?: AbortSignal) {
  return http<CommercePage<CommerceEntitlement>>(`/system/entitlements?${query(cursor)}`, {
    signal,
  })
}

export interface CommerceDownloadTicket {
  ticket: string
  downloadPath: string
  expiresAt: string
  file: CommerceAsset
}
export function issuePurchasedDownloadTicket(assetId: string, signal?: AbortSignal) {
  return http<CommerceDownloadTicket>(`/system/assets/${assetId}/download-ticket`, {
    method: 'POST',
    signal,
  })
}
