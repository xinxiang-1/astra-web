export interface ApiResult<T> {
  code: number
  msg: string
  data: T
}

export const ACCESS_TOKEN_KEY = 'astra_access_token'

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function setAccessToken(token: string | null) {
  if (token) localStorage.setItem(ACCESS_TOKEN_KEY, token)
  else localStorage.removeItem(ACCESS_TOKEN_KEY)
}

export class ApiError extends Error {
  code: number
  status?: number
  requestId?: string
  constructor(code: number, message: string, status?: number, requestId?: string) {
    super(message)
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

export async function http<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers = new Headers(options.headers)
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getAccessToken()
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000),
  })
  const requestId = res.headers.get('X-Request-Id') || undefined

  const json = (await res.json().catch(() => null)) as ApiResult<T> | null
  if (!json) {
    throw new ApiError(res.status || 500, res.status === 0 ? '网络异常' : `请求失败(${res.status})`, res.status, requestId)
  }
  if (json.code !== 0) {
    throw new ApiError(json.code, json.msg || '请求失败', res.status, requestId)
  }
  // 网关可能用 HTTP 401 且 body 无标准 code
  if (!res.ok && (json as { msg?: string }).msg) {
    throw new ApiError(res.status, (json as { msg: string }).msg, res.status, requestId)
  }
  if (!res.ok) {
    throw new ApiError(res.status, '请求失败', res.status, requestId)
  }
  return json.data
}
