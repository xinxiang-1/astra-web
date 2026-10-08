import assert from 'node:assert/strict'
import { createServer } from 'vite'

const originals = Object.fromEntries(['fetch', 'localStorage', 'sessionStorage'].map((k) => [k, globalThis[k]]))
const values = new Map(), calls = []
let token = 'initiation-contract-owner', lost = false, changeOwner = false
globalThis.localStorage = { getItem: () => token }
globalThis.sessionStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
const order = { id: '9007199254740993', state: 'PENDING_PAYMENT', totalAmountCent: 3900, currency: 'CNY' }
const flags = { mockPaymentInitiationEnabled: true, paymentEnabled: false, environment: 'test', paymentChannel: 'wechat_native' }
const payment = { id: '9007199254740995', orderId: order.id, state: 'INIT', amountCent: 3900, currency: 'CNY', channel: 'wechat_native', mock: true, expiresAt: '2030-01-01T00:00:00Z', qrCodeUrl: 'PRIVATE_CHECKOUT_SENTINEL' }
let response = payment
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null } })
let passed = 0
try {
  const { initiateMockPayment, canInitiateMockPayment } = await server.ssrLoadModule('/src/lib/payment-initiation.ts')
  const { recoverExistingPayment } = await server.ssrLoadModule('/src/lib/payment-recovery.ts')
  const initiate = () => initiateMockPayment(order, flags, token, new AbortController().signal)
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `/api/system/orders/${order.id}/payments`)
    assert.equal(options.method, 'POST')
    assert.deepEqual(JSON.parse(options.body), { channel: 'wechat_native' })
    const key = options.headers.get('Idempotency-Key')
    assert.match(key, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    assert.ok([...values.values()].includes(key), 'Original key saved before transport')
    calls.push(key)
    if (lost) { lost = false; throw new TypeError('Accepted response lost') }
    if (changeOwner) token = 'different-owner'
    return Response.json({ code: 0, data: response })
  }
  lost = true
  await assert.rejects(initiate())
  const result = await initiate()
  assert.equal(calls[0], calls[1])
  assert.equal(result.id, payment.id)
  assert.equal(result.qrCodeUrl, undefined)
  passed++
  await recoverExistingPayment({ ...order, paymentId: payment.id }, payment, token, new AbortController().signal)
  assert.equal(calls[2], calls[0], 'First-payment response loss and existing recovery share exact command')
  assert.ok(!JSON.stringify([...values]).includes(token) && !JSON.stringify([...values]).includes('PRIVATE_CHECKOUT_SENTINEL'))
  passed++
  for (const [o, f] of [
    [order, null], [order, { ...flags, mockPaymentInitiationEnabled: false }],
    [order, { ...flags, environment: 'production' }], [order, { ...flags, paymentChannel: 'alipay' }],
    [{ ...order, paymentId: payment.id }, flags], [{ ...order, state: 'CLOSED' }, flags],
    [{ ...order, state: 'PAID' }, flags], [{ ...order, id: Number(order.id) }, flags],
    [{ ...order, totalAmountCent: 0 }, flags], [{ ...order, currency: 'USD' }, flags],
  ]) {
    assert.equal(canInitiateMockPayment(o, f), false)
    await assert.rejects(initiateMockPayment(o, f, token, new AbortController().signal))
  }
  assert.equal(calls.length, 3)
  passed++
  await assert.rejects(initiateMockPayment(order, flags, 'stale-owner', new AbortController().signal), (e) => e.name === 'AbortError')
  const stopped = new AbortController(); stopped.abort()
  await assert.rejects(initiateMockPayment(order, flags, token, stopped.signal), (e) => e.name === 'AbortError')
  assert.equal(calls.length, 3)
  passed++
  changeOwner = true
  await assert.rejects(initiate(), (e) => e.name === 'AbortError')
  changeOwner = false
  passed++
  const before = calls.length, store = globalThis.sessionStorage
  globalThis.sessionStorage = { getItem: () => null, setItem: () => { throw new Error('Denied') } }
  await assert.rejects(initiate(), /无法确认原付款请求标识/)
  assert.equal(calls.length, before)
  globalThis.sessionStorage = store
  passed++
  values.clear(); lost = true
  await assert.rejects(initiate())
  values.set([...values.keys()][0], 'corrupt-command')
  const corruptBefore = calls.length
  await assert.rejects(initiate(), /无法确认原付款请求标识/)
  assert.equal(calls.length, corruptBefore)
  passed++
  values.clear()
  for (const wrong of [
    { ...payment, id: 9007199254740995 }, { ...payment, orderId: '1' },
    { ...payment, amountCent: 1 }, { ...payment, currency: 'USD' },
    { ...payment, state: 'PAID' }, { ...payment, mock: false },
  ]) { response = wrong; await assert.rejects(initiate()) }
  response = payment
  passed++
  const firstOwnerKey = calls.at(-1)
  token = 'new-test-owner'
  await initiate()
  assert.notEqual(calls.at(-1), firstOwnerKey)
  passed++
  console.log(`Payment initiation: ${passed} capability, persisted replay, shared recovery, binding, identity and storage boundary cases passed.`)
} finally {
  await server.close()
  for (const [key, value] of Object.entries(originals)) {
    if (value === undefined) delete globalThis[key]
    else globalThis[key] = value
  }
}
