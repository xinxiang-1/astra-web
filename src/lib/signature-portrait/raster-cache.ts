import { signatureTint } from './render-style'

type RasterCanvas = HTMLCanvasElement | OffscreenCanvas
type Entry = {
  canvas: RasterCanvas
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  bytes: number
}

/** Per-paint exact-color LRU. Recycle backing surfaces instead of creating a canvas per miss. */
export function createTintedStampCache(
  sources: readonly RasterCanvas[],
  colorize: boolean,
  maxBytes = 16 * 1024 * 1024,
  maxEntries = 64,
  createSurface: () => RasterCanvas = () => document.createElement('canvas'),
  stableRaster = false,
) {
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    !Number.isSafeInteger(maxEntries) ||
    maxEntries < 1
  ) {
    throw new Error('签名着色缓存预算无效')
  }
  const entries = new Map<string, Entry>()
  let bytes = 0,
    peakBytes = 0,
    created = 0,
    reused = 0,
    hits = 0,
    misses = 0
  let temporary: Entry | undefined
  function dispose(entry: Entry) {
    entry.canvas.width = 1
    entry.canvas.height = 1
  }
  function get(index: number, r: number, g: number, b: number, depth: number, literal = false) {
    const source = sources[index]
    if (!source) throw new Error('签名位置引用了不存在的写法')
    const tint = signatureTint(colorize, r, g, b, depth, literal)
    const key = `${index}:${tint.join(',')}`
    const found = entries.get(key)
    if (found) {
      hits++
      entries.delete(key)
      entries.set(key, found)
      return found.canvas
    }
    misses++
    const cost = source.width * source.height * 4
    let entry: Entry | undefined
    while (entries.size && (entries.size >= maxEntries || bytes + cost > maxBytes)) {
      const oldest = entries.keys().next().value!
      const evicted = entries.get(oldest)!
      entries.delete(oldest)
      bytes -= evicted.bytes
      if (!entry) entry = evicted
      else dispose(evicted)
    }
    if (temporary) {
      if (entry) dispose(temporary)
      else entry = temporary
      temporary = undefined
    }
    if (!entry) {
      const canvas = createSurface()
      canvas.width = source.width
      canvas.height = source.height
      const context = canvas.getContext('2d', { willReadFrequently: stableRaster })
      if (!context) throw new Error('无法创建签名着色画布')
      entry = { canvas, context, bytes: cost }
      created++
    } else {
      reused++
      if (entry.canvas.width !== source.width) entry.canvas.width = source.width
      if (entry.canvas.height !== source.height) entry.canvas.height = source.height
      entry.bytes = cost
    }
    const ctx = entry.context
    // Full-size copy replaces all previous pixels, including transparent source pixels.
    // Replace old pixels in the same draw instead of a separate clearRect.
    ctx.globalCompositeOperation = 'copy'
    ctx.drawImage(source, 0, 0)
    ctx.globalCompositeOperation = 'source-in'
    ctx.fillStyle = `rgb(${tint.join(',')})`
    ctx.fillRect(0, 0, source.width, source.height)
    ctx.globalCompositeOperation = 'source-over'
    if (cost > maxBytes) temporary = entry
    else {
      entries.set(key, entry)
      bytes += cost
      peakBytes = Math.max(peakBytes, bytes)
    }
    return entry.canvas
  }
  return {
    get,
    clear() {
      for (const entry of entries.values()) dispose(entry)
      entries.clear()
      if (temporary) dispose(temporary)
      temporary = undefined
      bytes = 0
    },
    get stats() {
      return {
        bytes,
        peakBytes,
        created,
        reused,
        hits,
        misses,
        entries: entries.size,
        maxBytes,
        maxEntries,
        temporaryBytes: temporary?.bytes ?? 0,
      }
    },
  }
}
