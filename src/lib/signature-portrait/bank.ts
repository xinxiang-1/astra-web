import type { SignatureStamp } from './extract'
import { measureStampTraits } from './extract'

const DB_NAME = 'astra-signature-bank'
const DB_VERSION = 1
const STORE_BANKS = 'banks'
const STORE_ENTRIES = 'entries'

export type NameBank = {
  id: string
  label: string
  createdAt: number
  updatedAt: number
  count: number
  goal: number
}

export type BankEntryRecord = {
  id: string
  bankId: string
  index: number
  createdAt: number
  width: number
  height: number
  png: Blob
  inkRatio: number
  aspect: number
  source?: SignatureStamp['source']
}

export type BankEntryView = Omit<BankEntryRecord, 'png'> & { previewUrl: string }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error ?? new Error('打开名字库失败'))
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_BANKS))
        db.createObjectStore(STORE_BANKS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
        db.createObjectStore(STORE_ENTRIES, { keyPath: 'id' }).createIndex('byBank', 'bankId', {
          unique: false,
        })
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

function transactionDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('名字库保存已取消，原笔迹已保留'))
    tx.onerror = () => reject(tx.error ?? new Error('名字库保存失败，原笔迹已保留'))
  })
}

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`
}
function nextTimestamp(bank: NameBank) {
  return Math.max(Date.now(), bank.updatedAt + 1)
}
function safeGoal(goal: number) {
  if (!Number.isFinite(goal)) throw new Error('目标遍数无效')
  return Math.max(1, Math.min(500, Math.round(goal)))
}

export async function listBanks(): Promise<NameBank[]> {
  const db = await openDb()
  try {
    const all = await idbReq(
      db.transaction(STORE_BANKS, 'readonly').objectStore(STORE_BANKS).getAll() as IDBRequest<
        NameBank[]
      >,
    )
    return all.sort((a, b) => b.updatedAt - a.updatedAt)
  } finally {
    db.close()
  }
}

export async function getBank(bankId: string): Promise<NameBank | null> {
  const db = await openDb()
  try {
    return (
      (await idbReq(
        db.transaction(STORE_BANKS, 'readonly').objectStore(STORE_BANKS).get(bankId) as IDBRequest<
          NameBank | undefined
        >,
      )) ?? null
    )
  } finally {
    db.close()
  }
}

/** Lookup and creation share one transaction, including concurrent tabs. */
export async function ensureBank(label: string, goal = 100): Promise<NameBank> {
  const trimmed = label.trim() || '未命名',
    targetGoal = safeGoal(goal)
  const db = await openDb()
  try {
    const tx = db.transaction(STORE_BANKS, 'readwrite'),
      done = transactionDone(tx)
    const store = tx.objectStore(STORE_BANKS)
    const banks = await idbReq(store.getAll() as IDBRequest<NameBank[]>)
    const existing = banks.find((bank) => bank.label === trimmed)
    const now = Date.now()
    const bank: NameBank = existing
      ? {
          ...existing,
          goal: targetGoal,
          updatedAt: existing.goal === targetGoal ? existing.updatedAt : nextTimestamp(existing),
        }
      : {
          id: uid('bank'),
          label: trimmed,
          goal: targetGoal,
          count: 0,
          createdAt: now,
          updatedAt: now,
        }
    store.put(bank)
    await done
    return bank
  } finally {
    db.close()
  }
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('印章导出失败，原笔迹已保留'))),
      'image/png',
    )
  })
}

type WriteOptions = { signal?: AbortSignal; onProgress?: (ratio: number) => void }
type Prepared = Omit<BankEntryRecord, 'bankId' | 'index'>

/** PNG preparation runs before a transaction: encoding failure cannot delete old ink. */
async function prepareStamps(stamps: SignatureStamp[], options: WriteOptions): Promise<Prepared[]> {
  if (stamps.length > 500) throw new Error('单次最多保存 500 枚签名')
  const prepared: Prepared[] = []
  for (let i = 0; i < stamps.length; i++) {
    options.signal?.throwIfAborted()
    const stamp = stamps[i]!
    if (
      stamp.width !== stamp.canvas.width ||
      stamp.height !== stamp.canvas.height ||
      stamp.width < 1 ||
      stamp.height < 1
    ) {
      throw new Error('签名尺寸不一致，原笔迹已保留')
    }
    const traits = measureStampTraits(stamp.canvas)
    if (!Number.isFinite(traits.inkRatio) || traits.inkRatio <= 0)
      throw new Error('签名没有笔迹，原笔迹已保留')
    const png = await canvasToPngBlob(stamp.canvas)
    prepared.push({
      id: uid('entry'),
      createdAt: Date.now(),
      width: stamp.width,
      height: stamp.height,
      png,
      inkRatio: traits.inkRatio,
      aspect: traits.aspect,
      ...(stamp.source ? { source: { ...stamp.source } } : {}),
    })
    options.onProgress?.((0.8 * (i + 1)) / stamps.length)
    if (i % 10 === 9) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  options.signal?.throwIfAborted()
  return prepared
}

type Target =
  | { kind: 'append'; bankId: string }
  | { kind: 'replace'; label: string; expected: NameBank | null; goal: number }

async function writeStamps(target: Target, stamps: SignatureStamp[], options: WriteOptions) {
  const prepared = await prepareStamps(stamps, options)
  const db = await openDb()
  try {
    options.signal?.throwIfAborted()
    return await new Promise<{ bank: NameBank; entries: BankEntryView[] }>((resolve, reject) => {
      const tx = db.transaction([STORE_BANKS, STORE_ENTRIES], 'readwrite')
      const bankStore = tx.objectStore(STORE_BANKS),
        entryStore = tx.objectStore(STORE_ENTRIES)
      let failure: unknown,
        bank: NameBank,
        rows: BankEntryRecord[] = []
      const abort = () => {
        failure = options.signal?.reason
        tx.abort()
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      const cleanup = () => options.signal?.removeEventListener('abort', abort)
      tx.onabort = () => {
        cleanup()
        const reason = failure ?? tx.error
        reject(reason instanceof DOMException && reason.name === 'QuotaExceededError'
          ? new Error('浏览器存储空间不足，原名字库已保留；请释放空间后重试')
          : reason ?? new Error('保存已取消，原名字库已保留'))
      }
      tx.onerror = () => {
        failure ??= tx.error
      }
      tx.oncomplete = () => {
        cleanup()
        // Expose URLs only after commit. No partial UI on transaction failure.
        const entries = rows.map((row, i) => {
          const { png, ...view } = row
          return { ...view, previewUrl: stamps[i]?.previewUrl || URL.createObjectURL(png) }
        })
        resolve({ bank, entries })
      }
      const request = bankStore.getAll() as IDBRequest<NameBank[]>
      request.onsuccess = () => {
        try {
          const existing =
            target.kind === 'append'
              ? request.result.find((b) => b.id === target.bankId)
              : request.result.find((b) => b.label === target.label)
          if (target.kind === 'append' && !existing) throw new Error('名字库不存在')
          if (target.kind === 'replace') {
            const expected = target.expected
            if (
              (expected &&
                (!existing ||
                  existing.id !== expected.id ||
                  existing.updatedAt !== expected.updatedAt ||
                  existing.count !== expected.count)) ||
              (!expected && existing)
            ) {
              throw new Error('名字库已在其它操作中更新，请重新打开后再生成；原笔迹已保留')
            }
          }
          const now = Date.now()
          let startIndex = 0
          bank = existing
            ? {
                ...existing,
                count: (target.kind === 'append' ? existing.count : 0) + prepared.length,
                updatedAt: nextTimestamp(existing),
              }
            : {
                id: uid('bank'),
                label: target.kind === 'replace' ? target.label : '',
                count: prepared.length,
                goal: 100,
                createdAt: now,
                updatedAt: now,
              }
          bank.goal = Math.max(bank.count, target.kind === 'replace' ? target.goal : bank.goal)
          const save = () => {
            try {
              rows = prepared.map((row, i) => ({
                ...row,
                bankId: bank.id,
                index: startIndex + i + 1,
              }))
              for (const row of rows) entryStore.add(row)
              bankStore.put(bank)
            } catch (error) {
              failure = error
              tx.abort()
            }
          }
          if (target.kind === 'replace' && existing) {
            const keys = entryStore.index('byBank').getAllKeys(bank.id)
            keys.onsuccess = () => {
              try {
                for (const key of keys.result) entryStore.delete(key)
                save()
              } catch (error) {
                failure = error
                tx.abort()
              }
            }
          } else if (target.kind === 'append') {
            // Deleted entries leave holes: count is not the next writing number.
            const previous = entryStore.index('byBank').getAll(bank.id) as IDBRequest<
              BankEntryRecord[]
            >
            previous.onsuccess = () => {
              startIndex = previous.result.reduce((last, row) => Math.max(last, row.index), 0)
              bank.count = previous.result.length + prepared.length
              bank.goal = Math.max(bank.goal, bank.count)
              save()
            }
          } else save()
        } catch (error) {
          failure = error
          tx.abort()
        }
      }
    })
  } finally {
    db.close()
  }
}

export async function addStampToBank(
  bankId: string,
  stamp: SignatureStamp,
): Promise<BankEntryView> {
  return (await addStampsToBank(bankId, [stamp]))[0]!
}

/** Entire append is atomic and reads the fresh count inside the transaction. */
export async function addStampsToBank(
  bankId: string,
  stamps: SignatureStamp[],
  onProgress?: (ratio: number) => void,
): Promise<BankEntryView[]> {
  if (!stamps.length) return []
  const result = await writeStamps({ kind: 'append', bankId }, stamps, { onProgress })
  onProgress?.(1)
  return result.entries
}

/** Replace only the requested name, with optimistic concurrency and no destructive migration. */
export async function replaceBankStamps(
  label: string,
  stamps: SignatureStamp[],
  options: WriteOptions & { expected: NameBank | null; goal?: number },
) {
  const name = label.trim()
  if (!name || !stamps.length) throw new Error('名字和笔迹不能为空')
  const result = await writeStamps(
    {
      kind: 'replace',
      label: name,
      expected: options.expected,
      goal: safeGoal(options.goal ?? 100),
    },
    stamps,
    options,
  )
  options.onProgress?.(1)
  return result
}

export async function listBankEntries(bankId: string): Promise<BankEntryView[]> {
  const rows = await loadRows(bankId)
  return rows.map(({ png, ...view }) => ({ ...view, previewUrl: URL.createObjectURL(png) }))
}

export async function deleteBankEntry(entryId: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction([STORE_BANKS, STORE_ENTRIES], 'readwrite'),
      done = transactionDone(tx)
    const store = tx.objectStore(STORE_ENTRIES),
      banks = tx.objectStore(STORE_BANKS)
    const entry = await idbReq(store.get(entryId) as IDBRequest<BankEntryRecord | undefined>)
    if (entry) {
      store.delete(entryId)
      const bank = await idbReq(banks.get(entry.bankId) as IDBRequest<NameBank | undefined>)
      if (bank)
        banks.put({ ...bank, count: Math.max(0, bank.count - 1), updatedAt: nextTimestamp(bank) })
    }
    await done
  } finally {
    db.close()
  }
}

export async function deleteBank(bankId: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction([STORE_BANKS, STORE_ENTRIES], 'readwrite'),
      done = transactionDone(tx)
    const store = tx.objectStore(STORE_ENTRIES)
    const keys = await idbReq(store.index('byBank').getAllKeys(bankId))
    for (const key of keys) store.delete(key)
    tx.objectStore(STORE_BANKS).delete(bankId)
    await done
  } finally {
    db.close()
  }
}

async function loadRows(bankId: string): Promise<BankEntryRecord[]> {
  const db = await openDb()
  try {
    const rows = await idbReq(
      db
        .transaction(STORE_ENTRIES, 'readonly')
        .objectStore(STORE_ENTRIES)
        .index('byBank')
        .getAll(bankId) as IDBRequest<BankEntryRecord[]>,
    )
    return rows.sort((a, b) => a.index - b.index)
  } finally {
    db.close()
  }
}

async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function loadBankAsStamps(bankId: string): Promise<SignatureStamp[]> {
  const rows = await loadRows(bankId),
    stamps: SignatureStamp[] = []
  try {
    for (const row of rows) {
      const img = await blobToImage(row.png)
      const canvas = document.createElement('canvas')
      canvas.width = row.width
      canvas.height = row.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('无法创建签名画布')
      ctx.drawImage(img, 0, 0)
      stamps.push({
        id: row.id,
        label: row.source ? `字体写法 #${row.index}` : `#${row.index}`,
        canvas,
        width: row.width,
        height: row.height,
        previewUrl: URL.createObjectURL(row.png),
        ...(row.source ? { source: { ...row.source } } : {}),
      })
    }
    return stamps
  } catch (error) {
    for (const stamp of stamps) URL.revokeObjectURL(stamp.previewUrl)
    throw error
  }
}

export function revokeEntryUrls(entries: BankEntryView[]) {
  for (const e of entries) if (e.previewUrl.startsWith('blob:')) URL.revokeObjectURL(e.previewUrl)
}
