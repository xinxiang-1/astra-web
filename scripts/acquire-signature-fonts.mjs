import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve('docs/research/2026-10-04-signature-fonts')
const assets = path.resolve('public/fonts/signature')
await mkdir(out, { recursive: true })
await mkdir(assets, { recursive: true })
const families = [
  ['mashanzheng', 'MaShanZheng-Regular.ttf', '406197b91ff39a93061c2c2eeaee67ddf2ae1f0d'],
  ['longcang', 'LongCang-Regular.ttf', '35e5529ffaf259a96693b048d9d97cdaa76b6837'],
]
const records = []
const sha = (b) => createHash('sha256').update(b).digest('hex')
const get = async (url) => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Astra-Font-Source-Research' },
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw Error(`HTTP ${response.status} ${url}`)
  return response.json()
}
for (const [family, file, commit] of families) {
  const retrievedAt = new Date().toISOString()
  try {
    const entries = await get(
      `https://api.github.com/repos/google/fonts/contents/ofl/${family}?ref=${commit}`,
    )
    const record = { family, file, commit, retrievedAt, files: [] }
    for (const filename of ['OFL.txt', file]) {
      const entry = entries.find((e) => e.name === filename)
      if (!entry) throw Error(`Missing ${filename}`)
      const source = await get(entry.git_url)
      if (source.encoding !== 'base64') throw Error('Expected base64 Git blob')
      const bytes = Buffer.from(source.content.replace(/\s/g, ''), 'base64')
      if (bytes.length !== entry.size) throw Error('Source size mismatch')
      // Verify against the upstream Git blob identity, not only a local digest.
      const gitSha = createHash('sha1')
        .update(Buffer.from(`blob ${bytes.length}\0`))
        .update(bytes)
        .digest('hex')
      if (gitSha !== entry.sha) throw Error('Upstream Git blob hash mismatch')
      if (filename.endsWith('.ttf') && bytes.readUInt32BE(0) !== 0x00010000)
        throw Error('Not a TrueType font')
      const target = filename === 'OFL.txt' ? `${family}-OFL.txt` : filename
      await writeFile(path.join(assets, target), bytes)
      record.files.push({
        filename,
        target,
        url: entry.git_url,
        gitSha,
        sha256: sha(bytes),
        bytes: bytes.length,
      })
    }
    records.push(record)
    console.log(JSON.stringify(record))
  } catch (error) {
    records.push({ family, file, retrievedAt, error: String(error) })
    console.log(JSON.stringify({ family, error: String(error) }))
  }
}
await writeFile(path.join(out, 'sources.json'), JSON.stringify(records, null, 2) + '\n')
if (records.some((r) => r.error)) process.exitCode = 1
