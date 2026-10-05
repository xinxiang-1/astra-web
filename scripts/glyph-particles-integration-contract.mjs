import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const out = path.resolve(process.env.ASTRA_PARTICLES_OUTPUT || `test-results/particles-integration-${Date.now()}`)
await mkdir(out, { recursive: true })
const frozen = execFileSync('git', ['show', 'c7f1eb2:src/lib/art-engine/canvas.ts'], { encoding: 'utf8' })
await writeFile(path.join(out, 'baseline-canvas.ts'), frozen)
const prefix = '/' + path.relative(process.cwd(), out).split(path.sep).join('/')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const sources = ['src/lib/art-engine/canvas.ts','src/lib/art-engine/types.ts','src/lib/art-engine/index.ts','src/lib/art-engine/gpu.ts','src/lib/art-engine/embed.ts','src/lib/art-project-package.ts','src/views/AsciiArtView.vue','docs/prototypes/v9-glyph-particles/presentation.ts']
const report = { errors: [], cases: [], hashes: Object.fromEntries(await Promise.all(sources.map(async file => [file, sha(await readFile(file))]))) }
const fieldBody = source => source.slice(source.indexOf('  function makeStudioInteraction('),source.indexOf('  let interaction:'))
assert.equal(fieldBody((await readFile(sources[0],'utf8')).replaceAll('\r\n','\n')),fieldBody(frozen))
for(const file of ['src/views/ArtHomeView.vue','src/components/CharacterArtwork.vue','src/lib/ascii/studio-preview.ts'])
  assert.equal((await readFile(file,'utf8')).replaceAll('\r\n','\n'),execFileSync('git',['show',`c7f1eb2:${file}`],{encoding:'utf8'}))
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
report.browser = browser.version()
try {
  const page = await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'no-preference'})
  page.on('pageerror', error => report.errors.push(error.message))
  page.on('console', message => { if(message.text().startsWith('particles-progress:')) console.log(message.text()) })
  await page.goto(base + '/ascii-art')
  Object.assign(report, await page.evaluate(async ({prefix}) => {
    const {createCanvasArtRenderer: frozen} = await import(prefix + '/baseline-canvas.ts')
    const {createCanvasArtRenderer: current,ART_PARTICLE_MAX_CELLS} = await import('/src/lib/art-engine/canvas.ts')
    const {prepareArtFrame, createArtRenderer} = await import('/src/lib/art-engine/index.ts')
    const {createGlyphParticlePresentation} = await import('/docs/prototypes/v9-glyph-particles/presentation.ts')
    const require = (value,message) => { if(!value)throw new Error(message) }
    const pixels = c => c.getContext('2d').getImageData(0,0,c.width,c.height).data
    const equal = (a,b) => a.length===b.length && a.every((v,i)=>v===b[i])
    const surface = () => { const c=document.createElement('canvas');c.getContext('2d',{willReadFrequently:true});return c }
    const source=new Image();source.src='/artwork/porcelain-study-v1.png';await source.decode()
    const cases=[]
    for(const mode of ['density','color','phrase','contour','braille','halftone']) {
      for(const quality of ['density','color'].includes(mode) ? ['classic','high','supersampled','software'] : ['classic']) {
        for(const transparent of [false,true]) {
          const frame=prepareArtFrame(source,source.width,source.height,{
            mode,columns:64,phrase:'把名字写成光，ASTRA。',fontFamily:mode==='phrase'?'Microsoft YaHei, monospace':'Consolas, monospace',
            ...(quality!=='classic'?{rasterQuality:quality==='supersampled'?'supersampled':'high',fontWeight:600}:{}),
            ...(quality==='software'?{softwareRaster:true,colorFidelity:mode==='color',fontWeight:400}:{}),
          })
          const originalIndices=new Uint16Array(frame.indices),originalColors=new Uint8ClampedArray(frame.colors)
          const oldCanvas=surface(),newCanvas=surface(),restCanvas=surface(),legacyCanvas=surface(),legacyNew=surface()
          const prototype=createGlyphParticlePresentation()
          const old=frozen(oldCanvas,{experimentalTrail:prototype.prepare}),now=current(newCanvas),rest=frozen(restCanvas)
          const legacy=frozen(legacyCanvas),sameLegacy=current(legacyNew)
          const common={longEdge:360,transparent,motion:'none',effectProfile:'expressive',hoverStrength:.65,hoverRadius:.38}
          rest.render(frame,{longEdge:360,transparent})
          const neutral=pixels(restCanvas)
          let time=0, pointer={x:.15,y:.5,strength:.65,active:false},peak=0,matchedFrames=0
          const options=events=>({...common,hoverTime:time,pointer,pointerSamples:events})
          prototype.setTime(0);old.render(frame,{...options([]),hover:'trail'});now.render(frame,{...options([]),hover:'particles'})
          require(equal(neutral,pixels(newCanvas)),`${mode}/${quality} neutral`)
          for(let i=0;i<30;i++){
            time=(i+1)/60
            pointer={x:.15+.7*i/29,y:.5+Math.sin(i/29*Math.PI*2)*.16,strength:.65,active:true}
            const events=[{...pointer,time:time*1000}]
            prototype.setTime(time)
            old.render(frame,{...options(events),hover:'trail'})
            now.render(frame,{...options(events),hover:'particles'})
            require(equal(pixels(oldCanvas),pixels(newCanvas)),`${mode}/${quality}/${transparent} frozen prototype frame ${i}`)
            legacy.render(frame,{...options(events),hover:'trail'})
            sameLegacy.render(frame,{...options(events),hover:'trail'})
            if(i===29)require(equal(pixels(legacyCanvas),pixels(legacyNew)),`${mode}/${quality} legacy trail unchanged`)
            matchedFrames++
            peak=Math.max(peak,now.cacheStats.particles.peak)
          }
          require(peak>.01,`${mode} clear scatter`)
          pointer={...pointer,active:false}
          time+=1/60
          now.render(frame,{...options([{...pointer,time:time*1000}]),hover:'particles'})
          let steps=0,tailPeak=0
          for(;steps<100;steps++){
            time+=.1
            now.render(frame,{...options([]),hover:'particles'})
            if(!now.sampleFluidField(.5,.5).active)tailPeak=Math.max(tailPeak,now.cacheStats.particles.peak)
            if(!now.interactionActive)break
          }
          require(steps<100,`${mode} natural settle within 10s`)
          require(equal(neutral,pixels(newCanvas)),`${mode}/${quality}/${transparent} exact natural recovery`)
          pointer={x:.4,y:.5,strength:.65,active:true};time+=.1
          now.render(frame,{...options([{...pointer,time:time*1000}]),hover:'particles'})
          now.render(frame,{...options([]),hover:'particles',hoverStrength:0})
          require(equal(neutral,pixels(newCanvas)),`${mode} zero strength`)
          require(equal(frame.indices,originalIndices)&&equal(frame.colors,originalColors),`${mode} identities/colors unchanged`)
          const stats=now.cacheStats.particles
          require(stats.maxCells===ART_PARTICLE_MAX_CELLS && stats.bytes<=stats.limit,`${mode} bounded state/identity`)
          const bytes=stats.bytes
          for(const renderer of [old,now,rest,legacy,sameLegacy])renderer.destroy()
          prototype.destroy()
          require(now.cacheStats.particles.bytes===0,'particle memory released')
          cases.push({mode,quality,transparent,matchedFrames,peak,tailPeak,settleSeconds:steps*.1,bytes,exactRecovery:true,legacyTrailIdentical:true})
        }
      }
      console.log('particles-progress: '+mode+' frozen, recovery, legacy complete')
    }
    const frame=prepareArtFrame(source,source.width,source.height,{columns:64})
    const canvas=surface(),renderer=current(canvas)
    let peak=0
    for(let i=0;i<30;i++){
      const time=i/60, pointer={x:.15+.7*i/29,y:.5+Math.sin(i/29*Math.PI*2)*.16,strength:.65,active:true}
      renderer.render({...frame},{longEdge:360,hover:'particles',hoverStrength:.65,hoverTime:time,pointer,pointerSamples:[{...pointer,time:time*1000}]})
      peak=Math.max(peak,renderer.cacheStats.particles.peak)
    }
    require(peak>.01,'new decoded frame retains scatter state')
    const videoFrameIdentity={peak,bytes:renderer.cacheStats.particles.bytes}
    renderer.destroy()
    const large={...frame,columns:512,rows:512,indices:new Uint16Array(512*512),alpha:new Float32Array(512*512),colors:new Uint8ClampedArray(512*512*3),settings:{...frame.settings,softwareRaster:false}}
    const unavailable=current(surface())
    unavailable.render(large,{longEdge:32,hover:'particles',hoverStrength:1,pointer:{x:.5,y:.5,strength:1,active:true}})
    require(unavailable.cacheStats.particles.unavailable && unavailable.cacheStats.particles.bytes===0 && !unavailable.interactionActive,'capacity refusal stays static without allocation')
    unavailable.destroy()
    const wrapped=createArtRenderer(surface())
    wrapped.render(frame,{hover:'particles',hoverStrength:.65,longEdge:360})
    require(wrapped.backend==='canvas2d','GPU wrapper uses matching shared factory')
    wrapped.destroy()
    return {cases,videoFrameIdentity,capacity:{maxCells:ART_PARTICLE_MAX_CELLS,refusal:true},wrapperCanvas:true}
  },{prefix}))
  assert.equal(report.cases.length,24)
  assert.deepEqual(report.errors,[])
  report.passed=true
} catch(error) {
  report.passed=false
  report.failure=error.stack
} finally {
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2))
  await browser.close()
  console.log(JSON.stringify({out,...report},null,2))
}
if(!report.passed)process.exitCode=1
