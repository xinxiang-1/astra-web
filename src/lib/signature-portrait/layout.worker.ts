/// <reference lib="webworker" />

import {
  computePlacementsFromPixels,
  type LayoutComputeInput,
} from './layout-compute'
import type {
  LayoutWorkerCancel,
  LayoutWorkerError,
  LayoutWorkerProgress,
  LayoutWorkerRequest,
  LayoutWorkerResult,
} from './layout-worker-protocol'

let cancelledId = -1

self.onmessage = (
  ev: MessageEvent<LayoutWorkerRequest | LayoutWorkerCancel>,
) => {
  const msg = ev.data
  if (msg.type === 'cancel') {
    cancelledId = msg.id
    return
  }
  if (msg.type !== 'run') return

  const { id } = msg
  try {
    const input: LayoutComputeInput = {
      fullPixels: new Uint8ClampedArray(msg.fullBuffer),
      outW: msg.outW,
      outH: msg.outH,
      aPixels: new Uint8ClampedArray(msg.aBuffer),
      aW: msg.aW,
      aH: msg.aH,
      aScale: msg.aScale,
      sizeMin: msg.sizeMin,
      sizeMax: msg.sizeMax,
      longSide: msg.longSide,
      stampMetrics: msg.stampMetrics,
      options: msg.options,
    }

    let lastPost = 0
    const placements = computePlacementsFromPixels(
      input,
      (stage, ratio) => {
        const now = Date.now()
        if (ratio < 1 && now - lastPost < 50) return
        lastPost = now
        const progress: LayoutWorkerProgress = {
          type: 'progress',
          id,
          stage,
          ratio,
        }
        self.postMessage(progress)
      },
      () => cancelledId === id,
    )

    if (cancelledId === id) {
      const err: LayoutWorkerError = { type: 'error', id, message: '已取消' }
      self.postMessage(err)
      return
    }

    const done: LayoutWorkerResult = { type: 'done', id, placements }
    self.postMessage(done)
  } catch (e) {
    const err: LayoutWorkerError = {
      type: 'error',
      id,
      message: e instanceof Error ? e.message : '排版失败',
    }
    self.postMessage(err)
  }
}
