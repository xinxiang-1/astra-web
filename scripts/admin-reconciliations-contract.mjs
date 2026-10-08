import assert from 'node:assert/strict'
import { createServer } from 'vite'

const originals = Object.fromEntries(['fetch', 'localStorage', 'sessionStorage'].map((key) => [key, globalThis[key]]))
let token = 'first-admin-token', lose = false, switchToken = false, rejected = null
const values = new Map(), calls = [], date = '2026-10-07', actor = '122'
globalThis.localStorage = { getItem: () => token }
globalThis.sessionStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
let result = { job: { id: '9007199254740993', billDate: date, timeZone: 'Asia/Shanghai', generation: 1, source: 'MANUAL', requestedBy: actor, state: 'READY', attempts: 0, createdAt: '2026-10-08T16:00:00Z' }, latestGeneration: 1, reason: '核对原账单并保留报告', attempts: [] }
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null } })
let passed = 0
try {
  const lib = await server.ssrLoadModule('/src/lib/admin-reconciliations.ts')
  const { accountReturnPath } = await server.ssrLoadModule('/src/lib/account-return.ts')
  globalThis.fetch = async (url, options) => {
    assert.equal(options.cache, 'no-store')
    const key = options.headers.get('Idempotency-Key')
    if (options.method === 'POST') {
      const body = JSON.parse(options.body)
      assert.deepEqual(Object.keys(body), ['expectedGeneration', 'reason'])
      assert.equal(url, `/api/system/admin/reconciliations/${date}/runs`)
      assert.ok([...values.values()].some((raw) => JSON.parse(raw).key === key))
      calls.push({ key, body })
      if (lose) { lose = false; throw new TypeError('Accepted response lost') }
      if (rejected) return Response.json({ code: rejected.code, msg: 'Owned rejection' }, { status: rejected.status })
    } else assert.match(url, /^\/api\/system\/admin\/reconciliations\/commands\/2026-10-07\/[a-f0-9-]+$/)
    if (switchToken) token = 'switched-token'
    return Response.json({ code: 0, data: result })
  }
  const submit = (text = result.reason, suppliedActor = actor, suppliedToken = token, signal = new AbortController().signal) => lib.submitReconciliation(date, 0, text, suppliedActor, suppliedToken, signal)
  lose = true; await assert.rejects(submit()); const pending = await lib.pendingReconciliation(actor, token, new AbortController().signal)
  assert.equal(pending.billDate, date); await submit(`  ${result.reason}  `); assert.deepEqual(calls[0], calls[1]); assert.equal(values.size, 0); passed++
  lose = true; await assert.rejects(submit()); const count = calls.length
  await assert.rejects(submit('不同说明不得替换未知结果'), /待确认操作/); assert.equal(calls.length, count); passed++
  const stored = JSON.stringify([...values]); assert.ok(!stored.includes(token) && !stored.includes('核对'))
  assert.deepEqual(Object.keys(JSON.parse([...values.values()][0])).sort(), ['billDate', 'bodyHash', 'expectedGeneration', 'key']); passed++
  token = 'renewed-same-admin-token'; const recovered = await lib.recoverReconciliation(actor, token, new AbortController().signal)
  assert.equal(recovered.job.id, result.job.id); assert.equal(calls.length, count); assert.equal(values.size, 0); passed++
  lose = true; await assert.rejects(submit()); assert.equal(await lib.pendingReconciliation('125', token, new AbortController().signal), null)
  await assert.rejects(lib.recoverReconciliation('125', token, new AbortController().signal), /没有待确认/); passed++
  const before = calls.length, signal = new AbortController(); signal.abort()
  await assert.rejects(submit(undefined, actor, token, signal.signal), (error) => error.name === 'AbortError')
  await assert.rejects(submit(undefined, actor, 'old-token'), (error) => error.name === 'AbortError'); assert.equal(calls.length, before)
  switchToken = true; await assert.rejects(submit(), (error) => error.name === 'AbortError'); switchToken = false; passed++
  values.clear(); const storage = globalThis.sessionStorage
  globalThis.sessionStorage = { ...storage, setItem: () => { throw new Error('blocked') } }
  const stoppedAt = calls.length; await assert.rejects(submit(), /尚未发送/); assert.equal(calls.length, stoppedAt); globalThis.sessionStorage = storage
  values.set('astra.reconcile-command.122', 'corrupt'); await assert.rejects(submit(), /无法确认原操作/); assert.equal(calls.length, stoppedAt); values.clear(); passed++
  rejected = { status: 409, code: 43008 }; await assert.rejects(submit()); assert.equal(values.size, 0)
  rejected = { status: 503, code: 503 }; await assert.rejects(submit()); assert.equal(values.size, 1); rejected = null; await lib.recoverReconciliation(actor, token, new AbortController().signal); passed++
  const saved = result; lose = true; await assert.rejects(submit()); result = { ...saved, job: { ...saved.job, requestedBy: '125' } }
  await assert.rejects(lib.recoverReconciliation(actor, token, new AbortController().signal), /不一致/); assert.equal(values.size, 1); result = saved; await lib.recoverReconciliation(actor, token, new AbortController().signal); passed++
  for (const bad of ['2026-02-30', '2026-1-01', 'bad', '2026-10-07T00:00:00Z']) assert.equal(lib.isBillDate(bad), false)
  assert.equal(lib.isBillDate('2024-02-29'), true)
  const access = { actorId: actor, executionEnabled: true, mock: true, environment: 'test', latestBillDate: date, earliestBillDate: '2024-10-09', observedAt: '2026-10-09T00:00:00Z' }
  assert.equal(lib.validateReconciliationAccess(access), access)
  for (const bad of [{ ...access, environment: 'production' }, { ...access, mock: false }, { ...access, actorId: 122 }]) assert.throws(() => lib.validateReconciliationAccess(bad)); passed++
  for (const bad of [{ ...result, job: { ...result.job, id: 9007199254740993 } }, { ...result, latestGeneration: 0 }, { ...result, job: { ...result.job, issueCount: 1 } }]) assert.throws(() => lib.validateReconciliationDetail(bad))
  const complete = { ...result, job: { ...result.job, state: 'DONE', completedAt: '2026-10-09T00:00:00Z', issueCount: 0 }, statementSha256: 'a'.repeat(64), observedAt: '2026-10-09T00:00:00Z', summary: Object.fromEntries(['statementPaymentCount', 'statementPaymentCent', 'statementRefundCount', 'statementRefundCent', 'localPaymentCount', 'localPaymentCent', 'localRefundCount', 'localRefundCent', 'matchedPayments', 'matchedRefunds'].map((k) => [k, 0])) }
  lib.validateReconciliationDetail(complete)
  assert.throws(() => lib.validateReconciliationDetail({ ...complete, summary: { ...complete.summary, statementPaymentCent: '0' } })); passed++
  lib.validateReconciliationIssue({ id: '9007199254740993', kind: 'PAYMENT', differences: ['STATEMENT_ONLY'], statementAmountCent: 3900 })
  for (const differences of [[], ['fake'], ['STATEMENT_ONLY', 'STATEMENT_ONLY']]) assert.throws(() => lib.validateReconciliationIssue({ id: '1', kind: 'PAYMENT', differences }))
  assert.throws(() => lib.validateReconciliationPage({ items: [], nextCursor: 'bad cursor' }, lib.validateReconciliationIssue)); passed++
  assert.equal(accountReturnPath('/admin/reconciliations'), '/admin/reconciliations')
  for (const bad of ['/admin/reconciliations?admin=true', '/admin/reconciliations/1', '//example.com/admin/reconciliations', '/admin/%72econciliations']) assert.equal(accountReturnPath(bad), '/')
  passed++
  console.log(`Reconciliation command: ${passed} identity/renewal/recovery/storage/validation cases passed.`)
} finally {
  await server.close()
  for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value }
}
