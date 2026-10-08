export function isCommerceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9]\d{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  )
}

/** Only implemented account routes; no query, fragment, encoding or external return URLs. */
export function accountReturnPath(value: unknown): string {
  if (value === '/account/orders' || value === '/account/library') return value
  if (typeof value === 'string' && value.startsWith('/account/orders/')) {
    const id = value.slice('/account/orders/'.length)
    if (isCommerceId(id)) return value
  }
  return '/'
}
