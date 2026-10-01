import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import path from 'node:path'
import { starterRecipes } from './templates/starter-source-art.mjs'
import { hash } from './templates/delivery-ui.mjs'

// Public starter demos are separate from complete local/future paid delivery packages.
const pack = path.resolve(process.env.ASTRA_TEMPLATE_PACK || 'output/astra-starter-pack-v1-r4')
const target = path.resolve('public/templates/starter-v1')
const catalog = path.resolve('src/content/starter-templates.ts')
const manifest = JSON.parse(await readFile(path.join(pack, 'manifest.json'), 'utf8'))
assert.equal(manifest.engineVersion, '2.2.0')
assert.equal(manifest.version, '1.0.0')
for (const destination of [target, catalog]) {
  let exists = true
  try {
    await access(destination)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    exists = false
  }
  assert(!exists, `Refuse to overwrite: ${destination}`)
}
const entries = []
const files = []
for (const recipe of starterRecipes) {
  const assets = {}
  for (const [key, name] of [
    ['project', 'project.astra'],
    ['preview', 'preview.png'],
  ]) {
    const relative = `templates/${recipe.id}/${name}`
    const expected = manifest.assets.find((asset) => asset.path === relative)
    assert(expected, `Missing manifest asset: ${relative}`)
    const bytes = await readFile(path.join(pack, relative))
    assert.equal(bytes.length, expected.bytes, relative)
    assert.equal(hash(bytes), expected.sha256, relative)
    const output = `${recipe.id}/${name}`
    files.push({ output, bytes })
    assets[key] = {
      path: `templates/starter-v1/${output}`,
      bytes: bytes.length,
      sha256: hash(bytes),
    }
  }
  entries.push({
    id: recipe.id,
    name: recipe.name,
    category: recipe.mode === 'phrase' ? '中文' : recipe.mode === 'color' ? '彩色' : '光影',
    modeLabel: recipe.modeLabel,
    motionLabel: recipe.motionLabel,
    hoverLabel: recipe.hoverLabel,
    suitedTo: recipe.suitedTo,
    adjust: recipe.adjust,
    version: manifest.version,
    engineVersion: manifest.engineVersion,
    assets,
  })
}
// Validate every input first. Preserve a partial output on any write failure for diagnosis.
await mkdir(path.dirname(target), { recursive: true })
await mkdir(target, { recursive: false })
for (const file of files) {
  const destination = path.join(target, file.output)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, file.bytes, { flag: 'wx' })
}
await writeFile(
  path.join(target, 'SOURCES.md'),
  `# Astra 原创体验模板\n\n星环余光、光谱折面、字句回响由本项目 scripts/templates/starter-source-art.mjs 的Canvas路径/渐变绘制，无第三方图片、字体文件或随机输入。成品及可编辑包由正式编辑器实际下载；原交付候选版本1.0.0、引擎2.2.0。\n\n此目录是网站免费体验资源，只包含每个模板的成品PNG与可编辑.astra包。完整本地候选ZIP、源码工具和许可草案不在公开目录；商业模板商品、正式许可与后端权益另外验收。文件完整性元数据在 src/content/starter-templates.ts，与上一阶段交付manifest逐字节核对。\n`,
  { flag: 'wx' },
)
await writeFile(
  catalog,
  `// Generated from verified original starter delivery. See scripts/publish-starter-demos.mjs.\nexport const starterTemplates = ${JSON.stringify(entries, null, 2)} as const\n\nexport type StarterTemplate = (typeof starterTemplates)[number]\n`,
  { flag: 'wx' },
)
console.log(
  `PUBLISHED ${entries.length} original starter demos, ${files.length} verified assets; no paid delivery bundle`,
)
