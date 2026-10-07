import { build, preview } from 'vite'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

// Independent production bundle: research pages never become official presets implicitly.
const root = process.cwd(), out = path.resolve(root, 'test-results/portrait-print-bundle')
await build({
  configFile: false, root, base: '/', publicDir: false,
  build: { outDir: out, emptyOutDir: true, rollupOptions: { input: path.resolve(root, 'docs/prototypes/v13-portrait-styles/index.html') } },
})
await mkdir(path.join(out, 'artwork'), { recursive: true })
for (const file of ['portrait-reference.png', 'porcelain-study-v1.png']) await copyFile(path.join(root, 'public/artwork', file), path.join(out, 'artwork', file))
if (process.argv.includes('--serve')) {
  const server = await preview({ configFile: false, root, build: { outDir: out }, preview: { host: '127.0.0.1', port: 5186, strictPort: true } })
  server.printUrls()
}
