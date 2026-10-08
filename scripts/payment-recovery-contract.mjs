import assert from 'node:assert/strict'
import { createServer } from 'vite'

const original = {
  fetch: globalThis.fetch,
  localStorage: globalThis.localStorage,
  sessionStorage: globalThis.sessionStorage,
}
let token = 'contract-owner-token',
  calls = [],
  lost = false,
  changeOwner = false
const values = new Map()
globalThis.localStorage = { getItem: () => token }
globalThis.sessionStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
}
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null },
})
const order = {
  id: '9007199254740993',
  paymentId: '9007199254740995',
  state: 'PENDING_PAYMENT',
  totalAmountCent: 3900,
  currency: 'CNY',
}
const payment = {
  id: order.paymentId,
  orderId: order.id,
  state: 'UNKNOWN',
  channel: 'wechat_native',
  amountCent: 3900,
  currency: 'CNY',
  expiresAt: '2020-01-01T00:00:00Z',
  mock: true,
  qrCodeUrl: 'astra-mock://checkout/PRIVATE_CHECKOUT_SENTINEL',
}
let passed = 0
try {
  const { recoverExistingPayment, paymentForOrder } = await server.ssrLoadModule(
    '/src/lib/payment-recovery.ts',
  )
  const { accountReturnPath, isCommerceId } = await server.ssrLoadModule(
    '/src/lib/account-return.ts',
  )
  globalThis.fetch = async (url, options) => {
    assert.equal(url, `/api/system/orders/${order.id}/payments`)
    assert.equal(options.method, 'POST')
    assert.deepEqual(JSON.parse(options.body), { channel: 'wechat_native' })
    const key = options.headers.get('Idempotency-Key')
    assert.match(key, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
    assert.equal(options.headers.get('Authorization'), `Bearer ${token}`)
    calls.push(key)
    if (lost) {
      lost = false
      throw new TypeError('Simulated accepted response loss')
    }
    if (changeOwner) token = 'another-contract-token'
    return Response.json({ code: 0, data: payment })
  }
  lost = true
  await assert.rejects(recoverExistingPayment(order, payment, token, new AbortController().signal))
  const result = await recoverExistingPayment(order, payment, token, new AbortController().signal)
  assert.equal(calls.length, 2)
  assert.equal(calls[0], calls[1])
  assert.equal(result.id, payment.id)
  assert.equal(result.qrCodeUrl, undefined)
  assert.ok(
    !JSON.stringify([...values]).includes(token) &&
      !JSON.stringify([...values]).includes('PRIVATE_CHECKOUT_SENTINEL'),
  )
  passed++
  token = 'different-owner'
  await recoverExistingPayment(order, payment, token, new AbortController().signal)
  assert.notEqual(calls[2], calls[0])
  passed++
  const before = calls.length
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(
    recoverExistingPayment(order, payment, token, aborted.signal),
    (e) => e.name === 'AbortError',
  )
  assert.equal(calls.length, before)
  passed++
  await assert.rejects(
    recoverExistingPayment(order, payment, 'stale-token', new AbortController().signal),
    (e) => e.name === 'AbortError',
  )
  assert.equal(calls.length, before)
  passed++
  changeOwner = true
  await assert.rejects(
    recoverExistingPayment(order, payment, token, new AbortController().signal),
    (e) => e.name === 'AbortError',
  )
  changeOwner = false
  passed++
  for (const value of [
    { ...payment, id: 'wrong' },
    { ...payment, orderId: '9007199254740994' },
    { ...payment, amountCent: 3901 },
    { ...payment, currency: 'USD' },
    { ...payment, mock: 'true' },
    { ...payment, state: 'PAID' },
  ])
    assert.throws(() => paymentForOrder(value, order))
  passed++
  calls = []
  for (const [o, p] of [
    [{ ...order, paymentId: null }, payment],
    [{ ...order, state: 'PAID' }, payment],
    [order, { ...payment, state: 'SUCCEEDED' }],
    [order, { ...payment, channel: 'alipay' }],
    [{ ...order, id: Number(order.id) }, payment],
  ]) {
    await assert.rejects(recoverExistingPayment(o, p, token, new AbortController().signal))
  }
  assert.equal(calls.length, 0)
  passed++
  const storage = globalThis.sessionStorage
  globalThis.sessionStorage = {
    getItem() {
      throw new Error('Storage unavailable')
    },
  }
  await assert.rejects(
    recoverExistingPayment(order, payment, token, new AbortController().signal),
    /无法保存恢复标识/,
  )
  assert.equal(calls.length, 0)
  globalThis.sessionStorage = storage
  passed++
  values.clear()
  await recoverExistingPayment(order, payment, token, new AbortController().signal)
  const storageKey = [...values.keys()][0]
  values.set(storageKey, 'corrupted-command')
  await recoverExistingPayment(order, payment, token, new AbortController().signal)
  assert.notEqual(calls.at(-1), calls.at(-2))
  passed++
  assert.equal(accountReturnPath(`/account/orders/${order.id}`), `/account/orders/${order.id}`)
  assert.equal(accountReturnPath('/account/orders'), '/account/orders')
  assert.equal(accountReturnPath('/account/library'), '/account/library')
  for (const url of [
    'https://external.invalid',
    '//external.invalid',
    '/account/orders/0',
    '/account/orders/9223372036854775808',
    '/account/orders/1?next=evil',
    '/account/orders/1#evil',
    '/account/orders/%31',
    '/account/orders/01',
    ['/account/orders/1'],
  ])
    assert.equal(accountReturnPath(url), '/')
  assert.equal(isCommerceId(9007199254740993), false)
  passed++
  console.log(
    `Payment recovery: ${passed} idempotency, ownership binding, storage safety, cancellation and return-path cases passed.`,
  )
} finally {
  await server.close()
  globalThis.fetch = original.fetch
  for (const name of ['localStorage', 'sessionStorage']) {
    if (original[name]) globalThis[name] = original[name]
    else delete globalThis[name]
  }
}
