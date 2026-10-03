import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve('docs/research/2026-10-04-creative-effects')
await mkdir(out, { recursive: true })
const queries = [
  'Codrops image particles hover',
  'After Effects text disintegration displacement glitch',
  'ASCII art particle interaction webgl',
  'signature portrait stippling weighted Voronoi',
  'commercial stock video Pexels Pixabay license',
  'Google Fonts Chinese handwriting Ma Shan Zheng license',
]
const references = [
  ['awwwards-animation', 'https://www.awwwards.com/websites/animation/'],
  [
    'codrops-particles-search',
    'https://api.github.com/search/repositories?q=org%3Acodrops+particles&per_page=5',
  ],
  [
    'codrops-displacement-search',
    'https://api.github.com/search/repositories?q=org%3Acodrops+hover&sort=stars&per_page=8',
  ],
  ['adobe-distortion', 'https://helpx.adobe.com/after-effects/using/distort-effects.html'],
  ['adobe-simulation', 'https://helpx.adobe.com/after-effects/using/simulation-effects.html'],
  ['book-of-shaders-noise', 'https://thebookofshaders.com/11/'],
  [
    'gpu-gems-fluid',
    'https://developer.nvidia.com/gpugems/gpugems/part-vi-beyond-triangles/chapter-38-fast-fluid-dynamics-simulation-gpu',
  ],
  ['three-gpu-computation', 'https://threejs.org/docs/pages/GPUComputationRenderer.html'],
  ['motion-spring', 'https://motion.dev/docs/animate'],
  ['weighted-voronoi', 'https://www.cs.ubc.ca/labs/imager/tr/2002/secord2002b/'],
  ['stipplegen', 'https://github.com/evil-mad/stipplegen'],
  [
    'googlefonts-mashanzheng-license',
    'https://api.github.com/repos/google/fonts/contents/ofl/mashanzheng/OFL.txt',
  ],
  [
    'googlefonts-longcang-license',
    'https://api.github.com/repos/google/fonts/contents/ofl/longcang/OFL.txt',
  ],
  ['pexels-license', 'https://www.pexels.com/license/'],
  ['pixabay-license', 'https://pixabay.com/service/license-summary/'],
  ['unsplash-license', 'https://unsplash.com/license'],
  ['nasa-media-guidelines', 'https://www.nasa.gov/nasa-brand-center/images-and-media/'],
  ['mdn-recording', 'https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder'],
]
const jobs = [
  ...queries.map((query, i) => [
    `search-${i + 1}`,
    `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`,
    query,
  ]),
  ...references,
]
const records = []
let next = 0
const unescape = (s) =>
  s
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
async function worker() {
  while (next < jobs.length) {
    const [name, url, query] = jobs[next++]
    const retrievedAt = new Date().toISOString()
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 Astra-Creative-Research',
          Accept: 'text/html,application/json,text/plain',
        },
        signal: AbortSignal.timeout(20000),
      })
      const body = await response.text()
      let repositories, licenseText
      if (url.includes('api.github.com') && response.ok) {
        const json = JSON.parse(body)
        repositories = json.items?.map((i) => ({
          name: i.full_name,
          url: i.html_url,
          stars: i.stargazers_count,
          license: i.license?.spdx_id ?? null,
          description: i.description,
        }))
        if (json.encoding === 'base64')
          licenseText = Buffer.from(json.content, 'base64').toString('utf8')
      }
      const text = unescape(
        body
          .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' '),
      ).trim()
      const items = [...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => ({
        title: unescape(match[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] || ''),
        url: unescape(match[1].match(/<link>([\s\S]*?)<\/link>/)?.[1] || ''),
        description: unescape(match[1].match(/<description>([\s\S]*?)<\/description>/)?.[1] || ''),
      }))
      const record = {
        name,
        url,
        query,
        retrievedAt,
        finalUrl: response.url,
        status: response.status,
        sha256: createHash('sha256').update(body).digest('hex'),
        bytes: Buffer.byteLength(body),
        title: body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim(),
        excerpt: text.slice(0, 16000),
        ...(items.length ? { items } : {}),
        repositories,
        licenseText,
        keywordExcerpts: ['Displacement Map', 'Turbulent Displace', 'Card Dance', 'CC Particle', 'Lloyd', 'Voronoi', 'commercial', 'prohibited'].flatMap(keyword => {
          const start = text.toLowerCase().indexOf(keyword.toLowerCase())
          return start < 0 ? [] : [{ keyword, text: text.slice(Math.max(0, start - 100), start + 1800) }]
        }),
      }
      records.push(record)
      console.log(
        JSON.stringify({
          name,
          status: record.status,
          title: record.title,
          items: items.map(({ title, url }) => ({ title, url })),
        }),
      )
    } catch (error) {
      records.push({ name, url, query, retrievedAt, error: String(error) })
      console.log(JSON.stringify({ name, error: String(error) }))
    }
  }
}
await Promise.all(Array.from({ length: 5 }, worker))
records.sort(
  (a, b) => jobs.findIndex((j) => j[0] === a.name) - jobs.findIndex((j) => j[0] === b.name),
)
await writeFile(
  path.join(out, 'sources.json'),
  JSON.stringify(
    {
      scope:
        'Targeted public searches and primary documentation; search relevance and HTTP access are recorded separately from visual verification and licensing.',
      queries,
      records,
    },
    null,
    2,
  ) + '\n',
)
