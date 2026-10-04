export const SIGNATURE_OVERVIEW_LONG = 1280
export const SIGNATURE_VIEWPORT_LONG = 2400

/** Bound pixel allocation independently of the logical size of a zoomed artwork. */
export function fitSignatureRaster(width: number, height: number, maxLong: number) {
  if (
    ![width, height, maxLong].every((value) => Number.isFinite(value) && value > 0) ||
    !Number.isSafeInteger(maxLong)
  ) {
    throw new Error('名字画预览尺寸无效')
  }
  const scale = Math.min(1, maxLong / Math.max(width, height))
  return {
    width: Math.max(1, Math.min(maxLong, Math.round(width * scale))),
    height: Math.max(1, Math.min(maxLong, Math.round(height * scale))),
  }
}

/** Client box excludes borders and scrollbars; CSS offsets stay in artwork coordinates. */
export function measureSignatureViewport(
  host: HTMLElement,
  root: HTMLElement,
  layoutW: number,
  layoutH: number,
) {
  const hostRect = host.getBoundingClientRect(),
    rootRect = root.getBoundingClientRect()
  if (
    ![layoutW, layoutH, rootRect.width, rootRect.height].every(
      (value) => Number.isFinite(value) && value > 0,
    )
  )
    return null
  const left = Math.max(rootRect.left, hostRect.left + host.clientLeft)
  const top = Math.max(rootRect.top, hostRect.top + host.clientTop)
  const right = Math.min(rootRect.right, hostRect.left + host.clientLeft + host.clientWidth)
  const bottom = Math.min(rootRect.bottom, hostRect.top + host.clientTop + host.clientHeight)
  if (right <= left || bottom <= top) return null
  const display = {
    x: left - rootRect.left,
    y: top - rootRect.top,
    width: right - left,
    height: bottom - top,
  }
  return {
    display,
    region: {
      x: (display.x / rootRect.width) * layoutW,
      y: (display.y / rootRect.height) * layoutH,
      w: (display.width / rootRect.width) * layoutW,
      h: (display.height / rootRect.height) * layoutH,
    },
  }
}
