import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const output = path.resolve(process.env.ASTRA_SIGNATURE_QUALITY_OUTPUT || 'test-results/signature-quality')
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, ...(process.env.ASTRA_BROWSER_CHANNEL ? { channel: process.env.ASTRA_BROWSER_CHANNEL } : {}) })
const page = await browser.newPage()
try {
  await page.goto(`${base}/signature-portrait`)
  const result = await page.evaluate(async () => {
    const { createTextStamp, renderSignaturePortrait, paintPlacementsScaled, traceStamps, buildPathSvgDocument } = await import('/src/lib/signature-portrait/index.ts')
    const { computePlacementsFromPixels } = await import('/src/lib/signature-portrait/layout-compute.ts')
    await document.fonts.ready
    const stamp = createTextStamp('Astra', { id: 'engineering-fixture', maxSide: 240 })
    const image = new Image(); image.src = '/artwork/portrait-reference.png'; await image.decode()
    const started = performance.now()
    const layout = await renderSignaturePortrait(image,image.width,image.height,[stamp],{ maxSide: 768, density: 2, lloydIters: 3, edgeOutline: true, colorize: false, coverFill: false, background: '#f5f3ef', seed:42 })
    const pure = paintPlacementsScaled(layout.placements,[stamp],layout.width,layout.height,layout.width,layout.height,{background:'#f5f3ef',colorize:false,coverFill:false,portrait:null,underlay:0})
    function hash(canvas) {const p=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let v=2166136261;for(let i=0;i<p.length;i++)v=Math.imul(v^p[i],16777619);return v}
    const tracing = await traceStamps([stamp])
    const svg = buildPathSvgDocument(layout.placements,tracing,layout.width,layout.height,{background:'#f5f3ef',colorize:false,underlay:0})
    const blank = new Uint8ClampedArray(40*40*4)
    const transparentStart=performance.now()
    const empty = computePlacementsFromPixels({fullPixels:blank,outW:40,outH:40,aPixels:blank,aW:40,aH:40,aScale:1,sizeMin:12,sizeMax:20,longSide:40,stampMetrics:[{inkRatio:.1,width:200,height:60,aspect:3.3}],options:{seed:42,density:2}})
    return {placements:layout.placements.length,width:layout.width,height:layout.height,totalMs:performance.now()-started,defaultHash:hash(layout.canvas),pureHash:hash(pure),emptyCount:empty.length,emptyMs:performance.now()-transparentStart,svgHasImage:/<image\b/.test(svg),svgHasPath:/<path\b/.test(svg),svg, png:layout.canvas.toDataURL('image/png').split(',')[1], valid:layout.placements.every(p=>[p.x,p.y,p.targetSize,p.angle].every(Number.isFinite))}
  })
  assert(result.placements>0 && result.valid)
  assert.equal(result.defaultHash,result.pureHash,'default signature must not contain an undeclared photograph layer')
  assert.equal(result.emptyCount,0)
  assert(result.emptyMs<1000,'empty input should skip sampling')
  assert(result.svgHasPath && !result.svgHasImage,'path SVG must contain real paths and no photograph')
  await writeFile(path.join(output,'pure-signature.png'),Buffer.from(result.png,'base64'))
  await writeFile(path.join(output,'pure-signature.svg'),result.svg)
  delete result.png; delete result.svg
  await writeFile(path.join(output,'metrics.json'),JSON.stringify({...result,fixture:'Typed Astra engineering stamp; does not prove human handwriting quality'},null,2))
  console.log(JSON.stringify(result,null,2))
} finally {await browser.close()}
