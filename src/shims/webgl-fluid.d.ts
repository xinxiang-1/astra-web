declare module 'webgl-fluid' {
  export interface WebGLFluidColor {
    r: number
    g: number
    b: number
  }

  export interface WebGLFluidOptions {
    TRIGGER?: 'hover' | 'click'
    IMMEDIATE?: boolean
    AUTO?: boolean
    INTERVAL?: number
    SIM_RESOLUTION?: number
    DYE_RESOLUTION?: number
    CAPTURE_RESOLUTION?: number
    DENSITY_DISSIPATION?: number
    VELOCITY_DISSIPATION?: number
    PRESSURE?: number
    PRESSURE_ITERATIONS?: number
    CURL?: number
    SPLAT_RADIUS?: number
    SPLAT_FORCE?: number
    SPLAT_COUNT?: number
    SPLAT_COLOR?: WebGLFluidColor
    SHADING?: boolean
    COLORFUL?: boolean
    COLOR_UPDATE_SPEED?: number
    PAUSED?: boolean
    BACK_COLOR?: WebGLFluidColor
    TRANSPARENT?: boolean
    BLOOM?: boolean
    BLOOM_ITERATIONS?: number
    BLOOM_RESOLUTION?: number
    BLOOM_INTENSITY?: number
    BLOOM_THRESHOLD?: number
    BLOOM_SOFT_KNEE?: number
    SUNRAYS?: boolean
    SUNRAYS_RESOLUTION?: number
    SUNRAYS_WEIGHT?: number
  }

  export default function WebGLFluid(
    canvas: HTMLCanvasElement,
    options?: WebGLFluidOptions,
  ): void
}
