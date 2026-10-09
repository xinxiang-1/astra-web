import assert from 'node:assert/strict'
import { createServer } from 'vite'

const originals = Object.fromEntries(['fetch', 'localStorage', 'sessionStorage'].map((key) => [key, globalThis[key]]))
const values = new Map(), calls = [], order = '9007199254740993', actor = '122'
let token = 'first-admin-token', lose = false, rejection = null, switchToken = false, passed = 0
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
globalThis.localStorage = { getItem: () => token }; globalThis.sessionStorage = storage
const now = '2026-10-09T00:00:00Z'
const original = { taskId: '9007199254740994', orderId: order, paymentId: '9007199254740995', requestedBy: actor, expectedVersion: 1, reason: '核查原支付并保留查询记录', state: 'READY', attempts: 0, factApplied: false, nextRunAt: now, createdAt: now, updatedAt: now }
let result = original
const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, watch: null } })
try {
  const lib = await server.ssrLoadModule('/src/lib/admin-payment-verification.ts')
  const { accountReturnPath } = await server.ssrLoadModule('/src/lib/account-return.ts')
  globalThis.fetch = async (url, options) => {
    assert.equal(options.cache, 'no-store')
    const key = options.headers.get('Idempotency-Key'), body = options.method === 'POST' ? JSON.parse(options.body) : null
    if (body) {
      assert.deepEqual(Object.keys(body), ['expectedVersion', 'reason']); assert.equal(url, `/api/system/admin/orders/${order}/reconcile`)
      assert.ok([...values.values()].some((raw) => JSON.parse(raw).key === key)); calls.push({ key, body })
      if (lose) { lose = false; throw new TypeError('Accepted response lost') }
    } else assert.match(url, new RegExp(`^/api/system/admin/orders/${order}/reconcile/commands/[a-f0-9-]+$`))
    if (switchToken) token = 'changed-account-token'
    if (rejection) return Response.json({ code: rejection.code, msg: 'Owned rejection' }, { status: rejection.status })
    return Response.json({ code: 0, data: result })
  }
  const signal = () => new AbortController().signal
  const submit = (text = original.reason, suppliedActor = actor, suppliedToken = token, version = 1, id = order) => lib.submitVerification(id, version, text, suppliedActor, suppliedToken, signal())
  lose = true; await assert.rejects(submit()); const pending = lib.pendingVerification(actor, token, signal()); assert.equal(pending.orderId, order)
  await submit(` ${original.reason} `); assert.deepEqual(calls[0], calls[1]); assert.equal(values.size, 0); passed++
  lose = true; await assert.rejects(submit()); const count = calls.length
  for (const args of [['不同说明不能覆盖原操作'], [undefined, actor, token, 2], [undefined, actor, token, 1, '2']]) await assert.rejects(submit(...args), /待确认操作/)
  assert.equal(calls.length, count); passed++
  const saved = [...values.values()][0]; assert.ok(!saved.includes(token) && !saved.includes(original.reason)); assert.deepEqual(Object.keys(JSON.parse(saved)).sort(), ['bodyHash', 'expectedVersion', 'key', 'orderId']); passed++
  token = 'renewed-same-admin-token'; await lib.recoverVerification(actor, token, signal()); assert.equal(calls.length, count); assert.equal(values.size, 0); passed++
  lose = true; await assert.rejects(submit()); assert.equal(lib.pendingVerification('125', token, signal()), null); await assert.rejects(lib.recoverVerification('125', token, signal()), /没有待确认/); passed++
  rejection = { status: 404, code: 404 }; await assert.rejects(lib.recoverVerification(actor, token, signal())); assert.equal(values.size, 1); assert.equal(calls.length, count + 1); rejection = null; await lib.recoverVerification(actor, token, signal()); passed++
  const before = calls.length, aborted = new AbortController(); aborted.abort()
  await assert.rejects(lib.submitVerification(order, 1, original.reason, actor, token, aborted.signal), (e) => e.name === 'AbortError')
  await assert.rejects(submit(undefined, actor, 'old-token'), (e) => e.name === 'AbortError'); assert.equal(calls.length, before)
  switchToken = true; await assert.rejects(submit(), (e) => e.name === 'AbortError'); switchToken = false; values.clear(); passed++
  globalThis.sessionStorage = { ...storage, setItem: () => { throw new Error('blocked') } }; const stopped = calls.length
  await assert.rejects(submit(), /尚未发送/); assert.equal(calls.length, stopped); globalThis.sessionStorage = storage
  values.set('astra.payment-verification-command.122', 'corrupt'); await assert.rejects(submit(), /无法确认原操作/); assert.equal(calls.length, stopped); values.clear(); passed++
  rejection = { status: 409, code: 43008 }; await assert.rejects(submit()); assert.equal(values.size, 0); passed++
  for (const code of [503, 43001]) { rejection = { status: code === 503 ? 503 : 409, code }; await assert.rejects(submit()); assert.equal(values.size, 1); rejection = null; await lib.recoverVerification(actor, token, signal()) } passed++
  for (const change of [{ requestedBy: '125' }, { orderId: '2' }, { expectedVersion: 2 }, { reason: '另一个原操作不同说明' }]) {
    lose = true; await assert.rejects(submit()); result = { ...original, ...change }; await assert.rejects(lib.recoverVerification(actor, token, signal())); assert.equal(values.size, 1); result = original; await lib.recoverVerification(actor, token, signal())
  } passed++
  const pendingResult = { ...original, state: 'DONE', attempts: 1, observation: 'PENDING', lastObservedAt: now }
  lib.validateVerificationJob(pendingResult, order); assert.equal(pendingResult.factApplied, false)
  for (const bad of [{ ...pendingResult, factApplied: true }, { ...original, taskId: 9007199254740993 }, { ...original, attempts: 10 }, { ...original, lastErrorCode: 'raw exception' }]) assert.throws(() => lib.validateVerificationJob(bad)); passed++
  const context = { actorId: actor, executionEnabled: true, mock: true, environment: 'test', order: { id: order, orderNo: 'ASO1', state: 'PENDING_PAYMENT', fulfillmentState: 'NONE', totalAmountCent: 3900, totalRefundedCent: 0, currency: 'CNY', paymentId: original.paymentId, createdAt: now, expiresAt: now, item: { productName: '测试商品', releaseVersion: '1.0.0' } }, orderVersion: 1, buyerAccountEnabled: true, paymentState: 'PENDING', observedAt: now, jobs: [original], jobsTruncated: false }
  lib.validateVerificationContext(context, order)
  for (const bad of [{ ...context, mock: false }, { ...context, environment: 'production' }, { ...context, orderVersion: 0 }, { ...context, order: { ...context.order, id: '2' } }, { ...context, jobs: [original, original] }]) assert.throws(() => lib.validateVerificationContext(bad, order)); passed++
  assert.equal(lib.verificationReason('  真实签名🖋核查说明  '), '真实签名🖋核查说明'); assert.throws(() => lib.verificationReason('核查说明\ud800文本')); assert.throws(() => lib.verificationReason('太短')); passed++
  const returnPath = `/admin/orders/${order}/verification`; assert.equal(accountReturnPath(returnPath), returnPath)
  for (const bad of [`${returnPath}?admin=true`, `${returnPath}#x`, '/admin/orders/0/verification', '/admin/orders/9223372036854775808/verification', '//evil.example/admin/orders/1/verification', '/admin/orders/%31/verification']) assert.equal(accountReturnPath(bad), '/'); passed++
  const concurrentStart = calls.length; await Promise.all([submit(), submit()]); assert.equal(calls.length, concurrentStart + 2); assert.deepEqual(calls[concurrentStart], calls[concurrentStart + 1]); assert.equal(values.size, 0); passed++
  values.clear(); globalThis.sessionStorage = { ...storage, getItem: () => { throw new Error('blocked read') } }
  assert.throws(() => lib.pendingVerification(actor, token, signal()), /无法确认原操作/); passed++
} finally {
  await server.close()
  for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value }
}
console.log(`Payment verification command: ${passed} identity/recovery/storage/financial-binding cases passed.`)
