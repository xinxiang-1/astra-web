import type { SignatureStamp } from './extract'
import type { Placement } from './layout'
import { traceStampCanvas } from './trace'
import {
  paintVectorInkTemplate,
  prepareVectorInkTemplate,
  type VectorInkTemplate,
} from './vector-ink-geometry'

/** Shared path geometry for cutout Canvas and SVG; raster ink remains unchanged. */
export function* createVectorInkPainterSteps(stamps: SignatureStamp[]) {
  const templates: VectorInkTemplate[] = []
  for (const stamp of stamps) {
    const vector = stamp.vector ?? traceStampCanvas(stamp.canvas)
    // Traced binary regions are disjoint; even-odd preserves their internal holes.
    // Paint the plate and negative ink in one coverage pass, also used by SVG.
    templates.push(prepareVectorInkTemplate(vector))
    yield
  }
  return (target: CanvasRenderingContext2D, placement: Placement, colorize: boolean) => {
    const template = templates[placement.stampIndex]
    if (!template) throw new Error('签名位置引用了不存在的写法')
    paintVectorInkTemplate(target, placement, template, colorize)
  }
}

export function createVectorInkPainter(stamps: SignatureStamp[]) {
  const steps = createVectorInkPainterSteps(stamps)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}
