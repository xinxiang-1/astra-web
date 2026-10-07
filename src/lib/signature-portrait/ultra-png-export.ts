import { createSignatureRasterWorker } from './raster-worker-client'
import { prepareSignatureWash } from './styled-wash'
import type { SignatureProject } from './project'
import type { SignaturePngStage } from './png-export'

export function signatureExportSize(
  scene: Pick<SignatureProject, 'width' | 'height'>,
  longSide: 8192 | 16384,
) {
  if (
    ![8192, 16384].includes(longSide) ||
    ![scene.width, scene.height].every((n) => Number.isSafeInteger(n) && n >= 1 && n <= 8192)
  )
    throw new Error('超清PNG尺寸无效')
  const scale = longSide / Math.max(scene.width, scene.height)
  return {
    width: Math.max(1, Math.round(scene.width * scale)),
    height: Math.max(1, Math.round(scene.height * scale)),
  }
}

/** Repaint fixed signature geometry directly at the requested pixel size; never upscale a PNG. */
export async function exportSignatureUltraPng(
  scene: SignatureProject,
  settings: { longSide: 8192 | 16384; inkMode: 'original' | 'outline' },
  hooks: {
    signal?: { cancelled?: boolean }
    onProgress?: (stage: SignaturePngStage, ratio: number) => void
    onBackend?: (backend: 'worker') => void
  } = {},
) {
  const check = () => {
    if (hooks.signal?.cancelled) throw new Error('已取消')
  }
  check()
  const size = signatureExportSize(scene, settings.longSide)
  if (!['original', 'outline'].includes(settings.inkMode))
    throw new Error('请选择有效的笔迹重绘方式')
  if (typeof CompressionStream === 'undefined')
    throw new Error('此浏览器不支持分块超清PNG，请使用普通PNG导出')
  hooks.onProgress?.('prepare', 0)
  const wash =
    (scene.options.underlay ?? 0) > 0
      ? await prepareSignatureWash(scene.portrait, scene.options, { signal: hooks.signal })
      : undefined
  check()
  const worker = await createSignatureRasterWorker(
    scene.placements,
    scene.stamps,
    scene.width,
    scene.height,
    scene.options,
    hooks.signal,
    wash,
    { cutout: true, outline: settings.inkMode === 'outline', stampMaxLong: 1000 },
  )
  if (!worker) throw new Error('当前浏览器不支持后台超清导出，请更新浏览器或使用普通PNG导出')
  try {
    hooks.onBackend?.('worker')
    const blob = await worker.exportStripePng(size.width, size.height, 1000, {
      signal: hooks.signal,
      inkMode: settings.inkMode,
      onProgress: (done, total, stage) =>
        hooks.onProgress?.(stage === 'encode' ? 'encode' : 'render', done / Math.max(1, total)),
    })
    check()
    return { ...size, blob }
  } finally {
    worker.dispose()
  }
}
