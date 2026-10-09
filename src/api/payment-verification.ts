import { http } from './http'
import type { CommerceOrder } from './commerce'

export interface VerificationJob {
  taskId: string
  orderId: string
  paymentId: string
  requestedBy: string
  expectedVersion: number
  reason: string
  state: 'READY' | 'RUNNING' | 'DONE' | 'DEAD'
  attempts: number
  observation?: 'NOT_FOUND' | 'PENDING' | 'UNKNOWN' | 'SUCCEEDED' | 'CLOSED' | 'MISMATCH'
  factApplied: boolean
  lastErrorCode?: string
  lastObservedAt?: string
  nextRunAt: string
  createdAt: string
  updatedAt: string
}
export interface VerificationContext {
  actorId: string
  executionEnabled: boolean
  mock: boolean
  environment: 'development' | 'test' | 'production'
  order: CommerceOrder
  orderVersion: number
  buyerAccountEnabled: boolean
  paymentState: string
  observedAt: string
  jobs: VerificationJob[]
  jobsTruncated: boolean
}
const root = (id: string) => `/system/admin/orders/${encodeURIComponent(id)}/reconcile`
export const fetchVerificationContext = (id: string, signal: AbortSignal) => http<VerificationContext>(root(id), { signal, cache: 'no-store' })
export const fetchVerificationJob = (id: string, task: string, signal: AbortSignal) => http<VerificationJob>(`${root(id)}/jobs/${encodeURIComponent(task)}`, { signal, cache: 'no-store' })
export const fetchVerificationCommand = (id: string, key: string, signal: AbortSignal) => http<VerificationJob>(`${root(id)}/commands/${encodeURIComponent(key)}`, { signal, cache: 'no-store' })
export const requestVerification = (id: string, body: { expectedVersion: number; reason: string }, key: string, signal: AbortSignal) => http<VerificationJob>(root(id), { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key }, signal, cache: 'no-store' })
