import { http } from './http'
import type { CommerceOrder, CommerceRefund } from './commerce'

export interface RefundVerificationJob {
  taskId: string
  refundId: string
  orderId: string
  paymentId: string
  requestedBy: string
  expectedVersion: number
  reason: string
  state: 'READY' | 'RUNNING' | 'DONE' | 'DEAD'
  attempts: number
  observation?: 'NOT_FOUND' | 'PENDING' | 'UNKNOWN' | 'SUCCEEDED' | 'FAILED' | 'MISMATCH'
  factApplied: boolean
  lastErrorCode?: string
  lastObservedAt?: string
  nextRunAt: string
  createdAt: string
  updatedAt: string
}
export interface RefundVerificationContext {
  actorId: string
  executionEnabled: boolean
  mock: boolean
  environment: 'development' | 'test' | 'production'
  order: CommerceOrder
  orderVersion: number
  refund: CommerceRefund
  buyerAccountEnabled: boolean
  paymentState: string
  observedAt: string
  jobs: RefundVerificationJob[]
  jobsTruncated: boolean
}
const root = (id: string) => `/system/admin/refunds/${encodeURIComponent(id)}/reconcile`
export const fetchRefundVerificationContext = (id: string, signal: AbortSignal) => http<RefundVerificationContext>(root(id), { signal, cache: 'no-store' })
export const fetchRefundVerificationJob = (id: string, task: string, signal: AbortSignal) => http<RefundVerificationJob>(`${root(id)}/jobs/${encodeURIComponent(task)}`, { signal, cache: 'no-store' })
export const fetchRefundVerificationCommand = (id: string, key: string, signal: AbortSignal) => http<RefundVerificationJob>(`${root(id)}/commands/${encodeURIComponent(key)}`, { signal, cache: 'no-store' })
export const requestRefundVerification = (id: string, body: { expectedVersion: number; reason: string }, key: string, signal: AbortSignal) => http<RefundVerificationJob>(root(id), { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key }, signal, cache: 'no-store' })
