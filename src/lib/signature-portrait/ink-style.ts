export type SignatureInkStyle = 'ink' | 'cutout'

/** Print a complete signature as ink, or as a cutout in its own ink plate. */
export function prepareSignatureInk(source: HTMLCanvasElement, style: SignatureInkStyle = 'ink'): HTMLCanvasElement {
  if (style === 'ink') return source
  const context = source.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('无法读取签名模板')
  const pixels = context.getImageData(0, 0, source.width, source.height)
  let ink = 0
  for (let i = 3; i < pixels.data.length; i += 4) ink += pixels.data[i]!
  if (ink === 0) throw new Error('签名模板没有有效笔迹')
  for (let i = 0; i < pixels.data.length; i += 4) {
    pixels.data[i] = 20; pixels.data[i + 1] = 24; pixels.data[i + 2] = 32
    pixels.data[i + 3] = 255 - pixels.data[i + 3]!
  }
  const output = document.createElement('canvas')
  output.width = source.width; output.height = source.height
  const target = output.getContext('2d')
  if (!target) throw new Error('无法创建签名镂空模板')
  target.putImageData(pixels, 0, 0)
  return output
}
