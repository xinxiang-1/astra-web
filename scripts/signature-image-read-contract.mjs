import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const dev = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5210'
const production = process.env.ASTRA_UI_URL || 'http://127.0.0.1:4210'
const coreOnly = process.env.ASTRA_IMAGE_PHASE === 'core'
const out = path.resolve(process.env.ASTRA_IMAGE_OUTPUT || `test-results/signature-image-read-${Date.now()}`)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge', headless: true })
const report = { passed: false, browser: browser.version(), formats: [], rejections: [], cancellations: [], ui: null, errors: [] }

// Controlled event delay, while retaining the browser's real decoding and dimensions.
function installImageControl() {
  const NativeImage = window.Image, onload = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'onload')
  const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
  const state = { hold: false, delayMs: 0, delayFrom: 0, images: [], waiting: [], created: [], revoked: [], live: new Set() }
  URL.createObjectURL = (value) => { const url = create(value); state.created.push(url); state.live.add(url); return url }
  URL.revokeObjectURL = (url) => { state.revoked.push(url); state.live.delete(url); revoke(url) }
  window.Image = function (...args) {
    const image = new NativeImage(...args), index = state.images.length
    state.images.push(image)
    Object.defineProperty(image, 'onload', {
      get() { return this.__handler },
      set(handler) {
        this.__handler = handler
        onload.set.call(image, handler ? (event) => {
          if (state.hold) state.waiting.push(() => handler.call(image, event))
          else if (state.delayMs && index >= state.delayFrom) setTimeout(() => handler.call(image, event), state.delayMs)
          else handler.call(image, event)
        } : null)
      },
    })
    return image
  }
  state.flush = () => { for (const call of state.waiting.splice(0)) call() }
  state.restore = () => { window.Image = NativeImage; URL.createObjectURL = create; URL.revokeObjectURL = revoke }
  window.__imageReadControl = state
}
async function bare() {
  const context = await browser.newContext({ reducedMotion: 'reduce' })
  const page = await context.newPage()
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.route(dev + '/__image_read_contract', (r) => r.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }))
  await page.goto(dev + '/__image_read_contract')
  return { context, page }
}
try {
  const { context, page } = await bare()
  const core = await page.evaluate(async () => {
    const { loadImageElement } = await import('/src/lib/signature-portrait/extract.ts')
    const { readImageHeader, IMAGE_HEADER_BYTES } = await import('/src/lib/image-header.ts')
    const { createSignatureProject } = await import('/src/lib/signature-portrait/project.ts')
    const { generateHandwritingVariants } = await import('/src/lib/signature-portrait/variants.ts')
    const check = (v, label) => { if (!v) throw Error(label) }
    const hash = async (b) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), (v) => v.toString(16).padStart(2, '0')).join('')
    const native = async (file) => { const url = URL.createObjectURL(file), image = new Image(); image.src = url; await image.decode(); return { image, dispose: () => { image.removeAttribute('src'); URL.revokeObjectURL(url) } } }
    const pixels = (image) => { const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0); const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; canvas.width = canvas.height = 1; return data }
    const fromUrl = async (url, name) => { const blob = await (await fetch(url)).blob(); return new File([blob], name, { type: blob.type, lastModified: 0 }) }
    const originals = await Promise.all(['portrait', 'landscape', 'pet'].map((name) => fromUrl('/artwork/' + name + '.jpg', name + '.jpg')))
    const ref = await native(originals[0]), canvas = document.createElement('canvas')
    canvas.width = ref.image.naturalWidth; canvas.height = ref.image.naturalHeight; canvas.getContext('2d').drawImage(ref.image, 0, 0)
    const png = new File([await new Promise((r) => canvas.toBlob(r, 'image/png'))], 'same-portrait.png', { type: 'image/png' })
    canvas.width = canvas.height = 1; ref.dispose()
    const exif = async (orientation) => {
      const raw = new Uint8Array(await originals[0].arrayBuffer()), segment = new Uint8Array(36), view = new DataView(segment.buffer)
      segment.set([255, 225, 0, 34, 69, 120, 105, 102, 0, 0, 73, 73, 42, 0, 8, 0, 0, 0, 1, 0])
      view.setUint16(20, 0x0112, true); view.setUint16(22, 3, true); view.setUint32(24, 1, true); view.setUint16(28, orientation, true)
      return new File([raw.slice(0, 2), segment, raw.slice(2)], 'exif-' + orientation + '.jpg', { type: 'image/jpeg' })
    }
    const bmp = new Uint8Array(70), bv = new DataView(bmp.buffer)
    bmp.set([66, 77]); bv.setUint32(2, bmp.length, true); bv.setUint32(10, 54, true); bv.setUint32(14, 40, true)
    bv.setInt32(18, 2, true); bv.setInt32(22, 2, true); bv.setUint16(26, 1, true); bv.setUint16(28, 24, true)
    bmp.set([0, 0, 255, 0, 255, 0, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0], 54)
    const gif = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0))
    const inputs = [
      ...originals, png,
      ...await Promise.all(['mountain', 'eagle', 'sea'].map((name) => fromUrl('/artwork/collection-20261005/' + name + '.webp', name + '.webp'))),
      await fromUrl('/docs/research/2026-10-04-signature-capacity/beethoven-signature.svg', 'public-historical-signature.svg'),
      new File([bmp], 'controlled-bmp.bmp', { type: 'image/bmp' }), new File([gif], 'controlled-transparent.gif', { type: 'image/gif' }),
      await exif(6), await exif(8),
    ]
    const rows = []
    for (const file of inputs) {
      const source = await native(file)
      const loaded = await loadImageElement(file, { maxBytes: 64 * 1024 * 1024, maxPixels: 32_000_000, maxSide: 32768 })
      const a = pixels(source.image), b = pixels(loaded.image), header = readImageHeader(await file.slice(0, IMAGE_HEADER_BYTES).arrayBuffer())
      check(loaded.image.naturalWidth === source.image.naturalWidth && loaded.image.naturalHeight === source.image.naturalHeight, 'Native dimensions changed: ' + file.name)
      check(a.length === b.length && a.every((v, i) => v === b[i]), 'Decoded RGBA changed: ' + file.name)
      if (file.name.startsWith('exif')) check(loaded.image.naturalWidth === rows[0].height && loaded.image.naturalHeight === rows[0].width, 'EXIF rotation must remain native')
      if (header) check(header.width * header.height === loaded.image.naturalWidth * loaded.image.naturalHeight, 'Header pixel count differs')
      rows.push({ name: file.name, fileBytes: file.size, fileSha256: await hash(await file.arrayBuffer()), width: loaded.image.naturalWidth, height: loaded.image.naturalHeight, header, rgbaSha256: await hash(b), differingBytes: 0 })
      loaded.image.removeAttribute('src'); URL.revokeObjectURL(loaded.objectUrl); source.dispose()
    }
    const portraitFile = originals[0], loaded = await loadImageElement(portraitFile)
    const stamps = (await generateHandwritingVariants('李云舟', { font: 'mashanzheng', count: 8, seed: 712 })).slice(0, 2)
    const project = { portrait: loaded.image, portraitFile, portraitName: '原作品 · 公共画像', width: 256, height: 320,
      options: { maxSide: 256, density: 0.7, background: '#f5f3ef', colorize: true, inkStyle: 'ink' }, stamps,
      placements: Array.from({ length: 64 }, (_, i) => ({ x: 16 + (i % 8) * 32, y: 20 + Math.floor(i / 8) * 40, angle: 0, targetSize: 34, stampIndex: i % 2, strength: .5 + (i % 3) * .2, tint: { r: 30, g: 70, b: 90 }, blend: 'soft', depth: 0 })) }
    const packed = await createSignatureProject(project)
    loaded.image.removeAttribute('src'); URL.revokeObjectURL(loaded.objectUrl)
    const asBase64 = async (blob) => { const raw = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let at = 0; at < raw.length; at += 8192) binary += String.fromCharCode(...raw.subarray(at, at + 8192)); return btoa(binary) }
    return { rows, packed: await asBase64(packed) }
  })
  assert.equal(core.rows.length, 12); report.formats = core.rows
  await writeFile(path.join(out, 'retained-project.astra-signature'), Buffer.from(core.packed, 'base64'))
  await page.evaluate(installImageControl)
  const failures = await page.evaluate(async () => {
    const { loadImageElement } = await import('/src/lib/signature-portrait/extract.ts')
    const { openSignaturePhoto } = await import('/src/lib/signature-portrait/cutout-client.ts')
    const { readSignatureProject } = await import('/src/lib/signature-portrait/project.ts')
    const { ensureBank, replaceBankStamps, loadBankAsStamps, getBank } = await import('/src/lib/signature-portrait/bank.ts')
    const { generateHandwritingVariants } = await import('/src/lib/signature-portrait/variants.ts')
    const check = (v, label) => { if (!v) throw Error(label) }
    const state = window.__imageReadControl, rejections = [], cancellations = []
    const blob = await (await fetch('/artwork/portrait.jpg')).blob(), file = new File([blob], 'public-photo.jpg', { type: 'image/jpeg' })
    async function reject(label, input, options, beforeDecode) {
      const urls = state.created.length, images = state.images.length
      let message
      try { await loadImageElement(input, options) } catch (e) { message = e.message }
      check(Boolean(message), 'Invalid input accepted: ' + label)
      if (beforeDecode) check(state.created.length === urls && state.images.length === images, 'Budget entered native decode: ' + label)
      check(state.live.size === 0, 'Rejected URL leaked: ' + label)
      rejections.push({ label, message, beforeNativeDecode: beforeDecode })
    }
    const png = new Uint8Array(33), pv = new DataView(png.buffer); png.set([137,80,78,71,13,10,26,10]); pv.setUint32(8,13); png.set([73,72,68,82],12); pv.setUint32(16,16000); pv.setUint32(20,16000)
    const jpeg = new Uint8Array([255,216,255,192,0,11,8,62,128,62,128,1,1,17,0])
    const webp = (kind) => {
      const raw = new Uint8Array(30), view = new DataView(raw.buffer)
      raw.set([82,73,70,70]); view.setUint32(4, 2_000_000, true); raw.set([87,69,66,80],8)
      raw.set(Array.from(kind).map((c) => c.charCodeAt(0)),12); view.setUint32(16,1_999_988,true)
      if (kind === 'VP8X') { raw[24]=127; raw[25]=62; raw[27]=127; raw[28]=62 }
      else if(kind === 'VP8L') { raw[20]=47; view.setUint32(21, 15999 | (15999 << 14), true) }
      else { raw.set([0,0,0,157,1,42,128,62,128,62],20) }
      return new File([raw], 'oversize-' + kind.trim() + '.webp', { type: 'image/webp' })
    }
    await reject('png-256MP', new File([png],'too-large.png',{type:'image/png'}), { maxPixels:32_000_000 }, true)
    await reject('jpeg-256MP', new File([jpeg],'too-large.jpg',{type:'image/jpeg'}), { maxPixels:32_000_000 }, true)
    for (const kind of ['VP8X','VP8L','VP8 ']) await reject('webp-' + kind, webp(kind), { maxPixels:32_000_000 }, true)
    await reject('byte-budget', file, { maxBytes:file.size-1 }, true)
    await reject('empty-file', new File([],'empty.png'), {}, true)
    await reject('corrupt-image', new File(['broken bytes'],'bad.png',{type:'image/png'}), {}, false)
    await reject('unknown-format-native-dimensions', new File(['<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"/>'],'bounded.svg',{type:'image/svg+xml'}), { maxPixels:100 }, false)
    state.hold = true
    await reject('timeout-cleanup', file, { timeoutMs:40 }, false)
    state.flush(); state.hold = false
    for (const api of ['loadImageElement','openSignaturePhoto']) {
      state.delayMs = 450; state.delayFrom = state.images.length
      const controller = new AbortController(), start = performance.now()
      setTimeout(() => controller.abort(),20)
      let error
      try { await (api === 'loadImageElement' ? loadImageElement(file,{signal:controller.signal}) : openSignaturePhoto(file,controller.signal)) } catch(e) { error=e.name }
      const elapsedMs = performance.now()-start
      check(error==='AbortError' && elapsedMs<250,'Cancel waited for image: '+api)
      check(state.live.size===0,'Canceled image URL leaked')
      cancellations.push({api,elapsedMs,error,liveUrls:state.live.size})
      await new Promise((r)=>setTimeout(r,500)); check(state.live.size===0,'Late callback recreated image URL')
    }
    const pre = new AbortController(); pre.abort(); const before=state.created.length
    try { await loadImageElement(file,{signal:pre.signal}) } catch(e) { check(e.name==='AbortError','Preabort') }
    check(before===state.created.length,'Preabort created URL')
    const stalled = new File([blob],'slow-header.jpg',{type:'image/jpeg'})
    stalled.slice = () => ({arrayBuffer:()=>new Promise(()=>{})})
    const sc = new AbortController(), start = performance.now(); setTimeout(()=>sc.abort(),20)
    let error; try { await loadImageElement(stalled,{signal:sc.signal}) } catch(e) { error=e.name }
    check(error==='AbortError' && performance.now()-start<250 && state.created.length===before,'Header cancellation')
    cancellations.push({api:'bounded-header-read',error,elapsedMs:performance.now()-start,noUrlCreated:true})
    state.delayMs=0
    const bank=await ensureBank('取消读取工程名字',2), stamps=(await generateHandwritingVariants('李云舟',{count:8,seed:17})).slice(0,2)
    const replacement = await replaceBankStamps(bank.label,stamps,{goal:2,expected:bank})
    for(const entry of replacement.entries)URL.revokeObjectURL(entry.previewUrl)
    const bankBefore=await getBank(bank.id), baselineUrls=state.live.size
    state.delayMs=450; state.delayFrom=state.images.length+1
    const bc=new AbortController(), bankStart=performance.now(), firstImage=state.images.length
    const bankTimer=setInterval(()=>{if(state.images.length>=firstImage+2)bc.abort()},5)
    try { await loadBankAsStamps(bank.id,bc.signal) } catch(e) { error=e.name }
    clearInterval(bankTimer)
    check(error==='AbortError' && performance.now()-bankStart<250,'Bank reading cancel')
    check(state.live.size===baselineUrls,'Partial bank preview/decode URL leaked')
    check(JSON.stringify(await getBank(bank.id))===JSON.stringify(bankBefore),'Reading cancel modified bank')
    cancellations.push({api:'loadBankAsStamps',error,elapsedMs:performance.now()-bankStart,bankUnchanged:true,liveUrls:state.live.size})
    await new Promise((r)=>setTimeout(r,500)); state.delayMs=0
    const loadedBank=await loadBankAsStamps(bank.id); check(loadedBank.length===2,'Bank retry failed')
    for(const stamp of loadedBank){URL.revokeObjectURL(stamp.previewUrl);stamp.canvas.width=stamp.canvas.height=1}
    check(state.live.size===0,'Bank retry cleanup')
    state.restore()
    return {rejections,cancellations,projectApiAvailable:typeof readSignatureProject==='function'}
  })
  report.rejections = failures.rejections; report.cancellations = failures.cancellations
  assert.equal(report.rejections.length,10); assert.equal(report.cancellations.length,4)
  // Actual project reader must propagate cancellation into its embedded portrait decode.
  await page.evaluate(installImageControl)
  const cancelPacked = await page.evaluate(async (packed) => {
    const { readSignatureProject }=await import('/src/lib/signature-portrait/project.ts')
    const raw=Uint8Array.from(atob(packed),(c)=>c.charCodeAt(0)), state=window.__imageReadControl
    state.hold=true
    const controller=new AbortController(), start=performance.now()
    const timer=setInterval(()=>{if(state.waiting.length)controller.abort()},5)
    let error;try{await readSignatureProject(new File([raw],'retained.astra-signature'),{signal:controller.signal})}catch(e){error=e.name}
    clearInterval(timer)
    const elapsedMs=performance.now()-start, liveUrls=state.live.size
    state.flush();state.restore();return {api:'readSignatureProject',error,elapsedMs,liveUrls}
  },core.packed)
  assert.equal(cancelPacked.error,'AbortError');assert.ok(cancelPacked.elapsedMs<250);assert.equal(cancelPacked.liveUrls,0)
  report.cancellations.push(cancelPacked)
  await context.close()

  if (!coreOnly) {
    const uiContext=await browser.newContext({viewport:{width:1440,height:960},reducedMotion:'reduce'})
    await uiContext.addInitScript(installImageControl)
    const ui=await uiContext.newPage();ui.on('pageerror',(e)=>report.errors.push(e.message))
    await ui.goto(production+'/signature-portrait')
    await ui.locator('input[type=file][accept*="astra-signature"]').setInputFiles(path.join(out,'retained-project.astra-signature'))
    await ui.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some((b)=>b.textContent.trim()==='保存作品文件'&&!b.disabled))
    const snapshot=async()=>ui.locator('.result-canvas').evaluate(async(canvas)=>{
      const rgba=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data
      return {width:canvas.width,height:canvas.height,sha256:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',rgba)),(v)=>v.toString(16).padStart(2,'0')).join('')}
    })
    const originalMeta=await ui.locator('.creation-bar-head .meta').textContent()
    const portraitInput=ui.locator('input[type=file][accept="image/*"]:not([multiple])')
    const source=await readFile('public/artwork/portrait.jpg'), next=await readFile('public/artwork/pet.jpg')
    const preserved=[]
    for(const theme of ['light','dark']){
      for(const width of [1440,390]){
        await ui.setViewportSize({width,height:width===390?844:960})
        if(await ui.locator('html').getAttribute('data-theme')!==theme)await ui.getByRole('button',{name:theme==='dark'?'切换到暗色':'切换到亮色',exact:true}).click()
        const original=await snapshot()
        await ui.evaluate(()=>{window.__imageReadControl.hold=true})
        await portraitInput.setInputFiles({name:'cancel-candidate.jpg',mimeType:'image/jpeg',buffer:source})
        await ui.getByRole('button',{name:'取消读取照片',exact:true}).waitFor()
        await ui.waitForFunction(()=>window.__imageReadControl.waiting.length>0)
        assert.equal(await ui.getByRole('button',{name:'上传画像照片',exact:true}).isEnabled(),true)
        assert.ok(await ui.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
        await ui.locator('.creation-bar').screenshot({path:path.join(out,`image-read-${theme}-${width}.png`)})
        const start=Date.now();await ui.getByRole('button',{name:'取消读取照片',exact:true}).click()
        await ui.getByRole('button',{name:'取消读取照片',exact:true}).waitFor({state:'detached'})
        assert.ok(Date.now()-start<1000)
        await ui.evaluate(()=>window.__imageReadControl.flush())
        assert.deepEqual(await snapshot(),original);assert.equal(await ui.locator('.creation-bar-head .meta').textContent(),originalMeta)
        preserved.push({theme,width,retainedCompleteRgba:true,retainedPortraitName:true})
      }
    }
    // A later selection wins even if a canceled native load delivers its callback afterwards.
    await portraitInput.setInputFiles({name:'older-slow.jpg',mimeType:'image/jpeg',buffer:source})
    await ui.waitForFunction(()=>window.__imageReadControl.waiting.length>0)
    await ui.evaluate(()=>{window.__imageReadControl.hold=false})
    await portraitInput.setInputFiles({name:'newest-photo.jpg',mimeType:'image/jpeg',buffer:next})
    await ui.waitForFunction(()=>document.querySelector('.creation-bar-head .meta')?.textContent.includes('newest-photo.jpg') && Array.from(document.querySelectorAll('button')).some((b)=>b.textContent.trim()==='保存作品文件'&&!b.disabled))
    const latest=await snapshot();await ui.evaluate(()=>window.__imageReadControl.flush())
    assert.deepEqual(await snapshot(),latest);assert.match(await ui.locator('.creation-bar-head .meta').textContent(),/newest-photo/)
    await portraitInput.setInputFiles({name:'corrupt.jpg',mimeType:'image/jpeg',buffer:Buffer.from('invalid bytes')})
    await ui.locator('.creation-bar .error').waitFor()
    assert.deepEqual(await snapshot(),latest)
    assert.match(await ui.locator('.creation-bar-head .meta').textContent(),/newest-photo/)
    // Leaving during decode revokes only the candidate URL and never publishes it.
    await ui.setViewportSize({width:1440,height:960})
    await ui.evaluate(()=>{window.__imageReadControl.hold=true})
    await portraitInput.setInputFiles({name:'leave-candidate.jpg',mimeType:'image/jpeg',buffer:source})
    await ui.waitForFunction(()=>window.__imageReadControl.waiting.length>0)
    const candidate=await ui.evaluate(()=>window.__imageReadControl.created.at(-1))
    await ui.getByRole('navigation',{name:'主导航',exact:true}).getByRole('link',{name:'创作工具',exact:true}).click()
    await ui.waitForURL('**/tools')
    assert.ok(await ui.evaluate((url)=>window.__imageReadControl.revoked.includes(url),candidate))
    await ui.evaluate(()=>window.__imageReadControl.flush())
    report.ui={production,preserved,latestSelectionWins:true,corruptInputPreservesLatest:true,leaveReleasesCandidate:true}
    await uiContext.close()
  }
  assert.deepEqual(report.errors,[]);report.passed=true
}catch(e){report.failure=String(e);process.exitCode=1}
finally{await browser.close();await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n')}
console.log(JSON.stringify({out,passed:report.passed,failure:report.failure,formats:report.formats.length,rejections:report.rejections.length,cancellations:report.cancellations.length,ui:report.ui}))
