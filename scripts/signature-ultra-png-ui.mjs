import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out=path.resolve(process.env.ASTRA_ULTRA_OUTPUT||`test-results/signature-ultra-ui-${Date.now()}`)
const base=process.env.ASTRA_PREVIEW_URL||'http://127.0.0.1:5188'
const input=path.resolve(process.env.ASTRA_ULTRA_PROJECT||'test-results/signature-png-ui-production-edge-final/pop-4k.astra-signature')
await mkdir(out,{recursive:true})
const source=await readFile(input),manifest=JSON.parse(source.subarray(43,43+source.readUInt32LE(7)))
const browser=await chromium.launch({channel:process.env.ASTRA_BROWSER_CHANNEL||'msedge',headless:true})
const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true,
  recordVideo:process.argv.includes('--record')?{dir:path.join(out,'video'),size:{width:1440,height:960}}:undefined})
const page=await context.newPage()
const report={browser:browser.version(),base,sourceSha256:createHash('sha256').update(source).digest('hex'),errors:[],cases:[],checks:[]}
for(const file of ['src/views/SignaturePortraitView.vue','src/components/signature/SignatureUltraExport.vue','src/lib/signature-portrait/raster-stripes.ts','src/lib/signature-portrait/ultra-png-export.ts','src/lib/signature-portrait/png-stream.ts','src/lib/signature-portrait/raster-worker-client.ts','src/lib/signature-portrait/raster-worker-protocol.ts','src/lib/signature-portrait/raster.worker.ts']) {
  report.sourceHashes??={};report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex')
}
page.on('pageerror',e=>report.errors.push(e.message))
let downloads=0;page.on('download',()=>downloads++)
await page.addInitScript(()=>{
  const NativeWorker=window.Worker;window.__stripeWorkers=[]
  window.Worker=class extends NativeWorker{
    constructor(uri,settings){super(uri,settings);this.record={uri:String(uri),terminated:false,export:false,progress:0};window.__stripeWorkers.push(this.record)
      this.addEventListener('message',e=>{if(e.data.type==='progress')this.record.progress++})}
    postMessage(message,transfer){if(message.type==='png-stripes'){this.record.export=true;this.record.width=message.width;this.record.height=message.height
      if(window.__failNextStripe){window.__failNextStripe=false;throw Error('QA ultra export failure')}}return super.postMessage(message,transfer)}
    terminate(){this.record.terminated=true;return super.terminate()}
  }
})
const save=async()=>writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')
const ready=async()=>page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='下载超清 PNG'&&!b.disabled),undefined,{timeout:180000})
const snapshot=()=>page.locator('.result-canvas').evaluate(c=>c.toDataURL())
const meterStart=()=>page.evaluate(()=>{
  const m={running:true,start:performance.now(),previous:performance.now(),frames:[],tasks:[],titles:[]};window.__ultraMeter=m
  const tick=t=>{if(!m.running)return;m.frames.push(t-m.previous);m.previous=t;const title=document.querySelector('.creation-bar .render-feedback strong')?.textContent;if(title&&m.titles.at(-1)!==title)m.titles.push(title);requestAnimationFrame(tick)};requestAnimationFrame(tick)
  m.observer=new PerformanceObserver(l=>m.tasks.push(...l.getEntries().map(e=>({start:e.startTime-m.start,duration:e.duration}))));m.observer.observe({type:'longtask',buffered:false})
})
const meterEnd=()=>page.evaluate(()=>{
  const m=window.__ultraMeter;m.running=false;m.observer.disconnect();const sorted=m.frames.sort((a,b)=>a-b)
  return {durationMs:performance.now()-m.start,rafCount:sorted.length,rafP95:sorted[Math.floor((sorted.length-1)*.95)],rafMax:sorted.at(-1),longTasks:m.tasks,titles:m.titles}
})
function crops(width,height){return [[.35,.35],[.5,.5],[.7,.65]].map(([x,y])=>{
  const p=manifest.placements.filter(p=>p.strength>.7).sort((a,b)=>Math.hypot(a.x/manifest.width-x,a.y/manifest.height-y)-Math.hypot(b.x/manifest.width-x,b.y/manifest.height-y))[0]
  return {x:Math.max(0,Math.min(width-1024,Math.round(p.x/manifest.width*width-512))),y:Math.max(0,Math.min(height-768,Math.round(p.y/manifest.height*height-384))),width:1024,height:768}
})}
async function exportFile(id,longSide,inkMode='outline',interact=false){
  await page.getByLabel('超清导出尺寸').selectOption(String(longSide));await page.getByLabel('超清笔迹方式').selectOption(inkMode)
  const before=await snapshot();await meterStart()
  const event=page.waitForEvent('download',{timeout:360000})
  await page.getByRole('button',{name:'下载超清 PNG',exact:true}).click()
  await page.locator('.creation-bar .render-feedback').waitFor()
  await page.screenshot({path:path.join(out,`loading-${id}.png`),fullPage:false})
  if(interact){await page.getByLabel('缩放清晰度').selectOption('fast');await page.getByRole('button',{name:'放大',exact:true}).click();await page.getByRole('button',{name:'适应',exact:true}).click()}
  const download=await event;const file=id+'.png';await download.saveAs(path.join(out,file));await ready()
  const performance=await meterEnd()
  assert.equal(await snapshot(),before,'export preserves displayed result')
  assert.equal(await page.locator('.creation-bar .error').count(),0)
  const handle=await open(path.join(out,file),'r'),header=Buffer.alloc(24);await handle.read(header,0,24,0);await handle.close()
  const width=header.readUInt32BE(16),height=header.readUInt32BE(20);assert.equal(Math.max(width,height),longSide)
  const workers=await page.evaluate(()=>window.__stripeWorkers.filter(w=>w.export));assert(workers.every(w=>w.terminated))
  report.cases.push({id,file,longSide,inkMode,width,height,placements:manifest.placements.length,crops:crops(width,height),performance})
  await save();console.log(JSON.stringify({stage:'production-export',id,width,height,...performance}))
}
try{
  await page.goto(base+'/signature-portrait')
  await page.locator('input[accept=".astra-signature"]').setInputFiles(input);await ready()
  assert.equal(await page.locator('.creation-bar .error').count(),0)
  await exportFile('outline-8k',8192,'outline',true)
  await page.getByLabel('签名走向',{exact:true}).selectOption('flow')
  await page.locator('.result-settings-changed').waitFor()
  await exportFile('outline-16k',16384)
  report.checks.push({case:'unapplied-controls-use-fixed-layout',passed:true})
  const baseline=await snapshot()
  for(const theme of ['light','dark']){
    await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await page.setViewportSize({width:390,height:844})
    await page.getByRole('button',{name:'下载超清 PNG',exact:true}).click()
    await page.waitForFunction(()=>window.__stripeWorkers.some(w=>w.export&&!w.terminated&&w.progress>0),undefined,{timeout:90000})
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
    await page.screenshot({path:path.join(out,`loading-${theme}-mobile.png`),fullPage:false})
    await page.getByRole('button',{name:'取消PNG导出',exact:true}).click();await ready()
  }
  await page.setViewportSize({width:1440,height:960});await page.evaluate(()=>document.documentElement.dataset.theme='light')
  assert.equal(downloads,2)
  report.checks.push({case:'mobile-two-theme-cancel-no-download',passed:true})
  await page.evaluate(()=>window.__failNextStripe=true)
  await page.getByRole('button',{name:'下载超清 PNG',exact:true}).click()
  await page.locator('.creation-bar .error').waitFor()
  await ready();assert.equal(await snapshot(),baseline)
  assert.equal(downloads,2)
  await exportFile('retry-8k',8192)
  report.checks.push({case:'failure-keeps-result-and-retry',passed:true})
  await page.getByRole('button',{name:'下载超清 PNG',exact:true}).click()
  await page.waitForFunction(()=>window.__stripeWorkers.some(w=>w.export&&!w.terminated&&w.progress>0),undefined,{timeout:90000})
  await page.getByRole('link',{name:'Astra 首页',exact:true}).first().click()
  await page.waitForURL(new URL('/',base).href,{timeout:30000})
  await page.waitForTimeout(100)
  const workers=await page.evaluate(()=>window.__stripeWorkers.filter(w=>w.export));assert(workers.every(w=>w.terminated))
  assert.equal(downloads,3)
  report.checks.push({case:'leave-cancels-and-releases-export-worker',passed:true})
  assert.deepEqual(report.errors,[]);report.passed=true
}catch(e){report.failure=String(e);process.exitCode=1}
finally{await context.close();await browser.close();await save()}
console.log(JSON.stringify({out,passed:report.passed,failure:report.failure,cases:report.cases.length,checks:report.checks.length}))
