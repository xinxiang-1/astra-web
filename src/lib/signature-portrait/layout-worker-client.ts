import type { Placement } from './layout'
import type {
  LayoutComputeOptions,
  StampMetricInput,
} from './layout-compute'
import type {
  LayoutWorkerError,
  LayoutWorkerProgress,
  LayoutWorkerRequest,
  LayoutWorkerResult,
} from './layout-worker-protocol'

type RunArgs = {
  fullPixels: Uint8ClampedArray
  outW: number
  outH: number
  aPixels: Uint8ClampedArray
  aW: number
  aH: number
  aScale: number
  sizeMin: number
  sizeMax: number
  longSide: number
  stampMetrics: StampMetricInput[]
  options: LayoutComputeOptions
  onProgress?: (stage: string, ratio: number) => void
  signal?: { cancelled?: boolean }
}

let worker: Worker | null = null
let seq = 0

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./layout.worker.ts', import.meta.url), {
      type: 'module',
    })
  }
  return worker
}

/**
 * 在 Web Worker 中跑密度采样 / Lloyd / placements，不堵主线程。
 * Worker 不可用时抛错，由调用方回退主线程计算。
 */
export function runLayoutInWorker(args: RunArgs): Promise<Placement[]> {
  const id = ++seq
  const w = getWorker()

  return new Promise((resolve, reject) => {
    const onMessage = (
      ev: MessageEvent<
        LayoutWorkerProgress | LayoutWorkerResult | LayoutWorkerError
      >,
    ) => {
      const msg = ev.data
      if (msg.id !== id) return
      if (msg.type === 'progress') {
        args.onProgress?.(msg.stage, msg.ratio)
        return
      }
      cleanup()
      if (msg.type === 'done') resolve(msg.placements as Placement[])
      else reject(new Error(msg.message))
    }

    const onError = (err: ErrorEvent) => {
      cleanup()
      reject(
        err.error instanceof Error
          ? err.error
          : new Error(err.message || 'Worker 错误'),
      )
    }

    const cleanup = () => {
      w.removeEventListener('message', onMessage)
      w.removeEventListener('error', onError)
      clearInterval(cancelWatch)
    }

    const cancelWatch = window.setInterval(() => {
      if (args.signal?.cancelled) {
        w.postMessage({ type: 'cancel', id })
      }
    }, 80)

    if (args.signal?.cancelled) {
      w.postMessage({ type: 'cancel', id })
    }

    w.addEventListener('message', onMessage)
    w.addEventListener('error', onError)

    // 拷贝后再 transfer，避免拆掉主线程仍持有的 ImageData 视图
    const fullCopy = args.fullPixels.slice()
    const aCopy = args.aPixels.slice()

    const req: LayoutWorkerRequest = {
      type: 'run',
      id,
      fullBuffer: fullCopy.buffer as ArrayBuffer,
      aBuffer: aCopy.buffer as ArrayBuffer,
      outW: args.outW,
      outH: args.outH,
      aW: args.aW,
      aH: args.aH,
      aScale: args.aScale,
      sizeMin: args.sizeMin,
      sizeMax: args.sizeMax,
      longSide: args.longSide,
      stampMetrics: args.stampMetrics,
      options: args.options,
    }
    w.postMessage(req, [fullCopy.buffer as ArrayBuffer, aCopy.buffer as ArrayBuffer])
  })
}

export function terminateLayoutWorker() {
  worker?.terminate()
  worker = null
}
