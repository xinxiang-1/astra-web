import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const out=path.resolve(process.env.ASTRA_ULTRA_OUTPUT||`test-results/signature-ultra-${Date.now()}`)
const base=process.env.ASTRA_PREVIEW_URL||'http://127.0.0.1:5180'
await mkdir(out,{recursive:true})
const browser=await chromium.launch({channel:process.env.ASTRA_BROWSER_CHANNEL||'msedge',headless:true})
const page=await browser.newPage({viewport:{width:1440,height:960}})
const report={browser:browser.version(),errors:[],cases:[]}
page.on('pageerror',e=>report.errors.push(e.message))
await page.exposeFunction('ultraDiagnostic',async value=>{
  for(const [name,data]of Object.entries(value.images))await writeFile(path.join(out,name+'.png'),Buffer.from(data,'base64'))
  report.diagnostic=value.stats
})
try {
  await page.goto(base+'/signature-portrait')
  const cases=await page.evaluate(async()=>{
    const {createSignatureRasterWorker}=await import('/src/lib/signature-portrait/raster-worker-client.ts')
    const {createTextStamp}=await import('/src/lib/signature-portrait/extract.ts')
    const {traceStamps,buildPathSvgDocument}=await import('/src/lib/signature-portrait/trace.ts')
    const {signatureExportSize}=await import('/src/lib/signature-portrait/ultra-png-export.ts')
    const {generateHandwritingVariants}=await import('/src/lib/signature-portrait/variants.ts')
    const {signatureTint}=await import('/src/lib/signature-portrait/render-style.ts')
    const check=(v,label)=>{if(!v)throw Error(label)}
    const stamps=[createTextStamp('李云舟',{maxSide:420}),...(await generateHandwritingVariants('张思雨',{count:8,font:'zcoolkuaile',seed:34})).slice(0,1)]
    const large=document.createElement('canvas');large.width=1181;large.height=319
    large.getContext('2d').drawImage(stamps[0].canvas,0,0,large.width,large.height)
    stamps.push({...stamps[0],id:'large',canvas:large,width:large.width,height:large.height})
    const wash=document.createElement('canvas');wash.width=307;wash.height=384
    const wc=wash.getContext('2d'),gr=wc.createLinearGradient(0,0,307,384)
    gr.addColorStop(0,'#f03684');gr.addColorStop(.5,'#1454a3');gr.addColorStop(1,'#fad269');wc.fillStyle=gr;wc.fillRect(0,0,307,384)
    wc.clearRect(0,0,40,100)
    const ps=Array.from({length:180},(_,i)=>({x:18.25+(i%12)*63.1,y:30.5+Math.floor(i/12)*63.71,angle:((i%9)-4)*.1,targetSize:40.5+(i%5)*8.3,
      stampIndex:i%3,strength:.13+(i%7)*.12,tint:{r:30.7+i*.8,g:22.9+i*.4,b:66.1+i*.6},blend:i%3?'soft':'ink',depth:(i%7)/7,tintLiteral:i%8===0}))
    const traced=await traceStamps(stamps)
    const decode=async(blob)=>{const b=await createImageBitmap(blob),c=document.createElement('canvas');c.width=b.width;c.height=b.height;c.getContext('2d').drawImage(b,0,0);b.close();return c.getContext('2d').getImageData(0,0,c.width,c.height)}
    const rows=[]
    for(const inkStyle of ['ink','cutout'])for(const colorize of [false,true])for(const coverFill of [false,true])for(const underlay of [0,.75]) {
      const options={inkStyle,colorize,coverFill,underlay,background:'#f5f3ef'}
      const w=769,h=1001
      const worker=await createSignatureRasterWorker(ps,traced,w,h,options,undefined,underlay?wash:undefined,{cutout:true,stampMaxLong:1000})
      try{
        const a=await decode(await worker.exportPng(w,h,1000,{tileSize:384}))
        const b=await decode(await worker.exportStripePng(w,h,1000,{inkMode:'original'}))
        let changed=0,max=0;for(let i=0;i<a.data.length;i++){const d=Math.abs(a.data[i]-b.data[i]);if(d)changed++;max=Math.max(max,d)}
        rows.push({case:'full-rgba',...options,width:w,height:h,changed,max})
        console.log(JSON.stringify(rows.at(-1)))
        check(!changed,'stripe RGBA parity '+JSON.stringify(rows.at(-1)))
      }finally{worker.dispose()}
    }
    // The single signature includes enclosed spaces; reference comes from the independent SVG renderer.
    for(const stamp of traced.slice(0,2))for(const strength of [.35,1]) {
      const w=1153,h=769,p={x:580.25,y:384.5,angle:.15,targetSize:900,stampIndex:0,strength,tint:{r:20,g:24,b:32},tintLiteral:true,blend:'soft',depth:0}
      const worker=await createSignatureRasterWorker([p],[stamp],w,h,{colorize:true,background:'#fff'},undefined,undefined,{outline:true,cutout:true})
      try{
        const actual=await decode(await worker.exportStripePng(w,h,1000,{inkMode:'outline'}))
        const full=new OffscreenCanvas(w,h),fc=full.getContext('2d',{willReadFrequently:true})
        fc.fillStyle='#fff';fc.fillRect(0,0,w,h);fc.fillStyle='rgb(20,24,32)';fc.globalAlpha=strength
        fc.translate(p.x,p.y);fc.rotate(p.angle);const scale=p.targetSize/Math.max(stamp.vector.width,stamp.vector.height)
        fc.scale(scale,scale);fc.translate(-stamp.vector.width/2,-stamp.vector.height/2)
        for(const d of stamp.vector.paths)fc.fill(new Path2D(d))
        const fullPixels=fc.getImageData(0,0,w,h)
        let fullChanged=0,fullMax=0,seamMax=0,worst=null
        for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let k=0;k<4;k++){
          const at=(y*w+x)*4+k,d=Math.abs(actual.data[at]-fullPixels.data[at]);if(d)fullChanged++;if(d>fullMax){fullMax=d;worst={x,y,actual:Array.from(actual.data.slice((y*w+x)*4,(y*w+x)*4+4)),expected:Array.from(fullPixels.data.slice((y*w+x)*4,(y*w+x)*4+4))}}
          if(x%384<2||x%384>381||y%384<2||y%384>381)seamMax=Math.max(seamMax,d)
        }
        if(fullMax>3){
          const png=pixels=>{const c=document.createElement('canvas');c.width=pixels.width;c.height=pixels.height;c.getContext('2d').putImageData(pixels,0,0);return c.toDataURL('image/png').split(',')[1]}
          await window.ultraDiagnostic({images:{actual:png(actual),expected:png(fullPixels)},stats:{fullChanged,fullMax,seamMax,worst}})
        }
        check(fullMax<=3,'full outline raster parity '+JSON.stringify({fullChanged,fullMax,seamMax,worst}))
        rows.push({case:'outline-full-raster',name:stamp.label,strength,fullChanged,fullMax,seamMax})
        const svg=buildPathSvgDocument([p],[stamp],w,h,{background:'#fff',colorize:true})
        const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})),img=new Image();img.src=url;await img.decode()
        const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0);URL.revokeObjectURL(url)
        const expected=c.getContext('2d').getImageData(0,0,w,h)
        let sum=0,max=0,changed=0,seam=0
        for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let channel=0;channel<4;channel++){
          const i=(y*w+x)*4+channel,d=Math.abs(actual.data[i]-expected.data[i]);sum+=d;max=Math.max(max,d);if(d)changed++
          if(x%384<2||x%384>381||y%384<2||y%384>381)seam+=d
        }
        const mae=sum/expected.data.length/255
        check(mae<.003,'SVG outline parity');rows.push({case:'outline-svg',name:stamp.label,strength,mae,max,changed,seam})
      }finally{worker.dispose()}
    }
    for(const colorize of [false,true])for(const coverFill of [false,true])for(const underlay of [0,.75]) {
      const w=769,h=1001,options={colorize,coverFill,underlay,background:'#f5f3ef'}
      const worker=await createSignatureRasterWorker(ps,traced,w,h,options,undefined,underlay?wash:undefined,{outline:true,cutout:true})
      try {
        const actual=await decode(await worker.exportStripePng(w,h,1000,{inkMode:'outline'}))
        const full=new OffscreenCanvas(w,h),fc=full.getContext('2d',{willReadFrequently:true})
        fc.fillStyle=options.background;fc.fillRect(0,0,w,h)
        if(underlay){const base=new OffscreenCanvas(wash.width,wash.height);base.getContext('2d',{willReadFrequently:true}).putImageData(wc.getImageData(0,0,wash.width,wash.height),0,0);fc.globalAlpha=underlay;fc.imageSmoothingQuality='high';fc.drawImage(base,0,0,w,h);fc.globalAlpha=1}
        for(const p of [...ps].sort((a,b)=>b.targetSize-a.targetSize||a.depth-b.depth)) {
          const vector=traced[p.stampIndex].vector,scale=p.targetSize/Math.max(vector.width,vector.height)
          if(coverFill){fc.save();fc.translate(p.x,p.y);fc.rotate(p.angle);fc.globalAlpha=Math.min(1,Math.max(0,.14+p.depth*.28))*Math.min(1,Math.max(0,p.strength));fc.fillStyle=`rgb(${p.tint.r|0},${p.tint.g|0},${p.tint.b|0})`;fc.beginPath();fc.ellipse(0,0,Math.max(2,vector.width*scale*.52),Math.max(2,vector.height*scale*.38),0,0,Math.PI*2);fc.fill();fc.restore()}
          fc.save();fc.translate(p.x,p.y);fc.rotate(p.angle);fc.scale(scale,scale);fc.translate(-vector.width/2,-vector.height/2)
          fc.globalAlpha=p.strength;fc.globalCompositeOperation=p.blend==='soft'?'source-over':'multiply'
          fc.fillStyle=`rgb(${signatureTint(colorize,p.tint.r,p.tint.g,p.tint.b,p.depth,p.tintLiteral).join(',')})`
          for(const d of vector.paths)fc.fill(new Path2D(d));fc.restore()
        }
        const expected=fc.getImageData(0,0,w,h);let changed=0,max=0,seamMax=0,sum=0
        for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let k=0;k<4;k++){
          const at=(y*w+x)*4+k,d=Math.abs(actual.data[at]-expected.data[at]);if(d)changed++;max=Math.max(max,d);sum+=d
          if(y%384<2||y%384>381)seamMax=Math.max(seamMax,d)
        }
        const mae=sum/expected.data.length/255
        // Soft ellipses use Canvas's translation-sensitive raster approximation.
        // Keep exact ink and band joins separate from that documented fill difference.
        check(seamMax<=3 && (!coverFill ? max<=3 : mae<.0005),'dense outline joins/ink '+JSON.stringify({colorize,coverFill,underlay,changed,max,seamMax,mae}))
        rows.push({case:'dense-full-outline',colorize,coverFill,underlay,changed,max,seamMax,mae,softFillPixelExact:max===0})
      }finally{worker.dispose()}
    }
    const cancelled={cancelled:false},worker=await createSignatureRasterWorker(ps,traced,769,1001,{},undefined,undefined,{outline:true})
    try{
      let aborted=false
      try{await worker.exportStripePng(2048,2560,1000,{inkMode:'outline',signal:cancelled,onProgress:()=>{cancelled.cancelled=true}})}catch(e){aborted=e.message==='已取消'}
      check(aborted,'stream cancellation')
      const retry=await worker.exportStripePng(385,511,1000,{inkMode:'outline'});check(retry.size>0,'retry after cancel')
      let rejected=false;try{await worker.exportStripePng(16385,200,1000)}catch{rejected=true}check(rejected,'oversized rejected')
      rows.push({case:'cancel-retry-dimension-reject'})
    }finally{worker.dispose()}
    check(signatureExportSize({width:3278,height:4096},16384).width===13112,'layout-preserving size')
    return rows
  })
  report.cases=cases;assert.deepEqual(report.errors,[]);report.passed=true
}catch(e){report.failure=String(e);process.exitCode=1}
finally{await browser.close();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({out,passed:report.passed,failure:report.failure,cases:report.cases.length}))
