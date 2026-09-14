import WebGLFluid, { type WebGLFluidOptions } from 'webgl-fluid'

export interface WebglFluidRendererOptions {
  canvas: HTMLCanvasElement
  options?: WebGLFluidOptions
}

export interface WebglFluidRenderer {
  ready: Promise<void>
  dispose: () => void
}

/**
 * PavelDoGreat WebGL Fluid Simulation (MIT), via the webgl-fluid ESM package.
 * https://paveldogreat.github.io/WebGL-Fluid-Simulation/
 */
export function createRenderer(
  options: WebglFluidRendererOptions,
): WebglFluidRenderer {
  let disposed = false
  const { canvas } = options

  const ready = Promise.resolve().then(() => {
    if (disposed) return
    const gl =
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    if (!gl) {
      throw new Error('当前浏览器不支持 WebGL，无法运行彩烟流体。')
    }

    WebGLFluid(canvas, {
      TRIGGER: 'hover',
      IMMEDIATE: true,
      AUTO: false,
      BLOOM: true,
      SUNRAYS: true,
      COLORFUL: true,
      BACK_COLOR: { r: 0, g: 0, b: 0 },
      ...options.options,
    })
  })

  return {
    ready,
    dispose() {
      if (disposed) return
      disposed = true
      const gl =
        canvas.getContext('webgl2') ||
        canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl')
      if (gl && 'getExtension' in gl) {
        const lose = (
          gl as WebGLRenderingContext
        ).getExtension('WEBGL_lose_context')
        lose?.loseContext()
      }
    },
  }
}
