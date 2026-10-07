import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_CUTOUT_OUTPUT || `test-results/signature-font-cutout-${Date.now()}`)
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce', acceptDownloads: true,
  recordVideo: process.argv.includes('--record') ? { dir: path.join(out, 'video'), size: { width: 1440, height: 960 } } : undefined })
const report = { browser: browser.version(), errors: [], cases: [] }
const page = await context.newPage()
page.on('pageerror', (e) => report.errors.push(e.message))
try {
  await page.goto(base + '/signature-portrait')
  const data = await page.evaluate(async () => {
    const { SIGNATURE_FONTS, loadSignatureFont } = await import('/src/lib/signature-portrait/fonts.ts')
    const { generateHandwritingVariants } = await import('/src/lib/signature-portrait/variants.ts')
    const { createSignatureProject, readSignatureProject } = await import('/src/lib/signature-portrait/project.ts')
    const { loadImageElement } = await import('/src/lib/signature-portrait/extract.ts')
    const { cutoutSignature } = await import('/src/lib/signature-portrait/cutout-client.ts')
    const { isolateSignaturePixels } = await import('/src/lib/signature-portrait/signature-cutout.ts')
    const check = (v, label) => { if (!v) throw Error(label) }
    const hash = async (s) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', s.canvas.getContext('2d').getImageData(0,0,s.width,s.height).data)), b=>b.toString(16).padStart(2,'0')).join('')
    const rows = [], samples = [], stamps = []
    const sheet = document.createElement('canvas'); sheet.width = 1200; sheet.height = SIGNATURE_FONTS.length * 104
    const ctx = sheet.getContext('2d'); ctx.fillStyle = '#f5f3ef'; ctx.fillRect(0,0,sheet.width,sheet.height)
    for (let f = 0; f < SIGNATURE_FONTS.length; f++) {
      const font = SIGNATURE_FONTS[f]
      for (const name of ['李云舟','张思雨 Astra']) {
        const [a,b] = await Promise.all([0,1].map(()=>generateHandwritingVariants(name,{font:font.id,count:8,seed:712})))
        const hashes = await Promise.all(a.map(hash)); const repeated = await Promise.all(b.map(hash))
        check(JSON.stringify(hashes)===JSON.stringify(repeated), 'deterministic font')
        for (const s of a) {
          const p = s.canvas.getContext('2d').getImageData(0,0,s.width,s.height)
          for(let y=0;y<s.height;y++) for(let x=0;x<s.width;x++) if(x<4||y<4||x>=s.width-4||y>=s.height-4)
            check(!p.data[(y*s.width+x)*4+3], 'complete transparent font border')
          check(s.source.font===font.id && s.width<=420 && s.height<=420,'recipe')
        }
        rows.push({ font:font.id,name,count:a.length,hash:hashes[0] })
        if (name==='李云舟') {
          stamps.push(a[0]); ctx.fillStyle='#203029';ctx.font='16px sans-serif';ctx.fillText(font.name,12,f*104+22)
          a.slice(0,4).forEach((s,i)=>ctx.drawImage(s.canvas,110+i*265,f*104+30,s.width*.8,s.height*.8))
        }
      }
    }
    check(new Set(rows.filter(r=>r.name==='李云舟').map(r=>r.hash)).size===6,'six distinct fonts')
    let missing=false;try{await loadSignatureFont('zcoolkuaile','𠮷')}catch(e){missing=e.message.includes('不支持')}
    check(missing,'missing glyph rejected')
    const portraitBlob = await (await fetch('/artwork/portrait-reference.png')).blob()
    const portraitFile = new File([portraitBlob],'portrait.png',{type:'image/png'})
    const loaded = await loadImageElement(portraitFile)
    const project={portrait:loaded.image,portraitFile,portraitName:'font-cutout',width:640,height:800,
      options:{background:'#f5f3ef',colorize:true,inkStyle:'ink'},stamps,
      placements:stamps.map((s,i)=>({x:120,y:80+i*100,angle:0,targetSize:100,stampIndex:i,strength:1,tint:{r:40,g:70,b:90},blend:'soft',depth:0}))}
    const packed = await createSignatureProject(project)
    const restored = await readSignatureProject(new File([packed],'fonts.astra-signature'))
    for(let i=0;i<stamps.length;i++)check(await hash(stamps[i])===await hash(restored.project.stamps[i]),'font project RGBA restore')
    check(JSON.stringify(stamps.map(s=>s.source))===JSON.stringify(restored.project.stamps.map(s=>s.source)),'all six recipes restore')
    restored.dispose();URL.revokeObjectURL(loaded.objectUrl)
    const img=new Image();img.src='/docs/research/2026-10-04-signature-capacity/beethoven-signature.svg';await img.decode()
    const ref=document.createElement('canvas');ref.width=1024;ref.height=400
    ref.getContext('2d').drawImage(img,90,110,840,130)
    const reference=ref.getContext('2d').getImageData(0,0,1024,400)
    const overview=document.createElement('canvas');overview.width=1024;overview.height=6*160
    const oc=overview.getContext('2d');oc.fillStyle='#fff';oc.fillRect(0,0,overview.width,overview.height)
    let fixture
    for(const [n,kind] of ['paper','shadow','blue','light','transparent','partial-alpha'].entries()) {
      const source=new ImageData(1024,400)
      for(let y=0;y<400;y++)for(let x=0;x<1024;x++){
        const at=(y*1024+x)*4,a=reference.data[at+3]/255
        const shadow=kind==='shadow'? 65*Math.exp(-((x-460)**2/180000+(y-180)**2/20000)):0
        const paper=[245-shadow,239-shadow,226-shadow],pen=kind==='blue'?[30,60,180]:kind==='light'?[245,242,220]:[20,24,32]
        for(let c=0;c<3;c++)source.data[at+c]=kind==='transparent'||kind==='partial-alpha'?pen[c]:Math.round((kind==='light'?20:paper[c])*(1-a)+pen[c]*a)
        source.data[at+3]=kind==='transparent'?reference.data[at+3]:kind==='partial-alpha'?Math.round(reference.data[at+3]*.5):255
      }
      const result=await cutoutSignature(source,{polarity:'auto',sensitivity:60},new AbortController().signal)
      let solid=0,kept=0,background=0,residue=0,maxAlpha=0
      for(let y=0;y<400;y++)for(let x=0;x<1024;x++){
        const expected=reference.data[(y*1024+x)*4+3]
        const dx=x-result.bounds.x+8,dy=y-result.bounds.y+8
        const actual=dx>=0&&dy>=0&&dx<result.pixels.width&&dy<result.pixels.height?result.pixels.data[(dy*result.pixels.width+dx)*4+3]:0
        maxAlpha=Math.max(maxAlpha,actual)
        if(expected>=240){solid++;if(actual>=(kind==='partial-alpha'?110:220))kept++}
        if(!expected){background++;if(actual)residue++}
      }
      check(kept/solid>.99,'complete solid handwriting '+kind)
      check(residue===0,'background removed '+kind)
      if(kind==='partial-alpha')check(maxAlpha<=128,'original opacity retained')
      const canvas=document.createElement('canvas');canvas.width=result.pixels.width;canvas.height=result.pixels.height
      canvas.getContext('2d').putImageData(result.pixels,0,0);oc.drawImage(canvas,20,n*160+15,Math.min(980,canvas.width),canvas.height*Math.min(1,980/canvas.width))
      samples.push({kind,polarity:result.polarity,solid,kept,residue,maxAlpha,width:canvas.width,height:canvas.height})
      if(kind==='shadow'){
        const raw=document.createElement('canvas');raw.width=1024;raw.height=400;raw.getContext('2d').putImageData(source,0,0)
        fixture=raw.toDataURL('image/png').split(',')[1]
      }
    }
    for(const kind of ['blank','empty']){
      const p=new ImageData(200,80)
      if(kind==='blank')p.data.fill(255)
      let rejected=false;try{isolateSignaturePixels(p,{polarity:'auto',sensitivity:60})}catch{rejected=true}
      check(rejected,'empty image rejected')
    }
    const c=new AbortController();c.abort();let aborted=false
    try{await cutoutSignature(reference,{polarity:'auto',sensitivity:60},c.signal)}catch(e){aborted=e.name==='AbortError'}
    check(aborted,'preabort')
    const mid=new AbortController();const promise=cutoutSignature(reference,{polarity:'auto',sensitivity:60},mid.signal);mid.abort()
    let cancelled=false;try{await promise}catch(e){cancelled=e.name==='AbortError'}check(cancelled,'mid abort')
    return {rows,samples,packedBytes:packed.size,fontSheet:sheet.toDataURL('image/png').split(',')[1],cutoutSheet:overview.toDataURL('image/png').split(',')[1],fixture}
  })
  for(const [key,name] of [['fontSheet','fonts.png'],['cutoutSheet','cutouts.png'],['fixture','shadow-signature.png']]){
    await writeFile(path.join(out,name),Buffer.from(data[key],'base64'));delete data[key]
  }
  report.cases.push({case:'six-font-generation-project-and-six-cutouts',...data})
  if (process.env.ASTRA_UI_URL) await page.goto(process.env.ASTRA_UI_URL + '/signature-portrait')
  await page.getByLabel('名字',{exact:true}).fill('李云舟')
  await page.getByLabel('目标遍数',{exact:true}).fill('10')
  for(const [id,name] of [['mashanzheng','行楷'],['longcang','草书'],['zhimangxing','行草'],['liujianmaocao','毛草'],['zcoolxiaowei','宋韵'],['zcoolkuaile','圆趣']]) {
    await page.getByLabel('书写字体',{exact:true}).selectOption(id)
    await page.waitForFunction(()=>document.querySelector('.font-preview .sample')?.textContent==='李云舟')
    assert((await page.locator('.font-preview .caption').textContent()).includes(name))
    await page.getByRole('button',{name:'一键生成 10 种写法',exact:true}).click()
    await page.getByRole('button',{name:'一键生成 10 种写法',exact:true}).waitFor()
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='一键生成 10 种写法')?.disabled)
    assert.equal(await page.locator('.creation-bar .error').count(),0)
  }
  report.cases.push({case:'six-font-live-preview-and-bank-generation',url:process.env.ASTRA_UI_URL || base})
  await page.locator('input[type=file][multiple]').setInputFiles(path.join(out,'shadow-signature.png'))
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button',{name:'确认并加入画像',exact:true}).waitFor()
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='确认并加入画像')?.disabled)
  await page.screenshot({path:path.join(out,'cutout-desktop.png'),fullPage:false})
  await page.getByLabel('签名提取力度').fill('75')
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='确认并加入画像')?.disabled)
  await page.getByRole('button',{name:'确认并加入画像',exact:true}).click()
  await page.getByRole('dialog').waitFor({state:'detached'})
  assert.equal(await page.locator('.stamps img[alt="shadow-signature.png"]').count(),1)
  report.cases.push({case:'confirm-cutout-before-use-and-adjust'})
  await page.locator('input[type=file][multiple]').setInputFiles([path.join(out,'shadow-signature.png'),path.join(out,'shadow-signature.png')])
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='确认笔迹，下一张')?.disabled)
  await page.getByRole('button',{name:'确认笔迹，下一张',exact:true}).click()
  await page.getByRole('button',{name:'取消上传',exact:true}).click()
  assert.equal(await page.locator('.stamps img[alt="shadow-signature.png"]').count(),1)
  report.cases.push({case:'batch-cancel-no-partial-commit'})
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme)
    await page.setViewportSize({width:390,height:844})
    await page.locator('input[type=file][multiple]').setInputFiles(path.join(out,'shadow-signature.png'))
    await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='确认并加入画像')?.disabled)
    assert(await page.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth))
    await page.screenshot({path:path.join(out,`cutout-${theme}-mobile.png`)})
    await page.getByLabel('取消签名抠图').click()
  }
  report.cases.push({case:'two-themes-390px-no-dialog-overflow'})
  assert.deepEqual(report.errors,[])
  report.passed=true
} catch(e) {report.failure=String(e);process.exitCode=1}
finally {await context.close();await browser.close();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({out,passed:report.passed,failure:report.failure,cases:report.cases.length}))
