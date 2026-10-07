import type { Placement } from './layout'

export function paintSignatureCover(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  p: Placement,
  glyphW: number,
  glyphH: number,
  scale: number,
) {
  const rw = Math.max(2, glyphW * scale * 0.52),
    rh = Math.max(2, glyphH * scale * 0.38)
  const { r, g, b } = p.tint
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.rotate(p.angle)
  ctx.globalCompositeOperation = 'source-over'
  ctx.globalAlpha =
    Math.min(1, Math.max(0, 0.14 + p.depth * 0.28)) * Math.min(1, Math.max(0, p.strength))
  ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`
  ctx.beginPath()
  ctx.ellipse(0, 0, rw, rh, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
