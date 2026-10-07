import type { Placement } from './layout'
import type { StampVector } from './trace'
import { signatureTint } from './render-style'

export function prepareVectorInkTemplate(vector: StampVector) {
  const cutout = new Path2D()
  cutout.rect(0, 0, vector.width, vector.height)
  for (const d of vector.paths) cutout.addPath(new Path2D(d))
  return { vector, cutout }
}
export type VectorInkTemplate = ReturnType<typeof prepareVectorInkTemplate>

/** Exact shared negative-plate geometry for DOM Canvas and OffscreenCanvas. */
export function paintVectorInkTemplate(
  target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  placement: Placement,
  template: VectorInkTemplate,
  colorize: boolean,
) {
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
