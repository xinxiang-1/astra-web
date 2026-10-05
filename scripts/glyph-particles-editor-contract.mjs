import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const production = process.env.ASTRA_PARTICLES_PRODUCTION === '1'
const out = path.resolve(process.env.ASTRA_PARTICLES_OUTPUT || `test-results/particles-editor-${Date.now()}`)
await mkdir(out,{recursive:true})
const browser = await chromium.launch({channel:process.env.ASTRA_BROWSER_CHANNEL || 'msedge',headless:true})
const report={browser:browser.version(),base,production,errors:[],desktop:[],touch:[],passed:false}
report.sourceHashes=Object.fromEntries(await Promise.all([
 'src/lib/art-engine/canvas.ts','src/lib/art-engine/frame-render-client.ts',
 'src/lib/art-engine/frame-render.worker.ts','src/lib/art-engine/preview-render-client.ts',
 'src/lib/art-engine/embed.ts','src/views/AsciiArtView.vue',
 'scripts/glyph-particles-editor-contract.mjs',
].map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])))
const context=await browser.newContext({viewport:{width:1440,height:960},acceptDownloads:true,reducedMotion:'no-preference'})
await context.addInitScript(()=>{
 localStorage.setItem('astra-theme','dark')
 const NativeWorker=window.Worker
 window.__particleWorkers=new Set()
 window.Worker=class extends NativeWorker{
  constructor(url,options){super(url,options);if(String(url).includes('frame-render.worker'))window.__particleWorkers.add(this)}
  terminate(){window.__particleWorkers.delete(this);super.terminate()}
 }
})
const page=await context.newPage()
page.on('pageerror',error=>report.errors.push(error.message))
page.on('dialog',dialog=>dialog.accept())
page.setDefaultTimeout(60000)
const source=path.resolve('public/artwork/porcelain-study-v1.png')
const pngHash=value=>createHash('sha256').update(value).digest('hex')
const canvas=target=>target.locator('.ascii-scroll .ascii-canvas').first()
const image=async target=>canvas(target).evaluate(c=>c.toDataURL())
async function choose(target){
 await target.locator('details.calibrated-effects').evaluate(d=>{d.open=true})
 await target.getByRole('group',{name:'六模式悬停',exact:true}).getByRole('button',{name:'字符聚散试用',exact:true}).click()
 await target.waitForFunction(()=>document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.hover==='particles')
}
async function ready(target,mode){
 await target.waitForFunction(mode=>{
  const c=document.querySelector('.ascii-scroll .ascii-canvas')
  return c?.width>100 && c.dataset.renderPending==='false' && (!mode || c.dataset.mode===mode) && !document.querySelector('.editor-package')?.disabled
 },mode)
}
async function settled(target){
 await target.waitForFunction(()=>{
  const c=document.querySelector('.ascii-scroll .ascii-canvas')
  return c?.dataset.renderPending==='false' && c.dataset.pointerStrength==='0' && c.dataset.interactionActive==='false'
 },{},{timeout:60000})
}
async function mouseGesture(target,locator){
 await locator.scrollIntoViewIfNeeded()
 const box=await locator.boundingBox()
 for(let i=0;i<18;i++){
  await target.mouse.move(box.x+box.width*(.15+.7*i/17),box.y+box.height*(.5+Math.sin(i/17*Math.PI*2)*.14))
  await target.waitForTimeout(25)
 }
 return box
}
async function touchGesture(target,selector,id){
 const el=target.locator(selector).first();await el.scrollIntoViewIfNeeded()
 // A new fullscreen Canvas exists before its first complete asynchronous frame.
 // Read the baseline only after the actual target is ready and at rest.
 await target.waitForFunction(selector=>{
  const c=document.querySelector(selector)
  return c?.width>100 && (c.dataset.ready==='true' ||
   (c.dataset.renderPending==='false' && c.dataset.hover==='particles' &&
    c.dataset.pointerStrength==='0' && c.dataset.interactionActive==='false'))
 },selector,{timeout:60000})
 const baseline=await el.evaluate(c=>c.toDataURL())
 const baselineSize=await el.evaluate(c=>({width:c.width,height:c.height}))
 const touchAction=await el.evaluate(c=>getComputedStyle(c).touchAction)
 assert.equal(touchAction,'none',id+' touch action')
 await el.evaluate(c=>{
  window.__particleTouch={down:0,move:0,up:0,cancel:0}
  for(const [event,key]of [['pointerdown','down'],['pointermove','move'],['pointerup','up'],['pointercancel','cancel']])
   c.addEventListener(event,()=>window.__particleTouch[key]++)
 })
 const box=await el.boundingBox(),cdp=await target.context().newCDPSession(target)
 const point=i=>({x:box.x+box.width*(.15+.7*i/10),y:box.y+box.height*(.5+Math.sin(i/10*Math.PI*2)*.14),id:1})
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(0)]})
 for(let i=1;i<=10;i++){
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(i)]})
  await target.waitForTimeout(40)
 }
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
 await cdp.detach()
 const trace=await target.evaluate(()=>window.__particleTouch)
 assert.equal(trace.down,1);assert.equal(trace.up,1);assert.equal(trace.cancel,0);assert(trace.move>=9)
 await target.waitForFunction(({selector,baseline})=>document.querySelector(selector)?.toDataURL()!==baseline,{selector,baseline},{timeout:60000,polling:100})
 await target.waitForFunction(({selector,baseline})=>document.querySelector(selector)?.toDataURL()===baseline,{selector,baseline},{timeout:60000,polling:250})
 const returned=await el.evaluate(c=>c.toDataURL())
 assert.equal(pngHash(returned),pngHash(baseline),id+' touch exact return')
 report.touch.push({id,touchAction,trace,baselineSize,visibleScatter:true,exactRecovery:true})
}
async function exportHtml(){
 await page.locator('.editor-header-actions .art-button').click()
 await page.locator('.format-grid button').filter({hasText:'动态网页'}).click()
 const pending=page.waitForEvent('download',{timeout:120000})
 await page.getByRole('button',{name:'免费下载作品',exact:true}).click()
 const download=await pending,file=path.join(out,'particles-offline.html')
 await download.saveAs(file)
 await page.keyboard.press('Escape')
 return readFile(file,'utf8')
}
async function startRecording(){
 return canvas(page).evaluate(c=>{
  const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(v=>MediaRecorder.isTypeSupported(v))
  if(!mime)throw new Error('No native recording codec available')
  const stream=c.captureStream(30),chunks=[],recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2500000})
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)}
  recorder.start(200)
  window.__particleRecording={stream,chunks,recorder,mime,start:performance.now()}
  return {mime,width:c.width,height:c.height,requestedFrameRate:30}
 })
}
async function stopRecording(metadata){
 const clip=await page.evaluate(async()=>{
  const r=window.__particleRecording
  await new Promise(resolve=>{r.recorder.onstop=resolve;r.recorder.stop()})
  const elapsedMs=performance.now()-r.start,blob=new Blob(r.chunks,{type:r.mime})
  r.stream.getTracks().forEach(t=>t.stop());delete window.__particleRecording
  const dataUrl=await new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)})
  return {elapsedMs,data:dataUrl.split(',')[1]}
 })
 const bytes=Buffer.from(clip.data,'base64')
 await writeFile(path.join(out,'editor-glyph-particles.webm'),bytes)
 report.recording={...metadata,elapsedMs:clip.elapsedMs,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),source:'Actual editor Canvas with real Playwright mouse input; exported MP4 does not record an interaction track'}
}
try{
 await page.goto(base+'/ascii-art')
 await page.locator('input[type=file]').first().setInputFiles(source)
 await ready(page)
 await choose(page)
 const labels=['光影字符','原色字符','中文铺字','轮廓线稿','点阵细节','印刷网点']
 const modes=['density','color','phrase','contour','braille','halftone']
 for(const label of labels){
  await page.locator('.six-modes button').filter({hasText:label}).click()
  await ready(page,modes[labels.indexOf(label)])
  await page.mouse.move(0,0);await settled(page)
  const baseline=await image(page)
  await canvas(page).evaluate(c=>{
   window.__particleFrameTrace=[]
   window.__particleFrameObserver?.disconnect()
   window.__particleFrameObserver=new MutationObserver(()=>{
    window.__particleFrameTrace.push({wallMs:performance.now(),clock:Number(c.dataset.interactionTime),peak:Number(c.dataset.particlePeak),pointerStrength:Number(c.dataset.pointerStrength),active:c.dataset.interactionActive})
   })
   window.__particleFrameObserver.observe(c,{attributes:true,attributeFilter:['data-particle-peak']})
  })
  const recording=process.env.ASTRA_PARTICLES_RECORD==='1' && label===labels[0] ? await startRecording() : null
  const gestureStartMs=await page.evaluate(()=>performance.now())
  await mouseGesture(page,canvas(page))
  await page.waitForFunction(()=>{
   const c=document.querySelector('.ascii-scroll .ascii-canvas')
   return Number(c?.dataset.pointerStrength)>0 && c.dataset.interactionActive==='true' && Number(c.dataset.particlePeak)>.005
  },{},{timeout:60000})
  const during=await image(page)
  assert.notEqual(during,baseline,label+' visible scatter')
  const stats=await canvas(page).evaluate(c=>({peak:Number(c.dataset.particlePeak),bytes:Number(c.dataset.particleBytes)}))
  assert(stats.peak>.005,label+' particle movement')
  await canvas(page).screenshot({path:path.join(out,'active-'+labels.indexOf(label)+'.png')})
  await page.mouse.move(0,0);await settled(page)
  const recoveredMs=await page.evaluate(()=>performance.now())
  assert.equal(pngHash(await image(page)),pngHash(baseline),label+' actual page exact recovery')
  if(recording)await stopRecording(recording)
  const frameTrace=await page.evaluate(()=>window.__particleFrameTrace)
  report.desktop.push({label,peak:stats.peak,bytes:stats.bytes,visibleScatter:true,exactRecovery:true,gestureStartMs,recoveredMs,frameTrace})
  console.log('particles-editor: '+label+' real interaction passed')
 }
 await page.locator('.six-modes button').filter({hasText:labels[0]}).click();await ready(page,'density')
 await page.mouse.move(0,0);await settled(page)
 const staticBaseline=await image(page)
 await page.screenshot({path:path.join(out,'editor-dark.png')})
 await page.getByRole('button',{name:'全屏 ↗',exact:true}).click()
 const fullscreen=page.locator('.fs-overlay .ascii-canvas');await fullscreen.waitFor()
 await page.waitForFunction(()=>{
  const c=document.querySelector('.fs-overlay .ascii-canvas')
  return c?.dataset.renderPending==='false' && c.dataset.hover==='particles' && c.dataset.interactionActive==='false'
 })
 const fullscreenBaseline=await fullscreen.evaluate(c=>c.toDataURL())
 const fullscreenWorkers=await page.evaluate(()=>window.__particleWorkers.size)
 assert.equal(fullscreenWorkers,2,'Both actual fullscreen workers are active')
 await mouseGesture(page,fullscreen)
 await page.waitForFunction(()=>Number(document.querySelector('.fs-overlay .ascii-canvas')?.dataset.particlePeak)>.005)
 assert.notEqual(await fullscreen.evaluate(c=>c.toDataURL()),fullscreenBaseline,'fullscreen visible scatter')
 await page.mouse.move(0,0)
 await page.waitForFunction(baseline=>document.querySelector('.fs-overlay .ascii-canvas')?.toDataURL()===baseline,fullscreenBaseline,{timeout:60000,polling:250})
 await page.keyboard.press('Escape')
 const remainingWorkers=await page.evaluate(()=>window.__particleWorkers.size)
 assert.equal(remainingWorkers,1,'fullscreen renderer released')
 await settled(page)
 assert.equal(pngHash(await image(page)),pngHash(staticBaseline),'fullscreen returns main original')
 report.fullscreen={interactive:true,released:true,fullscreenWorkers,remainingWorkers,exactMainRecovery:true,exactFullscreenRecovery:true}
 await page.getByRole('group',{name:'六模式微动',exact:true}).getByRole('button',{name:'流动',exact:true}).click()
 await page.getByRole('button',{name:'暂停动效',exact:true}).click()
 await page.waitForFunction(()=>{
  const c=document.querySelector('.ascii-scroll .ascii-canvas')
  return c?.dataset.renderPending==='false' && c.dataset.paused==='true'
 })
 const time=await canvas(page).getAttribute('data-time')
 const pausedBaseline=await image(page)
 await mouseGesture(page,canvas(page))
 await page.waitForFunction(()=>Number(document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.particlePeak)>.005)
 assert.notEqual(await image(page),pausedBaseline,'paused ambient allows visible scatter')
 assert.equal(await canvas(page).getAttribute('data-time'),time,'ambient paused while scatter responds')
 await page.mouse.move(0,0);await settled(page)
 assert.equal(pngHash(await image(page)),pngHash(pausedBaseline),'paused ambient exact recovery')
 report.pause={ambientFrozen:true,hoverContinues:true}
 await page.getByRole('group',{name:'六模式微动',exact:true}).getByRole('button',{name:'静态',exact:true}).click()
 await page.waitForFunction(()=>document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.motion==='none')
 await settled(page)
 const reducedBaseline=await image(page)
 await page.emulateMedia({reducedMotion:'reduce'})
 await mouseGesture(page,canvas(page));await page.waitForTimeout(150)
 assert.equal(pngHash(await image(page)),pngHash(reducedBaseline),'reduced motion stays static')
 assert.equal(await canvas(page).evaluate(c=>getComputedStyle(c).touchAction),'auto')
 report.reducedMotion={static:true,scrollAllowed:true}
 await page.emulateMedia({reducedMotion:'no-preference'});await page.mouse.move(0,0);await settled(page)
 const html=await exportHtml()
 const payload=JSON.parse(html.match(/<script id="art-data" type="application\/json">([\s\S]*?)<\/script>/)[1])
 assert.equal(payload.hover,'particles')
 const mobileContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'no-preference'})
 const mobile=await mobileContext.newPage()
 mobile.on('pageerror',error=>report.errors.push(error.message))
 await mobile.goto(base+'/ascii-art');await mobile.locator('input[type=file]').first().setInputFiles(source);await ready(mobile)
 await mobile.getByRole('button',{name:'调整效果',exact:true}).click()
 await mobile.getByRole('button',{name:/^低清/}).click();await ready(mobile);await choose(mobile)
 await touchGesture(mobile,'.ascii-scroll .ascii-canvas','mobile editor')
 await mobile.getByRole('button',{name:'全屏 ↗',exact:true}).click()
 await touchGesture(mobile,'.fs-overlay .ascii-canvas','mobile fullscreen')
 await mobile.keyboard.press('Escape')
 const offlineContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:'no-preference'})
 const requests=[]
 await offlineContext.route('**/*',route=>{requests.push(route.request().url());return route.abort()})
 const offline=await offlineContext.newPage()
 offline.on('pageerror',error=>report.errors.push(error.message))
 await offline.setContent(html,{waitUntil:'load'})
 await offline.waitForFunction(()=>document.querySelector('canvas')?.dataset.ready==='true')
 await touchGesture(offline,'canvas','offline mobile')
 assert.equal(requests.length,0,'offline makes no network requests')
 report.offline={hover:payload.hover,networkRequests:requests.length,htmlSha256:createHash('sha256').update(html).digest('hex')}
 await offlineContext.close();await mobileContext.close()
 await page.locator('input[type=file]').first().setInputFiles(path.resolve('test-results/video-responsive-final-fullscreen-edge-20261004/source.webm'))
 await ready(page);await choose(page)
 await page.waitForFunction(()=>document.querySelector('.ascii-scroll .ascii-canvas')?.dataset.renderBackend==='worker')
 await mouseGesture(page,canvas(page))
 report.videoWorker=await canvas(page).evaluate(c=>({backend:c.dataset.renderBackend,hover:c.dataset.hover,time:document.querySelector('.video-thumb.show').currentTime}))
 assert.equal(report.videoWorker.hover,'particles');assert(report.videoWorker.time>0)
 await page.mouse.move(0,0)
 await page.locator('.editor-back').click()
 await page.getByRole('button',{name:'放弃更改并离开',exact:true}).click()
 await page.waitForURL(base+'/gallery')
 assert.equal(await page.evaluate(()=>window.__particleWorkers.size),0,'Leaving editor releases all workers')
 report.routeReleased=true
 assert.deepEqual(report.errors,[])
 report.passed=true
}catch(error){
 report.failure=error.stack
 report.failureFrameTrace=await page.evaluate(()=>window.__particleFrameTrace).catch(()=>null)
 report.failureCanvas=await canvas(page).evaluate(c=>({width:c.width,height:c.height,data:{...c.dataset}})).catch(()=>null)
 await page.screenshot({path:path.join(out,'failure.png'),timeout:10000}).catch(()=>{})
}
finally{
 await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2))
 await browser.close()
 console.log(JSON.stringify({out,...report},null,2))
}
if(!report.passed)process.exitCode=1
