import { build, preview } from 'vite'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd(), out = path.resolve(root, 'test-results/signature-wash-bundle')
await build({ configFile: false, root, base: '/', publicDir: false,
  build: { outDir: out, emptyOutDir: true, rollupOptions: { input: path.resolve(root, 'docs/prototypes/v14-signature-wash/index.html') } },
})
await mkdir(path.join(out, 'artwork'), { recursive: true })
await mkdir(path.join(out, 'fonts/signature'), { recursive: true })
for (const file of ['portrait-reference.png', 'porcelain-study-v1.png']) await copyFile(path.join(root, 'public/artwork', file), path.join(out, 'artwork', file))
// Existing licensed handwriting assets; the production bundle must work without dev imports.
for (const file of ['MaShanZheng-Regular.ttf', 'LongCang-Regular.ttf', 'mashanzheng-OFL.txt', 'longcang-OFL.txt', 'SOURCES.md']) await copyFile(path.join(root, 'public/fonts/signature', file), path.join(out, 'fonts/signature', file))
if (process.argv.includes('--serve')) {
  const server = await preview({ configFile: false, root, build: { outDir: out }, preview: { host: '127.0.0.1', port: 5187, strictPort: true } })
  server.printUrls()
}
