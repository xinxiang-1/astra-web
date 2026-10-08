import assert from 'node:assert/strict'
import { createServer } from 'vite'

const originals = Object.fromEntries(['fetch', 'localStorage', 'sessionStorage'].map((k) => [k, globalThis[k]]))
const values = new Map(), calls = []
let token = 'refund-contract-owner', lost = false, changeOwner = false
globalThis.localStorage = { getItem: () => token }
globalThis.sessionStorage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) }
const order = { id: '9007199254740993', paymentId: '9007199254740995', state: 'PAID', totalAmountCent: 3900, totalRefundedCent: 0, currency: 'CNY' }
const refund = { id: '9007199254740997', orderId: order.id, paymentId: order.paymentId, amountCent: 3900, currency: 'CNY', state: 'REQUESTED', reason: '文件无法恢复希望核查退款', version: 1, createdAt: '2030-01-01T00:00:00Z', updatedAt: '2030-01-01T00:00:00Z' }
let response = refund
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null } })
let passed = 0
try {
  const { submitRefundRequest, normalizeRefundReason, refundForOrder } = await server.ssrLoadModule('/src/lib/refund-request.ts')
  const submit = (text = refund.reason) => submitRefundRequest(order, text, token, new AbortController().signal)
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `/api/system/orders/${order.id}/refund-requests`)
    assert.equal(options.method, 'POST'); assert.deepEqual(JSON.parse(options.body), { reason: refund.reason })
    const key = options.headers.get('Idempotency-Key')
    assert.ok([...values.values()].some((v) => JSON.parse(v).key === key), 'Save original command before transport')
    calls.push(key)
    if (lost) { lost = false; throw new TypeError('Accepted result lost') }
    if (changeOwner) token = 'new-contract-owner'
    return Response.json({ code: 0, data: response })
  }
  lost = true; await assert.rejects(submit()); await submit(`  ${refund.reason}  `)
  assert.equal(calls[0], calls[1]); passed++
  assert.ok(!JSON.stringify([...values]).includes(token) && !JSON.stringify([...values]).includes(refund.reason))
  assert.match(JSON.parse([...values.values()][0]).reasonHash, /^[a-f0-9]{64}$/); passed++
  const before = calls.length; await assert.rejects(submit('修改原原因不能换键重发'), /待确认请求/); assert.equal(calls.length, before); passed++
  for (const text of ['短', '字'.repeat(501), '有效原因\u0000不能提交']) assert.throws(() => normalizeRefundReason(text))
  assert.equal(Array.from(normalizeRefundReason('😀'.repeat(500))).length, 500); passed++
  const stopped = new AbortController(); stopped.abort()
  await assert.rejects(submitRefundRequest(order, refund.reason, token, stopped.signal), (e) => e.name === 'AbortError')
  await assert.rejects(submitRefundRequest(order, refund.reason, 'stale-owner', new AbortController().signal), (e) => e.name === 'AbortError')
  assert.equal(calls.length, before); passed++
  changeOwner = true; await assert.rejects(submit(), (e) => e.name === 'AbortError'); changeOwner = false; passed++
  const store = globalThis.sessionStorage, count = calls.length
  globalThis.sessionStorage = { getItem: () => null, setItem: () => { throw new Error('Unavailable') } }
  await assert.rejects(submit(), /无法确认原退款请求标识/); assert.equal(calls.length, count); globalThis.sessionStorage = store; passed++
  values.clear(); await submit(); values.set([...values.keys()][0], 'corrupt'); const corruptCount = calls.length
  await assert.rejects(submit(), /无法确认原退款请求标识/); assert.equal(calls.length, corruptCount); values.clear(); passed++
  for (const wrong of [{ ...refund, orderId: '1' }, { ...refund, paymentId: '1' }, { ...refund, id: 2 }, { ...refund, amountCent: 1 }, { ...refund, currency: 'USD' }, { ...refund, version: 0 }, { ...refund, state: 'PAID' }]) {
    assert.throws(() => refundForOrder(wrong, order)); response = wrong; await assert.rejects(submit())
  }
  response = refund; passed++
  for (const wrong of [{ ...order, state: 'CLOSED' }, { ...order, totalRefundedCent: 3900 }, { ...order, refund: { id: refund.id } }]) await assert.rejects(submitRefundRequest(wrong, refund.reason, token, new AbortController().signal))
  passed++
  console.log(`Refund request: ${passed} replay/privacy/identity/binding cases passed.`)
} finally {
  await server.close()
  for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value }
}
