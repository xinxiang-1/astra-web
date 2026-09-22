/** Worker ↔ 主线程消息协议（勿从 .worker.ts 反向 import） */

import type { Placement } from './layout-compute'
import type { LayoutComputeOptions, StampMetricInput } from './layout-compute'

export type LayoutWorkerRequest = {
  type: 'run'
  id: number
  fullBuffer: ArrayBuffer
  aBuffer: ArrayBuffer
  outW: number
  outH: number
  aW: number
  aH: number
  aScale: number
  sizeMin: number
  sizeMax: number
  longSide: number
  stampMetrics: StampMetricInput[]
  options: LayoutComputeOptions
}

export type LayoutWorkerProgress = {
  type: 'progress'
  id: number
  stage: string
  ratio: number
}

export type LayoutWorkerResult = {
  type: 'done'
  id: number
  placements: Placement[]
}

export type LayoutWorkerError = {
  type: 'error'
  id: number
  message: string
}

export type LayoutWorkerCancel = {
  type: 'cancel'
  id: number
}
