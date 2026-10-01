import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const directory = path.resolve('sandbox/signature-optimizer/fixtures')
await mkdir(directory, { recursive: true })
const fixtures = [
  { title: 'File:Benjamin Franklin Signature.svg', filename: 'franklin-signature.svg', page: 'https://commons.wikimedia.org/wiki/File:Benjamin_Franklin_Signature.svg', artist: 'Benjamin Franklin' },
  { title: "File:Lu Xun's Signature.svg", filename: 'luxun-signature.svg', page: 'https://commons.wikimedia.org/wiki/File:Lu_Xun%27s_Signature.svg', artist: 'Lu Xun' },
  { title: 'File:Albert Einstein signature 1934.svg', filename: 'einstein-signature.svg', evidence: 'einstein-signature-source-page.html', page: 'https://commons.wikimedia.org/wiki/File:Albert_Einstein_signature_1934.svg', artist: 'Albert Einstein', kind: 'signature' },
  { title: 'File:Albert Einstein Head.jpg', filename: 'einstein-portrait.jpg', evidence: 'einstein-portrait-source-page.html', page: 'https://commons.wikimedia.org/wiki/File:Albert_Einstein_Head.jpg', artist: 'Orren Jack Turner', kind: 'portrait' },
]
const records = []
const run = promisify(execFile)
async function get(url, filename) {
  if (process.platform === 'win32') {
    const quote = value => `'${value.replaceAll("'", "''")}'`
    const command = `$ErrorActionPreference = 'Stop'; Invoke-WebRequest -Uri ${quote(url)} -Headers @{ 'User-Agent' = 'AstraEngineResearch/1.0' } -OutFile ${quote(filename)} -TimeoutSec 30`
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 35000 })
    return readFile(filename)
  }
  const response = await fetch(url, { headers: { 'User-Agent': 'AstraEngineResearch/1.0' }, signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer()); await writeFile(filename, bytes); return bytes
}
// The API was rate-limited; retain official file pages and reuse local evidence.
async function cached(url, filename) {
  if (!process.argv.includes('--refresh')) { try { return await readFile(filename) } catch { /* Retrieve missing file. */ } }
  return get(url, filename)
}
for (const fixture of fixtures) {
  const evidence = fixture.evidence || `${fixture.filename.replace('-signature.svg', '')}-source-page.html`
  const page = (await cached(fixture.page, path.join(directory, evidence))).toString('utf8')
  if (!/class="licensetpl(?:_|&#95;)short">Public domain<\/span>/.test(page)) throw new Error(`Unverified public domain: ${fixture.title}`)
  const extension=fixture.filename.split('.').pop()
  const fullImage=page.match(/class="fullImage"[\s\S]{0,1500}?href="(https:\/\/upload\.wikimedia\.org\/[^"<> ]+)"/)
  const download=fullImage?.[1] || page.match(new RegExp(`https://upload\\.wikimedia\\.org/wikipedia/commons/[\\w/]+/[^"<> ]+\\.${extension}`))?.[0]
  if(!download || !download.toLowerCase().endsWith(`.${extension}`))throw new Error(`Missing verified original image: ${fixture.title}`)
  const bytes = await cached(download, path.join(directory, fixture.filename))
  records.push({ ...fixture, source: fixture.page, download, license: 'Public domain', evidence, pageSha256: createHash('sha256').update(page).digest('hex'), sha256: createHash('sha256').update(bytes).digest('hex'), use: fixture.kind==='portrait'?'Historical photographic portrait test fixture; no endorsement':'Historical handwritten signature test fixture; not a font-generated stamp or endorsement' })
}
await writeFile(path.join(directory, 'sources.json'), JSON.stringify({ date: '2026-09-30', fixtures: records }, null, 2))
console.log(records.map(item => ({ file: item.filename, license: item.license, sha256: item.sha256 })))
