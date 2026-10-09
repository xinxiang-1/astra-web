export const IMAGE_HEADER_BYTES = 256 * 1024
type ImageHeader = { format: 'png' | 'jpeg' | 'webp'; width: number; height: number }

/** Bounded metadata hint only. The native decoder and decoded dimensions remain authoritative. */
export function readImageHeader(bytes: ArrayBuffer): ImageHeader | null {
  const raw = new Uint8Array(bytes), view = new DataView(bytes)
  const text = (at: number, value: string) => at + value.length <= raw.length &&
    Array.from(value).every((char, i) => raw[at + i] === char.charCodeAt(0))
  const dimensions = (format: ImageHeader['format'], width: number, height: number): ImageHeader | null =>
    width > 0 && height > 0 ? { format, width, height } : null
  if (raw.length >= 24 && raw[0] === 137 && text(1, 'PNG\r\n\x1a\n') &&
    view.getUint32(8) === 13 && text(12, 'IHDR'))
    return dimensions('png', view.getUint32(16), view.getUint32(20))
  if (raw.length >= 4 && raw[0] === 0xff && raw[1] === 0xd8) {
    let at = 2
    while (at + 1 < raw.length) {
      if (raw[at] !== 0xff) return null
      while (raw[at] === 0xff) at++
      if (at >= raw.length) return null
      const marker = raw[at++]!
      if (marker === 0xda || marker === 0xd9) return null
      if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue
      if (at + 2 > raw.length) return null
      const length = view.getUint16(at)
      if (length < 2 || at + length > raw.length) return null
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
        return length >= 8 ? dimensions('jpeg', view.getUint16(at + 5), view.getUint16(at + 3)) : null
      at += length
    }
  }
  if (raw.length >= 20 && text(0, 'RIFF') && text(8, 'WEBP')) {
    const end = Math.min(raw.length, view.getUint32(4, true) + 8)
    let at = 12
    while (at + 8 <= end) {
      const length = view.getUint32(at + 4, true), data = at + 8
      if (text(at, 'VP8X') && length >= 10 && data + 10 <= end) {
        const u24 = (p: number) => raw[p]! + (raw[p + 1]! << 8) + (raw[p + 2]! << 16)
        return dimensions('webp', u24(data + 4) + 1, u24(data + 7) + 1)
      }
      if (text(at, 'VP8 ') && length >= 10 && data + 10 <= end && (raw[data]! & 1) === 0 &&
        raw[data + 3] === 0x9d && raw[data + 4] === 0x01 && raw[data + 5] === 0x2a)
        return dimensions('webp', view.getUint16(data + 6, true) & 0x3fff, view.getUint16(data + 8, true) & 0x3fff)
      if (text(at, 'VP8L') && length >= 5 && data + 5 <= end && raw[data] === 0x2f) {
        const packed = view.getUint32(data + 1, true)
        return dimensions('webp', (packed & 0x3fff) + 1, ((packed >>> 14) & 0x3fff) + 1)
      }
      if (length > end - data) return null
      at = data + length + (length & 1)
    }
  }
  return null
}
