import { http } from './http.ts'

export type MembershipState = 'ACTIVE' | 'FROZEN' | 'REVOKED' | 'SCHEDULED' | 'EXPIRED'
export type MembershipCapability = 'CLOUD_BACKUP_BYTES' | 'SERVER_RENDER_TASKS'
export interface MembershipQuota {
  capability: MembershipCapability
  capacity: string
  reserved: string
  used: string
  remaining: string
}
export interface MembershipGrant {
  id: string
  sourceOrderId: string
  state: MembershipState
  startsAt: string
  endsAt: string
  plan: {
    code: string
    version: string
    name: string
    durationSeconds: number
    backupBytes: string
    renderTasks: string
  }
  quotas: MembershipQuota[]
}
export interface MembershipStatus {
  enabled: boolean
  serverTime: string
  grants: MembershipGrant[]
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function quantity(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,13})$/.test(value)
}
function id(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  )
}
function instant(value: unknown): value is string {
  // The backend emits UTC instants. Date.parse alone accepts normalized invalid dates.
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  )
    return false
  const parsed = Date.parse(value)
  return (
    Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19)
  )
}
function grant(value: unknown): value is MembershipGrant {
  if (
    !object(value) ||
    !id(value.id) ||
    !id(value.sourceOrderId) ||
    typeof value.state !== 'string' ||
    !['ACTIVE', 'FROZEN', 'REVOKED', 'SCHEDULED', 'EXPIRED'].includes(value.state) ||
    !instant(value.startsAt) ||
    !instant(value.endsAt) ||
    Date.parse(value.endsAt) <= Date.parse(value.startsAt) ||
    !object(value.plan) ||
    !Array.isArray(value.quotas) ||
    value.quotas.length > 2
  )
    return false
  const plan = value.plan
  if (
    typeof plan.code !== 'string' ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(plan.code) ||
    typeof plan.version !== 'string' ||
    !/^[A-Za-z0-9._-]{1,32}$/.test(plan.version) ||
    typeof plan.name !== 'string' ||
    !plan.name.trim() ||
    plan.name.length > 120 ||
    typeof plan.durationSeconds !== 'number' ||
    !Number.isInteger(plan.durationSeconds) ||
    plan.durationSeconds < 60 ||
    plan.durationSeconds > 31622400 ||
    !quantity(plan.backupBytes) ||
    BigInt(plan.backupBytes) > 10995116277760n ||
    !quantity(plan.renderTasks) ||
    BigInt(plan.renderTasks) > 1000000n ||
    BigInt(plan.backupBytes) + BigInt(plan.renderTasks) < 1n
  )
    return false
  const seen = new Set<string>()
  for (const quota of value.quotas) {
    if (
      !object(quota) ||
      typeof quota.capability !== 'string' ||
      !['CLOUD_BACKUP_BYTES', 'SERVER_RENDER_TASKS'].includes(quota.capability) ||
      !quantity(quota.capacity) ||
      !quantity(quota.reserved) ||
      !quantity(quota.used) ||
      !quantity(quota.remaining)
    )
      return false
    const capability = quota.capability
    if (seen.has(capability)) return false
    seen.add(capability)
    const capacity = BigInt(quota.capacity)
    if (
      capacity < 1n ||
      capacity !==
        BigInt(capability === 'CLOUD_BACKUP_BYTES' ? plan.backupBytes : plan.renderTasks) ||
      capacity !== BigInt(quota.reserved) + BigInt(quota.used) + BigInt(quota.remaining)
    )
      return false
  }
  return seen.size === Number(BigInt(plan.backupBytes) > 0n) + Number(BigInt(plan.renderTasks) > 0n)
}

export async function fetchMembershipStatus(signal?: AbortSignal): Promise<MembershipStatus> {
  const value = await http<unknown>('/system/membership', { signal, cache: 'no-store' })
  if (
    !object(value) ||
    typeof value.enabled !== 'boolean' ||
    !instant(value.serverTime) ||
    !Array.isArray(value.grants) ||
    value.grants.length > 50 ||
    !value.grants.every(grant) ||
    (!value.enabled && value.grants.length > 0) ||
    new Set(value.grants.map((entry) => entry.id)).size !== value.grants.length
  ) {
    throw new Error('会员信息暂不可用，请稍后重新读取。')
  }
  return value as unknown as MembershipStatus
}
