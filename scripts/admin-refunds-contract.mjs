import assert from 'node:assert/strict'
import { createServer } from 'vite'

const originals = Object.fromEntries(['fetch', 'localStorage', 'sessionStorage'].map((key) => [key, globalThis[key]]))
let token = 'admin-contract-owner', lose = false, switchIdentity = false
const values = new Map(), calls = []
globalThis.localStorage = { getItem: () => token }
globalThis.sessionStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
const order = { id: '9007199254740993', paymentId: '9007199254740995', state: 'PAID', totalAmountCent: 3900, totalRefundedCent: 0, currency: 'CNY', refund: { id: '9007199254740997', state: 'REQUESTED', amountCent: 3900 } }
const refund = { id: order.refund.id, orderId: order.id, paymentId: order.paymentId, amountCent: 3900, currency: 'CNY', state: 'REQUESTED', reason: '文件无法恢复需核查退款', version: 1, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z' }
const context = { order, refund, paymentFactsConsistent: true, buyerAccountEnabled: true, observedAt: refund.createdAt, deliveryStarts: [], audits: [], tasks: [], deliveryStartsTruncated: false, auditsTruncated: false }
let response = { ...refund, state: 'APPROVED', version: 2 }
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null } })
let passed = 0
try {
  const { submitRefundDecision, validateRefundContext, availableRefundDecisions } = await server.ssrLoadModule('/src/lib/admin-refunds.ts')
  const { accountReturnPath } = await server.ssrLoadModule('/src/lib/account-return.ts')
  const submit = (text = '已核对原订单与质量诉求', decision = 'APPROVE', ctx = context, supplied = token, signal = new AbortController().signal) => submitRefundDecision(ctx, decision, text, supplied, signal)
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `/api/system/admin/refunds/${refund.id}/decisions`)
    assert.equal(options.method, 'POST'); assert.equal(options.cache, 'no-store')
    const body = JSON.parse(options.body), key = options.headers.get('Idempotency-Key')
    assert.deepEqual(Object.keys(body).sort(), ['decision', 'expectedVersion', 'reason'])
    assert.ok([...values.values()].some((value) => JSON.parse(value).key === key))
    calls.push({ key, body })
    if (lose) { lose = false; throw new TypeError('Accepted response lost') }
    if (switchIdentity) token = 'new-admin'
    return Response.json({ code: 0, data: response })
  }
  lose = true; await assert.rejects(submit()); await submit('  已核对原订单与质量诉求  ')
  assert.deepEqual(calls[0], calls[1]); passed++
  const before = calls.length
  await assert.rejects(submit('更换审核说明不能换键重试'), /待确认审核/)
  await assert.rejects(submit('已核对原订单与质量诉求', 'REJECT'), /待确认审核/)
  assert.equal(calls.length, before); passed++
  assert.ok(!JSON.stringify([...values]).includes(token) && !JSON.stringify([...values]).includes('核对'))
  assert.match(JSON.parse([...values.values()][0]).bodyHash, /^[a-f0-9]{64}$/); passed++
  for (const state of ['APPROVED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REVIEW']) {
    const ctx = { ...context, refund: { ...refund, state }, order: { ...order, refund: { ...order.refund, state } } }
    assert.deepEqual(availableRefundDecisions(ctx), []); await assert.rejects(submit(undefined, 'APPROVE', ctx))
  }
  const rejected = { ...context, refund: { ...refund, state: 'REJECTED', version: 2 }, order: { ...order, refund: { ...order.refund, state: 'REJECTED' } } }
  assert.deepEqual(availableRefundDecisions(rejected), ['REOPEN']); assert.deepEqual(availableRefundDecisions(context), ['APPROVE', 'REJECT']); passed++
  assert.deepEqual(availableRefundDecisions({ ...context, paymentFactsConsistent: false }), [])
  await assert.rejects(submit(undefined, 'APPROVE', { ...context, paymentFactsConsistent: false })); passed++
  for (const wrong of [{ ...context, order: { ...order, paymentId: '1' } }, { ...context, refund: { ...refund, id: '1' } }, { ...context, refund: { ...refund, amountCent: 1 } }, { ...context, refund: { ...refund, version: 0 } }, { ...context, order: { ...order, refund: null } }, { ...context, buyerAccountEnabled: 'yes' }, { ...context, observedAt: 'bad-date' }]) assert.throws(() => validateRefundContext(wrong))
  passed++
  const stopped = new AbortController(); stopped.abort()
  await assert.rejects(submit(undefined, undefined, context, token, stopped.signal), (error) => error.name === 'AbortError')
  await assert.rejects(submit(undefined, undefined, context, 'stale-admin'), (error) => error.name === 'AbortError')
  assert.equal(calls.length, before); switchIdentity = true; await assert.rejects(submit(), (error) => error.name === 'AbortError'); switchIdentity = false; passed++
  const store = globalThis.sessionStorage, n = calls.length
  globalThis.sessionStorage = { getItem: () => null, setItem: () => { throw new Error('Unavailable') } }
  await assert.rejects(submit(), /无法确认原审核标识/); assert.equal(calls.length, n); globalThis.sessionStorage = store
  values.clear(); await submit(); values.set([...values.keys()][0], 'corrupt'); const count = calls.length
  await assert.rejects(submit(), /无法确认原审核标识/); assert.equal(calls.length, count); values.clear(); passed++
  response = { ...refund, state: 'REQUESTED', version: 3 }; await submit('补充材料后重新受理', 'REOPEN', rejected)
  assert.equal(calls.at(-1).body.expectedVersion, 2); assert.notEqual(calls.at(-1).key, calls[0].key); passed++
  response = { ...refund, version: 0 }; values.clear(); await assert.rejects(submit()); passed++
  assert.equal(accountReturnPath('/admin/refunds'), '/admin/refunds')
  for (const bad of ['/admin/refunds?role=admin', '/admin/refunds/1', '//example.com/admin/refunds', '/admin/%72efunds', '/admin/refunds#approve']) assert.equal(accountReturnPath(bad), '/')
  passed++
  console.log(`Admin refund decision: ${passed} replay/privacy/role/version/identity/return cases passed.`)
} finally {
  await server.close()
  for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value }
}
