import { issuePurchasedDownloadTicket, type CommerceAsset } from '../api/commerce'
import { ApiError } from '../api/http'

const MAX_BYTES = 256 * 1024 * 1024
const fail = () => new Error('文件信息或内容校验失败，请刷新购买记录后重新领取。')

export function formatPurchasedFileSize(bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes < 1) return '大小待确认'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

/** Tokens stay in this operation; no redirect, credentials, storage or automatic retries. */
export async function fetchPurchasedAsset(
  asset: CommerceAsset,
  signal: AbortSignal,
  onProgress: (received: number, total: number) => void = () => {},
): Promise<File> {
  if (
    !asset ||
    typeof asset.id !== 'string' ||
    typeof asset.fileName !== 'string' ||
    typeof asset.mimeType !== 'string' ||
    typeof asset.sha256 !== 'string' ||
    !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(asset.mimeType) ||
    !/^[1-9]\d{0,18}$/.test(asset.id) ||
    BigInt(asset.id) > 9223372036854775807n ||
    !Number.isSafeInteger(asset.sizeBytes) ||
    asset.sizeBytes < 1 ||
    asset.sizeBytes > MAX_BYTES ||
    !/^[a-f0-9]{64}$/.test(asset.sha256) ||
    !asset.fileName ||
    /[\\/\x00-\x1f]/.test(asset.fileName)
  )
    throw fail()
  signal.throwIfAborted()
  const issued = await issuePurchasedDownloadTicket(asset.id, signal)
  signal.throwIfAborted()
  if (
    !issued ||
    typeof issued.ticket !== 'string' ||
    typeof issued.expiresAt !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(issued.ticket) ||
    issued.downloadPath !== `/api/system/assets/${asset.id}/download` ||
    !Number.isFinite(Date.parse(issued.expiresAt)) ||
    !issued.file ||
    ['id', 'fileName', 'mimeType', 'sizeBytes', 'sha256'].some(
      (key) => issued.file[key as keyof CommerceAsset] !== asset[key as keyof CommerceAsset],
    )
  )
    throw fail()
  const transportSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
  try {
    const response = await fetch(
      `${issued.downloadPath}?ticket=${encodeURIComponent(issued.ticket)}`,
      {
        signal: transportSignal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
      },
    )
    if (!response.ok) {
      await response.body?.cancel()
      throw new ApiError(
        response.status === 410 ? 44001 : response.status,
        response.status === 410
          ? '领取凭证已失效，请重新领取。'
          : response.status === 422
            ? '该内容暂时无法领取，请刷新记录或联系支持。'
            : '领取暂时未完成，请稍后重新领取。',
        response.status,
        response.headers.get('X-Request-Id') || undefined,
      )
    }
    const length = response.headers.get('Content-Length')
    if (
      !response.body ||
      response.headers.get('Content-Type')?.split(';')[0]?.trim() !== asset.mimeType ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) !== asset.sizeBytes))
    ) {
      await response.body?.cancel()
      throw fail()
    }
    const reader = response.body.getReader()
    const bytes = new Uint8Array(asset.sizeBytes)
    let received = 0
    try {
      while (true) {
        transportSignal.throwIfAborted()
        const chunk = await reader.read()
        if (chunk.done) break
        if (received + chunk.value.byteLength > bytes.byteLength) throw fail()
        bytes.set(chunk.value, received)
        received += chunk.value.byteLength
        onProgress(received, bytes.byteLength)
      }
      if (received !== asset.sizeBytes) throw fail()
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    signal.throwIfAborted()
    const actual = Array.from(new Uint8Array(digest), (n) => n.toString(16).padStart(2, '0')).join(
      '',
    )
    if (actual !== asset.sha256) throw fail()
    return new File([bytes], asset.fileName, { type: asset.mimeType })
  } catch (cause) {
    if (signal.aborted) throw new DOMException('领取已取消', 'AbortError')
    if (cause instanceof ApiError) throw cause
    if (transportSignal.aborted) throw new Error('文件领取超时，请重新领取。')
    if (cause instanceof TypeError) throw new Error('网络暂时不可用，请重新领取。')
    // Browser network exceptions can contain the credential URL; never surface them.
    throw fail()
  }
}
