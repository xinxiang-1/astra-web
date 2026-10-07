import type { Placement } from './layout'

export const RASTER_PLACEMENT_STRIDE = 13
/** Float64 preserves project coordinates, strength and RGB; explicit -1 preserves optional booleans. */
export async function packRasterPlacements(
  placements: readonly Placement[],
  signal?: { cancelled?: boolean },
) {
  const data = new Float64Array(placements.length * RASTER_PLACEMENT_STRIDE)
  const channel = new MessageChannel()
  let resume: (() => void) | null = null
  channel.port1.onmessage = () => {
    const next = resume
    resume = null
    next?.()
  }
  let start = performance.now()
  try {
    for (let row = 0; row < placements.length; row++) {
      if (signal?.cancelled) throw new Error('已取消')
      const p = placements[row]!,
        at = row * RASTER_PLACEMENT_STRIDE
      data.set(
        [
          p.x,
          p.y,
          p.angle,
          p.targetSize,
          p.stampIndex,
          p.strength,
          p.tint.r,
          p.tint.g,
          p.tint.b,
          p.blend === 'soft' ? 0 : 1,
          p.depth,
          p.onEdge === undefined ? -1 : p.onEdge ? 1 : 0,
          p.tintLiteral === undefined ? -1 : p.tintLiteral ? 1 : 0,
        ],
        at,
      )
      if (row % 128 === 0 && performance.now() - start >= 6) {
        await new Promise<void>((resolve) => {
          resume = resolve
          channel.port2.postMessage(0)
        })
        start = performance.now()
      }
    }
    if (signal?.cancelled) throw new Error('已取消')
    return data
  } finally {
    channel.port1.close()
    channel.port2.close()
  }
}
export function readRasterPlacement(data: Float64Array, at: number): Placement {
  return {
    x: data[at]!,
    y: data[at + 1]!,
    angle: data[at + 2]!,
    targetSize: data[at + 3]!,
    stampIndex: data[at + 4]!,
    strength: data[at + 5]!,
    tint: { r: data[at + 6]!, g: data[at + 7]!, b: data[at + 8]! },
    blend: data[at + 9] === 0 ? 'soft' : 'ink',
    depth: data[at + 10]!,
    ...(data[at + 11] === -1 ? {} : { onEdge: data[at + 11] === 1 }),
    ...(data[at + 12] === -1 ? {} : { tintLiteral: data[at + 12] === 1 }),
  }
}
