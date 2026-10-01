/** One ink palette for Canvas, WebGL and path SVG. Explicit ink stays exact. */
export function signatureTint(colorize: boolean, r: number, g: number, b: number, depth: number, literal = false): [number, number, number] {
  const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
  if (literal) return [byte(r), byte(g), byte(b)]
  const d = Math.max(0, Math.min(1, depth))
  if (colorize) {
    const k = .22 + (1 - d) * .28, mix = .55 + d * .35
    return [byte(r * k * mix + 18 * (1 - mix)), byte(g * k * mix + 16 * (1 - mix)), byte(b * k * mix + 22 * (1 - mix))]
  }
  const value = byte(18 + (1 - d) * 55)
  return [value, value, value + 2]
}

export function tintCacheKey(index: number, colorize: boolean, r: number, g: number, b: number, depth: number, literal: boolean) {
  return `${index}:${signatureTint(colorize, r, g, b, depth, literal).join(',')}`
}
