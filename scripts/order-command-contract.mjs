import assert from 'node:assert/strict'
import { createServer } from 'vite'

const original = Object.fromEntries(['fetch', 'localStorage', 'sessionStorage'].map((key) => [key, globalThis[key]]))
let token = 'order-contract-owner', lost = false, rejectVersion = false, switchOwner = false
const values = new Map(), calls = []
globalThis.localStorage = { getItem: () => token }
globalThis.sessionStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
}
const request = { skuId: '9007199254740993', offerVersion: 1, termsVersion: '1', refundPolicyVersion: '2', licenseVersion: '3' }
const order = {
  id: '9007199254740995', item: { skuId: request.skuId, quantity: 1, amountCent: 3900, license: { version: '3' } },
  purchaseTerms: { version: '1' }, refundPolicy: { version: '2' }, totalAmountCent: 3900, currency: 'CNY',
}
let responseOrder = order
const server = await createServer({ configFile: false, server: { middlewareMode: true, watch: null } })
let passed = 0
try {
  const { submitOrderCommand, readOrderCommand, orderRequest, releaseClosedOrderCommand } = await server.ssrLoadModule('/src/lib/order-command.ts')
  const { accountReturnPath } = await server.ssrLoadModule('/src/lib/account-return.ts')
  const submit = (body) => submitOrderCommand('test-pack', token, new AbortController().signal, body)
  const read = () => readOrderCommand('test-pack', token, new AbortController().signal)
  globalThis.fetch = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined
    const key = options.headers.get('Idempotency-Key')
    assert.equal(options.headers.get('Authorization'), `Bearer ${token}`)
    if (body) {
      assert.equal(url, '/api/system/orders')
      assert.deepEqual(body, request)
      assert.match(key, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
      const record = JSON.parse([...values.values()][0])
      assert.equal(record.key, key, 'Exact request saved before sending')
      assert.deepEqual(record.request, body)
    } else assert.equal(url, `/api/system/orders/${order.id}`)
    calls.push({ key, body })
    if (switchOwner) token = 'changed-owner'
    if (rejectVersion) return Response.json({ code: 43002, msg: 'Version changed' }, { status: 409 })
    if (lost) { lost = false; throw new TypeError('Accepted response lost') }
    return Response.json({ code: 0, data: responseOrder })
  }
  lost = true
  await assert.rejects(submit(request))
  assert.deepEqual((await read()).request, request)
  await assert.rejects(submit({ ...request, offerVersion: 2 }), /已有订单请求/)
  assert.equal(calls.length, 1, 'Changing offer cannot overwrite an unresolved command')
  passed++
  const result = await submit()
  assert.equal(result.id, order.id)
  assert.equal(calls[0].key, calls[1].key)
  assert.deepEqual(calls[0].body, calls[1].body)
  passed++
  await submit()
  assert.equal(calls[2].body, undefined, 'Known successful ID recovers through GET only')
  assert.ok(!JSON.stringify([...values]).includes(token))
  assert.equal(Object.keys(JSON.parse([...values.values()][0])).sort().join(','), 'key,orderId,request')
  passed++
  const before = calls.length
  await assert.rejects(submitOrderCommand('test-pack', 'stale-owner', new AbortController().signal, request), (e) => e.name === 'AbortError')
  const stopped = new AbortController(); stopped.abort()
  await assert.rejects(submitOrderCommand('test-pack', token, stopped.signal, request), (e) => e.name === 'AbortError')
  assert.equal(calls.length, before)
  passed++
  values.clear(); switchOwner = true
  await assert.rejects(submit(request), (e) => e.name === 'AbortError')
  switchOwner = false
  assert.ok([...values.values()].every((v) => !JSON.parse(v).orderId))
  passed++
  values.clear()
  const store = globalThis.sessionStorage
  globalThis.sessionStorage = { getItem: () => null, setItem: () => { throw new Error('Storage denied') } }
  const storageBefore = calls.length
  await assert.rejects(submit(request), /无法保存/)
  assert.equal(calls.length, storageBefore)
  globalThis.sessionStorage = store
  passed++
  values.clear(); lost = true
  await assert.rejects(submit(request))
  const location = [...values.keys()][0]
  values.set(location, '{broken-command')
  const corruptBefore = calls.length
  await assert.rejects(submit(request), /记录损坏/)
  assert.equal(calls.length, corruptBefore)
  passed++
  values.clear(); rejectVersion = true
  await assert.rejects(submit(request), (e) => e.code === 43002)
  assert.equal(await read(), null, 'Definite version rejection permits fresh consent')
  rejectVersion = false
  passed++
  for (const wrong of [
    { ...order, id: 9007199254740995 },
    { ...order, item: { ...order.item, skuId: '1' } },
    { ...order, totalAmountCent: 4000 },
    { ...order, purchaseTerms: { version: 'other' } },
  ]) {
    values.clear(); responseOrder = wrong
    await assert.rejects(submit(request), /订单结果无法确认/)
    assert.equal((await read()).orderId, undefined)
  }
  responseOrder = order
  passed++
  values.clear()
  await submit(request)
  await assert.rejects(releaseClosedOrderCommand('test-pack', token, new AbortController().signal), /尚未关闭/)
  assert.ok(await read())
  responseOrder = { ...order, state: 'CLOSED' }
  await releaseClosedOrderCommand('test-pack', token, new AbortController().signal)
  assert.equal(await read(), null)
  responseOrder = order
  passed++
  values.clear()
  for (const invalid of [{ ...request, amountCent: 1 }, { ...request, skuId: 123 }, { ...request, offerVersion: 2147483648 }])
    await assert.rejects(submit(invalid), /重新确认/)
  assert.deepEqual(orderRequest({ id: request.skuId, offerVersion: 1, amountCent: 1, purchaseTerms: { version: '1' }, refundPolicy: { version: '2' }, release: { license: { version: '3' } } }), request)
  passed++
  assert.equal(accountReturnPath('/collections/test-pack'), '/collections/test-pack')
  for (const url of ['/collections/test-pack?next=evil', '/collections/%61', '/collections/../login', '/collections/A', '/collections/test-pack#x'])
    assert.equal(accountReturnPath(url), '/')
  passed++
  console.log(`Order confirmation: ${passed} command persistence, exact replay, read recovery, binding, identity and consent boundary cases passed.`)
} finally {
  await server.close()
  for (const [name, value] of Object.entries(original)) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
}
