import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
try {
  await page.goto(process.env.ASTRA_PREVIEW_URL || 'http://127.0.0.1:5173')
  const result = await page.evaluate(async () => {
    const { paintStudioFrame, disposeStudioFrame, mountCharsetStudio, studioRasterForGrid } =
      await import('/src/lib/ascii/studio-preview.ts')
    const { ASCII_ART_DEFAULTS } = await import('/src/lib/ascii/constants.ts')
    const { exportAsciiVideo } = await import('/src/lib/ascii/export-video.ts')
    const { prerenderVideoFrames } = await import('/src/lib/ascii/prerender.ts')
    const image = new Image()
    image.src = '/artwork/portrait-reference.png'
    await image.decode()
    const frame = { source: image, width: image.width, height: image.height }
    const input = {
      charset: ASCII_ART_DEFAULTS.charset,
      ink: ASCII_ART_DEFAULTS.foreground,
      backdrop: ASCII_ART_DEFAULTS.background,
      colored: false,
      invert: true,
      contrast: 0.2,
      normalize: true,
      ditherStrength: 0.25,
      hoverEffect: 'none',
      motion: 'none',
      cellSize: 6,
    }
    const mountedCanvas = document.createElement('canvas')
    mountedCanvas.style.cssText =
      'position:fixed;top:0;left:0;width:200px;height:200px;z-index:9999'
    document.body.append(mountedCanvas)
    const native = await mountCharsetStudio(mountedCanvas, image.src, input)
    const grid = studioRasterForGrid({
      columns: 180,
      rows: 1,
      cssWidth: frame.width,
      cssHeight: frame.height,
    })
    native.resize(grid.width, grid.height, 1)
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    const still = document.createElement('canvas')
    paintStudioFrame(still, frame, input, 180)
    function hash(canvas) {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let value = 2166136261
      for (let i = 0; i < pixels.length; i++) value = Math.imul(value ^ pixels[i], 16777619)
      return value
    }
    const parity = {
      mounted: hash(mountedCanvas),
      still: hash(still),
      width: still.width,
      height: still.height,
    }
    native.destroy()
    mountedCanvas.remove()

    const png = []
    for (const longEdge of [1080, 2048, 3840]) {
      paintStudioFrame(still, frame, input, 180, { longEdge, transparent: true })
      const blob = await new Promise((resolve) => still.toBlob(resolve, 'image/png'))
      const decoded = await createImageBitmap(blob)
      const data = still.getContext('2d').getImageData(0, 0, still.width, still.height).data
      let transparent = false
      for (let i = 3; i < data.length; i += 4)
        if (data[i] === 0) {
          transparent = true
          break
        }
      png.push({
        expected: longEdge,
        edge: Math.max(decoded.width, decoded.height),
        bytes: blob.size,
        transparent,
      })
      decoded.close()
    }

    const source = document.createElement('canvas')
    source.width = 160
    source.height = 100
    const ctx = source.getContext('2d')
    const raster = document.createElement('canvas')
    const hashes = []
    const video = await exportAsciiVideo({
      frameCount: 4,
      fps: 8,
      bufferFrames: 0,
      maxEdge: 320,
      getFrame: async (index) => {
        ctx.fillStyle = '#111615'
        ctx.fillRect(0, 0, 160, 100)
        ctx.fillStyle = '#eeeae2'
        ctx.fillRect(15 + index * 20, 20, 45, 60)
        paintStudioFrame(raster, { source, width: 160, height: 100 }, input, 40, { longEdge: 320 })
        hashes.push(hash(raster))
        return { text: 'studio-frame', raster }
      },
    })
    const videoElement = document.createElement('video')
    videoElement.muted = true
    const videoUrl = URL.createObjectURL(video.blob)
    videoElement.src = videoUrl
    await new Promise((resolve, reject) => {
      videoElement.onloadeddata = resolve
      videoElement.onerror = () => reject(new Error('Native video output cannot be decoded'))
    })
    const cached = await prerenderVideoFrames({
      video: videoElement,
      fps: 8,
      startTime: 0,
      endTime: 0.375,
      shouldAbort: () => false,
      getFrameSource: () => ({
        source: videoElement,
        width: videoElement.videoWidth,
        height: videoElement.videoHeight,
      }),
      convertFrame: () => ({ text: '@', columns: 40, rows: 25 }),
      renderRaster: async (source, time) => {
        paintStudioFrame(raster, source, input, 40, { time })
        return new Promise((resolve) => raster.toBlob(resolve, 'image/png'))
      },
    })
    const cachedHashes = []
    if (cached.ok)
      for (const frame of cached.frames) {
        const bitmap = await createImageBitmap(frame.raster)
        const check = document.createElement('canvas')
        check.width = bitmap.width
        check.height = bitmap.height
        check.getContext('2d').drawImage(bitmap, 0, 0)
        cachedHashes.push(hash(check))
        bitmap.close()
      }
    videoElement.removeAttribute('src')
    videoElement.load()
    URL.revokeObjectURL(videoUrl)
    disposeStudioFrame(still)
    disposeStudioFrame(raster)
    return {
      parity,
      png,
      cached: { ok: cached.ok, frames: cachedHashes.length, distinct: new Set(cachedHashes).size },
      video: {
        size: video.blob.size,
        type: video.mimeType,
        frames: hashes.length,
        distinct: new Set(hashes).size,
      },
    }
  })
  assert.equal(
    result.parity.mounted,
    result.parity.still,
    'native still and mounted Studio pixels must match',
  )
  for (const png of result.png) {
    assert.equal(png.edge, png.expected)
    assert(png.bytes > 0)
    assert(png.transparent, 'transparent PNG must retain alpha')
  }
  assert.equal(result.video.frames, 4)
  assert.equal(result.video.distinct, 4, 'native canvas frames must not reuse stale pixels')
  assert(result.video.size > 0)
  assert(result.cached.ok, 'video prerender must cache native Studio rasters')
  assert.equal(result.cached.frames, 4)
  assert(result.cached.distinct >= 3, 'native cached video frames must retain motion')
  console.log(
    'PASS: mounted/still pixel parity, 1080/2K/4K PNG sizes and alpha, native streaming video, lossless native prerender cache.',
  )
} finally {
  await browser.close()
}
