import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const output = path.resolve(process.env.ASTRA_ENGINE_OUTPUT || 'test-results/engine-v2')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce', acceptDownloads: true })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto(`${base}/art-lab`)
  await page.getByRole('status').filter({ hasText: '作品已生成' }).waitFor()
  const result = await page.evaluate(async () => {
    const { prepareArtFrame, createArtRenderer, ART_MODES, ART_ENGINE_VERSION } = await import('/src/lib/art-engine/index.ts')
    const { imageDataToAscii } = await import('/src/lib/ascii/convert.ts')
    const source = document.createElement('canvas'); source.width = 400; source.height = 100
    const sourceCtx = source.getContext('2d')
    for (let x = 0; x < source.width; x++) { const n = Math.round(x / 399 * 255); sourceCtx.fillStyle = `rgb(${n},${n},${n})`; sourceCtx.fillRect(x,0,1,100) }
    const gradient = prepareArtFrame(source, 400, 100, { columns: 180, normalize: false, contrast: 0 })
    const reconstructed = []
    for (let x=0;x<gradient.columns;x++) reconstructed.push(gradient.glyphs[gradient.indices[x]].coverage * gradient.alpha[x] / gradient.statistics.maxCoverage)
    const sample = document.createElement('canvas'); sample.width = 180; sample.height = 1
    sample.getContext('2d').drawImage(source, 0, 0,180,1)
    const samples = sample.getContext('2d').getImageData(0,0,180,1)
    const legacy = imageDataToAscii(samples, '@80GCLft1i;:,. ', { invert: true, normalize: false, contrast: 0 })
    const density = new Map(gradient.glyphs.map(glyph=>[glyph.char,glyph.coverage / gradient.statistics.maxCoverage]))
    const target = Array.from({length:180}, (_,x)=>samples.data[x*4]/255)
    const mae = values => values.reduce((sum,n,i)=>sum+Math.abs(n-target[i]),0)/values.length
    const tone = { candidateMAE:mae(reconstructed), legacyMAE:mae([...legacy.text].map(char=>density.get(char)??0)), monotonic:reconstructed.every((v,i)=>i===0||v>=reconstructed[i-1]-.005) }
    const transparent = document.createElement('canvas');transparent.width=50;transparent.height=50
    const invisible = prepareArtFrame(transparent,50,50,{mode:'phrase',phrase:'我爱你👩‍💻',columns:24})
    sourceCtx.fillStyle='#fff';sourceCtx.fillRect(0,0,400,100)
    const phrase = prepareArtFrame(source,400,100,{mode:'phrase',phrase:'我爱你👩‍💻',columns:24,normalize:false,contrast:0})
    let invalidRejected=false;try {prepareArtFrame(source,Infinity,1)} catch {invalidRejected=true}
    const fixtures = ['/artwork/portrait-reference.png','/artwork/landscape.jpg','/artwork/pet.jpg','/artwork/portrait.jpg','/demos/ascii-live/aristotle-bust.webp']
    const cases=[]
    for (const src of fixtures) {
      const image=new Image();image.src=src;await image.decode()
      for (const {id} of ART_MODES) {
        const frame=prepareArtFrame(image,image.naturalWidth,image.naturalHeight,{mode:id,phrase:'山河万里',columns:120})
        const canvas=document.createElement('canvas'), renderer=createArtRenderer(canvas)
        const times=[]
        renderer.render(frame,{longEdge:1080})
        for(let i=0;i<5;i++) times.push(renderer.render(frame,{longEdge:1080}).renderMs)
        function hash() {const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let value=2166136261;for(let i=0;i<data.length;i+=7)value=Math.imul(value^data[i],16777619);return value}
        const first=hash();renderer.render(frame,{longEdge:1080,time:10});const stable=first===hash()
        renderer.render(frame,{longEdge:1080,time:0,motion:'wave'});const still=hash()
        renderer.render(frame,{longEdge:1080,time:2,motion:'wave'});const moving=still!==hash()
        times.sort((a,b)=>a-b)
        cases.push({src,mode:id,backend:renderer.backend,columns:frame.columns,rows:frame.rows,sourceAspect:image.naturalWidth/image.naturalHeight,preparationMs:frame.statistics.preparationMs,p50:times[2],p95:times[4],stable,moving,nonEmpty:frame.statistics.nonEmpty,width:canvas.width,height:canvas.height})
        renderer.destroy()
      }
    }
    const fallbackCanvas=document.createElement('canvas'), fallback=createArtRenderer(fallbackCanvas,{forceCanvas:true})
    fallback.render(phrase,{longEdge:512,transparent:true})
    const alpha=fallbackCanvas.getContext('2d').getImageData(0,0,fallbackCanvas.width,fallbackCanvas.height).data
    let empty=0,ink=0;for(let i=3;i<alpha.length;i+=4){if(alpha[i]===0)empty++;if(alpha[i]>0)ink++}
    const fallbackResult={backend:fallback.backend,empty,ink,width:fallbackCanvas.width,height:fallbackCanvas.height};fallback.destroy()
    return {version:ART_ENGINE_VERSION,browser:navigator.userAgent,dpr:devicePixelRatio,font:'Consolas / Microsoft YaHei system fallback',viewport:[innerWidth,innerHeight],tone,transparentCells:invisible.statistics.nonEmpty,phraseText:phrase.text.split('\n')[0],invalidRejected,cases,fallback:fallbackResult}
  })
  assert(result.tone.monotonic, 'calibrated gradient must remain monotonic')
  assert(result.tone.candidateMAE < .02, 'density/alpha must accurately represent normalized ink target')
  assert(result.tone.candidateMAE < result.tone.legacyMAE * .5, 'candidate must improve tone calibration')
  assert.equal(result.transparentCells, 0)
  assert(result.phraseText.startsWith('我爱你👩‍💻我爱你👩‍💻'), 'phrase order/graphemes must be preserved')
  assert(result.invalidRejected)
  assert.equal(result.fallback.backend,'canvas2d');assert(result.fallback.empty>0 && result.fallback.ink>0,'Canvas fallback must preserve transparent space and glyph ink')
  for (const item of result.cases) { assert(item.stable, `${item.src}/${item.mode} nondeterministic`);assert(item.moving, `${item.src}/${item.mode} frozen motion`);assert(item.nonEmpty>0);assert(Math.abs(item.width/item.height - item.sourceAspect)<.01, 'source proportions must be preserved') }
  for (const name of ['光影字符','原色字符','中文铺字','轮廓线稿','点阵细节','印刷网点']) {
    await page.getByRole('button',{name:new RegExp(name)}).first().click()
    await page.screenshot({path:path.join(output,`${name}.png`)})
  }
  await page.getByRole('button',{name:/中文铺字/}).first().click()
  await page.getByLabel('铺写的文字').fill('我爱你，山河万里')
  await page.getByRole('checkbox',{name:'透明背景',exact:true}).check()
  const download = page.waitForEvent('download')
  await page.getByRole('button',{name:'下载 4K PNG',exact:true}).click()
  const file=await download, filename=path.join(output,'phrase-4k-transparent.png')
  await file.saveAs(filename)
  const bytes=await readFile(filename)
  assert.equal(Math.max(bytes.readUInt32BE(16),bytes.readUInt32BE(20)),3840)
  result.png={path:filename,sha256:createHash('sha256').update(bytes).digest('hex'),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}
  await page.setViewportSize({width:390,height:844})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile horizontal overflow')
  await page.screenshot({path:path.join(output,'lab-mobile.png'),fullPage:true})
  assert.deepEqual(errors,[])
  await writeFile(path.join(output,'metrics.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify({tone:result.tone,cases:result.cases.length,maxP95:Math.max(...result.cases.map(item=>item.p95)),png:result.png,errors},null,2))
} finally { await browser.close() }
