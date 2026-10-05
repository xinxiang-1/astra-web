/** One ink palette for Canvas, WebGL and path SVG. Explicit ink stays exact. */
export function signatureTint(
  colorize: boolean,
  r: number,
  g: number,
  b: number,
  depth: number,
  literal = false,
): [number, number, number] {
  const byte = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
  if (literal) return [byte(r), byte(g), byte(b)]
  const d = Math.max(0, Math.min(1, depth))
  if (colorize) {
    const k = 0.22 + (1 - d) * 0.28,
      mix = 0.55 + d * 0.35
    return [
      byte(r * k * mix + 18 * (1 - mix)),
      byte(g * k * mix + 16 * (1 - mix)),
      byte(b * k * mix + 22 * (1 - mix)),
    ]
  }
  const value = byte(18 + (1 - d) * 55)
  return [value, value, value + 2]
}

export function tintCacheKey(
  index: number,
  colorize: boolean,
  r: number,
  g: number,
  b: number,
  depth: number,
  literal: boolean,
) {
  return `${index}:${signatureTint(colorize, r, g, b, depth, literal).join(',')}`
}

/** Raise ink opacity smoothly without clipping midtones; gain 1 preserves old works exactly. */
export function signatureInkStrength(strength: number, gain = 1): number {
  const alpha = Math.max(0, Math.min(1, strength))
  const amount = Number.isFinite(gain) ? Math.max(1, Math.min(3, gain)) : 1
  return amount === 1 ? alpha : 1 - Math.pow(1 - alpha, amount)
}
