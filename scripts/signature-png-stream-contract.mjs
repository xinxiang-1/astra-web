import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(
  process.env.ASTRA_PNG_OUTPUT || `test-results/signature-png-stream-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const browser = await chromium.launch({
  channel: process.env.ASTRA_BROWSER_CHANNEL || 'msedge',
  headless: true,
})
const report = {
  browser: browser.version(),
  cases: [],
  errors: [],
  scope:
    'Streaming codec only; no claim that signature clarity or production 16K export is integrated.',
}
try {
  const page = await browser.newPage({
    acceptDownloads: true,
    viewport: { width: 1200, height: 800 },
  })
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(base + '/signature-portrait')
  await page.evaluate((base) => {
    const code = `const queued=[]; self.onmessage=event=>queued.push(event); const { createPngRowEncoder } = await import(${JSON.stringify(base + '/src/lib/signature-portrait/png-stream.ts')});
      self.onmessage = async event => {
        const { id, width, height, band = 128, cancel, maxBytes, incomplete } = event.data;
        const signal = { cancelled: false }, encoder = createPngRowEncoder(width, height, { signal, maxCompressedBytes: maxBytes, onRows: rows => { if(cancel && rows >= 17) signal.cancelled = true } });
        const start = performance.now(); let peakStripeBytes = 0;
        try {
          for(let y0 = 0; y0 < (incomplete ? height - 1 : height); y0 += band) {
            const h = Math.min(band, (incomplete ? height - 1 : height) - y0), pixels = new ImageData(width,h); peakStripeBytes = Math.max(peakStripeBytes, pixels.data.byteLength);
            for(let y = 0; y < h; y++) for(let x = 0; x < width; x++) { const at = (y * width + x) * 4, yy = y + y0;
              pixels.data[at] = (x * 17 + yy * 13) & 255; pixels.data[at+1] = (x * 3 + yy * 7) & 255; pixels.data[at+2] = (x ^ yy) & 255; pixels.data[at+3] = (x * 11 + yy * 5) & 255; }
            await encoder.writeRows(pixels);
          }
          const blob = await encoder.finish(); self.postMessage({ id, blob, width, height, peakStripeBytes, ...encoder.stats(), durationMs: performance.now()-start });
        } catch(e) { await encoder.abort(); self.postMessage({id, error:e.message, ...encoder.stats()}); }
      }; for(const event of queued) self.onmessage(event);`
    window.__streamWorkerUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  }, base)
  for (const [width, height, band] of [
    [1, 1, 1],
    [17, 129, 31],
    [384, 257, 128],
    [519, 513, 127],
    [16384, 33, 17],
    [17, 16384, 128],
    ...(process.argv.includes('--small-only') ? [] : [[13112, 16384, 128]]),
  ]) {
    const id = `${width}x${height}`
    const download = page.waitForEvent('download', { timeout: 180000 })
    const result = await page.evaluate(
      (config) =>
        new Promise((resolve, reject) => {
          const worker = new Worker(window.__streamWorkerUrl, { type: 'module' })
          worker.onerror = (e) => {
            worker.terminate()
            reject(new Error(e.message))
          }
          worker.onmessage = (e) => {
            const value = e.data
            worker.terminate()
            if (value.error) {
              reject(new Error(value.error))
              return
            }
            const a = document.createElement('a'),
              href = URL.createObjectURL(value.blob)
            a.href = href
            a.download = config.id + '.png'
            a.click()
            setTimeout(() => URL.revokeObjectURL(href), 1000)
            const { blob, ...stats } = value
            resolve({ ...stats, blobBytes: blob.size })
          }
          worker.postMessage(config)
        }),
      { id, width, height, band },
    )
    await (await download).saveAs(path.join(out, id + '.png'))
    report.cases.push(result)
    console.log(JSON.stringify({ stage: 'encoded', ...result }))
  }
  report.rejections = await page.evaluate(async () => {
    const { createPngRowEncoder } = await import('/src/lib/signature-portrait/png-stream.ts'),
      rows = []
    for (const value of [0, 1.5, 16385, NaN]) {
      let rejected = false
      try {
        createPngRowEncoder(value, 32)
      } catch {
        rejected = true
      }
      if (!rejected) throw new Error('Invalid PNG dimension')
      rows.push({ kind: 'invalid-dimension', value: String(value) })
    }
    for (const settings of [
      { id: 'cancel', width: 32, height: 64, cancel: true },
      { id: 'budget', width: 32, height: 64, maxBytes: 32 },
      { id: 'incomplete', width: 32, height: 64, incomplete: true },
    ]) {
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(window.__streamWorkerUrl, { type: 'module' })
        worker.onerror = (e) => {
          worker.terminate()
          reject(new Error(e.message))
        }
        worker.onmessage = (e) => {
          worker.terminate()
          resolve(e.data)
        }
        worker.postMessage(settings)
      })
      if (!result.error) throw new Error('PNG failure must reject ' + settings.id)
      rows.push(result)
    }
    const encoder = createPngRowEncoder(32, 32)
    let rejected = false
    try {
      await encoder.writeRows(new ImageData(31, 32))
    } catch {
      rejected = true
    } finally {
      await encoder.abort()
    }
    if (!rejected) throw new Error('Wrong stripe width accepted')
    rows.push({ kind: 'invalid-stripe' })
    URL.revokeObjectURL(window.__streamWorkerUrl)
    return rows
  })
  const decoder = `import sys,json,struct,zlib,binascii\nfrom pathlib import Path\nimport numpy as np\np=Path(sys.argv[1]); results=[]\nfor file in p.glob('*.png'):\n f=file.open('rb');assert f.read(8)==b'\\x89PNG\\r\\n\\x1a\\n';dec=zlib.decompressobj();pending=b'';rows=0;filters=set();width=height=0;previous=None\n def consume(raw):\n  global pending,rows,previous\n  pending+=raw;n=width*4\n  while len(pending)>=n+1:\n   kind=pending[0];filters.add(kind);line=np.frombuffer(pending[1:n+1],dtype=np.uint8).reshape(width,4);pending=pending[n+1:]\n   if kind==1: line=(np.cumsum(line,axis=0,dtype=np.uint64)&255).astype(np.uint8)\n   elif kind==2: line=((line.astype(np.uint16)+previous)&255).astype(np.uint8)\n   else: raise AssertionError('Unknown PNG filter')\n   x=np.arange(width,dtype=np.uint32);expected=np.column_stack(((x*17+rows*13)&255,(x*3+rows*7)&255,(x^rows)&255,(x*11+rows*5)&255)).astype(np.uint8)\n   assert np.array_equal(line,expected),(file.name,rows)\n   previous=line;rows+=1\n while True:\n  length=struct.unpack('>I',f.read(4))[0];kind=f.read(4);data=f.read(length);crc=struct.unpack('>I',f.read(4))[0];assert (binascii.crc32(kind+data)&0xffffffff)==crc\n  if kind==b'IHDR':\n   width,height,depth,col,comp,fil,interlace=struct.unpack('>IIBBBBB',data);assert (depth,col,comp,fil,interlace)==(8,6,0,0,0);previous=np.zeros((width,4),dtype=np.uint8)\n  elif kind==b'IDAT':\n   raw=dec.decompress(data,(width*4+1)*16);consume(raw)\n   while dec.unconsumed_tail: consume(dec.decompress(dec.unconsumed_tail,(width*4+1)*16))\n  elif kind==b'IEND':break\n consume(dec.flush());assert rows==height and not pending and dec.eof and not dec.unused_data;assert not f.read();f.close();results.append(dict(file=file.name,width=width,height=height,rows=rows,channels=width*height*4,filters=sorted(filters),changed=0,crcValid=True))\nprint(json.dumps(results))\n`
  await writeFile(path.join(out, 'independent-decoder.py'), decoder)
  report.decoded = JSON.parse(
    execFileSync('python', [path.join(out, 'independent-decoder.py'), out], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    }),
  )
  assert.equal(report.decoded.length, report.cases.length)
  assert.deepEqual(report.errors, [])
  report.passed = true
} catch (error) {
  report.failure = error.stack
  process.exitCode = 1
} finally {
  await browser.close()
  report.sourceSha256 = createHash('sha256')
    .update(await readFile('src/lib/signature-portrait/png-stream.ts'))
    .digest('hex')
  await writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2))
  console.log(
    JSON.stringify({
      out,
      passed: report.passed,
      cases: report.cases.length,
      failure: report.failure,
    }),
  )
}
