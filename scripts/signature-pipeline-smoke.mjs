import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
import path from 'node:path'
import { createHash } from 'node:crypto'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const requireGpu = process.argv.includes('--require-gpu')
const directory = path.resolve('test-results/signature-pipeline')
await mkdir(directory,{recursive:true})
const bytes=await readFile('sandbox/signature-optimizer/fixtures/luxun-signature.svg')
const browser=await chromium.launch({headless:true})
try {
  const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1,reducedMotion:'reduce',acceptDownloads:true})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`${base}/signature-portrait`)
  const result=await page.evaluate(async raw=>{
    const engine=await import('/src/lib/signature-portrait/index.ts')
    const {runLayoutInWorker}=await import('/src/lib/signature-portrait/layout-worker-client.ts')
    const img=new Image();img.src='/artwork/portrait-reference.png';await img.decode()
    const handwriting=new Image();handwriting.src=`data:image/svg+xml;base64,${raw}`;await handwriting.decode()
    const stamp=engine.extractStampFromImage(handwriting,handwriting.width,handwriting.height,{maxSide:512,padding:2},{id:'luxun-historical',label:'历史手写测试样本'})
    const tracing=await engine.traceStamps([stamp])
    const productionGpu=engine.createGlStampPreview()
    if(productionGpu)productionGpu.dispose()
    const pixels=canvas=>canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
    function mae(a,b){let sum=0;for(let i=0;i<a.length;i++){if(i%4!==3)sum+=Math.abs(a[i]-b[i])}return sum/(a.length*.75*255)}
    const cases=[]
    let debug=null
    let proof=''
    for(const [name,background,invertDensity,ink,coverFill] of [['paper','#f5f3ef',false,undefined,false],['night','#111615',true,{r:238,g:234,b:226},false],['paper-dots','#f5f3ef',false,undefined,true],['night-dots','#111615',true,{r:238,g:234,b:226},true]]) {
      const layout=await engine.renderSignaturePortrait(img,img.width,img.height,[stamp],{maxSide:768,skipPaint:true,seed:42,density:30,minSizeRatio:.014,maxSizeRatio:.04,colorize:false,invertDensity,ink})
      const options={background,colorize:false,coverFill,underlay:0}
      const reference=engine.paintPlacementsScaled(layout.placements,[stamp],layout.width,layout.height,layout.width,layout.height,options)
      const tiled=await engine.paintPlacementsTiled(layout.placements,[stamp],layout.width,layout.height,layout.width,layout.height,{...options,tileSize:128})
      const svg=engine.buildPathSvgDocument(layout.placements,tracing,layout.width,layout.height,options)
      const vector=new Image(),url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));vector.src=url;await vector.decode()
      const raster=document.createElement('canvas');raster.width=layout.width;raster.height=layout.height;raster.getContext('2d').drawImage(vector,0,0);URL.revokeObjectURL(url)
      const gl=engine.createGlStampPreview(undefined,{allowUnverified:true});if(!gl)throw new Error('WebGL2 parity test unavailable')
      gl.setStamps([stamp]);gl.setColorize(false);gl.setCoverFill(coverFill);gl.setBackground(background);gl.setPlacements(layout.placements,layout.width,layout.height);gl.resize(layout.width,layout.height,1);gl.redraw()
      const gpu=document.createElement('canvas');gpu.width=layout.width;gpu.height=layout.height;gpu.getContext('2d').drawImage(gl.canvas,0,0)
      cases.push({name,placements:layout.placements.length,svgHasImage:/<image\b/.test(svg),svgHasEllipse:/<ellipse\b/.test(svg),tiledMAE:mae(pixels(reference),pixels(tiled)),svgMAE:mae(pixels(reference),pixels(raster)),gpuMAE:mae(pixels(reference),pixels(gpu))})
      if(name==='paper')debug={reference:reference.toDataURL('image/png').split(',')[1],gpu:gpu.toDataURL('image/png').split(',')[1],svg:raster.toDataURL('image/png').split(',')[1]}
      if(name==='night-dots')proof=reference.toDataURL('image/png').split(',')[1]
      gl.dispose()
    }
    const printStart=performance.now(), print=await engine.renderSignaturePortrait(img,img.width,img.height,[stamp],{maxSide:4096,skipPaint:true,density:30,minSizeRatio:.014,maxSizeRatio:.04,seed:42,invertDensity:false})
    const preview8k=await engine.renderSignaturePortrait(img,img.width,img.height,[stamp],{maxSide:8192,skipPaint:true,density:30,minSizeRatio:.014,maxSizeRatio:.04,seed:42,invertDensity:false})
    const printTiming=performance.now()-printStart
    const repeat=await engine.renderSignaturePortrait(img,img.width,img.height,[stamp],{maxSide:4096,skipPaint:true,density:30,minSizeRatio:.014,maxSizeRatio:.04,seed:42,invertDensity:false})
    const exports=[]
    for(const [name,layout] of [['4k',print],['8k',preview8k]]) {
      const start=performance.now()
      const canvas=await engine.paintPlacementsTiled(layout.placements,[stamp],layout.width,layout.height,layout.width,layout.height,{background:'#f5f3ef',colorize:false,coverFill:false,underlay:0,tileSize:512})
      const blob=await engine.canvasToPngBlob(canvas)
      const url=URL.createObjectURL(blob),decoded=new Image();decoded.src=url;await decoded.decode();URL.revokeObjectURL(url)
      exports.push({name,width:decoded.naturalWidth,height:decoded.naturalHeight,bytes:blob.size,ms:performance.now()-start,png:canvas.toDataURL('image/png').split(',')[1]})
      canvas.width=canvas.height=1
    }
    const edge=await engine.renderSignaturePortrait(img,img.width,img.height,[stamp],{maxSide:768,skipPaint:true,ink:{r:238,g:234,b:226},invertDensity:true,edgeOutline:true,edgeThreshold:.08,edgeColorMode:'custom',edgeColor:{r:34,g:152,b:200}})
    const customEdges=edge.placements.filter(p=>p.onEdge)
    const blank=document.createElement('canvas');blank.width=blank.height=40
    let blankRejected=false;try{engine.traceStampCanvas(blank)}catch{blankRejected=true}
    const data=new Uint8ClampedArray(320*320*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=(i/4)%255;data[i+3]=255}
    const signal={cancelled:false},cancelStart=performance.now()
    const pending=runLayoutInWorker({fullPixels:data,aPixels:data,outW:320,outH:320,aW:320,aH:320,aScale:1,longSide:4096,sizeMin:14,sizeMax:40,stampMetrics:[{width:stamp.width,height:stamp.height,aspect:stamp.width/stamp.height,inkRatio:.2}],options:{layoutMethod:'stipple',density:50,lloydIters:14,seed:42},signal})
    setTimeout(()=>{signal.cancelled=true},30)
    let cancellation='';try{await pending}catch(error){cancellation=error.message}
    return {cases,productionGpuEnabled:Boolean(productionGpu),gpuVerified:engine.SIGNATURE_GPU_PREVIEW_VERIFIED,customEdges:customEdges.length,customEdgeColorCorrect:customEdges.length>0&&customEdges.every(p=>p.tintLiteral&&p.tint.r===34&&p.tint.g===152&&p.tint.b===200),exports,print:{width:print.width,height:print.height,placements:print.placements.length,previewCanvas:[print.canvas.width,print.canvas.height]},preview8k:{width:preview8k.width,height:preview8k.height,placements:preview8k.placements.length,previewCanvas:[preview8k.canvas.width,preview8k.canvas.height]},printTiming,deterministic:JSON.stringify(print.placements)===JSON.stringify(repeat.placements),blankRejected,cancellation,cancelMs:performance.now()-cancelStart,proof,debug}
  },bytes.toString('base64'))
  for(const [name,png] of Object.entries(result.debug))await writeFile(path.join(directory,`debug-${name}.png`),Buffer.from(png,'base64'))
  delete result.debug
  console.log(result.cases)
  for(const item of result.cases){assert(!item.svgHasImage);assert.equal(item.svgHasEllipse,item.name.endsWith('dots'));assert(item.tiledMAE<.004,`tile seams: ${JSON.stringify(item)}`);assert(item.svgMAE<.04,`SVG color/geometry mismatch: ${JSON.stringify(item)}`)}
  assert.equal(result.productionGpuEnabled,result.gpuVerified)
  assert(result.customEdgeColorCorrect)
  for(const item of result.exports){assert.equal(Math.max(item.width,item.height),item.name==='4k'?4096:8192);assert(item.bytes>10000);await writeFile(path.join(directory,`real-handwriting-${item.name}.png`),Buffer.from(item.png,'base64'));delete item.png}
  assert.equal(Math.max(result.print.width,result.print.height),4096)
  assert.equal(Math.max(result.preview8k.width,result.preview8k.height),8192)
  assert.deepEqual(result.print.previewCanvas,[8,8]);assert.deepEqual(result.preview8k.previewCanvas,[8,8])
  assert(result.deterministic && result.blankRejected)
  assert.equal(result.cancellation,'已取消');assert(result.cancelMs<500,'cancellation must terminate active CPU work promptly')
  await writeFile(path.join(directory,'real-handwriting-night-dots.png'),Buffer.from(result.proof,'base64'));delete result.proof
  await page.getByRole('button',{name:'2K',exact:true}).click()
  await page.getByRole('button',{name:'一键试用示例',exact:true}).click()
  await page.waitForFunction(()=>document.querySelector('.preview-head .meta')?.textContent?.includes('枚签名'),{timeout:30000})
  const previewBackend=await page.locator('.result-canvas').evaluate(canvas=>canvas.getContext('2d')?'canvas2d':'webgl')
  assert.equal(previewBackend,result.gpuVerified?'webgl':'canvas2d')
  await page.getByLabel('作品底色').selectOption('night')
  await page.waitForFunction(()=>{const canvas=document.querySelector('.result-canvas');if(!canvas)return false;const target=document.createElement('canvas');target.width=target.height=1;const context=target.getContext('2d');context.drawImage(canvas,0,0,1,1);return context.getImageData(0,0,1,1).data[0]<90})
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(button=>button.textContent.trim()==='生成预览'&&!button.disabled),{},{timeout:30000})
  const uiInk=await page.locator('.result-canvas').evaluate(canvas=>{
    const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
    let max=0,min=255,sum=0,marks=0
    for(let i=0;i<data.length;i+=4){max=Math.max(max,data[i]);min=Math.min(min,data[i]);sum+=data[i];if(data[i]>20)marks++}
    return{max,min,mean:sum/(data.length/4),marks,pixels:data.length/4}
  })
  assert(uiInk.max-uiInk.min>8&&uiInk.marks>1000,'Actual UI must paint signatures, not only a flat background')
  result.uiInk=uiInk
  await page.locator('.preview').screenshot({path:path.join(directory,'actual-night-preview.png')})
  await page.setViewportSize({width:390,height:844})
  await page.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth+1,{},{timeout:5000}).catch(async error=>{
    await page.screenshot({path:path.join(directory,'mobile-overflow.png'),fullPage:true})
    console.log(await page.evaluate(()=>Array.from(document.querySelectorAll('body *')).map(el=>({tag:el.tagName,class:el.className,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width})).filter(item=>item.right>innerWidth+1&&item.width>0).slice(0,20)))
    throw error
  })
  await page.locator('.preview').screenshot({path:path.join(directory,'mobile-night-preview.png')})
  assert.deepEqual(errors,[])
  result.gpuGate={passed:result.cases.every(item=>item.gpuMAE<.02),threshold:.02,productionEnabled:result.gpuVerified}
  result.sourceHashes=Object.fromEntries(await Promise.all(['src/lib/signature-portrait/gl-preview.ts','src/lib/signature-portrait/woven.ts','src/lib/signature-portrait/layout.ts','src/lib/signature-portrait/render-style.ts','src/lib/signature-portrait/trace.ts','src/lib/signature-portrait/layout-worker-client.ts','src/views/SignaturePortraitView.vue','src/App.vue','sandbox/signature-optimizer/fixtures/luxun-signature.svg','public/artwork/portrait-reference.png'].map(async file=>[file,createHash('sha256').update(await readFile(file)).digest('hex')])))
  await writeFile(path.join(directory,'metrics.json'),JSON.stringify({...result,previewBackend,browser:await browser.version(),viewport:[1440,960],dpr:1,errors,scope:'Production Canvas, four render styles, actual 4K/8K PNG files, deterministic repeat, cancellation, custom edge ink, UI/mobile; GPU diagnostics are a separate failing promotion gate, not a commercial quality certificate'},null,2))
  console.log(JSON.stringify(result,null,2))
  if(requireGpu)for(const item of result.cases)assert(item.gpuMAE<.02,`GPU color/geometry mismatch: ${JSON.stringify(item)}`)
}finally{await browser.close()}
