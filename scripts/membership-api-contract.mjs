import assert from 'node:assert/strict'
import { fetchMembershipStatus } from '../src/api/membership.ts'
import { ApiError } from '../src/api/http.ts'

const originalFetch = globalThis.fetch
const originalStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => 'membership-contract-token' }
const valid = {
  enabled: true,
  serverTime: '2026-10-13T01:00:00.123456Z',
  grants: [
    {
      id: '9223372036854775807',
      sourceOrderId: '9007199254740993',
      state: 'ACTIVE',
      startsAt: '2026-10-01T00:00:00Z',
      endsAt: '2026-11-01T00:00:00Z',
      plan: {
        code: 'creator',
        version: 'v1',
        name: '创作服务',
        durationSeconds: 2678400,
        backupBytes: '10995116277760',
        renderTasks: '1000000',
      },
      quotas: [
        {
          capability: 'CLOUD_BACKUP_BYTES',
          capacity: '10995116277760',
          reserved: '20',
          used: '30',
          remaining: '10995116277710',
        },
        {
          capability: 'SERVER_RENDER_TASKS',
          capacity: '1000000',
          reserved: '1',
          used: '1',
          remaining: '999998',
        },
      ],
    },
  ],
}
let checks = 0
const respond = (data) => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/system/membership')
    assert.equal(options.cache, 'no-store')
    assert.equal(options.headers.get('Authorization'), 'Bearer membership-contract-token')
    assert.ok(options.signal instanceof AbortSignal)
    return Response.json({ code: 0, data })
  }
}
try {
  for (const state of ['ACTIVE', 'FROZEN', 'REVOKED', 'SCHEDULED', 'EXPIRED']) {
    const data = structuredClone(valid)
    data.grants[0].state = state
    respond(data)
    assert.deepEqual(await fetchMembershipStatus(), data)
    checks++
  }
  for (const enabled of [false, true]) {
    const data = { enabled, serverTime: valid.serverTime, grants: [] }
    respond(data)
    assert.deepEqual(await fetchMembershipStatus(), data)
    checks++
  }
  // Damaged transport must never turn a partial, rounded or duplicated ledger into a usable record.
  const damaged = [
    (v) => {
      v.enabled = false
    },
    (v) => {
      v.serverTime = '2026-02-30T00:00:00Z'
    },
    (v) => {
      v.serverTime = 'Tue Oct 13 2026 01:00:00 GMTZ'
    },
    (v) => {
      v.grants.push(structuredClone(v.grants[0]))
    },
    (v) => {
      v.grants[0].id = 9007199254740993
    },
    (v) => {
      v.grants[0].id = '9223372036854775808'
    },
    (v) => {
      v.grants[0].sourceOrderId = '../orders'
    },
    (v) => {
      v.grants[0].state = ['ACTIVE']
    },
    (v) => {
      v.grants[0].endsAt = v.grants[0].startsAt
    },
    (v) => {
      v.grants[0].plan.backupBytes = '10995116277761'
    },
    (v) => {
      v.grants[0].plan.renderTasks = '1000001'
    },
    (v) => {
      v.grants[0].quotas.pop()
    },
    (v) => {
      v.grants[0].quotas[1] = structuredClone(v.grants[0].quotas[0])
    },
    (v) => {
      v.grants[0].quotas[0].remaining = '10995116277760'
    },
    (v) => {
      v.grants[0].quotas[0].used = -1
    },
    (v) => {
      v.grants[0].quotas[0].reserved = '01'
    },
    (v) => {
      v.grants[0].quotas[0].capability = ['CLOUD_BACKUP_BYTES']
    },
  ]
  for (const change of damaged) {
    const data = structuredClone(valid)
    change(data)
    respond(data)
    await assert.rejects(fetchMembershipStatus(), /会员信息暂不可用/)
    checks++
  }
  for (const status of [401, 503]) {
    globalThis.fetch = async () => Response.json({ code: status, msg: 'unavailable' }, { status })
    await assert.rejects(
      fetchMembershipStatus(),
      (error) => error instanceof ApiError && error.status === status,
    )
    checks++
  }
  globalThis.fetch = (_url, { signal }) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  const controller = new AbortController()
  const pending = fetchMembershipStatus(controller.signal)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  checks++
  console.log(
    `Membership API contract: ${checks} checks passed (controlled transport, no live database).`,
  )
} finally {
  globalThis.fetch = originalFetch
  if (originalStorage) globalThis.localStorage = originalStorage
  else delete globalThis.localStorage
}
