import type { ArtProject, SavedSignatureProject } from './art-projects'
import { readProjectOrigin, type SignatureProjectOrigin } from './art-project-origin'
import { createArtProjectPackage, readArtProjectPackage } from './art-project-package'
import { readSignatureProject, SIGNATURE_PROJECT_ENGINE } from './signature-portrait/project'
import { creativeWorkflowSnapshot } from './creative-workflow-snapshot'

export const CREATIVE_WORKFLOW_ACCEPT = '.astra-workflow'
export const CREATIVE_WORKFLOW_LIMIT = 264 * 1024 * 1024
const SIGNATURE_LIMIT = 193 * 1024 * 1024
const ART_LIMIT = 67 * 1024 * 1024
const MANIFEST_LIMIT = 16 * 1024
const MAGIC = new TextEncoder().encode('ASTRAWF01\n')
const HEADER = MAGIC.length + 4 + 32
type Asset = { size: number; sha256: string; engine: string | null }
export interface CreativeWorkflowManifest {
  format: 'astra-creative-workflow'
  version: 1
  exportedAt: number
  signature: Asset
  characters: Asset
  origin: SignatureProjectOrigin
}
const fail = (label: string): never => {
  throw new Error(`工作流包${label}`)
}
const check = (signal?: AbortSignal) => signal?.throwIfAborted()
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
async function digest(blob: Blob, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  check(signal)
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
  check(signal)
  return bytes
}
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('目录无效')
  return value as Record<string, unknown>
}
function asset(value: unknown, max: number): Asset {
  const raw = record(value)
  if (
    !Number.isSafeInteger(raw.size) ||
    (raw.size as number) < 1 ||
    (raw.size as number) > max ||
    typeof raw.sha256 !== 'string' ||
    !/^[0-9a-f]{64}$/.test(raw.sha256) ||
    (raw.engine !== null &&
      (typeof raw.engine !== 'string' || raw.engine.length > 40 || /[\x00-\x1f]/.test(raw.engine)))
  )
    return fail('素材信息无效')
  return { size: raw.size as number, sha256: raw.sha256, engine: raw.engine as string | null }
}
function manifestOf(value: unknown): CreativeWorkflowManifest {
  const raw = record(value)
  if (raw.format !== 'astra-creative-workflow' || raw.version !== 1)
    return fail('版本暂不支持，请使用对应版本的 Astra')
  if (!Number.isSafeInteger(raw.exportedAt) || (raw.exportedAt as number) < 0)
    return fail('导出日期无效')
  const signature = asset(raw.signature, SIGNATURE_LIMIT),
    characters = asset(raw.characters, ART_LIMIT)
  const origin = readProjectOrigin(raw.origin)
  if (
    !origin ||
    origin.sha256 !== signature.sha256 ||
    signature.engine !== SIGNATURE_PROJECT_ENGINE
  )
    return fail('原作关系或签名引擎不匹配')
  return {
    format: 'astra-creative-workflow',
    version: 1,
    exportedAt: raw.exportedAt as number,
    signature,
    characters,
    origin,
  }
}
function sameOrigin(a: SignatureProjectOrigin | undefined, b: SignatureProjectOrigin) {
  return a && JSON.stringify(a) === JSON.stringify(b)
}
export function creativeWorkflowFilename(name: string) {
  return `${
    name
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
      .trim()
      .slice(0, 60) || '创作工作流'
  }${CREATIVE_WORKFLOW_ACCEPT}`
}

/** Both editable packages are retained byte-for-byte; nested readers enforce versions and licenses. */
export async function createCreativeWorkflowPackage(
  signature: SavedSignatureProject,
  project: ArtProject,
  signal?: AbortSignal,
): Promise<Blob> {
  const origin = readProjectOrigin(project.origin)
  if (
    !origin ||
    origin.projectId !== signature.id ||
    origin.sha256 !== signature.signatureHash ||
    project.kind !== 'image'
  )
    return fail('缺少匹配的签名原作，请先恢复原作')
  if (!signature.file.size || signature.file.size > SIGNATURE_LIMIT)
    return fail('签名原文件大小无效')
  const sha = hex(await digest(signature.file, signal))
  if (sha !== origin.sha256) return fail('签名原文件校验失败')
  const restored = await readSignatureProject(signature.file, { signal })
  try {
    const art = await createArtProjectPackage(project)
    check(signal)
    const validated = await readArtProjectPackage(art)
    check(signal)
    if (validated.project.kind !== 'image' || !sameOrigin(validated.project.origin, origin))
      return fail('派生关系无效')
    const manifest: CreativeWorkflowManifest = {
      format: 'astra-creative-workflow',
      version: 1,
      exportedAt: Date.now(),
      signature: { size: signature.file.size, sha256: sha, engine: SIGNATURE_PROJECT_ENGINE },
      characters: {
        size: art.size,
        sha256: hex(await digest(art, signal)),
        engine: project.engineVersion ?? null,
      },
      origin,
    }
    const json = new Blob([JSON.stringify(manifest)], { type: 'application/json' })
    if (json.size > MANIFEST_LIMIT || art.size > ART_LIMIT) return fail('大小超出支持范围')
    const header = new Uint8Array(HEADER)
    header.set(MAGIC)
    new DataView(header.buffer).setUint32(MAGIC.length, json.size, true)
    header.set(await digest(json, signal), MAGIC.length + 4)
    check(signal)
    return new Blob([header, json, signature.file, art], {
      type: 'application/x-astra-creative-workflow',
    })
  } finally {
    restored.dispose()
  }
}

/** Caller owns the decoded signature until dispose(); nothing is persisted by this reader. */
export async function readCreativeWorkflowPackage(file: Blob, signal?: AbortSignal) {
  check(signal)
  if (file.size <= HEADER || file.size > CREATIVE_WORKFLOW_LIMIT)
    return fail('大小无效，最大支持264 MB')
  const header = new Uint8Array(await file.slice(0, HEADER).arrayBuffer())
  check(signal)
  if (!MAGIC.every((b, i) => header[i] === b)) return fail('格式不正确，请打开.astra-workflow文件')
  const length = new DataView(header.buffer).getUint32(MAGIC.length, true)
  if (!length || length > MANIFEST_LIMIT || HEADER + length >= file.size) return fail('目录不完整')
  const json = file.slice(HEADER, HEADER + length)
  if (hex(await digest(json, signal)) !== hex(header.slice(MAGIC.length + 4)))
    return fail('目录校验失败')
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await json.arrayBuffer()))
  } catch {
    return fail('目录无法读取')
  }
  const manifest = manifestOf(value),
    start = HEADER + length
  if (file.size !== start + manifest.signature.size + manifest.characters.size)
    return fail('素材不完整或包含额外数据')
  const signatureFile = new File(
    [file.slice(start, start + manifest.signature.size)],
    'original.astra-signature',
    { type: 'application/x-astra-signature-project' },
  )
  const characters = file.slice(start + manifest.signature.size)
  if (
    hex(await digest(signatureFile, signal)) !== manifest.signature.sha256 ||
    hex(await digest(characters, signal)) !== manifest.characters.sha256
  )
    return fail('素材校验失败，请从备份恢复')
  const original = await readSignatureProject(signatureFile, { signal })
  try {
    const { project } = await readArtProjectPackage(characters)
    check(signal)
    if (
      project.kind !== 'image' ||
      !sameOrigin(project.origin, manifest.origin) ||
      (project.engineVersion ?? null) !== manifest.characters.engine
    )
      return fail('派生关系或引擎不匹配')
    const snapshot = await creativeWorkflowSnapshot(project, signal)
    const workflowKey = hex(
      await digest(new Blob([`1:${manifest.signature.sha256}:${snapshot}`]), signal),
    )
    return {
      project,
      signature: original.project,
      signatureFile,
      workflowKey,
      dispose: original.dispose,
    }
  } catch (error) {
    original.dispose()
    throw error
  }
}
