/** Lossless RGBA PNG encoding without allocating a full output-sized canvas or RGBA buffer. */
const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let value = i
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  crcTable[i] = value >>> 0
}
function chunk(type: string, pixels = new Uint8Array(0)) {
  const header = new Uint8Array(8),
    crcBytes = new Uint8Array(4)
  new DataView(header.buffer).setUint32(0, pixels.length)
  for (let i = 0; i < 4; i++) header[i + 4] = type.charCodeAt(i)
  let crc = 0xffffffff
  for (let i = 4; i < 8; i++) crc = (crc >>> 8) ^ crcTable[(crc ^ header[i]!) & 255]!
  for (const byte of pixels) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!
  new DataView(crcBytes.buffer).setUint32(0, (crc ^ 0xffffffff) >>> 0)
  return new Blob([header, pixels, crcBytes])
}
type StreamSettings = {
  signal?: { cancelled?: boolean }
  maxCompressedBytes?: number
  onRows?: (done: number, total: number) => void
}

/** Instantiate inside a Worker. Sub/Up filters keep colour, alpha and every pixel unchanged. */
export function createPngRowEncoder(width: number, height: number, settings: StreamSettings = {}) {
  if (![width, height].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 16384))
    throw new Error('分块 PNG 尺寸无效')
  if (typeof CompressionStream === 'undefined')
    throw new Error('此浏览器不支持分块超清 PNG，请使用普通 PNG 导出')
  const maxBytes = settings.maxCompressedBytes ?? 512 * 1024 * 1024
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('分块 PNG 文件预算无效')
  const check = () => {
    if (settings.signal?.cancelled) throw new Error('已取消')
  }
  check()
  const stream = new CompressionStream('deflate'),
    writer = stream.writable.getWriter(),
    reader = stream.readable.getReader()
  const chunks: Blob[] = []
  let bytes = 0,
    rows = 0,
    state: 'open' | 'finished' | 'aborted' = 'open',
    readError: unknown
  // Consume in parallel with writes so compressed output never blocks the writer indefinitely.
  const drain = (async () => {
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) return
        check()
        bytes += value.byteLength
        if (bytes > maxBytes) throw new Error('超清 PNG 文件过大，请降低导出分辨率')
        chunks.push(chunk('IDAT', value))
      }
    } catch (error) {
      readError = error
      await reader.cancel(error).catch(() => {})
    }
  })()
  const rowBytes = width * 4,
    previous = new Uint8Array(rowBytes),
    sub = new Uint8Array(rowBytes),
    up = new Uint8Array(rowBytes)
  let writing = false
  async function abort(reason: unknown = new Error('已取消')) {
    if (state !== 'open') return
    state = 'aborted'
    await Promise.allSettled([writer.abort(reason), reader.cancel(reason)])
    await drain
    chunks.length = 0
  }
  async function writeRows(pixels: ImageData) {
    if (state !== 'open' || writing) throw new Error('PNG 条带写入状态无效')
    if (
      pixels.width !== width ||
      pixels.height < 1 ||
      pixels.height > 512 ||
      rows + pixels.height > height
    )
      throw new Error('PNG 条带尺寸无效')
    writing = true
    try {
      for (let y = 0; y < pixels.height; y++) {
        check()
        if (readError) throw readError
        const raw = pixels.data.subarray(y * rowBytes, (y + 1) * rowBytes)
        let subScore = 0,
          upScore = 0
        for (let i = 0; i < rowBytes; i++) {
          const a = (raw[i]! - (i >= 4 ? raw[i - 4]! : 0)) & 255,
            b = (raw[i]! - previous[i]!) & 255
          sub[i] = a
          up[i] = b
          subScore += Math.min(a, 256 - a)
          upScore += Math.min(b, 256 - b)
        }
        const line = new Uint8Array(rowBytes + 1)
        line[0] = subScore <= upScore ? 1 : 2
        line.set(line[0] === 1 ? sub : up, 1)
        previous.set(raw)
        await writer.write(line)
        rows++
        settings.onRows?.(rows, height)
        if (rows % 16 === 0) await new Promise((resolve) => setTimeout(resolve, 0))
      }
    } catch (error) {
      await abort(error)
      throw error
    } finally {
      writing = false
    }
  }
  async function finish() {
    if (state !== 'open' || writing) throw new Error('PNG 编码状态无效')
    if (rows !== height) {
      const error = new Error('PNG 条带不完整')
      await abort(error)
      throw error
    }
    try {
      check()
      await writer.close()
      await drain
      check()
      if (readError) throw readError
      const ihdr = new Uint8Array(13),
        header = new DataView(ihdr.buffer)
      header.setUint32(0, width)
      header.setUint32(4, height)
      ihdr[8] = 8
      ihdr[9] = 6
      const result = new Blob(
        [
          new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
          chunk('IHDR', ihdr),
          chunk('sRGB', new Uint8Array([0])),
          ...chunks,
          chunk('IEND'),
        ],
        { type: 'image/png' },
      )
      state = 'finished'
      chunks.length = 0
      return result
    } catch (error) {
      await abort(error)
      throw error
    }
  }
  return {
    writeRows,
    finish,
    abort,
    stats: () => ({ rows, compressedBytes: bytes, rowScratchBytes: rowBytes * 4 + 1 }),
  }
}
