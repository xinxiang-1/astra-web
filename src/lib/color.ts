/** Parse `#rgb` / `#rrggbb` into 0–1 RGB channels for GPU options. */
export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const raw = hex.trim().replace(/^#/, '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    return { r: 0, g: 0, b: 0 }
  }
  return {
    r: Number.parseInt(full.slice(0, 2), 16) / 255,
    g: Number.parseInt(full.slice(2, 4), 16) / 255,
    b: Number.parseInt(full.slice(4, 6), 16) / 255,
  }
}

export function normalizeHex(hex: string, fallback = '#000000'): string {
  const raw = hex.trim().replace(/^#/, '')
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw
  return /^[0-9a-fA-F]{6}$/.test(full) ? `#${full.toLowerCase()}` : fallback
}
