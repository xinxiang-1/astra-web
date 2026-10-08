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
  paidAt?: string | null
  expiresAt: string
  paymentId?: string | null
  item: { productName: string; releaseVersion: string; assets: CommerceAsset[] }
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

function query(cursor?: string) {
  const params = new URLSearchParams({ limit: '20' })
  if (cursor) params.set('cursor', cursor)
  return params.toString()
}
export function fetchOwnedOrders(cursor?: string, signal?: AbortSignal) {
  return http<CommercePage<CommerceOrder>>(`/system/orders?${query(cursor)}`, { signal })
}
export function fetchOwnedEntitlements(cursor?: string, signal?: AbortSignal) {
  return http<CommercePage<CommerceEntitlement>>(`/system/entitlements?${query(cursor)}`, {
    signal,
  })
}
