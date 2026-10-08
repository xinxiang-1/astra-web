import assert from 'node:assert/strict'
import { http, ApiError, getAccessToken, setAccessToken } from '../src/api/http.ts'

const originalFetch = globalThis.fetch
const originalStorage = globalThis.localStorage
const storage = new Map()
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}
const requestId = 'ec513904-7290-49a4-9a0e-871583ade961'
let requests = 0
try {
  setAccessToken('contract-token')
  globalThis.fetch = async (url, options) => {
    requests++
    assert.equal(url, '/api/system/catalog/capabilities')
    assert.equal(options.headers.get('Authorization'), 'Bearer contract-token')
    assert.ok(options.signal instanceof AbortSignal)
    return Response.json({ code: 0, data: { paymentEnabled: false } })
  }
  assert.deepEqual(await http('/system/catalog/capabilities'), { paymentEnabled: false })
  for (const [status, code] of [[503, 503], [401, 401], [409, 43001], [200, 401]]) {
    globalThis.fetch = async () => {
      requests++
      return Response.json({ code, msg: '合同错误' }, { status, headers: { 'X-Request-Id': requestId } })
    }
    await assert.rejects(http('/auth/me'), (error) => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, status)
      assert.equal(error.code, code)
      assert.equal(error.requestId, requestId)
      return true
    })
    assert.equal(getAccessToken(), 'contract-token')
  }
  globalThis.fetch = async () => { requests++; return new Response('upstream unavailable', { status: 502 }) }
  await assert.rejects(http('/auth/me'), (error) => error.status === 502)
  const controller = new AbortController()
  globalThis.fetch = (_url, options) => {
    requests++
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason)))
  }
  const pending = http('/system/orders', { method: 'POST', body: '{}', signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, (error) => error.name === 'AbortError')
  assert.equal(requests, 7, 'no automatic read or write retries')
  assert.equal(getAccessToken(), 'contract-token')
  console.log('Auth HTTP contract: 7 requests passed; status/code preserved, cancellation and token retention verified.')
} finally {
  globalThis.fetch = originalFetch
  if (originalStorage) globalThis.localStorage = originalStorage
  else delete globalThis.localStorage
}
