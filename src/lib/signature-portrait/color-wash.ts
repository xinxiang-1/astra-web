/** Broad photographic colour for the explicitly labelled mixed-media treatment.
 * At most 384² pixels (<576 KiB); the full signatures carry the fine texture.
 * This is a raster layer, not a claim that the whole picture consists of names.
 */
export const SIGNATURE_COLOR_WASH_LONG = 384

const washes = new WeakMap<HTMLImageElement, HTMLCanvasElement>()

export function signatureColorWash(portrait: HTMLImageElement): HTMLCanvasElement {
  const existing = washes.get(portrait)
  if (existing) return existing
  const width = portrait.naturalWidth || portrait.width
  const height = portrait.naturalHeight || portrait.height
  if (!(width > 0 && height > 0)) throw new Error('画像尚未加载')
  const scale = Math.min(1, SIGNATURE_COLOR_WASH_LONG / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法准备彩绘底色')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(portrait, 0, 0, canvas.width, canvas.height)
  washes.set(portrait, canvas)
  return canvas
}
