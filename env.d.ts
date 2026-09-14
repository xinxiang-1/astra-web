/// <reference types="vite/client" />
/// <reference types="@vgpu/wgsl/wgsl-types" />

declare module '*noise-volume.mjs' {
  import type { Gpu } from 'vgpu'
  type VgpuApi = typeof import('vgpu')

  export const NOISE_VOLUME_SIZE: number

  export function createNoiseVolume(
    gpu: Gpu,
    size?: number,
    label?: string,
  ): GPUTexture

  export function noiseVolumeSampler(vgpu: VgpuApi, gpu: Gpu): GPUSampler
}
