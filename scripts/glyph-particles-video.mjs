import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const out = path.resolve(
  process.env.ASTRA_PARTICLES_VIDEO_OUTPUT || `test-results/glyph-particles-video-${Date.now()}`,
)
await mkdir(out, { recursive: true })
const browser = await chromium.launch({ headless: true, channel: 'msedge' })
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } })
  await page.goto(
    (process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180') +
      '/docs/prototypes/v9-glyph-particles/index.html',
  )
  await page.waitForFunction(() => window.astraParticlesPrototype?.ready)
  await page.evaluate(() => window.astraParticlesPrototype.setManual(true))
  const result = await page.evaluate(async () => {
    const p = window.astraParticlesPrototype,
      c = document.querySelector('#particles')
    const stream = c.captureStream(30)
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) =>
      MediaRecorder.isTypeSupported(m),
    )
    if (!mime) throw Error('No native WebM recording encoder')
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 3500000 })
    const chunks = []
    const finished = new Promise((resolve, reject) => {
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }
      recorder.onerror = (e) => reject(e.error)
      recorder.onstop = resolve
    })
    const timeline = [],
      start = performance.now()
    recorder.start(200)
    for (let i = 0; i < 150; i++) {
      const dt = 1 / 30
      const active = i >= 15 && i < 48
      const t = (i - 15) / 32,
        x = 0.15 + Math.max(0, Math.min(1, t)) * 0.7,
        y = 0.5 + Math.sin(Math.max(0, Math.min(1, t)) * Math.PI * 2) * 0.16
      p.tick(dt, active || i === 48 ? [{ x, y, time: (p.state.clock + dt) * 1000, active }] : [])
      if ([0, 15, 32, 47, 70, 100, 149].includes(i))
        timeline.push({
          tick: i,
          simulationTime: i / 30,
          wallTime: (performance.now() - start) / 1000,
          peak: p.state.stats.peak,
        })
      await new Promise((r) => setTimeout(r, 1000 / 30))
    }
    recorder.stop()
    await finished
    stream.getTracks().forEach((t) => t.stop())
    const blob = new Blob(chunks, { type: mime }),
      url = URL.createObjectURL(blob),
      video = document.createElement('video')
    video.src = url
    video.muted = true
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = reject
    })
    const metadata = {
      mime,
      requestedCaptureFPS: 30,
      width: video.videoWidth,
      height: video.videoHeight,
      wallSeconds: (performance.now() - start) / 1000,
      simulationSeconds: 5,
      timeline,
      scope:
        'Native recording of a deterministic 30Hz research trajectory; requested capture FPS is not a verified delivered-frame count. Not a real user recording or a commercial performance certification.',
    }
    URL.revokeObjectURL(url)
    return { bytes: Array.from(new Uint8Array(await blob.arrayBuffer())), metadata }
  })
  const bytes = Buffer.from(result.bytes)
  await writeFile(path.join(out, 'glyph-particles.webm'), bytes)
  await writeFile(
    path.join(out, 'video.json'),
    JSON.stringify(
      {
        ...result.metadata,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      null,
      2,
    ) + '\n',
  )
  await page.screenshot({ path: path.join(out, 'settled.png'), fullPage: true })
  console.log(JSON.stringify({ out, ...result.metadata, bytes: bytes.length }))
} finally {
  await browser.close()
}
