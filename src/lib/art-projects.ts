/** Projects and source files stay in IndexedDB on this device. */
export interface ArtProject {
  id: string
  name: string
  updatedAt: number
  kind: 'image' | 'video'
  source: File
  thumbnail: string
  settings: Record<string, string | number | boolean>
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('astra-art-projects', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('projects', { keyPath: 'id' })
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('请关闭其他 Astra 标签页后重试'))
    request.onsuccess = () => resolve(request.result)
  })
}
async function transaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('projects', mode)
    const request = action(tx.objectStore('projects'))
    tx.oncomplete = () => {
      db.close()
      resolve(request.result)
    }
    tx.onerror = () => {
      db.close()
      reject(tx.error || request.error)
    }
    tx.onabort = () => {
      db.close()
      reject(tx.error || new Error('本地存储操作未完成'))
    }
  })
}
export function saveArtProject(project: ArtProject) {
  return transaction('readwrite', (store) => store.put(project))
}
export function getArtProject(id: string): Promise<ArtProject | undefined> {
  return transaction('readonly', (store) => store.get(id))
}
export async function listArtProjects(): Promise<ArtProject[]> {
  return (await transaction<ArtProject[]>('readonly', (store) => store.getAll())).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  )
}
export function deleteArtProject(id: string) {
  return transaction('readwrite', (store) => store.delete(id))
}
