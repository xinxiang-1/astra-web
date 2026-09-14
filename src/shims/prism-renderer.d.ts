declare module '@/effects/prism/renderer' {
  export type PrismPipelineMode = 'dark' | 'light'
  export type PrismQualityPreference = 'auto' | 'high' | 'low'

  export interface PrismControls {
    wallColor: string
    [key: string]: unknown
  }

  export interface PrismRenderer {
    ready: Promise<void>
    dispose: () => void
    setMode: (mode: PrismPipelineMode) => Promise<void>
    setQualityPreference: (preference: PrismQualityPreference) => Promise<void>
    setControls: (next: PrismControls) => void
  }

  export function createRenderer(options: {
    canvas: HTMLCanvasElement
    initialMode: PrismPipelineMode
    initialQuality?: PrismQualityPreference
    initialControls?: PrismControls
    onError?: (error: unknown) => void
  }): PrismRenderer
}

declare module '@/effects/prism/types' {
  import type { PrismControls } from '@/effects/prism/renderer'

  export const DEFAULT_PRISM_CONTROLS: PrismControls
}
