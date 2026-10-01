import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

// Research evidence only. No upstream code is installed or executed.
const destination = resolve('docs/research/2026-09-30-ascii')
await mkdir(destination, { recursive: true })
const headers = { 'User-Agent': 'Astra-Engine-Research', Accept: 'application/vnd.github+json' }
async function get(url) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(25_000) })
  if (!response.ok) throw new Error(`${response.status} ${url}`)
  return response.text()
}
const queries = ['ascii art javascript canvas', 'ascii image converter', 'p5.asciify']
const searches = await Promise.allSettled(queries.map(async (query) => {
  const body = JSON.parse(await get(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=7`))
  return { query, repositories: body.items.map(item => ({ repository: item.full_name, url: item.html_url, license: item.license?.spdx_id ?? null, description: item.description })) }
}))
await writeFile(resolve(destination, 'search-results.json'), JSON.stringify({ date: '2026-09-30', scope: 'Targeted public GitHub search, not exhaustive web coverage', results: searches.map(result => result.status === 'fulfilled' ? result.value : { error: String(result.reason) }) }, null, 2))
const projects = [
  ['ayangabryl/asciify-engine', 'main', ['LICENSE', 'README.md', 'THIRD_PARTY.md']],
  ['humanbydefinition/p5.asciify', 'main', ['LICENSE', 'README.md']],
  ['humanbydefinition/p5.asciify-accurate-renderer-plugin', 'main', ['LICENSE', 'README.md']],
  ['collidingScopes/ascii', 'main', ['LICENSE', 'README.md']],
  ['TheZoraiz/ascii-image-converter', 'master', ['LICENSE', 'README.md']],
  ['Kirilllive/ASCII_Art_Paint', 'main', ['LICENSE', 'README.md']],
  ['humanbydefinition/textmode.js', 'main', ['LICENSE', 'README.md']],
]
const records = await Promise.all(projects.map(async ([repository, branch, files]) => {
  const name = repository.replaceAll('/', '__')
  const folder = resolve(destination, name)
  await mkdir(folder, { recursive: true })
  const record = { repository, url: `https://github.com/${repository}`, branch, retrievedAt: new Date().toISOString(), files: [] }
  try {
    const commit = JSON.parse(await get(`https://api.github.com/repos/${repository}/commits/${branch}`))
    record.commit = commit.sha
    for (const filename of files) {
      const sourceFilename = repository === 'collidingScopes/ascii'
        ? (filename === 'LICENSE' ? 'LICENSE.txt' : 'README.MD')
        : repository === 'TheZoraiz/ascii-image-converter' && filename === 'LICENSE' ? 'LICENSE.txt' : filename
      const url = `https://api.github.com/repos/${repository}/contents/${sourceFilename}?ref=${commit.sha}`
      try {
        const resource = JSON.parse(await get(url))
        if (resource.encoding !== 'base64' || !resource.content) throw new Error('Expected a small text resource')
        const body = Buffer.from(resource.content, 'base64')
        await writeFile(resolve(folder, filename), body)
        record.files.push({ filename, url, sha256: createHash('sha256').update(body).digest('hex') })
      } catch (error) { record.files.push({ filename, error: String(error) }) }
    }
  } catch (error) { record.error = String(error) }
  return record
}))
await writeFile(resolve(destination, 'sources.json'), JSON.stringify(records, null, 2))
for (const record of records) console.log(JSON.stringify({ repository: record.repository, commit: record.commit, files: record.files.map(file => ({ filename: file.filename, ok: Boolean(file.sha256), error: file.error })), error: record.error }))
