import { loadImageElement, type SignatureStamp } from './extract'
import type { Placement, SignatureLayoutOptions } from './layout'
import { SIGNATURE_FONT_LICENSES } from './font-licenses'
import type { SignatureFontId } from './fonts'

export const SIGNATURE_PROJECT_ACCEPT = '.astra-signature'
export const SIGNATURE_PROJECT_ENGINE = 'signature-1'
const MAGIC = new TextEncoder().encode('ASIG01\n')
const HEADER = MAGIC.length + 4 + 32
const MB = 1024 * 1024
const SOURCE_LIMIT = 64 * MB
const MANIFEST_LIMIT = 64 * MB
const STAMP_PIXEL_LIMIT = 16 * MB
const FILE_LIMIT = HEADER + MANIFEST_LIMIT + SOURCE_LIMIT + STAMP_PIXEL_LIMIT * 4

export type SignatureProject = {
  portrait: HTMLImageElement
  portraitFile: File
  portraitName: string
  options: SignatureLayoutOptions
  stamps: SignatureStamp[]
  placements: Placement[]
  width: number
  height: number
}
type Progress = { signal?: AbortSignal; onProgress?: (value: number) => void }
type Raster = { width: number; height: number; size: number; sha256: string }
type PackedStamp = Raster & Pick<SignatureStamp, 'id' | 'label' | 'source' | 'vector'>
type FontLicense = { fontSha256: string; sourceUrl: string; licenseText: string }
type Manifest = {
  format: 'astra-signature-project'
  version: 1
  engine: typeof SIGNATURE_PROJECT_ENGINE
  portrait: Raster & { name: string; displayName: string; type: string; lastModified: number }
  width: number
  height: number
  options: SignatureLayoutOptions
  placements: Placement[]
  stamps: PackedStamp[]
  fontLicenses: Partial<Record<SignatureFontId, FontLicense>>
}
function fail(label: string): never {
  throw new Error(`名字画作品文件${label}`)
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label}无效`)
  return value as Record<string, unknown>
}
function num(value: unknown, min: number, max: number, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    fail('数值超出支持范围')
  return value
}
function str(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f]/.test(value))
    fail('文字信息无效')
  return value
}
function check(signal?: AbortSignal) {
  signal?.throwIfAborted()
}
async function pause(signal?: AbortSignal) {
  await new Promise((resolve) => setTimeout(resolve, 0))
  check(signal)
}
async function hash(blob: Blob) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('')
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail('校验信息无效')
  return value
}
function rgb(value: unknown) {
  const v = record(value, '颜色')
  return { r: num(v.r, 0, 255), g: num(v.g, 0, 255), b: num(v.b, 0, 255) }
}
function optionsOf(value: unknown): SignatureLayoutOptions {
  const raw = record(value, '参数'),
    result: Record<string, unknown> = {}
  const ranges: Record<string, [number, number]> = {
    maxSide: [128, 8192],
    density: [0.7, 50],
    angleRange: [0, 90],
    minSizeRatio: [0.001, 0.2],
    maxSizeRatio: [0.001, 0.3],
    underlay: [0, 0],
    seed: [0, Number.MAX_SAFE_INTEGER],
    overlap: [0, 0.9],
    gamma: [0.1, 5],
    lloydIters: [0, 30],
    edgeBoost: [0, 2.2],
    edgeThreshold: [0, 1],
  }
  const booleans = new Set([
    'allowVertical',
    'fillHighlights',
    'invertDensity',
    'colorize',
    'coverFill',
    'edgeOutline',
  ])
  const enums: Record<string, string[]> = {
    inkStyle: ['ink', 'cutout'],
    layoutMethod: ['woven', 'stipple'],
    edgeColorMode: ['auto', 'custom', 'ink'],
  }
  for (const [key, val] of Object.entries(raw)) {
    if (val === undefined) continue
    if (Object.hasOwn(ranges, key))
      result[key] = num(
        val,
        ...ranges[key]!,
        key === 'seed' || key === 'maxSide' || key === 'lloydIters',
      )
    else if (booleans.has(key)) {
      if (typeof val !== 'boolean') fail('开关参数无效')
      result[key] = val
    } else if (Object.hasOwn(enums, key)) {
      if (!enums[key]!.includes(String(val))) fail('样式参数暂不支持')
      result[key] = val
    } else if (key === 'ink' || key === 'edgeColor') result[key] = rgb(val)
    else if (key === 'background') {
      if (typeof val !== 'string' || !/^#[0-9a-f]{6}$/i.test(val)) fail('背景颜色无效')
      result[key] = val
    } else fail('包含暂不支持的参数')
  }
  if (Number(result.minSizeRatio ?? 0.022) > Number(result.maxSizeRatio ?? 0.065))
    fail('签名大小范围无效')
  return result as SignatureLayoutOptions
}
function vectorOf(value: unknown): SignatureStamp['vector'] {
  if (value === undefined || value === null) return value
  const v = record(value, '笔迹路径'),
    width = num(v.width, 1, 2048, true),
    height = num(v.height, 1, 2048, true)
  if (!Array.isArray(v.paths) || !v.paths.length || v.paths.length > 2000) fail('笔迹路径数量无效')
  let size = 0
  const paths = v.paths.map((d) => {
    if (
      typeof d !== 'string' ||
      !d.length ||
      d.length > 200000 ||
      !/^[MmLlHhVvCcSsQqTtAaZz0-9eE+.,\s-]+$/.test(d)
    )
      fail('笔迹路径无效')
    size += d.length
    if (size > 2 * MB) fail('笔迹路径过大')
    for (const token of d.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [])
      num(Number(token), -8192, 8192)
    new Path2D(d)
    return d
  })
  return { width, height, paths }
}
function recipeOf(value: unknown): SignatureStamp['source'] {
  if (value === undefined) return undefined
  const v = record(value, '字体来源')
  if (v.kind !== 'font' || v.version !== 2 || (v.font !== 'mashanzheng' && v.font !== 'longcang'))
    fail('字体来源版本暂不支持')
  return {
    kind: 'font',
    version: 2,
    font: v.font,
    text: str(v.text, 32),
    seed: num(v.seed, 0, Number.MAX_SAFE_INTEGER, true),
    variant: num(v.variant, 0, 1000, true),
  }
}
function manifestOf(value: unknown): Manifest {
  const raw = record(value, '目录')
  if (
    raw.format !== 'astra-signature-project' ||
    raw.version !== 1 ||
    raw.engine !== SIGNATURE_PROJECT_ENGINE
  )
    fail('版本暂不支持，请使用对应版本的Astra')
  const width = num(raw.width, 1, 8192, true),
    height = num(raw.height, 1, 8192, true)
  if (!Array.isArray(raw.stamps) || !raw.stamps.length || raw.stamps.length > 200)
    fail('签名数量超出范围（1–200）')
  let pixels = 0
  const stamps: PackedStamp[] = raw.stamps.map((item) => {
    const v = record(item, '签名'),
      w = num(v.width, 1, 2048, true),
      h = num(v.height, 1, 2048, true)
    pixels += w * h
    if (pixels > STAMP_PIXEL_LIMIT || v.size !== w * h * 4) fail('签名像素超出范围或长度不符')
    return {
      id: str(v.id, 512),
      label: str(v.label, 255),
      width: w,
      height: h,
      size: w * h * 4,
      sha256: digest(v.sha256),
      source: recipeOf(v.source),
      vector: vectorOf(v.vector),
    }
  })
  const usedFonts = new Set(stamps.flatMap((stamp) => (stamp.source ? [stamp.source.font] : [])))
  const rawLicenses = record(raw.fontLicenses, '字体许可')
  const fontLicenses: Partial<Record<SignatureFontId, FontLicense>> = {}
  for (const id of Object.keys(rawLicenses))
    if (!usedFonts.has(id as SignatureFontId)) fail('包含未知字体许可')
  for (const id of usedFonts) {
    const expected = SIGNATURE_FONT_LICENSES[id],
      license = record(rawLicenses[id], '字体许可')
    if (
      license.fontSha256 !== expected.fontSha256 ||
      license.sourceUrl !== expected.sourceUrl ||
      license.licenseText !== expected.licenseText
    )
      fail('字体版权或许可信息不完整')
    fontLicenses[id] = expected
  }
  if (!Array.isArray(raw.placements) || !raw.placements.length || raw.placements.length > 250000)
    fail('落点数量超出范围（最多25万）')
  const long = Math.max(width, height)
  const placements: Placement[] = raw.placements.map((item) => {
    const v = record(item, '落点')
    if (v.blend !== 'soft' && v.blend !== 'ink') fail('落点混合样式无效')
    for (const key of ['onEdge', 'tintLiteral'])
      if (v[key] !== undefined && typeof v[key] !== 'boolean') fail('落点开关无效')
    return {
      x: num(v.x, -long, width + long),
      y: num(v.y, -long, height + long),
      angle: num(v.angle, -Math.PI * 2, Math.PI * 2),
      targetSize: num(v.targetSize, 0.001, long),
      stampIndex: num(v.stampIndex, 0, stamps.length - 1, true),
      strength: num(v.strength, 0, 1),
      tint: rgb(v.tint),
      blend: v.blend,
      depth: num(v.depth, 0, 1),
      ...(v.onEdge === undefined ? {} : { onEdge: v.onEdge as boolean }),
      ...(v.tintLiteral === undefined ? {} : { tintLiteral: v.tintLiteral as boolean }),
    }
  })
  const p = record(raw.portrait, '画像'),
    pw = num(p.width, 1, 32768, true),
    ph = num(p.height, 1, 32768, true)
  if (pw * ph > 32_000_000) fail('画像最多支持3200万像素')
  const type = str(p.type, 100)
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/avif', 'image/bmp'].includes(type))
    fail('画像格式暂不支持，请使用PNG、JPEG或WebP')
  return {
    format: 'astra-signature-project',
    version: 1,
    engine: SIGNATURE_PROJECT_ENGINE,
    width,
    height,
    options: optionsOf(raw.options),
    stamps,
    placements,
    fontLicenses,
    portrait: {
      width: pw,
      height: ph,
      name: str(p.name, 255),
      displayName: str(p.displayName, 255),
      type,
      size: num(p.size, 1, SOURCE_LIMIT, true),
      lastModified: num(p.lastModified, 0, Number.MAX_SAFE_INTEGER, true),
      sha256: digest(p.sha256),
    },
  }
}

export function signatureProjectFilename(name: string) {
  return `${
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .trim()
      .slice(0, 80) || 'signature-portrait'
  }${SIGNATURE_PROJECT_ACCEPT}`
}

/** Stores the fixed result, original image bytes and actual RGBA templates; no font reload. */
export async function createSignatureProject(
  project: SignatureProject,
  progress: Progress = {},
): Promise<Blob> {
  check(progress.signal)
  if (
    !(project.portraitFile instanceof File) ||
    !project.portraitFile.size ||
    project.portraitFile.size > SOURCE_LIMIT
  )
    fail('缺少画像源文件或超过64MB')
  if (!project.stamps.length || project.stamps.length > 200) fail('签名数量超出范围（1–200）')
  const buffers: Blob[] = [],
    stamps: PackedStamp[] = []
  let pixels = 0
  for (let i = 0; i < project.stamps.length; i++) {
    const s = project.stamps[i]!,
      width = num(s.canvas.width, 1, 2048, true),
      height = num(s.canvas.height, 1, 2048, true)
    if (width !== s.width || height !== s.height) fail('签名尺寸不一致')
    pixels += width * height
    if (pixels > STAMP_PIXEL_LIMIT) fail('签名像素超出范围')
    const context = s.canvas.getContext('2d')
    if (!context) fail('无法读取签名像素')
    const bytes = context.getImageData(0, 0, width, height).data
    const blob = new Blob([bytes])
    buffers.push(blob)
    stamps.push({
      id: s.id,
      label: s.label,
      width,
      height,
      size: blob.size,
      sha256: await hash(blob),
      source: s.source,
      vector: s.vector,
    })
    progress.onProgress?.(((i + 1) / project.stamps.length) * 0.7)
    if (i % 4 === 3) await pause(progress.signal)
    check(progress.signal)
  }
  const source = project.portraitFile
  const manifest = manifestOf({
    format: 'astra-signature-project',
    version: 1,
    engine: SIGNATURE_PROJECT_ENGINE,
    width: project.width,
    height: project.height,
    options: project.options,
    placements: project.placements,
    stamps,
    fontLicenses: Object.fromEntries(
      stamps.flatMap((stamp) =>
        stamp.source ? [[stamp.source.font, SIGNATURE_FONT_LICENSES[stamp.source.font]]] : [],
      ),
    ),
    portrait: {
      width: project.portrait.naturalWidth,
      height: project.portrait.naturalHeight,
      name: source.name,
      displayName: project.portraitName,
      type: source.type,
      size: source.size,
      lastModified: source.lastModified,
      sha256: await hash(source),
    },
  })
  const json = new Blob([JSON.stringify(manifest)])
  if (json.size > MANIFEST_LIMIT) fail('目录超过64MB，请缩小落点数量')
  const header = new Uint8Array(HEADER)
  header.set(MAGIC)
  new DataView(header.buffer).setUint32(MAGIC.length, json.size, true)
  header.set(
    Uint8Array.from((await hash(json)).match(/../g)!, (value) => parseInt(value, 16)),
    MAGIC.length + 4,
  )
  check(progress.signal)
  progress.onProgress?.(1)
  return new Blob([header, json, source, ...buffers], {
    type: 'application/x-astra-signature-project',
  })
}

/** Validates all bytes/geometry first. Caller owns the returned assets until dispose(). */
export async function readSignatureProject(
  file: Blob,
  progress: Progress = {},
): Promise<{ project: SignatureProject; dispose: () => void }> {
  check(progress.signal)
  if (file.size <= HEADER || file.size > FILE_LIMIT) fail('大小超出范围或不完整')
  const header = new Uint8Array(await file.slice(0, HEADER).arrayBuffer())
  if (!MAGIC.every((value, index) => value === header[index]))
    fail('格式不正确，请打开.astra-signature文件')
  const length = new DataView(header.buffer).getUint32(MAGIC.length, true)
  if (!length || length > MANIFEST_LIMIT || HEADER + length >= file.size) fail('目录不完整')
  const json = file.slice(HEADER, HEADER + length)
  if (
    (await hash(json)) !==
    Array.from(header.slice(MAGIC.length + 4), (value) => value.toString(16).padStart(2, '0')).join(
      '',
    )
  )
    fail('目录校验失败，文件可能已损坏')
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await json.arrayBuffer()))
  } catch {
    return fail('目录无法读取')
  }
  const manifest = manifestOf(value)
  let offset = HEADER + length
  if (
    file.size !==
    offset +
      manifest.portrait.size +
      manifest.stamps.reduce((total, stamp) => total + stamp.size, 0)
  )
    fail('素材不完整或包含额外数据')
  const source = file.slice(offset, offset + manifest.portrait.size, manifest.portrait.type)
  offset += source.size
  if ((await hash(source)) !== manifest.portrait.sha256) fail('画像校验失败')
  const blocks: Blob[] = []
  for (let i = 0; i < manifest.stamps.length; i++) {
    const s = manifest.stamps[i]!,
      block = file.slice(offset, offset + s.size)
    offset += s.size
    if ((await hash(block)) !== s.sha256) fail('签名校验失败')
    blocks.push(block)
    progress.onProgress?.(((i + 1) / manifest.stamps.length) * 0.5)
    await pause(progress.signal)
  }
  const portraitFile = new File([source], manifest.portrait.name, {
    type: manifest.portrait.type,
    lastModified: manifest.portrait.lastModified,
  })
  const { image: portrait, objectUrl } = await loadImageElement(portraitFile)
  const stamps: SignatureStamp[] = []
  const ownedCanvases: HTMLCanvasElement[] = []
  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    URL.revokeObjectURL(objectUrl)
    portrait.onload = null
    portrait.onerror = null
    portrait.removeAttribute('src')
    for (const canvas of ownedCanvases) {
      canvas.width = 1
      canvas.height = 1
    }
  }
  try {
    if (
      portrait.naturalWidth !== manifest.portrait.width ||
      portrait.naturalHeight !== manifest.portrait.height
    )
      fail('画像尺寸与目录不符')
    for (let i = 0; i < manifest.stamps.length; i++) {
      check(progress.signal)
      const packed = manifest.stamps[i]!,
        canvas = document.createElement('canvas')
      ownedCanvases.push(canvas)
      canvas.width = packed.width
      canvas.height = packed.height
      const context = canvas.getContext('2d')
      if (!context) fail('无法恢复签名像素')
      context.putImageData(
        new ImageData(
          new Uint8ClampedArray(await blocks[i]!.arrayBuffer()),
          packed.width,
          packed.height,
        ),
        0,
        0,
      )
      // Register ownership before preview encoding so failed encoding also releases it.
      const stamp: SignatureStamp = {
        id: packed.id,
        label: packed.label,
        width: packed.width,
        height: packed.height,
        canvas,
        previewUrl: '',
        source: packed.source,
        vector: packed.vector,
      }
      stamps.push(stamp)
      stamp.previewUrl = canvas.toDataURL('image/png')
      progress.onProgress?.(0.5 + ((i + 1) / manifest.stamps.length) * 0.5)
      if (i % 4 === 3) await pause(progress.signal)
    }
    check(progress.signal)
    return {
      project: {
        portrait,
        portraitFile,
        portraitName: manifest.portrait.displayName,
        stamps,
        placements: manifest.placements,
        options: manifest.options,
        width: manifest.width,
        height: manifest.height,
      },
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}
