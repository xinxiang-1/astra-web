/** Pinned, locally hosted OFL 1.1 fonts. Never substitute a platform font silently. */
import { SIGNATURE_FONT_EXTENSION } from './font-extension'
import { SIGNATURE_WEB_FONTS } from './font-web'
import { isSubsetName, loadSubsetFont } from './font-subset-loader'
export const SIGNATURE_FONTS = [
  {
    id: 'mashanzheng',
    name: '行楷',
    family: 'Astra Signature Ma Shan Zheng',
    file: 'MaShanZheng-Regular.ttf',
    sha256: '6d2546bb189c732a8ca29af9e22457b152387d158aa459e4ac2ce1e51788b7fb',
  },
  {
    id: 'longcang',
    name: '草书',
    family: 'Astra Signature Long Cang',
    file: 'LongCang-Regular.ttf',
    sha256: 'e5bf2c3f24ef2327c6f136d8f73e2f9dfdf44896fdbeb35a9515f44777bb91bc',
  },
  ...SIGNATURE_FONT_EXTENSION,
] as const
export type SignatureFontId = (typeof SIGNATURE_FONTS)[number]['id']
export function isSignatureFontId(value: unknown): value is SignatureFontId {
  return SIGNATURE_FONTS.some((font) => font.id === value)
}
type LoadedFont = { family: string; supports: (codepoint: number) => boolean }
const fonts = new Map<SignatureFontId, Promise<LoadedFont>>()

/** Compact coverage from the font's actual cmap; missing glyphs must not become tofu. */
export function readTrueTypeCoverage(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const u16 = (offset: number) => view.getUint16(offset)
  const u32 = (offset: number) => view.getUint32(offset)
  if (buffer.byteLength < 12 || u32(0) !== 0x00010000) throw new Error('书写字体格式损坏')
  let cmap = -1,
    length = 0
  for (let i = 0; i < u16(4); i++) {
    const at = 12 + i * 16
    if (at + 16 > buffer.byteLength) throw new Error('书写字体目录损坏')
    if (u32(at) === 0x636d6170) {
      cmap = u32(at + 8)
      length = u32(at + 12)
    }
  }
  if (cmap < 0 || cmap + length > buffer.byteLength || length < 4)
    throw new Error('书写字体缺少字表')
  return readCmapCoverage(view, cmap, length)
}

function readCmapCoverage(view: DataView, cmap: number, length: number) {
  const u16 = (offset: number) => view.getUint16(offset)
  const u32 = (offset: number) => view.getUint32(offset)
  if (length < 4 || cmap + length > view.byteLength || u16(cmap) !== 0)
    throw new Error('书写字体字表损坏')
  const bmp = new Uint8Array(65536),
    ranges: [number, number][] = []
  let found = false
  for (let i = 0; i < u16(cmap + 2); i++) {
    const record = cmap + 4 + i * 8
    if (record + 8 > cmap + length) throw new Error('书写字体字表损坏')
    const platform = u16(record),
      encoding = u16(record + 2),
      at = cmap + u32(record + 4)
    if (platform !== 0 && !(platform === 3 && (encoding === 1 || encoding === 10))) continue
    if (at + 4 > cmap + length) throw new Error('书写字体字表越界')
    const format = u16(at)
    if (format === 4) {
      if (at + 14 > cmap + length) throw new Error('书写字体分段字表损坏')
      const end = at + u16(at + 2),
        segments = u16(at + 6) / 2,
        ends = at + 14,
        starts = ends + segments * 2 + 2,
        deltas = starts + segments * 2,
        offsets = deltas + segments * 2
      if (
        !Number.isInteger(segments) ||
        segments < 1 ||
        end > cmap + length ||
        offsets + segments * 2 > end
      )
        throw new Error('书写字体分段字表损坏')
      for (let j = 0; j < segments; j++) {
        const first = u16(starts + j * 2),
          last = u16(ends + j * 2),
          delta = view.getInt16(deltas + j * 2),
          offset = u16(offsets + j * 2)
        if (first > last) throw new Error('书写字体分段范围损坏')
        for (let cp = first; cp <= last && cp < 65535; cp++) {
          let glyph
          if (!offset) glyph = (cp + delta) & 65535
          else {
            const address = offsets + j * 2 + offset + 2 * (cp - first)
            if (address + 2 > end) throw new Error('书写字体字形索引越界')
            const value = u16(address)
            glyph = value ? (value + delta) & 65535 : 0
          }
          if (glyph) bmp[cp] = 1
        }
      }
      found = true
    } else if (format === 12) {
      if (at + 16 > cmap + length) throw new Error('书写字体扩展字表损坏')
      const end = at + u32(at + 4),
        groups = u32(at + 12)
      if (end > cmap + length || at + 16 + groups * 12 > end)
        throw new Error('书写字体扩展范围越界')
      for (let j = 0; j < groups; j++) {
        const address = at + 16 + j * 12,
          first = u32(address) + (u32(address + 8) === 0 ? 1 : 0),
          last = u32(address + 4)
        if (last > 0x10ffff) throw new Error('书写字体字符范围损坏')
        if (first <= last) ranges.push([first, last])
      }
      found = true
    }
  }
  if (!found) throw new Error('书写字体没有可用 Unicode 字表')
  return (cp: number) =>
    Number.isInteger(cp) &&
    cp >= 0 &&
    cp <= 0x10ffff &&
    (Boolean(bmp[cp]) || ranges.some(([first, last]) => cp >= first && cp <= last))
}

/** Standard WOFF2 private data binds the original cmap to the compressed full font. */
export function readWoff2Coverage(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  if (buffer.byteLength < 48 || view.getUint32(0) !== 0x774f4632 ||
    view.getUint32(4) !== 0x00010000 || view.getUint32(8) !== buffer.byteLength ||
    !view.getUint16(12) || view.getUint16(12) > 512 || view.getUint16(14) !== 0)
    throw new Error('书写字体压缩格式损坏')
  const offset = view.getUint32(40), length = view.getUint32(44)
  if (offset < 48 || offset % 4 !== 0 || length < 8 || length > 1024 * 1024 ||
    offset + length !== buffer.byteLength || view.getUint32(offset) !== 0x41434d31)
    throw new Error('书写字体缺少原始字表')
  return readCmapCoverage(view, offset + 4, length - 4)
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('已取消', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

export async function loadSignatureFont(id: SignatureFontId, text: string, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const descriptor = SIGNATURE_FONTS.find((f) => f.id === id)
  if (!descriptor) throw new Error('请选择有效的书写字体')
  const transport = SIGNATURE_WEB_FONTS[descriptor.id]
  if (transport.sourceSha256 !== descriptor.sha256) throw new Error('书写字体来源校验不一致')
  if (isSubsetName(text) && !fonts.has(id)) {
    const family = await abortable(loadSubsetFont(descriptor, text, readWoff2Coverage), signal)
    signal?.throwIfAborted()
    return family
  }
  let promise = fonts.get(id)
  if (!promise) {
    promise = (async () => {
      const response = await fetch(
        `${import.meta.env.BASE_URL}fonts/signature/${transport.file}`,
        { signal: AbortSignal.timeout(15000) },
      ).catch(() => { throw new Error('书写字体暂未加载成功，请检查网络后重试；现有名字库会保留') })
      if (!response.ok) throw new Error('书写字体加载失败，请重试；现有名字库会保留')
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength !== transport.bytes) throw new Error('书写字体文件不完整，请重试')
      const digest = await crypto.subtle.digest('SHA-256', buffer)
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('')
      if (hash !== transport.sha256) throw new Error('书写字体校验失败，请刷新后重试')
      const supports = readWoff2Coverage(buffer)
      const face = await new FontFace(descriptor.family, buffer, {
        style: 'normal',
        weight: '400',
      }).load()
      document.fonts.add(face)
      return { family: descriptor.family, supports }
    })()
    fonts.set(id, promise)
    void promise.catch(() => {
      if (fonts.get(id) === promise) fonts.delete(id)
    })
  }
  const font = await abortable(promise, signal)
  signal?.throwIfAborted()
  const missing = [
    ...new Set(Array.from(text).filter((char) => !font.supports(char.codePointAt(0)!))),
  ]
  if (missing.length) throw new Error(`这款字体不支持“${missing.join('')}”，请换字体或手写名字`)
  return font.family
}
