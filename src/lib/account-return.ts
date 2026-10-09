export function isCommerceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[1-9]\d{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  )
}

/** Only implemented account and product routes; no query, fragment, encoding or external return URLs. */
export function accountReturnPath(value: unknown): string {
  if (typeof value === 'string') {
    const match = /^\/admin\/(?:orders|refunds)\/([1-9]\d{0,18})\/verification$/.exec(value)
    if (match && isCommerceId(match[1])) return value
  }
  if (typeof value === 'string' && value.startsWith('/collections/')) {
    const slug = value.slice('/collections/'.length)
    if (slug.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return value
  }
  if (value === '/account/orders' || value === '/account/library' || value === '/admin/refunds' || value === '/admin/reconciliations') return value
  if (typeof value === 'string' && value.startsWith('/account/orders/')) {
    const id = value.slice('/account/orders/'.length)
    if (isCommerceId(id)) return value
  }
  return '/'
}
