import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { build } from 'vite'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(process.env.ASTRA_LIGHT_STORAGE_OUTPUT || `test-results/preview-light-storage-${Date.now()}`)
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const modes = (process.env.ASTRA_LIGHT_STORAGE_MODES || 'color,phrase').split(',')
const rounds = Number(process.env.ASTRA_LIGHT_STORAGE_ROUNDS || 3)
assert(modes.length > 0 && modes.every(mode => ['color', 'phrase'].includes(mode)), 'Select actual high-density color or phrase cases')
assert(Number.isSafeInteger(rounds) && rounds >= 1 && rounds <= 3, 'Use 1–3 independent worker lifetimes')
await mkdir(out, { recursive: true })
for (const storage of ['bitmap', 'surface']) {
  const dir = path.join(out, storage)
  execFileSync(process.execPath, ['scripts/preview-light-material-research.mjs'], {
    env: { ...process.env, ASTRA_LIGHT_MATERIAL_OUTPUT: dir, ASTRA_LIGHT_MATERIAL_STORAGE: storage, ASTRA_LIGHT_MATERIAL_BUILD_ONLY: '1' }, stdio: 'pipe',
  })
  if (storage === 'bitmap') {
    const source = (await readFile('src/lib/art-engine/frame-render.worker.ts', 'utf8')).replace("from './canvas'", "from './frozen'").replace("from './types'", "from '/src/lib/art-engine/types'").replace("from './frame-render-protocol'", "from '/src/lib/art-engine/frame-render-protocol'")
    await writeFile(path.join(dir, 'frozen-frame.worker.ts'), source)
  }
}
const sources = { frozen: ['bitmap', 'frozen-frame.worker.ts'], bitmap: ['bitmap', 'material-frame.worker.ts'], surface: ['surface', 'material-frame.worker.ts'] }
for (const [kind, [dir, filename]] of Object.entries(sources)) {
  await build({ configFile: false, publicDir: false, logLevel: 'silent', build: { outDir: path.join(out, 'bundle'), emptyOutDir: false, minify: false, lib: { entry: path.join(out, dir, filename), formats: ['es'], fileName: () => kind + '.worker.js' } } })
}
const prefix = '/' + path.relative(process.cwd(), out).split(path.sep).join('/')
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const report = { browser: browser.version(), parent: '92bc304', scope: 'Three real renderResponsive Workers, same fresh structured-cloned typed arrays and original event clocks. 180 columns and full RGB/alpha; fixed material representation is the only candidate difference. Three rotated orders across independent worker lifetimes; no between-pass readback, pool tuning, synthetic delivery delays or stable FPS claim.', hashes: {}, cases: [], passed: false }
report.rounds = rounds
report.hashes.workerProtocol = createHash('sha256').update(await readFile('src/lib/art-engine/frame-render.worker.ts')).digest('hex')
report.hashes.fixture = createHash('sha256').update(await readFile('public/artwork/porcelain-study-v1.png')).digest('hex')
for (const [kind,[dir]] of Object.entries(sources)) report.hashes[kind] = createHash('sha256').update(await readFile(path.join(out,dir,kind === 'frozen' ? 'frozen.ts':'candidate.ts'))).digest('hex')
try {
  const page = await browser.newPage()
  await page.goto(base + '/ascii-art', { waitUntil: 'domcontentloaded' })
  for (const mode of modes) {
    for (let round = 0; round < rounds; round++) {
      const entry = await page.evaluate(async ({ prefix, mode, round }) => {
        const { prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
        const image = new Image(); image.src = '/artwork/porcelain-study-v1.png'; await image.decode()
        const frame = prepareArtFrame(image, image.width, image.height, { mode, columns: 180, colored: true, phrase: '把名字写成光，ASTRA。', fontFamily: mode === 'phrase' ? 'Microsoft YaHei, monospace' : 'Consolas, monospace' })
        const { glyphs, ...wire } = frame
        const packets = glyphs.map(g => ({ char: g.char, coverage: g.coverage, pixels: g.tile.getContext('2d').getImageData(0,0,g.tile.width,g.tile.height) }))
        const names = ['frozen','bitmap','surface']
        const workers = Object.fromEntries(names.map(name => [name, new Worker(prefix + '/bundle/' + name + '.worker.js', { type: 'module' })]))
        const records = []
        const events = [{ x:.15,y:.5,active:false,time:0 }, ...Array.from({length:8},(_,i)=>({ x:.15+.7*i/7,y:.5+Math.sin(i/7*Math.PI*2)*.14,active:true,time:33*(i+1) })), { x:.85,y:.5,active:false,time:5000 }]
        let id=0
        const receive = (worker, message) => new Promise((resolve,reject)=>{
          const timeout = setTimeout(()=>{worker.removeEventListener('message',handle);reject(new Error('Actual Worker did not complete within 120 seconds'))},120000)
          const handle = event => { const r=event.data;if(r.id!==message.id||(!r.bitmap&&!r.error))return;clearTimeout(timeout);worker.removeEventListener('message',handle);if(r.error)reject(new Error(r.error));else resolve(r) }
          worker.addEventListener('message',handle);worker.postMessage(message)
        })
        try {
          for(let i=0;i<events.length;i++) {
            const event=events[i]
            const order=names.map((_,n)=>names[(n+round+i)%names.length])
            const timings={}, pixels={}, stats={}, progress={}
            for(const name of order) {
              const worker=workers[name]
              let drawing=0,interaction=0
              const observe=e=>{if(e.data.completedCells!==undefined)drawing++;if(e.data.phase==='interaction')interaction++}
              worker.addEventListener('message',observe)
              const start=performance.now()
              const response=await receive(worker,{ id:++id, ...(i===0?{glyphs:packets}:{}), frame:{...wire,indices:wire.indices.slice(),alpha:wire.alpha.slice(),colors:wire.colors.slice()}, options:{ longEdge:713,hover:'light',hoverStrength:.65,hoverRadius:.38,effectProfile:'expressive',motion:'none',hoverTime:event.time/1000,pointer:{...event,strength:event.active?.65:0},pointerSamples:[event] } })
              timings[name]={workerMs:response.renderMs,completeMs:performance.now()-start}
              stats[name]={main:response.cacheStats,light:response.lightMaterialStats??null}
              progress[name]={drawing,interaction}
              worker.removeEventListener('message',observe)
              const canvas=new OffscreenCanvas(response.bitmap.width,response.bitmap.height),ctx=canvas.getContext('2d')
              ctx.drawImage(response.bitmap,0,0);response.bitmap.close();pixels[name]=ctx.getImageData(0,0,canvas.width,canvas.height).data;canvas.width=canvas.height=1
            }
            const parity={}
            for(const name of ['bitmap','surface']) {
              let changed=0,maxDelta=0
              for(let p=0;p<pixels.frozen.length;p++) {const d=Math.abs(pixels.frozen[p]-pixels[name][p]);if(d)changed++;maxDelta=Math.max(maxDelta,d)}
              parity[name]={changed,maxDelta,channels:pixels.frozen.length}
            }
            records.push({inputFrame:i,event,order,timings,parity,stats,progress})
          }
        } finally {for(const w of Object.values(workers))w.terminate()}
        const q=(values,p)=>{const sorted=[...values].sort((a,b)=>a-b),at=(sorted.length-1)*p,lo=Math.floor(at);return sorted[lo]+(sorted[Math.min(lo+1,sorted.length-1)]-sorted[lo])*(at-lo)}
        return {mode,round,columns:frame.columns,rows:frame.rows,records,summary:Object.fromEntries(names.map(name=>[name,{p50:q(records.slice(3,9).map(r=>r.timings[name].workerMs),.5),p95:q(records.slice(3,9).map(r=>r.timings[name].workerMs),.95),samples:6}]))}
      }, { prefix, mode, round })
      report.cases.push(entry)
      await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2))
      assert(entry.records.every(r=>Object.values(r.parity).every(p=>p.changed===0)), 'Every completed real Worker pixel must match the frozen renderer')
      assert(entry.records.some(r=>r.stats.surface.light?.hits>0&&r.stats.bitmap.light?.hits>0),'Both representations actually reuse fixed light')
      assert(entry.records.every(r=>['bitmap','surface'].every(n=>r.stats[n].light.bytes<=2*1024*1024&&r.stats[n].light.totalBackingBytes<=16*1024*1024)),'Material memory bounds')
      console.log(JSON.stringify({mode,round,summary:entry.summary}))
    }
  }
  assert.equal(report.cases.length, modes.length * rounds, 'All requested real Worker cohorts completed')
  report.passed=true
}catch(error){report.failure=error.stack;process.exitCode=1}
finally{await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,passed:report.passed,failure:report.failure}));await browser.close()}
