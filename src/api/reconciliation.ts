import { http } from './http'
import type { CommercePage } from './commerce'

export type ReconciliationState = 'READY' | 'RUNNING' | 'DONE' | 'DEAD'
export interface ReconciliationAccess {
  actorId: string
  executionEnabled: boolean
  mock: boolean
  environment: 'development' | 'test' | 'production'
  latestBillDate: string
  earliestBillDate: string
  observedAt: string
}
export interface ReconciliationJob {
  id: string
  billDate: string
  timeZone: string
  generation: number
  source: 'AUTO' | 'MANUAL'
  requestedBy?: string
  state: ReconciliationState
  attempts: number
  lastErrorCode?: string
  createdAt: string
  completedAt?: string
  issueCount?: number
}
export interface ReconciliationSummary {
  statementPaymentCount: number
  statementPaymentCent: number
  statementRefundCount: number
  statementRefundCent: number
  localPaymentCount: number
  localPaymentCent: number
  localRefundCount: number
  localRefundCent: number
  matchedPayments: number
  matchedRefunds: number
}
export interface ReconciliationDetail {
  job: ReconciliationJob
  latestGeneration: number
  reason: string
  statementSha256?: string
  observedAt?: string
  summary?: ReconciliationSummary
  attempts: { attempt: number; result: string; errorCode?: string; startedAt: string; finishedAt?: string }[]
}
export interface ReconciliationIssue {
  id: string
  kind: 'PAYMENT' | 'REFUND'
  orderId?: string
  paymentId?: string
  refundId?: string
  localAmountCent?: number
  statementAmountCent?: number
  differences: string[]
}
export interface ReconciliationRun { expectedGeneration: number; reason: string }
const root = '/system/admin/reconciliations'
export function fetchReconciliationAccess(signal?: AbortSignal) {
  return http<ReconciliationAccess>(`${root}/access`, { signal, cache: 'no-store' })
}
export function fetchReconciliationJobs(billDate?: string, state?: string, cursor?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: '20' })
  if (billDate) params.set('billDate', billDate)
  if (state) params.set('state', state)
  if (cursor) params.set('cursor', cursor)
  return http<CommercePage<ReconciliationJob>>(`${root}?${params}`, { signal, cache: 'no-store' })
}
export function fetchReconciliationDetail(id: string, signal?: AbortSignal) {
  return http<ReconciliationDetail>(`${root}/${encodeURIComponent(id)}`, { signal, cache: 'no-store' })
}
export function fetchReconciliationIssues(id: string, cursor?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ limit: '20' })
  if (cursor) params.set('cursor', cursor)
  return http<CommercePage<ReconciliationIssue>>(`${root}/${encodeURIComponent(id)}/issues?${params}`, { signal, cache: 'no-store' })
}
export function fetchReconciliationCommand(date: string, key: string, signal: AbortSignal) {
  return http<ReconciliationDetail>(`${root}/commands/${encodeURIComponent(date)}/${encodeURIComponent(key)}`, { signal, cache: 'no-store' })
}
export function runReconciliation(date: string, body: ReconciliationRun, key: string, signal: AbortSignal) {
  return http<ReconciliationDetail>(`${root}/${encodeURIComponent(date)}/runs`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': key }, signal, cache: 'no-store',
  })
}
