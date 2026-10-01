import type { SignatureStamp } from './extract'
import type { Placement } from './layout'
import { traceStampCanvas } from './trace'
import { signatureTint } from './render-style'

/** Shared path geometry for cutout Canvas and SVG; raster ink remains unchanged. */
export function createVectorInkPainter(stamps: SignatureStamp[]) {
  const templates = stamps.map(stamp => {
    const vector = stamp.vector ?? traceStampCanvas(stamp.canvas)
    const paths = vector.paths.map(d => new Path2D(d))
    return { vector, paths }
  })
  const layer = document.createElement('canvas')
  return (target: CanvasRenderingContext2D, placement: Placement, colorize: boolean) => {
    const template = templates[placement.stampIndex]
    if (!template) throw new Error('签名位置引用了不存在的写法')
    const { vector, paths } = template
    const scale = placement.targetSize / Math.max(vector.width, vector.height)
    const cos = Math.abs(Math.cos(placement.angle)), sin = Math.abs(Math.sin(placement.angle))
    const halfW = (vector.width * cos + vector.height * sin) * scale / 2
    const halfH = (vector.width * sin + vector.height * cos) * scale / 2
    const left = Math.floor(placement.x - halfW) - 2
    const top = Math.floor(placement.y - halfH) - 2
    layer.width = Math.ceil(placement.x + halfW) - left + 2
    layer.height = Math.ceil(placement.y + halfH) - top + 2
    const ctx = layer.getContext('2d')
    if (!ctx) throw new Error('无法创建镂空笔迹画布')
    ctx.translate(placement.x - left, placement.y - top)
    ctx.rotate(placement.angle)
    ctx.scale(scale, scale)
    ctx.translate(-vector.width / 2, -vector.height / 2)
    const tint = placement.tint
    ctx.fillStyle = `rgb(${signatureTint(colorize, tint.r, tint.g, tint.b, placement.depth, Boolean(placement.tintLiteral)).join(',')})`
    ctx.fillRect(0, 0, vector.width, vector.height)
    ctx.globalCompositeOperation = 'destination-out'
    for (const path of paths) ctx.fill(path)
    target.save()
    target.globalAlpha = Math.min(1, Math.max(0, placement.strength))
    target.globalCompositeOperation = placement.blend === 'soft' ? 'source-over' : 'multiply'
    target.drawImage(layer, left, top)
    target.restore()
  }
}
