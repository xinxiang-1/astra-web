import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
const directory='test-results/signature-pipeline/strokes'
await mkdir(directory,{recursive:true})
const raw=(await readFile('sandbox/signature-optimizer/fixtures/luxun-signature.svg')).toString('base64')
const browser=await chromium.launch({headless:true})
try {
 const page=await browser.newPage()
 await page.goto(process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180')
 const results=await page.evaluate(async raw=>{
  const engine=await import('/src/lib/signature-portrait/index.ts')
  const img=new Image();img.src=`data:image/svg+xml;base64,${raw}`;await img.decode()
  const stamp=engine.extractStampFromImage(img,img.width,img.height,{maxSide:512,padding:2},{id:'historical',label:'historical'})
  const results=[]
  for(const size of [8,16,40,96,220])for(const angle of [0,.15]){
   const placements=[{x:160,y:160,targetSize:size,angle,stampIndex:0,strength:1,tint:{r:0,g:0,b:0},tintLiteral:true,depth:1,blend:'soft'}]
   const canvas=engine.paintPlacementsScaled(placements,[stamp],320,320,320,320,{background:'#ffffff',colorize:false})
   const gl=engine.createGlStampPreview(undefined,{allowUnverified:true});if(!gl)throw new Error('WebGL2 unavailable');gl.setStamps([stamp]);gl.setPlacements(placements,320,320);gl.setBackground('#ffffff');gl.resize(320,320,1);gl.redraw()
   const gpu=document.createElement('canvas');gpu.width=gpu.height=320;gpu.getContext('2d').drawImage(gl.canvas,0,0)
   const cropA=document.createElement('canvas'),cropB=document.createElement('canvas');cropA.width=cropB.width=Math.ceil(size*1.5);cropA.height=cropB.height=Math.ceil(size*1.5)
   cropA.getContext('2d').drawImage(canvas,160-cropA.width/2,160-cropA.height/2,cropA.width,cropA.height,0,0,cropA.width,cropA.height)
   cropB.getContext('2d').drawImage(gpu,160-cropA.width/2,160-cropA.height/2,cropA.width,cropA.height,0,0,cropA.width,cropA.height)
   const a=cropA.getContext('2d').getImageData(0,0,cropA.width,cropA.height).data,b=cropB.getContext('2d').getImageData(0,0,cropA.width,cropA.height).data
   let massA=0,massB=0,mae=0
   for(let i=0;i<a.length;i+=4){massA+=255-a[i];massB+=255-b[i];mae+=Math.abs(a[i]-b[i])}
   results.push({size,angle,mae:mae/(a.length/4*255),massRatio:massB/massA,reference:cropA.toDataURL().split(',')[1],gpu:cropB.toDataURL().split(',')[1]})
   gl.dispose()
  }
  return results
 },raw)
 for(const r of results){for(const kind of ['reference','gpu']){await writeFile(`${directory}/${r.size}-${r.angle}-${kind}.png`,Buffer.from(r[kind],'base64'));delete r[kind]}}
 await writeFile(`${directory}/metrics.json`,JSON.stringify(results,null,2));console.log(results)
}finally{await browser.close()}
