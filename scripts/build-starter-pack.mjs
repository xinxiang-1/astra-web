import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { starterRecipes, drawStarterSource } from './templates/starter-source-art.mjs'
import { hash, ready, configure, download, exportFile, unpack } from './templates/delivery-ui.mjs'
import { writeManifest, writeZip } from './templates/delivery-files.mjs'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5194'
const pack = path.resolve(process.env.ASTRA_TEMPLATE_PACK || 'output/astra-starter-pack-v1')
const evidence = path.resolve(
  process.env.ASTRA_TEMPLATE_BUILD_OUTPUT || 'sandbox/template-delivery/2026-10-02-v1/build',
)
await mkdir(path.dirname(pack), { recursive: true })
await mkdir(pack, { recursive: false })
await mkdir(path.dirname(evidence), { recursive: true })
await mkdir(evidence, { recursive: false })
const sourceFiles = [
  'scripts/build-starter-pack.mjs',
  'scripts/templates/starter-source-art.mjs',
  'scripts/templates/delivery-ui.mjs',
  'scripts/templates/delivery-files.mjs',
  'scripts/templates/verify-delivery.ps1',
]
const sourceManifest = []
for (const relative of sourceFiles) {
  const bytes = await readFile(relative),
    destination = path.join(evidence, 'source', relative)
  await mkdir(path.dirname(destination), { recursive: true })
  await writeFile(destination, bytes)
  sourceManifest.push({ path: relative, sha256: hash(bytes) })
}
await writeFile(
  path.join(evidence, 'source-manifest.json'),
  JSON.stringify(sourceManifest, null, 2),
)
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  reducedMotion: 'reduce',
  acceptDownloads: true,
})
const page = await context.newPage()
page.setDefaultTimeout(30000)
page.setDefaultNavigationTimeout(60000)
const report = {
  base,
  browser: browser.version(),
  pack,
  sourceParent: 'bd5287dc1a8a7b0935bb01e0788c46b1d63f7298',
  templates: [],
  errors: [],
  passed: false,
}
page.on('pageerror', (error) => report.errors.push(error.message))
page.on('dialog', (dialog) => dialog.accept())
const summary = []
try {
  for (const recipe of starterRecipes) {
    const directory = path.join(pack, 'templates', recipe.id)
    await mkdir(directory, { recursive: true })
    await page.goto(`${base}/ascii-art`, { waitUntil: 'domcontentloaded' })
    const encoded = await page.evaluate(
      ({ source, id }) => {
        const canvas = document.createElement('canvas')
        canvas.width = 800
        canvas.height = 1000
        const draw = (0, eval)('(' + source + ')')
        draw(canvas.getContext('2d'), id, canvas.width, canvas.height)
        return canvas.toDataURL('image/png').split(',')[1]
      },
      { source: drawStarterSource.toString(), id: recipe.id },
    )
    const source = Buffer.from(encoded, 'base64')
    await writeFile(path.join(directory, 'source.png'), source, { flag: 'wx' })
    await page
      .locator('input[type=file]')
      .setInputFiles({ name: recipe.id + '.png', mimeType: 'image/png', buffer: source })
    await ready(page, 'density')
    await configure(page, recipe)
    const png = await exportFile(page, 'PNG', path.join(directory, 'preview.png'))
    const html = await exportFile(page, '动态网页', path.join(directory, 'playback.html'))
    const project = await download(
      page,
      () => page.getByRole('button', { name: '下载作品包', exact: true }).click(),
      path.join(directory, 'project.astra'),
    )
    const { manifest, source: returnedSource } = unpack(project.bytes)
    assert.equal(hash(returnedSource), hash(source))
    assert.equal(manifest.engine.version, '2.2.0')
    assert.equal(manifest.version, 1)
    const settings = manifest.project.settings
    for (const [key, value] of Object.entries({
      artMode: recipe.mode,
      artQuality: recipe.quality,
      columns: recipe.columns,
      backgroundColor: recipe.background,
      foregroundColor: recipe.ink,
      artMotion: recipe.motion,
      artHover: recipe.hover,
      artEffectProfile: 'expressive',
      artMotionSpeed: recipe.motionSpeed,
      artMotionStrength: recipe.motionStrength,
      hoverStrength: recipe.hoverStrength,
      hoverRadius: recipe.hoverRadius,
      invert: recipe.invert,
    }))
      assert.equal(settings[key], value, key)
    if (recipe.phrase) assert.equal(settings.phrase, recipe.phrase)
    const record = {
      schemaVersion: 1,
      templateId: recipe.id,
      templateVersion: '1.0.0',
      name: recipe.name,
      engineVersion: manifest.engine.version,
      projectPackageSchema: manifest.schemaVersion ?? manifest.version,
      source: {
        file: 'source.png',
        bytes: source.length,
        sha256: hash(source),
        width: 800,
        height: 1000,
      },
      settings,
      use: recipe.suitedTo,
      adjust: recipe.adjust,
      delivered: { project: 'project.astra', png: 'preview.png', html: 'playback.html' },
    }
    await writeFile(path.join(directory, 'recipe.json'), JSON.stringify(record, null, 2), {
      flag: 'wx',
    })
    await writeFile(
      path.join(directory, 'README.md'),
      `# ${recipe.name}\n\n版本1.0.0；calibrated 2.2.0，作品包v1。\n\n${recipe.suitedTo}\n\n${recipe.adjust}\n\n从“我的项目”导入project.astra，每次导入创建新项目。在编辑器选择源文件即可换图，风格参数保留；${recipe.phrase ? '“铺底文案”可修改短句；' : ''}保存后可回来继续编辑。下载PNG用于发布，playback.html可离线播放/暂停及悬停，project.astra用于继续编辑并含完整原图。\n\npreview.png是正式引擎真实1080长边输出，不是原图叠加或后期滤镜。源素材为原创几何演示，复杂自然照片/中文/签名需逐张验收；系统字体和设备变化可能影响重新生成，固定PNG和内嵌字形HTML用于保留成品。许可候选见整包LICENSE-DRAFT.md。\n`,
      { flag: 'wx' },
    )
    summary.push({
      id: recipe.id,
      name: recipe.name,
      directory: 'templates/' + recipe.id,
      recipe: 'templates/' + recipe.id + '/recipe.json',
    })
    report.templates.push({
      id: recipe.id,
      sourceHash: hash(source),
      pngHash: hash(png.bytes),
      htmlHash: hash(html.bytes),
      packageHash: hash(project.bytes),
      settings,
      originalSourceMatched: true,
    })
    await page.screenshot({ path: path.join(evidence, recipe.id + '-editor.png') })
    console.log(`BUILT ${recipe.id}: actual PNG, HTML and editable package`)
  }
  await mkdir(path.join(pack, 'source'))
  await writeFile(
    path.join(pack, 'source/source-art.mjs'),
    await readFile('scripts/templates/starter-source-art.mjs'),
  )
  const sourceTool = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Astra 原创素材生成工具</title><style>*{box-sizing:border-box}body{margin:0;background:#111615;color:#f5f3ef;font:15px system-ui;padding:40px 24px}main{max-width:1100px;margin:auto}.eyebrow{color:#58e8ed;font-size:11px;letter-spacing:4px}h1{font-size:clamp(28px,5vw,48px)}p{line-height:1.8;color:#b4c2b2}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:24px}article{padding:16px;border:1px solid #425145;border-radius:16px}canvas{display:block;width:100%;height:auto;border-radius:8px}h2{font-size:20px}button{width:100%;min-height:46px;background:#58e8ed;border:0;border-radius:24px;color:#111615;cursor:pointer}button:focus-visible{outline:3px solid #fff;outline-offset:3px}</style><main><div class="eyebrow">ASTRA · ORIGINAL SOURCES</div><h1>几何光影 · 原创素材</h1><p>此工具在本机重新绘制三幅源素材，无外部图片、字体或网络请求。下载源图后，可放入字符编辑器继续创作。</p><div class="grid" id="sources"></div></main><script>const draw=${drawStarterSource.toString()};const recipes=${JSON.stringify(starterRecipes.map(({ id, name }) => ({ id, name })))};for(const recipe of recipes){const article=document.createElement('article'),canvas=document.createElement('canvas');canvas.width=800;canvas.height=1000;draw(canvas.getContext('2d'),recipe.id,800,1000);const heading=document.createElement('h2');heading.textContent=recipe.name;const button=document.createElement('button');button.textContent='下载 '+recipe.name+' 原图';button.dataset.source=recipe.id;button.onclick=()=>canvas.toBlob(blob=>{const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=recipe.id+'.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)},'image/png');article.append(canvas,heading,button);document.getElementById('sources').append(article)}</script></html>`
  await writeFile(path.join(pack, 'source/generate-sources.html'), sourceTool, { flag: 'wx' })
  await writeFile(
    path.join(pack, 'VERIFY.ps1'),
    await readFile('scripts/templates/verify-delivery.ps1'),
  )
  await writeFile(
    path.join(pack, 'SOURCES.md'),
    `# 原创来源\n\n三幅source.png由本包source/source-art.mjs中的drawStarterSource程序绘制。原始输入只有路径、梯度、颜色和尺寸；没有第三方图片、字体、签名、音频或AI位图。source/generate-sources.html可直接离线打开并下载重新绘制的原图。\n\n创作工具源码来自Astra项目；成品字形由当前浏览器系统字体栅格化，未包含字体文件。校验和证明文件完整性，不证明身份、商用许可或购买权益。对外发布许可由实际运营权利人确定，见LICENSE-DRAFT.md。\n`,
    { flag: 'wx' },
  )
  await writeFile(
    path.join(pack, 'LICENSE-DRAFT.md'),
    `# 模板许可候选 v1.0.0\n\n状态：本地交付候选，尚未上架收费；本文件不是已生效的对外销售授权。许可主体、支持期限与正式条款待运营权利人定稿。\n\n候选范围：允许使用模板和包内原创源素材创作、修改、导出并将成品用于个人或商业项目；允许交付使用模板创作的成品给客户。不得转售或公开再分发未经实质修改的模板包，不得冒称Astra官方，不授予Logo/品牌商标独占权。源生成代码与几何素材拟允许为创作成品修改使用，其独立再分发范围须与正式条款一致。\n\n用户替换的图片、短句、字体或其他素材需具有相应使用权。当前包为明文可编辑文件，分享会交付完整源图；退款不能追回已下载文件。当前没有交易、权益校验或承诺未来版本免费升级。\n`,
    { flag: 'wx' },
  )
  await writeFile(
    path.join(pack, 'README.md'),
    `# Astra 几何光影入门包 v1\n\n交付候选版本1.0.0，当前生产引擎calibrated 2.2.0，三份原创可编辑模板：\n\n${starterRecipes.map((recipe) => `- ${recipe.name}：${recipe.modeLabel}，${recipe.adjust}`).join('\n')}\n\n## 开始创作\n\n1. 打开Astra“我的项目”，选择“导入作品包”，导入templates目录内的project.astra；每次导入创建新项目。\n2. 打开新项目，选择源文件可替换自己的素材；中文模板可直接改“铺底文案”。\n3. 预览确认后保存到当前浏览器，或免费下载PNG/HTML/作品包。成品下载不等于保存可编辑项目。\n\nPNG用于发布，HTML用于离线播放/暂停/悬停，.astra用于继续编辑并包含完整原图。原始source.png和recipe.json便于检查配方，源码工具source/generate-sources.html可离线重新绘制原图。\n\n## 版本与限制\n\n系统字体/浏览器差异可能影响重绘，固定PNG/内嵌字形HTML保留成品；不包含历史引擎或字体文件。当前包仅是三几何样品的交付候选，不认证自然照片、中文或真实签名通用商业画质，不含账户/支付/云同步。源码绘制来源见SOURCES.md，许可状态见LICENSE-DRAFT.md，没有虚构价格或销量。\n\n## 校验\n\n在解压目录运行pwsh -File ./VERIFY.ps1，验证全部文件的大小及SHA256。也可加-ZipPath指定原ZIP，同时使用.NET解析器核对归档内容。manifest不记录自己的hash；ZIP的.sha256为独立伴随文件，只作完整性比较，不是购买或身份凭证。\n`,
    { flag: 'wx' },
  )
  const manifest = await writeManifest(pack, {
    schemaVersion: 1,
    id: 'astra-starter-pack',
    version: '1.0.0',
    name: '几何光影入门包',
    createdAt: new Date().toISOString(),
    engineVersion: '2.2.0',
    projectPackageSchema: 1,
    status: 'local-delivery-candidate',
    templates: summary,
  })
  report.archive = await writeZip(pack, pack + '.zip')
  report.assets = manifest.assets.length
  assert.deepEqual(report.errors, [])
  report.passed = true
  console.log(`BUILT ${manifest.assets.length} assets; ZIP ${report.archive.bytes} bytes`)
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }
  await page.screenshot({ path: path.join(evidence, 'failure.png') })
  throw error
} finally {
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  await browser.close()
}
