/** Astra character engine: one sampling contract and two matching backends. */
import { createGlyphGpu } from './gpu'
import { createArtCore } from './core'
import { createCanvasArtRenderer } from './canvas'
import type { ArtFrame, ArtSettings, ArtMode, ArtRenderOptions } from './types'
export type * from './types'
export { createArtCore } from './core'
export { createCanvasArtRenderer } from './canvas'
export const ART_ENGINE_VERSION = '2.2.0'
export const ART_DEFAULTS: ArtSettings = {
  mode: 'density',
  columns: 180,
  phrase: '光与影',
  charset: ' .,:;i1tfLCG08@',
  background: '#111615',
  ink: '#eeeae2',
  colored: false,
  normalize: true,
  contrast: 0.08,
  exposure: 0,
  invert: true,
  fillAll: true,
  threshold: 0.1,
}
export const ART_MODES: { id: ArtMode; name: string; description: string }[] = [
  { id: 'density', name: '光影字符', description: '按真实字形覆盖率还原明暗' },
  { id: 'color', name: '原色字符', description: '细密字符保留素材的色彩层次' },
  { id: 'phrase', name: '中文铺字', description: '顺序铺写你的文字，以笔画描绘光影' },
  { id: 'contour', name: '轮廓线稿', description: '沿图像边缘排列方向字符' },
  { id: 'braille', name: '点阵细节', description: '每个字格以八点表达更细的轮廓' },
  { id: 'halftone', name: '印刷网点', description: '由点的面积呈现连续灰度' },
]

const core = createArtCore(ART_DEFAULTS, ART_ENGINE_VERSION)
export const prepareArtFrame = core.prepareArtFrame
export const prepareArtFrameResponsive = core.prepareArtFrameResponsive
export function createArtRenderer(
  target: HTMLCanvasElement,
  configuration: { forceCanvas?: boolean } = {},
) {
  const canvas = createCanvasArtRenderer(target),
    ctx = target.getContext('2d')!
  const gpu = configuration.forceCanvas ? null : createGlyphGpu()
  let backend = gpu ? ('webgl2' as const) : ('canvas2d' as const)
  return {
    get backend() {
      return backend
    },
    render(frame: ArtFrame, options: ArtRenderOptions = {}) {
      if (
        !gpu ||
        options.effectProfile === 'expressive' ||
        options.motionStyle === 'cinematic' ||
        ['current', 'reform', 'caustics'].includes(options.motion ?? 'none') ||
        ['trail', 'rift', 'water', 'silk', 'vortex', 'contour', 'dissolve'].includes(
          options.hover ?? 'light',
        ) ||
        (frame.settings.softwareRaster &&
          (frame.settings.mode === 'color' ||
            (frame.settings.mode === 'density' && !frame.settings.colored))) ||
        (frame.settings.mode === 'density' &&
          !frame.settings.colored &&
          frame.settings.rasterQuality &&
          frame.settings.rasterQuality !== 'legacy')
      ) {
        backend = 'canvas2d'
        return canvas.render(frame, options)
      }
      const start = performance.now(),
        ratio = frame.width / frame.height,
        edge = Math.min(8192, Math.max(32, Math.round(options.longEdge ?? 1200)))
      const w = ratio >= 1 ? edge : Math.max(1, Math.round(edge * ratio)),
        h = ratio >= 1 ? Math.max(1, Math.round(edge / ratio)) : edge
      if (target.width !== w || target.height !== h) {
        target.width = w
        target.height = h
      }
      ctx.globalAlpha = 1
      if (options.transparent) ctx.clearRect(0, 0, w, h)
      else {
        ctx.fillStyle = frame.settings.background
        ctx.fillRect(0, 0, w, h)
      }
      if (!gpu.render(frame, options, w, h)) {
        backend = 'canvas2d'
        return canvas.render(frame, options)
      }
      backend = 'webgl2'
      ctx.drawImage(gpu.surface, 0, 0)
      return { width: w, height: h, renderMs: performance.now() - start }
    },
    destroy() {
      canvas.destroy()
      gpu?.destroy()
    },
  }
}
