import { chromium } from 'playwright'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const experiment = process.env.ASTRA_SIGNATURE_EXPERIMENT || '2026-09-30-woven-v1'
const directory = path.resolve('sandbox/signature-optimizer/experiments', experiment)
await mkdir(directory, { recursive: true })
const signatures = await Promise.all(['franklin', 'luxun'].map(async id => {
  const filename = `sandbox/signature-optimizer/fixtures/${id}-signature.svg`, bytes = await readFile(filename)
  return { id, filename, sha256: createHash('sha256').update(bytes).digest('hex'), src: `data:image/svg+xml;base64,${bytes.toString('base64')}` }
}))
const fixtures = [{ id: 'portrait', src: '/artwork/portrait-reference.png', split: 'train' }, { id: 'bust', src: '/demos/ascii-live/aristotle-bust.webp', split: 'dev' }]
const candidates = [
  { id: 'baseline', module: '/sandbox/signature-optimizer/baseline/engine/index.ts', parameters: { density: 30, minSizeRatio: .022, maxSizeRatio: .065 } },
  { id: 'balanced', module: '/sandbox/signature-optimizer/candidate/engine/index.ts', parameters: { layoutMethod: 'woven', density: 30, minSizeRatio: .022, maxSizeRatio: .065 } },
  { id: 'quality', module: '/sandbox/signature-optimizer/candidate/engine/index.ts', parameters: { layoutMethod: 'woven', density: 50, minSizeRatio: .01, maxSizeRatio: .032 } },
  { id: 'performance', module: '/sandbox/signature-optimizer/candidate/engine/index.ts', parameters: { layoutMethod: 'woven', density: 20, minSizeRatio: .032, maxSizeRatio: .08 } },
  { id: 'night', module: '/sandbox/signature-optimizer/candidate/engine/index.ts', parameters: { layoutMethod: 'woven', density: 50, minSizeRatio: .01, maxSizeRatio: .032, invertDensity: true, background: '#111615', ink: {r:238,g:234,b:226} } },
]
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  page.on('console', message => { if (message.text().startsWith('Signature benchmark:')) console.log(message.text()) })
  await page.goto(base)
  const baselinePath=process.env.ASTRA_SIGNATURE_BASELINE
  const cachedBaseline=baselinePath ? JSON.parse(await readFile(baselinePath,'utf8')) : null
  if (cachedBaseline && cachedBaseline.baselineHash !== createHash('sha256').update(await readFile('sandbox/signature-optimizer/baseline/engine/layout-compute.ts')).digest('hex')) throw new Error('Baseline source changed')
  if (cachedBaseline && cachedBaseline.browser !== await browser.version()) throw new Error('Baseline browser changed')
  const records = await page.evaluate(async ({ signatures, fixtures, candidates }) => {
    await document.fonts.ready
    const results = []
    function structure(image, canvas, inverse, background = '#f5f3ef') {
      const source = document.createElement('canvas'), actual = document.createElement('canvas')
      source.width = actual.width = canvas.width; source.height = actual.height = canvas.height
      source.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); actual.getContext('2d').drawImage(canvas, 0, 0)
      const a = source.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data, b = actual.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
      const target = [], ink = []
      const night=background==='#111615'
      for(let by=0;by<32;by++)for(let bx=0;bx<24;bx++) {let light=0,mark=0,count=0;for(let y=Math.floor(by*canvas.height/32);y<Math.floor((by+1)*canvas.height/32);y++)for(let x=Math.floor(bx*canvas.width/24);x<Math.floor((bx+1)*canvas.width/24);x++){const i=(y*canvas.width+x)*4;light+=(a[i]*.2126+a[i+1]*.7152+a[i+2]*.0722)/255;const brightness=b[i]*.2126+b[i+1]*.7152+b[i+2]*.0722;mark+=Math.max(0,night?(brightness-21)/217:(244-brightness)/244);count++}target.push(inverse?light/count:1-light/count);ink.push(mark/count)}
      const mean = array => array.reduce((sum,value)=>sum+value,0)/array.length, x=mean(target), y=mean(ink)
      let covariance=0, vx=0, vy=0
      for(let i=0;i<ink.length;i++){ const dx=target[i]-x,dy=ink[i]-y;covariance+=dx*dy;vx+=dx*dx;vy+=dy*dy }
      ink.sort((a,b)=>a-b)
      return { correlation:covariance/Math.sqrt(vx*vy), inkRange:ink[Math.floor(ink.length*.99)]-ink[Math.floor(ink.length*.01)], meanInk:y }
    }
    window.__signatureStructure = structure
    function footprints(placements, stamps) {
      const boxes = placements.map(p => { const stamp=stamps[p.stampIndex], scale=p.targetSize/Math.max(stamp.width,stamp.height); const w=stamp.width*scale/2,h=stamp.height*scale/2,c=Math.cos(p.angle),s=Math.sin(p.angle);return {x:p.x,y:p.y,w,h,c,s,rx:Math.abs(c*w)+Math.abs(s*h),ry:Math.abs(s*w)+Math.abs(c*h)} })
      const buckets=new Map(), colliding=new Set();let pairs=0
      function intersects(a,b){ for(const [x,y] of [[a.c,a.s],[-a.s,a.c],[b.c,b.s],[-b.s,b.c]]) {const distance=Math.abs((a.x-b.x)*x+(a.y-b.y)*y), ra=a.w*Math.abs(a.c*x+a.s*y)+a.h*Math.abs(-a.s*x+a.c*y), rb=b.w*Math.abs(b.c*x+b.s*y)+b.h*Math.abs(-b.s*x+b.c*y);if(distance>=ra+rb-.01)return false} return true }
      boxes.forEach((a,i)=> { const ids=new Set(); for(let y=Math.floor((a.y-a.ry)/40);y<=Math.floor((a.y+a.ry)/40);y++)for(let x=Math.floor((a.x-a.rx)/40);x<=Math.floor((a.x+a.rx)/40);x++){const key=`${x},${y}`,bucket=buckets.get(key)||[];bucket.forEach(j=>ids.add(j));bucket.push(i);buckets.set(key,bucket)} for(const j of ids){if(intersects(a,boxes[j])){pairs++;colliding.add(i);colliding.add(j)}} })
      const heights=boxes.map(b=>Math.min(b.w,b.h)*2).sort((a,b)=>a-b)
      return { collisionPairs:pairs, collidingFraction:colliding.size/Math.max(1,boxes.length), shortSideP10:heights[Math.floor(heights.length*.1)], shortSideMedian:heights[Math.floor(heights.length*.5)] }
    }
    for (const fixture of fixtures) {
      const image = new Image(); image.src=fixture.src;await image.decode()
      for (const signature of signatures) {
        const raw=new Image();raw.src=signature.src;await raw.decode()
        for (const candidate of candidates) {
          const engine=await import(candidate.module)
          console.log(`Signature benchmark: ${fixture.id}/${signature.id}/${candidate.id}`)
          const stamp=engine.extractStampFromImage(raw,raw.width,raw.height,{maxSide:512,padding:2},{id:signature.id,label:signature.id})
          const options={maxSide:768,lloydIters:3,edgeOutline:false,colorize:false,coverFill:false,invertDensity:false,background:'#f5f3ef',seed:42,...candidate.parameters}
          const start=performance.now(), layout=await engine.renderSignaturePortrait(image,image.width,image.height,[stamp],options), totalMs=performance.now()-start
          const crop=engine.paintPlacementsRegion(layout.placements,[stamp],{x:layout.width*.45,y:layout.height*.28,w:140,h:140},560,560,{background:'#f5f3ef',colorize:false,coverFill:false})
          results.push({id:`${fixture.id}-${signature.id}-${candidate.id}`,candidate:candidate.id,fixture:fixture.id,signature:signature.id,split:fixture.split,parameters:options,stamps:[{width:stamp.width,height:stamp.height}],placements:layout.placements.length,width:layout.width,height:layout.height,totalMs,...structure(image,layout.canvas,options.invertDensity,options.background),...footprints(layout.placements,[stamp]),png:layout.canvas.toDataURL('image/png').split(',')[1],crop:crop.toDataURL('image/png').split(',')[1],positions:JSON.stringify(layout.placements)})
        }
      }
    }
    return results
  }, { signatures, fixtures, candidates:cachedBaseline?candidates.filter(candidate=>candidate.id!=='baseline'):candidates })
  for (const record of records) {
    await writeFile(path.join(directory,`${record.id}.png`),Buffer.from(record.png,'base64'))
    await writeFile(path.join(directory,`${record.id}-crop.png`),Buffer.from(record.crop,'base64'))
    record.pngSha256=createHash('sha256').update(Buffer.from(record.png,'base64')).digest('hex')
    record.positionsSha256=createHash('sha256').update(record.positions).digest('hex')
    delete record.png;delete record.crop;delete record.positions
  }
  const sourceHashes=Object.fromEntries(await Promise.all(fixtures.map(async fixture=>[fixture.src,createHash('sha256').update(await readFile(path.resolve('public',fixture.src.slice(1)))).digest('hex')])))
  const baselineHash=createHash('sha256').update(await readFile('sandbox/signature-optimizer/baseline/engine/layout-compute.ts')).digest('hex')
  const candidateHash=createHash('sha256').update(await readFile('sandbox/signature-optimizer/candidate/engine/woven.ts')).digest('hex')
  if(cachedBaseline){
    if(JSON.stringify(cachedBaseline.sourceHashes)!==JSON.stringify(sourceHashes))throw new Error('Baseline inputs changed')
    for(const prior of cachedBaseline.records.filter(record=>record.candidate==='baseline')) {
      const png = await readFile(path.join(path.dirname(baselinePath),`${prior.id}.png`))
      const metric=await page.evaluate(async({src,png,options})=>{const image=new Image();image.src=src;await image.decode();const actual=new Image();actual.src=`data:image/png;base64,${png}`;await actual.decode();const canvas=document.createElement('canvas');canvas.width=actual.width;canvas.height=actual.height;canvas.getContext('2d').drawImage(actual,0,0);return window.__signatureStructure(image,canvas,options.invertDensity,options.background)}, {src:fixtures.find(fixture=>fixture.id===prior.fixture).src,png:png.toString('base64'),options:prior.parameters})
      records.push({...prior,...metric})
    }
  }
  await writeFile(path.join(directory,'results.json'),JSON.stringify({experiment,engineCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),baselineHash,candidateHash,cachedBaseline:baselinePath||null,sourceHashes,browser:await browser.version(),viewport:[1440,960],dpr:1,seed:42,signatureSources:signatures.map(({src,...rest})=>rest),evaluator:'signature-box-tone-collision-v2',budgets:{candidates:5,judges:0},limitations:'Two exploration portraits, no held-out quality claim; historical SVG signatures are handwriting-derived fixtures. Headless desktop timing is not mobile performance.',records},null,2))
  console.log(records.map(({id,placements,totalMs,correlation,inkRange,collidingFraction,shortSideP10})=>({id,placements,totalMs:Math.round(totalMs),correlation,inkRange,collidingFraction,shortSideP10})))
} finally { await browser.close() }
