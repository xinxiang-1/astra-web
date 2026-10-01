import type { StarterTemplate } from '@/content/starter-templates'
import { assertArtProjectEngineCompatible, readArtProjectPackage } from '@/lib/art-project-package'

export function starterAssetUrl(relative: string) {
  return `${import.meta.env.BASE_URL}${relative}`
}

/** This reads an original demo; persistence is a separate, explicit user action. */
export async function readStarterTemplate(template: StarterTemplate, signal: AbortSignal) {
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) controller.abort()
  let timedOut = false
  const timeout = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, 15000)
  try {
    const asset = template.assets.project
    const response = await fetch(starterAssetUrl(asset.path), { signal: controller.signal })
    if (!response.ok) throw new Error('模板暂时无法读取，请检查网络后重试。')
    const bytes = await response.arrayBuffer()
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const sha256 = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
    if (bytes.byteLength !== asset.bytes || sha256 !== asset.sha256)
      throw new Error('模板文件不完整，请刷新页面后重试。你的已有项目保持原样。')
    const { project } = await readArtProjectPackage(new File([bytes], `${template.id}.astra`))
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError')
    assertArtProjectEngineCompatible(project)
    return project
  } catch (cause) {
    if (timedOut) throw new Error('模板读取超时，请检查网络后重试。')
    throw cause
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', onAbort)
  }
}
