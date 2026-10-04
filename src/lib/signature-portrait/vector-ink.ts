import type { SignatureStamp } from './extract'
import type { Placement } from './layout'
import { traceStampCanvas, type StampVector } from './trace'
import { signatureTint } from './render-style'

/** Shared path geometry for cutout Canvas and SVG; raster ink remains unchanged. */
export function* createVectorInkPainterSteps(stamps: SignatureStamp[]) {
  const templates: { vector: StampVector; cutout: Path2D }[] = []
  for (const stamp of stamps) {
    const vector = stamp.vector ?? traceStampCanvas(stamp.canvas)
    // Traced binary regions are disjoint; even-odd preserves their internal holes.
    // Paint the plate and negative ink in one coverage pass, also used by SVG.
    const cutout = new Path2D()
    cutout.rect(0, 0, vector.width, vector.height)
    for (const d of vector.paths) cutout.addPath(new Path2D(d))
    templates.push({ vector, cutout })
    yield
  }
  return (target: CanvasRenderingContext2D, placement: Placement, colorize: boolean) => {
    const template = templates[placement.stampIndex]
    if (!template) throw new Error('签名位置引用了不存在的写法')
    const { vector, cutout } = template
    const scale = placement.targetSize / Math.max(vector.width, vector.height)
    target.save()
    target.translate(placement.x, placement.y)
    target.rotate(placement.angle)
    target.scale(scale, scale)
    target.translate(-vector.width / 2, -vector.height / 2)
    const tint = placement.tint
    target.fillStyle = `rgb(${signatureTint(colorize, tint.r, tint.g, tint.b, placement.depth, Boolean(placement.tintLiteral)).join(',')})`
    target.globalAlpha = Math.min(1, Math.max(0, placement.strength))
    target.globalCompositeOperation = placement.blend === 'soft' ? 'source-over' : 'multiply'
    target.fill(cutout, 'evenodd')
    target.restore()
  }
}

export function createVectorInkPainter(stamps: SignatureStamp[]) {
  const steps = createVectorInkPainterSteps(stamps)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}
