import type { SignatureStamp } from './extract'
import type { Placement } from './layout'

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  return canvas
}

function downscaleStamp(src: HTMLCanvasElement, maxLong: number): HTMLCanvasElement {
  const long = Math.max(src.width, src.height)
  if (long <= maxLong) return src
  const s = maxLong / long
  const out = makeCanvas(src.width * s, src.height * s)
  const ctx = out.getContext('2d')
  if (!ctx) return src
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, out.width, out.height)
  return out
}

function tintStampCanvas(
  source: HTMLCanvasElement,
  colorize: boolean,
  r: number,
  g: number,
  b: number,
  depth: number,
): HTMLCanvasElement {
  const out = makeCanvas(source.width, source.height)
  const ctx = out.getContext('2d')
  if (!ctx) return source
  ctx.drawImage(source, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  const d = clamp01(depth)
  if (colorize) {
    const k = 0.22 + (1 - d) * 0.28
    const mix = 0.55 + d * 0.35
    const nr = Math.round(r * k * mix + 18 * (1 - mix))
    const ng = Math.round(g * k * mix + 16 * (1 - mix))
    const nb = Math.round(b * k * mix + 22 * (1 - mix))
    ctx.fillStyle = `rgb(${nr},${ng},${nb})`
  } else {
    const v = Math.round(18 + (1 - d) * 55)
    ctx.fillStyle = `rgb(${v},${v},${v + 2})`
  }
  ctx.fillRect(0, 0, out.width, out.height)
  ctx.globalCompositeOperation = 'source-over'
  return out
}

function escAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

export type SvgBuildOptions = {
  background?: string
  colorize?: boolean
  portraitHref?: string | null
  underlay?: number
  /** 印章栅格嵌入长边上限（仍是位图字，但布局坐标是矢量） */
  stampMaxLong?: number
  chunkSize?: number
  /** SVG 壳建好立刻回调（可先挂到页面再继续填章） */
  onShell?: (svg: SVGSVGElement) => void
  onProgress?: (done: number, total: number) => void
  signal?: { cancelled?: boolean }
}

/**
 * 用已有 placements 直接拼 SVG，不重算排版。
 * 分块往 DOM 追加，完成一部分就能看见一部分。
 */
export async function buildPlacementsSvg(
  placements: Placement[],
  stamps: SignatureStamp[],
  layoutW: number,
  layoutH: number,
  options: SvgBuildOptions = {},
): Promise<SVGSVGElement> {
  const background = options.background ?? '#f5f0e8'
  const colorize = options.colorize ?? true
  const underlay = options.underlay ?? 0
  const stampMaxLong = options.stampMaxLong ?? 480
  const chunkSize = Math.max(20, options.chunkSize ?? 80)
  const NS = 'http://www.w3.org/2000/svg'
  const XLINK = 'http://www.w3.org/1999/xlink'

  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('xmlns', NS)
  svg.setAttribute('xmlns:xlink', XLINK)
  svg.setAttribute('viewBox', `0 0 ${layoutW} ${layoutH}`)
  svg.setAttribute('width', String(layoutW))
  svg.setAttribute('height', String(layoutH))
  svg.setAttribute('role', 'img')

  const defs = document.createElementNS(NS, 'defs')
  svg.appendChild(defs)

  const bg = document.createElementNS(NS, 'rect')
  bg.setAttribute('width', '100%')
  bg.setAttribute('height', '100%')
  bg.setAttribute('fill', background)
  svg.appendChild(bg)

  if (options.portraitHref && underlay > 0) {
    const under = document.createElementNS(NS, 'image')
    under.setAttribute('href', options.portraitHref)
    under.setAttributeNS(XLINK, 'href', options.portraitHref)
    under.setAttribute('x', '0')
    under.setAttribute('y', '0')
    under.setAttribute('width', String(layoutW))
    under.setAttribute('height', String(layoutH))
    under.setAttribute('preserveAspectRatio', 'none')
    under.setAttribute('opacity', String(underlay))
    svg.appendChild(under)
  }

  const layer = document.createElementNS(NS, 'g')
  layer.setAttribute('class', 'stamps')
  svg.appendChild(layer)

  options.onShell?.(svg)
  await yieldFrame()

  const bases = stamps.map((s) => downscaleStamp(s.canvas, stampMaxLong))
  const tintCache = new Map<string, { id: string; w: number; h: number }>()
  let tintSeq = 0

  const getTinted = (
    index: number,
    r: number,
    g: number,
    b: number,
    depth: number,
  ) => {
    const key = `${index}:${(r / 16) | 0}:${(g / 16) | 0}:${(b / 16) | 0}:${(depth * 6) | 0}:${colorize ? 1 : 0}`
    let cached = tintCache.get(key)
    if (!cached) {
      const base = bases[index] ?? bases[0]!
      const tinted = tintStampCanvas(base, colorize, r, g, b, depth)
      tintSeq++
      const id = `s${tintSeq}`
      const href = tinted.toDataURL('image/png')
      const img = document.createElementNS(NS, 'image')
      img.setAttribute('id', id)
      img.setAttribute('href', href)
      img.setAttributeNS(XLINK, 'href', href)
      img.setAttribute('width', String(tinted.width))
      img.setAttribute('height', String(tinted.height))
      img.setAttribute('preserveAspectRatio', 'none')
      defs.appendChild(img)
      cached = { id, w: tinted.width, h: tinted.height }
      tintCache.set(key, cached)
    }
    return cached
  }

  const total = placements.length
  options.onProgress?.(0, total)

  for (let i = 0; i < total; i++) {
    if (options.signal?.cancelled) throw new Error('已取消')
    const p = placements[i]!
    const glyph = getTinted(p.stampIndex, p.tint.r, p.tint.g, p.tint.b, p.depth)
    const stampLong = Math.max(glyph.w, glyph.h)
    const scale = p.targetSize / Math.max(1, stampLong)
    const opacity = clamp01(p.strength)
    const blend = p.blend === 'soft' ? 'normal' : 'multiply'

    const g = document.createElementNS(NS, 'g')
    g.setAttribute(
      'transform',
      `translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${((p.angle * 180) / Math.PI).toFixed(3)}) scale(${scale.toFixed(5)})`,
    )
    g.setAttribute('opacity', opacity.toFixed(3))
    if (blend !== 'normal') g.setAttribute('style', `mix-blend-mode:${blend}`)

    const use = document.createElementNS(NS, 'use')
    use.setAttribute('href', `#${glyph.id}`)
    use.setAttributeNS(XLINK, 'href', `#${glyph.id}`)
    use.setAttribute('x', String(-glyph.w / 2))
    use.setAttribute('y', String(-glyph.h / 2))
    g.appendChild(use)

    layer.appendChild(g)

    if ((i + 1) % chunkSize === 0 || i + 1 === total) {
      options.onProgress?.(i + 1, total)
      await yieldFrame()
    }
  }

  return svg
}

/** 序列化为可下载的 SVG Blob（内嵌 data URL 印章） */
export function svgElementToBlob(svg: SVGSVGElement): Blob {
  const clone = svg.cloneNode(true) as SVGSVGElement
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  }
  const xml = new XMLSerializer().serializeToString(clone)
  return new Blob([xml], { type: 'image/svg+xml;charset=utf-8' })
}

export function triggerDownloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 调试 / 文本导出用 */
export function placementsToSvgString(
  placements: Placement[],
  layoutW: number,
  layoutH: number,
  background = '#f5f0e8',
): string {
  // 仅坐标骨架（不含印章图），体积极小
  const parts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layoutW} ${layoutH}" width="${layoutW}" height="${layoutH}">`,
    `<rect width="100%" height="100%" fill="${escAttr(background)}"/>`,
  ]
  for (const p of placements) {
    parts.push(
      `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(p.targetSize * 0.2).toFixed(1)}" fill="rgba(0,0,0,${clamp01(p.strength).toFixed(2)})"/>`,
    )
  }
  parts.push(`</svg>`)
  return parts.join('')
}
