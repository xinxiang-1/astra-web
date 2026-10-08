import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createPinia, setActivePinia } from 'pinia'

const storage = new Map()
const originalStorage = globalThis.localStorage
const originalFetch = globalThis.fetch
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
}
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null },
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
})
let passed = 0
try {
  const { useAuthStore } = await server.ssrLoadModule('/src/stores/auth.ts')
  for (const scenario of [
    { status: 503, code: 503, clear: false },
    { status: 503, code: 401, clear: false },
    { status: 502, code: 502, clear: false },
    { network: true, clear: false },
    { timeout: true, clear: false },
    { status: 401, code: 401, clear: true },
    { status: 200, code: 401, clear: true },
  ]) {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    storage.set('astra_access_token', 'test-token')
    globalThis.fetch = async () => Response.json({ code: 0, data: { id: '9007199254740993', nickname: '测试用户' } })
    assert.equal(await auth.restoreSession(), true)
    assert.equal(auth.user.id, '9007199254740993')
    globalThis.fetch = async () => {
      if (scenario.network) throw new TypeError('Failed to fetch')
      if (scenario.timeout) throw new DOMException('Timeout', 'TimeoutError')
      return Response.json({ code: scenario.code, msg: '合同错误' }, { status: scenario.status })
    }
    assert.equal(await auth.restoreSession(), false)
    assert.equal(storage.has('astra_access_token'), !scenario.clear)
    assert.equal(auth.user !== null, !scenario.clear)
    passed++
  }
  console.log(`Auth session contract: ${passed} real store scenarios passed.`)
} finally {
  await server.close()
  globalThis.fetch = originalFetch
  if (originalStorage) globalThis.localStorage = originalStorage
  else delete globalThis.localStorage
}
