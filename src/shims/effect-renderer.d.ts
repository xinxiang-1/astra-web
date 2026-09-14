declare module '@/effects/optimized-black-hole/renderer' {
  export interface BlackHoleInteractionOptions {
    mouseYaw?: number
    yawSmoothing?: number
    speedFromPointerX?: number
    speedFromVelocity?: number
    velocityDecay?: number
  }

  export interface BlackHoleRendererOptions {
    canvas: HTMLCanvasElement
    interaction?: BlackHoleInteractionOptions
    baseDiskSpeed?: number
  }

  export function createRenderer(options: BlackHoleRendererOptions): {
    ready: Promise<void>
    dispose: () => void
  }
}

declare module '@/effects/fluid/renderer' {
  export function createRenderer(options: { canvas: HTMLCanvasElement }): {
    ready: Promise<void>
    dispose: () => void
  }
}
