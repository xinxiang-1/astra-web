import { readProjectOrigin, type SignatureProjectOrigin } from './art-project-origin'
import { creativeWorkflowSnapshot, readWorkflowKey } from './creative-workflow-snapshot'

/** Projects and source files stay in IndexedDB on this device. */
export interface ArtProject {
  id: string
  name: string
  updatedAt: number
  kind: 'image' | 'video'
  source: File
  thumbnail: string
  settings: Record<string, string | number | boolean>
  engineVersion?: string
  origin?: SignatureProjectOrigin
  workflowKey?: string
}
export interface CreativeProjectSummary {
  id: string
  name: string
  updatedAt: number
  kind: 'image' | 'video' | 'signature'
  thumbnail: string
  engineVersion?: string
  signatureHash?: string
  origin?: SignatureProjectOrigin
  workflowKey?: string
  workflowSnapshot?: string
}
export interface SavedSignatureProject extends CreativeProjectSummary {
  kind: 'signature'
  signatureHash: string
  file: File
}
export interface SignatureSaveInput {
  file: Blob
  name: string
  thumbnail: string
  engineVersion: string
}
const PROJECTS = 'projects'
const INDEX = 'creative-index'
const SIGNATURES = 'signature-projects'

function artSummary(project: ArtProject): CreativeProjectSummary {
  return {
    id: project.id,
    name: project.name,
    updatedAt: project.updatedAt,
    kind: project.kind,
    thumbnail: project.thumbnail,
    engineVersion: project.engineVersion,
    ...(project.origin ? { origin: readProjectOrigin(project.origin) } : {}),
  }
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false
    const request = indexedDB.open('astra-art-projects', 2)
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true
        reject(error)
      }
    }
    request.onupgradeneeded = () => {
      if (settled) {
        request.transaction?.abort()
        return
      }
      const db = request.result,
        tx = request.transaction!
      if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(SIGNATURES))
        db.createObjectStore(SIGNATURES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(INDEX)) {
        const index = db.createObjectStore(INDEX, { keyPath: 'id' })
        index.createIndex('signatureHash', 'signatureHash', { unique: true })
        // Only migration visits legacy payload records; normal listing reads summaries.
        const cursor = tx.objectStore(PROJECTS).openCursor()
        cursor.onsuccess = () => {
          const row = cursor.result
          if (!row) return
          index.put(artSummary(row.value as ArtProject))
          row.continue()
        }
      }
    }
    request.onerror = () =>
      fail(
        request.error?.name === 'VersionError'
          ? new Error('本地项目版本已更新，请刷新此窗口后重试。')
          : request.error,
      )
    request.onblocked = () => fail(new Error('请关闭其他 Astra 标签页后重试，本地作品会保留。'))
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      if (settled) {
        db.close()
        return
      }
      settled = true
      resolve(db)
    }
  })
}
async function transaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  action: (tx: IDBTransaction, result: (value: T) => void) => void,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  const db = await openDatabase()
  if (signal?.aborted) {
    db.close()
    signal.throwIfAborted()
  }
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(stores, mode)
    } catch (error) {
      db.close()
      reject(error)
      return
    }
    let result: T
    const abort = () => {
      try {
        tx.abort()
      } catch {
        /* Already complete. */
      }
    }
    const close = () => {
      signal?.removeEventListener('abort', abort)
      db.close()
    }
    tx.oncomplete = () => {
      close()
      resolve(result)
    }
    tx.onabort = () => {
      close()
      reject(signal?.aborted ? signal.reason : tx.error || new Error('本地存储操作未完成'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      action(tx, (value) => {
        result = value
      })
    } catch (cause) {
      abort()
      close()
      reject(cause)
    }
  })
}
export async function saveArtProject(project: ArtProject, signal?: AbortSignal) {
  const entry = {
    ...project,
    settings: { ...project.settings },
    ...(project.origin ? { origin: readProjectOrigin(project.origin) } : {}),
  }
  const summary = artSummary(entry)
  if (entry.workflowKey) {
    summary.workflowKey = entry.workflowKey = readWorkflowKey(entry.workflowKey)
    summary.workflowSnapshot = await creativeWorkflowSnapshot(entry, signal)
  }
  return transaction<IDBValidKey>(
    [PROJECTS, INDEX],
    'readwrite',
    (tx, result) => {
      const request = tx.objectStore(PROJECTS).put(entry)
      request.onsuccess = () => result(request.result)
      tx.objectStore(INDEX).put(summary)
    },
    signal,
  )
}
export function getArtProject(id: string): Promise<ArtProject | undefined> {
  return transaction([PROJECTS], 'readonly', (tx, result) => {
    const request = tx.objectStore(PROJECTS).get(id)
    request.onsuccess = () => result(request.result)
  })
}
export async function listArtProjects(): Promise<ArtProject[]> {
  const entries = await transaction<ArtProject[]>([PROJECTS], 'readonly', (tx, result) => {
    const request = tx.objectStore(PROJECTS).getAll()
    request.onsuccess = () => result(request.result)
  })
  return entries.sort((a, b) => b.updatedAt - a.updatedAt)
}
export async function listCreativeProjects(): Promise<CreativeProjectSummary[]> {
  const entries = await transaction<CreativeProjectSummary[]>([INDEX], 'readonly', (tx, result) => {
    const request = tx.objectStore(INDEX).getAll()
    request.onsuccess = () => result(request.result)
  })
  return entries.sort((a, b) => b.updatedAt - a.updatedAt)
}
export function deleteArtProject(id: string) {
  return transaction<void>([PROJECTS, INDEX], 'readwrite', (tx) => {
    tx.objectStore(PROJECTS).delete(id)
    tx.objectStore(INDEX).delete(id)
  })
}
export function deleteCreativeProject(id: string) {
  return transaction<void>([PROJECTS, SIGNATURES, INDEX], 'readwrite', (tx) => {
    // Independent derivatives stay intact when an original is removed.
    tx.objectStore(PROJECTS).delete(id)
    tx.objectStore(SIGNATURES).delete(id)
    tx.objectStore(INDEX).delete(id)
  })
}
async function signatureEntry(
  input: SignatureSaveInput,
  signal?: AbortSignal,
): Promise<SavedSignatureProject> {
  signal?.throwIfAborted()
  if (
    !input.file.size ||
    input.file.size > 193 * 1024 * 1024 ||
    input.thumbnail.length > 2 * 1024 * 1024 ||
    !/^data:image\/(png|jpeg);base64,/.test(input.thumbnail)
  )
    throw new Error('签名作品或缩略图无效')
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', await input.file.arrayBuffer()),
  )
  signal?.throwIfAborted()
  const name =
    input.name
      .replace(/[\x00-\x1f]/g, '')
      .trim()
      .slice(0, 60) || '未命名签名画像'
  return {
    id: crypto.randomUUID(),
    kind: 'signature',
    name,
    updatedAt: Date.now(),
    thumbnail: input.thumbnail,
    engineVersion: input.engineVersion,
    signatureHash: Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''),
    file: new File([input.file], 'signature.astra-signature', { type: input.file.type }),
  }
}
function saveSignatureInTransaction(
  tx: IDBTransaction,
  entry: SavedSignatureProject,
  done: (summary: CreativeProjectSummary) => void,
) {
  const store = tx.objectStore(INDEX),
    existing = store.index('signatureHash').get(entry.signatureHash)
  existing.onsuccess = () => {
    try {
      const saved = { ...entry, id: existing.result?.id ?? entry.id }
      const { file, ...summary } = saved
      tx.objectStore(SIGNATURES).put({ ...summary, file })
      store.put(summary)
      done(summary)
    } catch {
      try {
        tx.abort()
      } catch {
        // An AbortSignal may already have aborted the transaction during a write.
      }
    }
  }
}
export async function saveSignatureProject(input: SignatureSaveInput, signal?: AbortSignal) {
  const entry = await signatureEntry(input, signal)
  return transaction<CreativeProjectSummary>(
    [INDEX, SIGNATURES],
    'readwrite',
    (tx, result) => saveSignatureInTransaction(tx, entry, result),
    signal,
  )
}
export async function saveSignatureDerivative(
  input: SignatureSaveInput,
  project: ArtProject,
  recipeId: string,
  signal?: AbortSignal,
) {
  const entry = await signatureEntry(input, signal)
  return transaction<{ signature: CreativeProjectSummary; project: ArtProject }>(
    [INDEX, SIGNATURES, PROJECTS],
    'readwrite',
    (tx, result) => {
      saveSignatureInTransaction(tx, entry, (signature) => {
        const origin = readProjectOrigin({
          kind: 'signature',
          projectId: signature.id,
          sha256: entry.signatureHash,
          name: signature.name,
          recipeId,
        })!
        const derived = { ...project, origin }
        tx.objectStore(PROJECTS).put(derived)
        tx.objectStore(INDEX).put(artSummary(derived))
        result({ signature, project: derived })
      })
    },
    signal,
  )
}
export async function getSignatureProject(
  id: string,
  signal?: AbortSignal,
): Promise<SavedSignatureProject | undefined> {
  const entry = await transaction<SavedSignatureProject | undefined>(
    [SIGNATURES],
    'readonly',
    (tx, result) => {
      const request = tx.objectStore(SIGNATURES).get(id)
      request.onsuccess = () => result(request.result)
    },
    signal,
  )
  if (!entry) return undefined
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', await entry.file.arrayBuffer()),
  )
  signal?.throwIfAborted()
  if (Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') !== entry.signatureHash)
    throw new Error('本地签名作品校验失败，请从备份文件恢复。')
  return entry
}

/** Receipt metadata is local only; an edited copy never gets overwritten by a backup import. */
export async function importCreativeWorkflow(
  input: SignatureSaveInput,
  project: ArtProject,
  workflowKey: string,
  signal?: AbortSignal,
) {
  readWorkflowKey(workflowKey)
  const entry = await signatureEntry(input, signal)
  const origin = readProjectOrigin(project.origin)
  if (!origin || origin.sha256 !== entry.signatureHash || project.kind !== 'image')
    throw new Error('工作流的原作与派生关系不匹配')
  const snapshot = await creativeWorkflowSnapshot(project, signal)
  return transaction<{ signature: CreativeProjectSummary; project: ArtProject; reused: boolean }>(
    [INDEX, SIGNATURES, PROJECTS],
    'readwrite',
    (tx, result) => {
      const save = (existing?: ArtProject) =>
        saveSignatureInTransaction(tx, entry, (signature) => {
          const mappedOrigin = readProjectOrigin({
            ...origin,
            projectId: signature.id,
            name: signature.name,
          })!
          const derived: ArtProject = existing
            ? { ...existing, origin: mappedOrigin }
            : { ...project, id: crypto.randomUUID(), workflowKey, origin: mappedOrigin }
          tx.objectStore(PROJECTS).put(derived)
          tx.objectStore(INDEX).put({
            ...artSummary(derived),
            workflowKey,
            workflowSnapshot: snapshot,
          })
          result({ signature, project: derived, reused: Boolean(existing) })
        })
      const abort = () => {
        try {
          tx.abort()
        } catch {
          /* Already cancelled. */
        }
      }
      const findSnapshot = () => {
        const cursor = tx.objectStore(INDEX).openCursor()
        cursor.onsuccess = () => {
          try {
            const row = cursor.result
            if (!row) {
              save()
              return
            }
            const summary = row.value as CreativeProjectSummary
            if (summary.workflowKey === workflowKey && summary.workflowSnapshot === snapshot) {
              const request = tx.objectStore(PROJECTS).get(summary.id)
              request.onsuccess = () => {
                try {
                  save(request.result)
                } catch {
                  abort()
                }
              }
            } else row.continue()
          } catch {
            abort()
          }
        }
      }
      // Retain the original id when vacant; collisions with other local work get a fresh id.
      // Hash deduplication can instead select an existing equivalent local original.
      let remaining = 3,
        occupied = false
      for (const store of [INDEX, SIGNATURES, PROJECTS]) {
        const request = tx.objectStore(store).getKey(origin.projectId)
        request.onsuccess = () => {
          occupied ||= request.result !== undefined
          if (--remaining === 0) {
            if (!occupied) entry.id = origin.projectId
            try {
              findSnapshot()
            } catch {
              abort()
            }
          }
        }
      }
    },
    signal,
  )
}
