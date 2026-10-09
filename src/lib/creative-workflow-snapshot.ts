import type { ArtProject } from './art-projects'
import { readProjectOrigin } from './art-project-origin'

const sourceHashes = new WeakMap<Blob, Promise<string>>()
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')

/** Local ids/time are excluded so the same editable snapshot can be restored on another device. */
export async function creativeWorkflowSnapshot(project: ArtProject, signal?: AbortSignal) {
  signal?.throwIfAborted()
  let sourceHash = sourceHashes.get(project.source)
  if (!sourceHash) {
    sourceHash = project.source
      .arrayBuffer()
      .then((bytes) => crypto.subtle.digest('SHA-256', bytes))
      .then(hex)
    sourceHashes.set(project.source, sourceHash)
    sourceHash.catch(() => sourceHashes.delete(project.source))
  }
  const origin = readProjectOrigin(project.origin)
  const value = {
    name: project.name,
    kind: project.kind,
    engine: project.engineVersion ?? null,
    source: {
      sha256: await sourceHash,
      name: project.source.name,
      type: project.source.type,
      lastModified: project.source.lastModified,
    },
    settings: Object.fromEntries(
      Object.entries(project.settings).sort(([a], [b]) => a.localeCompare(b)),
    ),
    origin: origin ? { sha256: origin.sha256, recipeId: origin.recipeId ?? null } : null,
  }
  signal?.throwIfAborted()
  const result = hex(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))),
  )
  signal?.throwIfAborted()
  return result
}

export function readWorkflowKey(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error('工作流校验信息无效')
  return value
}
