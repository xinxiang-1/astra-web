import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
const out=path.resolve(process.env.ASTRA_ULTRA_OUTPUT||`test-results/signature-ultra-real-${Date.now()}`)
const base=process.env.ASTRA_PREVIEW_URL||'http://127.0.0.1:5180'
const input=path.resolve(process.env.ASTRA_ULTRA_PROJECT||'test-results/signature-png-ui-production-edge-final/pop-4k.astra-signature')
await mkdir(out,{recursive:true})
const url=p=>'/'+path.relative(process.cwd(),p).split(path.sep).join('/')
const browser=await chromium.launch({channel:process.env.ASTRA_BROWSER_CHANNEL||'msedge',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:960},acceptDownloads:true})
const report={browser:browser.version(),source:input,errors:[],cases:[]}
page.on('pageerror',e=>report.errors.push(e.message))
await page.exposeFunction('ultraProgress',v=>console.log(JSON.stringify(v)))
try {
  await page.goto(base+'/signature-portrait')
  report.scene=await page.evaluate(async uri=>{
    const {readSignatureProject}=await import('/src/lib/signature-portrait/project.ts')
    window.__realUltra=await readSignatureProject(await(await fetch(uri)).blob())
    const s=window.__realUltra.project
    const {createSignatureRasterWorker}=await import('/src/lib/signature-portrait/raster-worker-client.ts')
    const {prepareSignatureWash}=await import('/src/lib/signature-portrait/styled-wash.ts')
    const wash=await prepareSignatureWash(s.portrait,s.options)
    const worker=await createSignatureRasterWorker(s.placements,s.stamps,s.width,s.height,s.options,undefined,wash,{cutout:true})
    try {
      const overview=await worker.paint(820,1024,480,{tileSize:384})
      const frame=document.createElement('section');frame.id='ultra-prototype';frame.style.cssText='position:fixed;inset:90px 0 0;background:var(--bg-elevated);overflow:auto;z-index:1000;padding:24px;display:grid;grid-template-columns:1fr 1fr;gap:24px;color:var(--text)'
      const copy=document.createElement('div');copy.innerHTML='<h2>超清PNG · 轮廓重绘对照</h2><p>后台绘制完整签名并分块编码。当前预览使用轻量概览。</p><p id="ultra-prototype-status">已准备好</p><progress id="ultra-prototype-progress" max="1" value="0"></progress><p>可以继续浏览、缩放预览或取消导出。</p><input id="ultra-prototype-zoom" type="range" min="1" max="2" value="1" step=".1" aria-label="对照预览缩放" />'
      const figure=document.createElement('div');figure.style.cssText='max-height:780px;overflow:auto';overview.style.cssText='width:100%;height:auto;transform-origin:0 0'
      figure.append(overview);frame.append(copy,figure);document.body.append(frame)
      document.getElementById('ultra-prototype-zoom').oninput=e=>overview.style.transform=`scale(${e.target.value})`
    }finally{worker.dispose()}
    return {width:s.width,height:s.height,placements:s.placements.length,templates:s.stamps.length,options:s.options}
  },url(input))
  for(const longSide of [8192,16384]) {
    const download=page.waitForEvent('download',{timeout:360000})
    const run=page.evaluate(async longSide=>{
      const {exportSignatureUltraPng}=await import('/src/lib/signature-portrait/ultra-png-export.ts')
      const s=window.__realUltra.project,start=performance.now(),m={running:true,previous:performance.now(),frames:[],longTasks:[]}
      const tick=t=>{if(!m.running)return;m.frames.push(t-m.previous);m.previous=t;requestAnimationFrame(tick)};requestAnimationFrame(tick)
      const po=new PerformanceObserver(l=>m.longTasks.push(...l.getEntries().map(e=>({start:e.startTime-start,duration:e.duration}))))
      po.observe({type:'longtask',buffered:false})
      let reported=-.2
      const result=await exportSignatureUltraPng(s,{longSide,inkMode:'outline'},{onProgress:(stage,ratio)=>{
        document.getElementById('ultra-prototype-status').textContent=stage==='prepare'?'准备签名轮廓':stage==='encode'?'完成无损编码':'后台重绘与分块编码'
        document.getElementById('ultra-prototype-progress').value=ratio
        if(stage==='render'&&ratio>=reported+.2){reported=ratio;void window.ultraProgress({longSide,ratio})}
      }})
      m.running=false;po.disconnect()
      const a=document.createElement('a'),href=URL.createObjectURL(result.blob);a.href=href;a.download=`real-${longSide}.png`;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000)
      const crops=[]
      for(const [fx,fy]of [[.35,.35],[.5,.5],[.7,.65]]) {
        const p=s.placements.filter(p=>p.strength>.7).sort((a,b)=>Math.hypot(a.x/s.width-fx,a.y/s.height-fy)-Math.hypot(b.x/s.width-fx,b.y/s.height-fy))[0]
        const sx=result.width/s.width,sy=result.height/s.height
        crops.push({x:Math.max(0,Math.min(result.width-1024,Math.round(p.x*sx-512))),y:Math.max(0,Math.min(result.height-768,Math.round(p.y*sy-384))),width:1024,height:768,
          signature:{...p,x:p.x*sx,y:p.y*sy,targetSize:p.targetSize*(sx+sy)/2},template:{label:s.stamps[p.stampIndex].label,width:s.stamps[p.stampIndex].width,height:s.stamps[p.stampIndex].height}})
      }
      const sorted=m.frames.sort((a,b)=>a-b)
      return {longSide,width:result.width,height:result.height,bytes:result.blob.size,durationMs:performance.now()-start,rafCount:sorted.length,rafP95:sorted[Math.floor((sorted.length-1)*.95)],rafMax:sorted.at(-1),longTasks:m.longTasks,crops}
    },longSide)
    await page.getByLabel('对照预览缩放').fill('1.2')
    await page.screenshot({path:path.join(out,`loading-${longSide}.png`)})
    const result=await run
    await(await download).saveAs(path.join(out,`real-${longSide}.png`))
    const bytes=await readFile(path.join(out,`real-${longSide}.png`))
    assert.equal(bytes.readUInt32BE(16),result.width);assert.equal(bytes.readUInt32BE(20),result.height)
    report.cases.push(result)
    await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')
    console.log(JSON.stringify({stage:'real-export',...result,crops:result.crops.length}))
  }
  assert.deepEqual(report.errors,[]);report.passed=true
}catch(e){report.failure=String(e);process.exitCode=1}
finally{await browser.close();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({out,passed:report.passed,failure:report.failure,cases:report.cases.length}))
