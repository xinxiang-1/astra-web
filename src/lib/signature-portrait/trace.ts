/**
 * 第三档：章模板位图 → SVG path（Imagetracer）。
 * 只对名字库/印章模板做，不对整幅十二万笔成图 trace。
 */

import ImageTracer from 'imagetracerjs'

import type { SignatureStamp } from './extract'
import type { Placement } from './layout'

export type StampVector = {
  width: number
  height: number
  /** 印章像素坐标系（左上原点）下的 path d */
  paths: string[]
}

export type TracedStamp = SignatureStamp & { vector: StampVector }

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

/** 与 layout/gl 一致的染色，输出 #rrggbb */
function tintHex(
  colorize: boolean,
  r: number,
  g: number,
  b: number,
  depth: number,
  literal = false,
): string {
  let nr: number
  let ng: number
  let nb: number
  if (literal) {
    nr = r | 0
    ng = g | 0
    nb = b | 0
  } else {
    const d = clamp01(depth)
    if (colorize) {
      const k = 0.22 + (1 - d) * 0.28
      const mix = 0.55 + d * 0.35
      nr = Math.round(r * k * mix + 18 * (1 - mix))
      ng = Math.round(g * k * mix + 16 * (1 - mix))
      nb = Math.round(b * k * mix + 22 * (1 - mix))
    } else {
      const v = Math.round(18 + (1 - d) * 55)
      nr = v
      ng = v
      nb = v + 2
    }
  }
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0')
  return `#${h(nr)}${h(ng)}${h(nb)}`
}

function escAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/**
 * 把透明底印章 canvas 描成 path。
 * 使用少色量化，适合墨迹剪影。
 */
export function traceStampCanvas(canvas: HTMLCanvasElement): StampVector {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法读取印章像素')
  const imgd = ctx.getImageData(0, 0, canvas.width, canvas.height)
  // 透明像素当白底，便于二值描边
  const data = imgd.data
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3]!
    if (a < 24) {
      data[i] = 255
      data[i + 1] = 255
      data[i + 2] = 255
      data[i + 3] = 255
    } else {
      // 墨迹压成近黑，减少杂色层
      const lum = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!
      const v = lum > 200 ? 255 : 20
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }

  const svg = ImageTracer.imagedataToSVG(imgd, {
    ltres: 0.8,
    qtres: 0.8,
    pathomit: 6,
    numberofcolors: 2,
    colorquantcycles: 2,
    blurradius: 0,
    blurdelta: 20,
    scale: 1,
    strokewidth: 0,
    linefilter: true,
    rightangleenhance: true,
    viewbox: true,
  })

  const paths = extractPathDs(svg).filter((d) => d.length > 8)
  if (paths.length === 0) {
    // 退化：用矩形占位避免导出空章
    paths.push(`M0 0h${canvas.width}v${canvas.height}h-${canvas.width}z`)
  }

  return {
    width: canvas.width,
    height: canvas.height,
    paths,
  }
}

function extractPathDs(svg: string): string[] {
  const out: string[] = []
  // <path ... fill="rgb(r,g,b)" ... d="..." /> 顺序不固定
  const re = /<path\b[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(svg))) {
    const tag = m[0]!
    const dMatch = /\bd\s*=\s*"([^"]+)"/i.exec(tag)
    if (!dMatch?.[1]) continue
    const d = dMatch[1].trim()
    if (d.length < 8) continue
    const fillMatch = /\bfill\s*=\s*"([^"]+)"/i.exec(tag)
    const fill = (fillMatch?.[1] || '').toLowerCase()
    // 丢掉近白底
    if (fill.includes('rgb(')) {
      const nums = fill.match(/\d+/g)?.map(Number) ?? []
      if (nums.length >= 3) {
        const lum = 0.299 * nums[0]! + 0.587 * nums[1]! + 0.114 * nums[2]!
        if (lum > 210) continue
      }
    } else if (fill === '#fff' || fill === '#ffffff' || fill === 'white') {
      continue
    }
    out.push(d)
  }
  return out
}

export async function traceStamp(
  stamp: SignatureStamp,
): Promise<TracedStamp> {
  const vector = traceStampCanvas(stamp.canvas)
  return { ...stamp, vector }
}

export async function traceStamps(
  stamps: SignatureStamp[],
  options: {
    onProgress?: (done: number, total: number) => void
    signal?: { cancelled?: boolean }
  } = {},
): Promise<TracedStamp[]> {
  const total = stamps.length
  const out: TracedStamp[] = []
  options.onProgress?.(0, total)
  for (let i = 0; i < total; i++) {
    if (options.signal?.cancelled) throw new Error('已取消')
    out.push(await traceStamp(stamps[i]!))
    options.onProgress?.(i + 1, total)
    if (i % 2 === 1) await yieldFrame()
  }
  return out
}

export function stampHasVector(
  stamp: SignatureStamp,
): stamp is TracedStamp {
  return Boolean(
    stamp &&
      'vector' in stamp &&
      stamp.vector &&
      Array.isArray((stamp as TracedStamp).vector.paths) &&
      (stamp as TracedStamp).vector.paths.length > 0,
  )
}

/**
 * 用模板 path + placements 拼真正的矢量 SVG（非嵌入位图）。
 */
export function buildPathSvgDocument(
  placements: Placement[],
  stamps: SignatureStamp[],
  layoutW: number,
  layoutH: number,
  options: {
    background?: string
    colorize?: boolean
    portraitHref?: string | null
    underlay?: number
  } = {},
): string {
  const background = options.background ?? '#f5f0e8'
  const colorize = options.colorize ?? true
  const underlay = options.underlay ?? 0
  const traced = stamps.map((s, i) => {
    if (stampHasVector(s)) return s
    // 未 trace 的现场补一刀（同步，可能稍卡）
    return { ...s, vector: traceStampCanvas(s.canvas) }
  })

  const parts: string[] = []
  parts.push(`<?xml version="1.0" encoding="UTF-8"?>`)
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${layoutW} ${layoutH}" width="${layoutW}" height="${layoutH}">`,
  )
  parts.push(`<rect width="100%" height="100%" fill="${escAttr(background)}"/>`)

  if (options.portraitHref && underlay > 0) {
    parts.push(
      `<image href="${escAttr(options.portraitHref)}" x="0" y="0" width="${layoutW}" height="${layoutH}" preserveAspectRatio="none" opacity="${underlay}"/>`,
    )
  }

  parts.push(`<defs>`)
  for (let i = 0; i < traced.length; i++) {
    const v = traced[i]!.vector
    parts.push(`<g id="stamp-${i}">`)
    for (const d of v.paths) {
      parts.push(`<path d="${escAttr(d)}" fill="currentColor"/>`)
    }
    parts.push(`</g>`)
  }
  parts.push(`</defs>`)

  const order = [...placements].sort(
    (a, b) => b.targetSize - a.targetSize || a.depth - b.depth,
  )

  for (const p of order) {
    const stamp = traced[p.stampIndex] ?? traced[0]
    if (!stamp) continue
    const v = stamp.vector
    const stampLong = Math.max(v.width, v.height)
    const scale = p.targetSize / Math.max(1, stampLong)
    const deg = (p.angle * 180) / Math.PI
    const fill = tintHex(
      colorize,
      p.tint.r,
      p.tint.g,
      p.tint.b,
      p.depth,
      Boolean(p.tintLiteral),
    )
    const opacity = clamp01(p.strength)
    // 印章 path 原点在左上；摆放中心对齐
    const tx = p.x
    const ty = p.y
    parts.push(
      `<g transform="translate(${tx.toFixed(2)} ${ty.toFixed(2)}) rotate(${deg.toFixed(3)}) scale(${scale.toFixed(5)}) translate(${(-v.width / 2).toFixed(2)} ${(-v.height / 2).toFixed(2)})" fill="${fill}" opacity="${opacity.toFixed(3)}"${p.blend === 'ink' ? ' style="mix-blend-mode:multiply"' : ''}>`,
    )
    parts.push(`<use href="#stamp-${p.stampIndex}" xlink:href="#stamp-${p.stampIndex}"/>`)
    parts.push(`</g>`)
  }

  parts.push(`</svg>`)
  return parts.join('')
}

export function pathSvgToBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
}
