import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const base = process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5180'
const output = path.resolve('test-results/editor-cache-contract')
await mkdir(output, { recursive: true })
const bytes = await readFile('test-results/editor-contract-source.mp4')
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ reducedMotion: 'reduce' })
  await page.goto(`${base}/ascii-art`)
  const result = await page.evaluate(
    async (source) => {
      const { ART_MODES, prepareArtFrame } = await import('/src/lib/art-engine/index.ts')
      const { prerenderVideoFrames } = await import('/src/lib/ascii/prerender.ts')
      const { seekVideoTo } = await import('/src/lib/ascii/media.ts')
      const video = document.createElement('video')
      video.muted = true
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve
        video.onerror = reject
        video.src = source
      })
      const records = []
      for (const { id: mode } of ART_MODES) {
        await seekVideoTo(video, 0.1)
        const options = {
          video,
          fps: 12,
          startTime: 0.2,
          endTime: 0.7,
          shouldAbort: () => false,
          getFrameSource: () => ({
            source: video,
            width: video.videoWidth,
            height: video.videoHeight,
          }),
          convertFrame: (source) => {
            const art = prepareArtFrame(source.source, source.width, source.height, {
              mode,
              columns: 80,
              phrase: '山河👩‍💻',
              fontFamily: '"Microsoft YaHei", sans-serif',
            })
            return { art, text: art.text, colors: art.colors, columns: art.columns, rows: art.rows }
          },
        }
        const success = await prerenderVideoFrames(options)
        const restoredAfterSuccess = Math.abs(video.currentTime - 0.1) < 0.001
        const complete =
          success.ok &&
          success.frames.length > 1 &&
          success.frames.every(
            (f) =>
              f.art &&
              f.text === f.art.text &&
              f.columns === f.art.columns &&
              f.time >= 0.2 &&
              f.time <= 0.7,
          )
        let count = 0
        const cancelled = await prerenderVideoFrames({
          ...options,
          shouldAbort: () => count >= 2,
          onProgress: () => count++,
        })
        const restoredAfterCancel = Math.abs(video.currentTime - 0.1) < 0.001
        const memory = await prerenderVideoFrames({ ...options, maxCacheBytes: 1 })
        const restoredAfterMemory = Math.abs(video.currentTime - 0.1) < 0.001
        records.push({
          mode,
          complete,
          frames: success.ok ? success.frames.length : 0,
          restoredAfterSuccess,
          aborted: cancelled.aborted === true,
          cancelledError: cancelled.error,
          restoredAfterCancel,
          memoryRejected: !memory.ok && memory.error.includes('内存上限'),
          restoredAfterMemory,
        })
      }
      video.removeAttribute('src')
      video.load()
      return records
    },
    `data:video/mp4;base64,${bytes.toString('base64')}`,
  )
  await writeFile(
    path.join(output, 'report.json'),
    JSON.stringify(
      {
        scope: 'Synthetic clip development regression, not holdout or real-device certification',
        browser: await browser.version(),
        sourceHash: createHash('sha256').update(bytes).digest('hex'),
        records: result,
      },
      null,
      2,
    ),
  )
  for (const record of result)
    assert(
      record.complete &&
        record.restoredAfterSuccess &&
        record.aborted &&
        record.restoredAfterCancel &&
        record.memoryRejected &&
        record.restoredAfterMemory,
      JSON.stringify(record),
    )
  console.log(
    `PASS: ${result.length} modes, complete typed-frame cache, cancellation/memory rejection and source-time restoration.`,
  )
} finally {
  await browser.close()
}
