import { fitSignatureRaster } from './signature-portrait/preview-viewport'

/** The list uses a bounded thumbnail of the artwork, never the unprocessed portrait. */
export async function signatureProjectThumbnail(blob: Blob, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const url = URL.createObjectURL(blob),
    image = new Image()
  let canvas: HTMLCanvasElement | null = null
  try {
    image.src = url
    await image.decode()
    signal?.throwIfAborted()
    const size = fitSignatureRaster(image.naturalWidth, image.naturalHeight, 420)
    canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法准备作品缩略图')
    context.drawImage(image, 0, 0, size.width, size.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    image.removeAttribute('src')
    URL.revokeObjectURL(url)
    if (canvas) canvas.width = canvas.height = 1
  }
}
