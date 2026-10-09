import { canvasToPngBlob, paintPlacementsTiled } from './layout'
import { createSignatureRasterWorker } from './raster-worker-client'
import { prepareSignatureWash } from './styled-wash'
import type { SignatureProject } from './project'
import { fitSignatureRaster } from './preview-viewport'

export type SignaturePngStage = 'prepare' | 'render' | 'encode'
export async function exportSignaturePng(
  scene: SignatureProject,
  hooks: {
    signal?: { cancelled?: boolean }
    onProgress?: (stage: SignaturePngStage, ratio: number) => void
    onBackend?: (backend: 'worker' | 'canvas') => void
    /** Optional bounded raster for a new creative step; layout coordinates stay unchanged. */
    longEdge?: number
  } = {},
) {
  const check = () => {
    if (hooks.signal?.cancelled) throw new Error('已取消')
  }
  check()
  if (
    ![scene.width, scene.height].every(
      (value) => Number.isSafeInteger(value) && value >= 1 && value <= 8192,
    )
  )
    throw new Error('PNG导出尺寸无效')
  const size = fitSignatureRaster(
    scene.width,
    scene.height,
    hooks.longEdge ?? Math.max(scene.width, scene.height),
  )
  hooks.onProgress?.('prepare', 0)
  const wash =
    (scene.options.underlay ?? 0) > 0
      ? await prepareSignatureWash(scene.portrait, scene.options, { signal: hooks.signal })
      : undefined
  check()
  let worker: Awaited<ReturnType<typeof createSignatureRasterWorker>> = null
  const stampMaxLong = Math.min(
    1000,
    Math.max(480, Math.round(Math.max(scene.width, scene.height) * 0.4)),
  )
  try {
    worker = await createSignatureRasterWorker(
      scene.placements,
      scene.stamps,
      scene.width,
      scene.height,
      scene.options,
      hooks.signal,
      wash,
      { cutout: true, stampMaxLong },
    )
    if (worker) {
      hooks.onBackend?.('worker')
      const blob = await worker.exportPng(size.width, size.height, stampMaxLong, {
        tileSize: 384,
        signal: hooks.signal,
        onProgress: (done, total, stage) =>
          hooks.onProgress?.(stage === 'encode' ? 'encode' : 'render', done / Math.max(1, total)),
      })
      check()
      return blob
    }
  } catch (error) {
    check()
    if (error instanceof Error && error.message === '已取消') throw error
  } finally {
    worker?.dispose()
  }
  check()
  hooks.onBackend?.('canvas')
  let canvas: HTMLCanvasElement | null = null
  try {
    canvas = await paintPlacementsTiled(
      scene.placements,
      scene.stamps,
      scene.width,
      scene.height,
      size.width,
      size.height,
      {
        ...scene.options,
        portrait: wash,
        tileSize: 384,
        signal: hooks.signal,
        onTile: ({ done, total }) => hooks.onProgress?.('render', done / Math.max(1, total)),
      },
    )
    check()
    hooks.onProgress?.('encode', 0)
    const blob = await canvasToPngBlob(canvas)
    check()
    return blob
  } finally {
    if (canvas) canvas.width = canvas.height = 1
  }
}
