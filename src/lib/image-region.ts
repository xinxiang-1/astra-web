/** A source-image region in normalized coordinates; independent of preview CSS size. */
export type ImageRegion = { x: number; y: number; width: number; height: number }
export const FULL_IMAGE_REGION: ImageRegion = { x: 0, y: 0, width: 1, height: 1 }

export function imageRegionBounds(width: number, height: number, region: ImageRegion) {
  if (
    ![width, height].every((n) => Number.isSafeInteger(n) && n > 0) ||
    ![region.x, region.y, region.width, region.height].every(Number.isFinite) ||
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > 1.000000001 ||
    region.y + region.height > 1.000000001
  )
    throw new Error('请选择图片内完整的签名区域')
  // Percentages such as .4 + .2 can land just past an exact integer pixel in
  // binary floating point. Snap only that numerical noise before outward rounding.
  const snap = (value: number) =>
    Math.abs(value - Math.round(value)) < 1e-7 ? Math.round(value) : value
  const x = Math.floor(snap(region.x * width)),
    y = Math.floor(snap(region.y * height))
  const right = Math.min(width, Math.ceil(snap((region.x + region.width) * width)))
  const bottom = Math.min(height, Math.ceil(snap((region.y + region.height) * height)))
  if (right <= x || bottom <= y) throw new Error('签名区域太小，请重新框选')
  return { x, y, width: right - x, height: bottom - y }
}
