/** Preserve GIF timing while preparing a bounded, local playback video for the editor. */
export async function gifPlaybackFile(
  file: File,
  signal: AbortSignal,
  checkDimensions: (width: number, height: number) => void,
): Promise<File | null> {
  if (typeof ImageDecoder === 'undefined' || typeof VideoEncoder === 'undefined')
    throw new Error('当前浏览器无法播放 GIF 字符画，请使用新版 Chrome / Edge 或上传 MP4 / WebM')
  signal.throwIfAborted()
  const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: 'image/gif' })
  let output: import('mediabunny').Output | undefined
  let complete = false
  try {
    await decoder.tracks.ready
    await decoder.completed
    signal.throwIfAborted()
    const count = decoder.tracks.selectedTrack?.frameCount ?? 0
    if (!count) throw new Error('GIF 没有可读取的画面')
    if (count === 1) return null
    if (count > 3000) throw new Error('GIF 超过 3000 帧，请裁剪后重试')
    const { StreamTarget, CanvasSource, Output, WebMOutputFormat, canEncodeVideo } =
      await import('mediabunny')
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    const chunks: { data: Uint8Array<ArrayBuffer>; position: number }[] = []
    let retainedBytes = 0
    let length = 0
    const limit = 64 * 1024 * 1024
    const target = new StreamTarget(new WritableStream({
      write({ data, position }) {
        signal.throwIfAborted()
        retainedBytes += data.byteLength
        length = Math.max(length, position + data.byteLength)
        if (retainedBytes > limit || length > limit)
          throw new Error('GIF 播放素材过大，请缩小尺寸或裁剪后重试')
        chunks.push({ data: data.slice(), position })
      },
    }))
    let source: InstanceType<typeof CanvasSource> | undefined
    let timestamp = 0
    for (let index = 0; index < count; index++) {
      signal.throwIfAborted()
      const { image } = await decoder.decode({ frameIndex: index })
      try {
        signal.throwIfAborted()
        if (!source) {
          checkDimensions(image.displayWidth, image.displayHeight)
          if (image.displayWidth * image.displayHeight * count > 1_000_000_000)
            throw new Error('GIF 逐帧数据量过大，请缩小尺寸或裁剪后重试')
          canvas.width = image.displayWidth
          canvas.height = image.displayHeight
          const options = { width: canvas.width, height: canvas.height, bitrate: 8_000_000 }
          const codec = (await canEncodeVideo('vp9', options))
            ? 'vp9'
            : (await canEncodeVideo('vp8', options)) ? 'vp8' : null
          if (!codec) throw new Error('当前浏览器无法编码 GIF 播放素材，请使用新版 Chrome / Edge')
          signal.throwIfAborted()
          output = new Output({ format: new WebMOutputFormat(), target })
          source = new CanvasSource(canvas, { codec, bitrate: 8_000_000, alpha: 'keep' })
          output.addVideoTrack(source)
          await output.start()
        }
        // ImageDecoder supplies fully composited frames, including GIF disposal rules.
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0)
        const duration = Math.max(0.01, (image.duration ?? 100_000) / 1_000_000)
        if (timestamp + duration > 120) throw new Error('GIF 超过 120 秒，请裁剪后重试')
        await source.add(timestamp, duration)
        timestamp += duration
      } finally {
        image.close()
      }
    }
    signal.throwIfAborted()
    await output!.finalize()
    signal.throwIfAborted()
    if (!length)
      throw new Error('GIF 播放素材过大，请缩小尺寸或裁剪后重试')
    const buffer = new Uint8Array(length)
    for (const chunk of chunks) buffer.set(chunk.data, chunk.position)
    chunks.length = 0
    complete = true
    return new File([buffer], file.name.replace(/\.gif$/i, '') + '.gif-playback.webm', {
      type: 'video/webm', lastModified: file.lastModified,
    })
  } finally {
    decoder.close()
    if (output && !complete) await output.cancel().catch(() => undefined)
  }
}
