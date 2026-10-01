import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve('docs/research/2026-09-30-interactions')
await mkdir(out, { recursive: true })
const searches = [
  'Awwwards',
  'Lusion',
  'GSAP ScrollTrigger',
]
const references = [
  ['awwwards', 'https://www.awwwards.com/websites/animation/'],
  ['codrops', 'https://tympanus.net/codrops/'],
  ['lusion', 'https://lusion.co/'],
  ['active-theory', 'https://activetheory.net/'],
  ['linear', 'https://linear.app/'],
  ['gsap-scrolltrigger', 'https://gsap.com/docs/v3/Plugins/ScrollTrigger/'],
  ['motion-scroll', 'https://motion.dev/docs/scroll'],
  ['codrops-scroll-animations', 'https://tympanus.net/codrops/2023/05/25/kinetic-typography-with-three-js/'],
  ['codrops-github', 'https://api.github.com/search/repositories?q=org%3Acodrops+scroll&sort=updated&per_page=8'],
  ['webgl-pixel-store', 'https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/pixelStorei'],
]
async function save(name, url) {
  const retrievedAt = new Date().toISOString()
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 Astra-Interaction-Research' }, signal: AbortSignal.timeout(25000) })
    const body = await response.text()
    await writeFile(path.join(out, `${name}.html`), body)
    const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim()
    const items = [...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(match => ({
      title: match[1].match(/<title>([\s\S]*?)<\/title>/)?.[1],
      url: match[1].match(/<link>([\s\S]*?)<\/link>/)?.[1],
      description: match[1].match(/<description>([\s\S]*?)<\/description>/)?.[1],
    }))
    return { name, url, finalUrl: response.url, status: response.status, retrievedAt, title, bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex'), ...(items.length ? { items } : {}) }
  } catch (error) { return { name, url, retrievedAt, error: String(error) } }
}
const results = await Promise.allSettled([
  ...searches.map((query, i) => save(`search-${i + 1}`, `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`)),
  ...references.map(([name, url]) => save(name, url)),
])
const records = results.map(item => item.status === 'fulfilled' ? item.value : { error: String(item.reason) })
await writeFile(path.join(out, 'sources.json'), JSON.stringify({ scope: 'Targeted public web searches and official reference pages; no third-party code copied or executed.', queries: searches, records }, null, 2))
for (const item of records) console.log(JSON.stringify({ name: item.name, status: item.status, title: item.title, items: item.items, error: item.error }))
