import { SIGNATURE_FONT_SUBSETS } from './font-subsets'

type FontId = keyof typeof SIGNATURE_FONT_SUBSETS
type Descriptor = { id: FontId; family: string; sha256: string }
type Shard = { first: number; last: number; file: string; bytes: number; sha256: string }
type Manifest = { coverage: Uint8Array; shards: Map<number, Shard> }
type CoverageReader = (buffer: ArrayBuffer) => (codepoint: number) => boolean
const firstCjk = 0x4e00, lastCjk = 0x9fff, blockSize = 256
const manifests = new Map<FontId, Promise<Manifest>>()
const faces = new Map<string, Promise<FontFace>>()

/** Other scripts and long runs retain complete fonts and their original shaping. */
export function isSubsetName(text: string) {
  return text.length <= 32 && /^[\u4e00-\u9fff]+$/u.test(text)
}

function invalid(): never { throw new Error('书写字体分片目录损坏，请刷新后重试') }

export function readSubsetManifest(raw: unknown, expectedSource: string): Manifest {
  if (!raw || typeof raw !== 'object') return invalid()
  const input = raw as Record<string, unknown>
  if (input.version !== 1 || input.sourceSha256 !== expectedSource || input.start !== firstCjk ||
    input.end !== lastCjk || input.block !== blockSize || typeof input.coverage !== 'string' ||
    input.coverage.length !== Math.ceil((lastCjk - firstCjk + 1) / 8 / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.coverage) || !Array.isArray(input.shards) ||
    input.shards.length < 1 || input.shards.length > 82) return invalid()
  let decoded: string
  try { decoded = atob(input.coverage) } catch { return invalid() }
  if (decoded.length !== (lastCjk - firstCjk + 1) / 8) return invalid()
  const coverage = Uint8Array.from(decoded, (value) => value.charCodeAt(0))
  const shards = new Map<number, Shard>()
  for (const value of input.shards) {
    if (!value || typeof value !== 'object') return invalid()
    const row = value as Record<string, unknown>
    if (typeof row.first !== 'number' || !Number.isInteger(row.first) || row.first < firstCjk ||
      row.first > lastCjk || (row.first - firstCjk) % blockSize !== 0 || row.last !== row.first + blockSize - 1 ||
      typeof row.file !== 'string' || !/^[a-f0-9]{4}-[a-f0-9]{12}\.woff2$/.test(row.file) ||
      row.file.slice(0, 4) !== row.first.toString(16) || typeof row.bytes !== 'number' ||
      !Number.isInteger(row.bytes) || row.bytes < 48 || row.bytes > 1024 * 1024 ||
      typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256) || shards.has(row.first)) return invalid()
    shards.set(row.first, { first: row.first, last: row.last as number, file: row.file, bytes: row.bytes, sha256: row.sha256 })
  }
  for (let cp = firstCjk; cp <= lastCjk; cp++) {
    if (supports(coverage, cp) && !shards.has(shardStart(cp))) return invalid()
  }
  return { coverage, shards }
}

function supports(coverage: Uint8Array, cp: number) {
  const offset = cp - firstCjk
  return cp >= firstCjk && cp <= lastCjk && Boolean(coverage[offset >> 3]! & (1 << (offset & 7)))
}
function shardStart(cp: number) { return firstCjk + Math.floor((cp - firstCjk) / blockSize) * blockSize }

async function checkedBuffer(url: string, bytes: number, expectedHash: string) {
  let response: Response
  try { response = await fetch(url, { signal: AbortSignal.timeout(15000) }) }
  catch { throw new Error('书写字体暂未加载成功，请检查网络后重试；现有名字库会保留') }
  if (!response.ok) throw new Error('书写字体加载失败，请重试；现有名字库会保留')
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength !== bytes) throw new Error('书写字体文件不完整，请重试')
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  if (hash !== expectedHash) throw new Error('书写字体校验失败，请刷新后重试')
  return buffer
}

function manifest(descriptor: Descriptor) {
  const transport = SIGNATURE_FONT_SUBSETS[descriptor.id]
  if (transport.sourceSha256 !== descriptor.sha256) throw new Error('书写字体来源校验不一致')
  let pending = manifests.get(descriptor.id)
  if (!pending) {
    pending = (async () => {
      const buffer = await checkedBuffer(`${import.meta.env.BASE_URL}fonts/signature/cjk/${transport.file}`, transport.bytes, transport.sha256)
      let raw: unknown
      try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer)) }
      catch { return invalid() }
      return readSubsetManifest(raw, descriptor.sha256)
    })()
    manifests.set(descriptor.id, pending)
    void pending.catch(() => { if (manifests.get(descriptor.id) === pending) manifests.delete(descriptor.id) })
  }
  return pending
}

export async function loadSubsetFont(descriptor: Descriptor, text: string, readCoverage: CoverageReader) {
  const metadata = await manifest(descriptor)
  const characters = [...new Set(Array.from(text))]
  const missing = characters.filter((char) => !supports(metadata.coverage, char.codePointAt(0)!))
  if (missing.length) throw new Error(`这款字体不支持“${missing.join('')}”，请换字体或手写名字`)
  const needed = [...new Set(characters.map((char) => shardStart(char.codePointAt(0)!)))]
  await Promise.all(needed.map((first) => {
    const key = `${descriptor.id}:${first}`
    let pending = faces.get(key)
    if (!pending) {
      pending = (async () => {
        const shard = metadata.shards.get(first)!
        const buffer = await checkedBuffer(`${import.meta.env.BASE_URL}fonts/signature/cjk/${descriptor.id}/${shard.file}`, shard.bytes, shard.sha256)
        const coverage = readCoverage(buffer)
        for (let cp = first; cp <= shard.last; cp++) {
          if (coverage(cp) !== supports(metadata.coverage, cp)) throw new Error('书写字体分片字表不一致，请刷新后重试')
        }
        const face = await new FontFace(descriptor.family, buffer, {
          style: 'normal', weight: '400', unicodeRange: `U+${first.toString(16)}-${shard.last.toString(16)}`,
        }).load()
        document.fonts.add(face)
        return face
      })()
      faces.set(key, pending)
      void pending.catch(() => { if (faces.get(key) === pending) faces.delete(key) })
    }
    return pending
  }))
  return descriptor.family
}
