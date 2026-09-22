import type { SignatureStamp } from './extract'
import { measureStampTraits } from './extract'

const DB_NAME = 'astra-signature-bank'
const DB_VERSION = 1
const STORE_BANKS = 'banks'
const STORE_ENTRIES = 'entries'

export type NameBank = {
  id: string
  /** 名字标签，如「心上人」 */
  label: string
  createdAt: number
  updatedAt: number
  count: number
  /** 目标遍数，默认 100 */
  goal: number
}

export type BankEntryRecord = {
  id: string
  bankId: string
  index: number
  createdAt: number
  width: number
  height: number
  /** PNG blob */
  png: Blob
  /** 墨量占比 0–1 */
  inkRatio: number
  /** 宽/高 */
  aspect: number
}

export type BankEntryView = {
  id: string
  bankId: string
  index: number
  createdAt: number
  width: number
  height: number
  previewUrl: string
  inkRatio: number
  aspect: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('打开名字库失败'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_BANKS)) {
        db.createObjectStore(STORE_BANKS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        const store = db.createObjectStore(STORE_ENTRIES, { keyPath: 'id' })
        store.createIndex('byBank', 'bankId', { unique: false })
      }
    }
  })
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'))
  })
}

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export async function listBanks(): Promise<NameBank[]> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_BANKS, 'readonly')
    const all = await idbReq(tx.objectStore(STORE_BANKS).getAll() as IDBRequest<NameBank[]>)
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    db.close()
  }
}

export async function getBank(bankId: string): Promise<NameBank | null> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_BANKS, 'readonly')
    const bank = await idbReq(tx.objectStore(STORE_BANKS).get(bankId) as IDBRequest<NameBank | undefined>)
    return bank ?? null
  } finally {
    db.close()
  }
}

export async function ensureBank(label: string, goal = 100): Promise<NameBank> {
  const trimmed = label.trim() || '未命名'
  const goalClamped = Math.max(1, Math.min(500, goal))
  const banks = await listBanks()
  const existing = banks.find((b) => b.label === trimmed)
  if (existing) {
    if (existing.goal !== goalClamped) {
      const updated = { ...existing, goal: goalClamped, updatedAt: Date.now() }
      const db = await openDb()
      try {
        const tx = db.transaction(STORE_BANKS, 'readwrite')
        await idbReq(tx.objectStore(STORE_BANKS).put(updated))
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        })
        return updated
      } finally {
        db.close()
      }
    }
    return existing
  }

  const bank: NameBank = {
    id: uid('bank'),
    label: trimmed,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    count: 0,
    goal: goalClamped,
  }
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_BANKS, 'readwrite')
    await idbReq(tx.objectStore(STORE_BANKS).put(bank))
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return bank
  } finally {
    db.close()
  }
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('印章导出失败'))),
      'image/png',
    )
  })
}

export async function addStampToBank(
  bankId: string,
  stamp: SignatureStamp,
): Promise<BankEntryView> {
  const views = await addStampsToBank(bankId, [stamp])
  return views[0]!
}

/** 批量写入名字库（生成 100 种时用） */
export async function addStampsToBank(
  bankId: string,
  stamps: SignatureStamp[],
  onProgress?: (ratio: number) => void,
): Promise<BankEntryView[]> {
  const bank = await getBank(bankId)
  if (!bank) throw new Error('名字库不存在')
  if (stamps.length === 0) return []

  // 先在事务外转 PNG，避免 IDB 事务超时
  const prepared: Omit<BankEntryRecord, 'index'>[] = []
  for (let i = 0; i < stamps.length; i++) {
    const stamp = stamps[i]!
    const png = await canvasToPngBlob(stamp.canvas)
    const traits = measureStampTraits(stamp.canvas)
    prepared.push({
      id: uid('entry'),
      bankId,
      createdAt: Date.now(),
      width: stamp.width,
      height: stamp.height,
      png,
      inkRatio: traits.inkRatio,
      aspect: traits.aspect,
    })
    if (i % 10 === 0) {
      onProgress?.(0.45 * ((i + 1) / stamps.length))
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  const views: BankEntryView[] = []
  let count = bank.count
  const db = await openDb()
  try {
    const chunk = 25
    for (let i = 0; i < prepared.length; i += chunk) {
      const slice = prepared.slice(i, i + chunk)
      const tx = db.transaction([STORE_BANKS, STORE_ENTRIES], 'readwrite')
      const entryStore = tx.objectStore(STORE_ENTRIES)
      const bankStore = tx.objectStore(STORE_BANKS)
      for (let j = 0; j < slice.length; j++) {
        const row = slice[j]!
        count += 1
        const entry: BankEntryRecord = { ...row, index: count }
        entryStore.put(entry)
        const stamp = stamps[i + j]
        views.push({
          id: entry.id,
          bankId,
          index: entry.index,
          createdAt: entry.createdAt,
          width: entry.width,
          height: entry.height,
          previewUrl: stamp?.previewUrl || URL.createObjectURL(entry.png),
          inkRatio: entry.inkRatio,
          aspect: entry.aspect,
        })
      }
      bankStore.put({
        ...bank,
        count,
        updatedAt: Date.now(),
        goal: Math.max(bank.goal, count),
      })
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
      })
      onProgress?.(0.45 + 0.55 * Math.min(1, (i + slice.length) / prepared.length))
    }
  } finally {
    db.close()
  }
  return views
}

export async function listBankEntries(bankId: string): Promise<BankEntryView[]> {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_ENTRIES, 'readonly')
    const idx = tx.objectStore(STORE_ENTRIES).index('byBank')
    const rows = await idbReq(
      idx.getAll(bankId) as IDBRequest<BankEntryRecord[]>,
    )
    rows.sort((a, b) => a.index - b.index)
    return rows.map((r) => ({
      id: r.id,
      bankId: r.bankId,
      index: r.index,
      createdAt: r.createdAt,
      width: r.width,
      height: r.height,
      previewUrl: URL.createObjectURL(r.png),
      inkRatio: r.inkRatio,
      aspect: r.aspect,
    }))
  } finally {
    db.close()
  }
}

export async function deleteBankEntry(entryId: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction([STORE_BANKS, STORE_ENTRIES], 'readwrite')
    const entryStore = tx.objectStore(STORE_ENTRIES)
    const bankStore = tx.objectStore(STORE_BANKS)
    const entry = await idbReq(
      entryStore.get(entryId) as IDBRequest<BankEntryRecord | undefined>,
    )
    if (!entry) return
    entryStore.delete(entryId)
    const bank = await idbReq(
      bankStore.get(entry.bankId) as IDBRequest<NameBank | undefined>,
    )
    if (bank) {
      bankStore.put({
        ...bank,
        count: Math.max(0, bank.count - 1),
        updatedAt: Date.now(),
      })
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

export async function deleteBank(bankId: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction([STORE_BANKS, STORE_ENTRIES], 'readwrite')
    const entries = await idbReq(
      tx.objectStore(STORE_ENTRIES).index('byBank').getAll(bankId) as IDBRequest<
        BankEntryRecord[]
      >,
    )
    for (const e of entries) {
      tx.objectStore(STORE_ENTRIES).delete(e.id)
    }
    tx.objectStore(STORE_BANKS).delete(bankId)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('名字库条目读取失败'))
    }
    img.src = url
  })
}

/** 把整库加载成可渲染的印章数组 */
export async function loadBankAsStamps(bankId: string): Promise<SignatureStamp[]> {
  const db = await openDb()
  let rows: BankEntryRecord[] = []
  try {
    const tx = db.transaction(STORE_ENTRIES, 'readonly')
    rows = await idbReq(
      tx.objectStore(STORE_ENTRIES).index('byBank').getAll(bankId) as IDBRequest<
        BankEntryRecord[]
      >,
    )
  } finally {
    db.close()
  }
  rows.sort((a, b) => a.index - b.index)

  const stamps: SignatureStamp[] = []
  for (const row of rows) {
    const img = await blobToImage(row.png)
    const canvas = document.createElement('canvas')
    canvas.width = row.width
    canvas.height = row.height
    const ctx = canvas.getContext('2d')
    if (!ctx) continue
    ctx.drawImage(img, 0, 0)
    stamps.push({
      id: row.id,
      label: `#${row.index}`,
      canvas,
      width: row.width,
      height: row.height,
      previewUrl: URL.createObjectURL(row.png),
    })
  }
  return stamps
}

export function revokeEntryUrls(entries: BankEntryView[]) {
  for (const e of entries) {
    if (e.previewUrl.startsWith('blob:')) URL.revokeObjectURL(e.previewUrl)
  }
}
