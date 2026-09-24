export interface ApiResult<T> {
  code: number
  msg: string
  data: T
}

const TOKEN_KEY = 'astra_access_token'

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAccessToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
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
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
  })

  const json = (await res.json().catch(() => null)) as ApiResult<T> | null
  if (!json) {
    throw new ApiError(res.status || 500, res.status === 0 ? '网络异常' : `请求失败(${res.status})`)
  }
  if (json.code !== 0) {
    throw new ApiError(json.code, json.msg || '请求失败')
  }
  // 网关可能用 HTTP 401 且 body 无标准 code
  if (!res.ok && (json as { msg?: string }).msg) {
    throw new ApiError(res.status, (json as { msg: string }).msg)
  }
  if (!res.ok) {
    throw new ApiError(res.status, '请求失败')
  }
  return json.data
}
