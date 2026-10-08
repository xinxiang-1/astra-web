import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'vite'

const originalFetch = globalThis.fetch
const originalStorage = globalThis.localStorage
globalThis.localStorage = { getItem: () => 'contract-only-token' }
const server = await createServer({
  configFile: false,
  server: { middlewareMode: true, watch: null },
})
const bytes = new Uint8Array([1, 2, 3, 4])
const asset = {
  id: '9007199254740993',
  fileName: '测试.astra',
  mimeType: 'application/octet-stream',
  sizeBytes: 4,
  sha256: createHash('sha256').update(bytes).digest('hex'),
}
const ticket = 'A'.repeat(43)
let calls = []
let mode = ''
let passed = 0
try {
  const { fetchPurchasedAsset, formatPurchasedFileSize } = await server.ssrLoadModule(
    '/src/lib/purchased-assets.ts',
  )
  globalThis.fetch = async (url, options) => {
    calls.push(url)
    if (options.method === 'POST') {
      assert.equal(options.headers.get('Authorization'), 'Bearer contract-only-token')
      assert.equal(options.body, undefined)
      return Response.json({
        code: 0,
        data: {
          ticket: mode === 'bad-ticket' ? 'invalid' : ticket,
          downloadPath:
            mode === 'external'
              ? 'https://external.invalid/file'
              : mode === 'other-path'
                ? '/api/system/assets/1/download'
                : `/api/system/assets/${asset.id}/download`,
          expiresAt: new Date(Date.now() + 120000).toISOString(),
          file: { ...asset, ...(mode === 'metadata' ? { sha256: 'b'.repeat(64) } : {}) },
        },
      })
    }
    assert.equal(options.headers, undefined, 'Binary request never sends bearer identity')
    assert.equal(options.credentials, 'omit')
    assert.equal(options.referrerPolicy, 'no-referrer')
    assert.equal(options.redirect, 'error')
    assert.equal(options.cache, 'no-store')
    if (mode === 'expired') return new Response('expired', { status: 410 })
    if (mode === 'network') throw new TypeError(`Network error ${url}`)
    const chunks =
      mode === 'oversize'
        ? [new Uint8Array([1, 2, 3, 4, 5])]
        : mode === 'short'
          ? [bytes.slice(0, 2)]
          : mode === 'hash'
            ? [new Uint8Array([1, 2, 3, 5])]
            : [bytes.slice(0, 2), bytes.slice(2)]
    const body = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    return new Response(body, {
      headers: {
        'Content-Type': mode === 'mime' ? 'text/html' : asset.mimeType,
        ...(mode === 'length' ? { 'Content-Length': '3' } : {}),
      },
    })
  }
  const progress = []
  const file = await fetchPurchasedAsset(asset, new AbortController().signal, (count) =>
    progress.push(count),
  )
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes)
  assert.deepEqual(progress, [2, 4])
  assert.equal(file.name, asset.fileName)
  assert.equal(calls.length, 2)
  passed++
  for (mode of [
    'bad-ticket',
    'external',
    'other-path',
    'metadata',
    'expired',
    'network',
    'oversize',
    'short',
    'hash',
    'mime',
    'length',
  ]) {
    calls = []
    await assert.rejects(fetchPurchasedAsset(asset, new AbortController().signal), (error) => {
      assert.ok(!error.message.includes(ticket), 'Never leak ticket in an error')
      assert.ok(!error.message.includes('external.invalid'))
      if (mode === 'expired') assert.equal(error.status, 410)
      return true
    })
    assert.equal(
      calls.length,
      ['bad-ticket', 'external', 'other-path', 'metadata'].includes(mode) ? 1 : 2,
    )
    passed++
  }
  mode = ''
  calls = []
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(
    fetchPurchasedAsset(asset, aborted.signal),
    (error) => error.name === 'AbortError',
  )
  assert.equal(calls.length, 0)
  passed++
  const during = new AbortController()
  await assert.rejects(
    fetchPurchasedAsset(asset, during.signal, () => during.abort()),
    (error) => error.name === 'AbortError',
  )
  passed++
  calls = []
  await assert.rejects(
    fetchPurchasedAsset(
      { ...asset, sizeBytes: 256 * 1024 * 1024 + 1 },
      new AbortController().signal,
    ),
  )
  await assert.rejects(
    fetchPurchasedAsset({ ...asset, id: '1/../../x' }, new AbortController().signal),
  )
  assert.equal(calls.length, 0)
  passed++
  for (const invalid of [
    { ...asset, id: 189304737000010304 },
    { ...asset, fileName: 123 },
    { ...asset, mimeType: 'text/html; charset=utf-8' },
    { ...asset, mimeType: null },
    { ...asset, sha256: null },
  ]) {
    await assert.rejects(fetchPurchasedAsset(invalid, new AbortController().signal))
    assert.equal(calls.length, 0)
  }
  passed++
  assert.equal(formatPurchasedFileSize(1), '1 B')
  assert.equal(formatPurchasedFileSize(1024), '1.0 KB')
  assert.equal(formatPurchasedFileSize(1048576), '1.00 MB')
  passed++
  console.log(
    `Purchased assets: ${passed} bounded transport, integrity, cancellation and credential safety cases passed.`,
  )
} finally {
  await server.close()
  globalThis.fetch = originalFetch
  if (originalStorage) globalThis.localStorage = originalStorage
  else delete globalThis.localStorage
}
