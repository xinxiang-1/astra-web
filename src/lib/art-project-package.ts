import { ART_ENGINE_VERSION } from './art-engine'
import type { ArtProject } from './art-projects'

export const ART_PROJECT_PACKAGE_ACCEPT = '.astra'
export const ART_PROJECT_SOURCE_LIMIT = 64 * 1024 * 1024
const THUMBNAIL_LIMIT = 2 * 1024 * 1024
const MANIFEST_LIMIT = 64 * 1024
const MAGIC = new TextEncoder().encode('ASTRA01\n')
const HEADER_SIZE = MAGIC.length + 4 + 32
const MIME = 'application/x-astra-project'
const LEGACY_VERSION = 'legacy-1'
type Settings = ArtProject['settings']
type Asset = { name: string; type: string; size: number; lastModified: number; sha256: string }
export interface ArtProjectPackageManifest {
  format: 'astra-project'
  version: 1
  exportedAt: number
  project: { name: string; settings: Settings }
  engine: { id: 'calibrated' | 'legacy'; version: string | null }
  source: Asset
  thumbnail: { type: string; size: number; sha256: string }
  fonts: { embedded: false; userAgent: string }
}

const enums: Record<string, readonly string[]> = {
  editorEngine: ['calibrated', 'legacy'],
  artMode: ['density', 'color', 'phrase', 'contour', 'braille', 'halftone'],
  artQuality: ['classic', 'detailed', 'smooth', 'faithful'],
  artMotion: ['none', 'breathe', 'wave', 'assemble', 'current', 'reform', 'caustics'],
  artHover: [
    'none',
    'light',
    'ripple',
    'displace',
    'trail',
    'rift',
    'particles',
    'water',
    'silk',
    'vortex',
    'contour',
    'dissolve',
  ],
  artEffectProfile: ['classic', 'expressive'],
  artMotionStyle: ['studio', 'cinematic'],
  mode: ['charset', 'phrase'],
  hoverEffect: ['none', 'trail', 'water', 'silk', 'vortex', 'contour', 'dissolve'],
  ambientMotion: ['none', 'current', 'reform', 'caustics'],
  resolutionKey: ['low', 'medium', 'high', 'ultra', 'max', 'custom'],
  charsetKey: ['dense', 'standard', 'blocks', 'simple', 'letters', 'binary'],
  previewFontKey: ['consolas', 'yahei'],
  exportFontKey: ['consolas', 'yahei'],
}
const ranges: Record<string, readonly [number, number]> = {
  phraseThreshold: [0, 1],
  exposure: [-2, 2],
  contrast: [-0.4, 0.8],
  ditherStrength: [0, 1],
  hoverStrength: [0, 1],
  hoverRadius: [0.05, 1],
  columns: [20, 520],
  fontSize: [4, 16],
  previewAspect: [0.1, 4],
  exportAspect: [0.1, 4],
  clipStart: [0, 86400],
  clipEnd: [0, 86400],
  videoFps: [1, 60],
  artMotionSpeed: [0.2, 2],
  artMotionStrength: [0, 1],
}
const booleans = new Set(['phraseFillAll', 'phraseColor', 'normalizeTone', 'invert'])
const strings: Record<string, number> = {
  phrase: 64,
  customCharset: 1024,
  previewFontFamily: 1024,
  exportFontFamily: 1024,
}
const imageTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/avif',
])
const videoTypes = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
  'video/x-m4v',
])
const extensions: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogg: 'video/ogg',
  ogv: 'video/ogg',
  m4v: 'video/x-m4v',
}
function fail(message: string): never {
  throw new Error(message)
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`作品包的${label}无效`)
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, label: string, empty = false): string {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!empty && !value.length) ||
    /[\x00-\x1f]/.test(value)
  )
    fail(`作品包的${label}无效`)
  return value
}
function number(value: unknown, min: number, max: number, label: string, integer = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max ||
    (integer && !Number.isSafeInteger(value))
  )
    fail(`作品包的${label}超出支持范围`)
  return value
}
function settingsOf(value: unknown): Settings {
  const input = record(value, '参数'),
    result: Settings = Object.create(null)
  if (Object.keys(input).length > 64) fail('作品包包含过多参数')
  for (const [key, v] of Object.entries(input)) {
    if (Object.hasOwn(enums, key)) {
      if (typeof v !== 'string' || !enums[key]!.includes(v)) fail(`不支持作品包中的 ${key} 参数`)
    } else if (Object.hasOwn(ranges, key)) {
      const [min, max] = ranges[key]!
      number(v, min, max, key, key === 'columns')
    } else if (booleans.has(key)) {
      if (typeof v !== 'boolean') fail(`作品包的 ${key} 参数无效`)
    } else if (Object.hasOwn(strings, key)) {
      // Phrase/charset may contain newlines, as permitted by the editor.
      if (typeof v !== 'string' || v.length > strings[key]!) fail(`作品包的 ${key} 参数无效`)
    } else if (key === 'backgroundColor' || key === 'foregroundColor') {
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) fail('作品包的颜色参数无效')
    } else fail(`作品包包含当前版本不支持的参数：${key.slice(0, 60)}`)
    result[key] = v as string | number | boolean
  }
  if (result.mode !== 'charset' && result.mode !== 'phrase') fail('作品包缺少转换模式')
  for (const key of [
    'columns',
    'previewAspect',
    'previewFontFamily',
    'backgroundColor',
    'foregroundColor',
  ])
    if (!Object.hasOwn(result, key)) fail(`作品包缺少必要参数：${key}`)
  if (
    typeof result.clipStart === 'number' &&
    typeof result.clipEnd === 'number' &&
    result.clipStart > result.clipEnd
  )
    fail('作品包的视频选段无效')
  return result
}
export function assertArtProjectEngineCompatible(
  project: Pick<ArtProject, 'settings' | 'engineVersion'>,
) {
  const expected =
    project.settings.editorEngine === 'calibrated' ? ART_ENGINE_VERSION : LEGACY_VERSION
  if (project.engineVersion && project.engineVersion !== expected)
    fail('这个项目使用了其他版本的效果引擎，请使用对应版本打开，避免改变作品。')
}
function hashString(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail('作品包的校验信息无效')
  return value
}
async function hash(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  if (!crypto.subtle) fail('作品包需要在 HTTPS 或本地开发环境中使用')
  return new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))
}
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('')
function mediaType(source: Pick<Asset, 'name' | 'type'>) {
  const type = source.type || extensions[source.name.split('.').pop()?.toLowerCase() || '']
  if (type && imageTypes.has(type)) return { kind: 'image' as const, type }
  if (type && videoTypes.has(type)) return { kind: 'video' as const, type }
  return fail('作品包中的素材格式暂不支持，请使用 PNG、JPG、WebP 或 MP4、WebM')
}
async function validateImage(blob: Blob, thumbnail = false) {
  let image: ImageBitmap
  try {
    image = await createImageBitmap(blob)
  } catch {
    return fail('作品包中的图片无法读取')
  }
  try {
    if (
      !image.width ||
      !image.height ||
      image.width * image.height > (thumbnail ? 2_000_000 : 32_000_000) ||
      Math.max(image.width, image.height) > (thumbnail ? 4096 : 16384)
    )
      fail('作品包中的图片尺寸超出支持范围')
  } finally {
    image.close()
  }
}
async function validateMedia(blob: Blob, source: Asset, settings: Settings) {
  const media = mediaType(source)
  const typed = blob.slice(0, blob.size, media.type)
  if (media.kind === 'image') await validateImage(typed)
  else {
    const video = document.createElement('video'),
      url = URL.createObjectURL(typed)
    let timer = 0
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => {
          if (
            !Number.isFinite(video.duration) ||
            !video.videoWidth ||
            !video.videoHeight ||
            video.videoWidth * video.videoHeight > 32_000_000
          )
            reject(new Error('作品包中的视频信息无效'))
          else if (typeof settings.clipEnd === 'number' && settings.clipEnd > video.duration + 0.05)
            reject(new Error('作品包的视频选段超出了素材长度'))
          else if (
            typeof settings.clipStart === 'number' &&
            typeof settings.clipEnd === 'number' &&
            (settings.clipEnd <= settings.clipStart ||
              settings.clipEnd - settings.clipStart > 20.001)
          )
            reject(new Error('作品包的视频选段无效，最长支持 20 秒'))
          else resolve()
        }
        video.onerror = () =>
          reject(new Error('作品包中的视频无法读取，请检查浏览器是否支持此格式'))
        timer = window.setTimeout(() => reject(new Error('视频读取超时，请检查素材或重试')), 10000)
        video.preload = 'metadata'
        video.src = url
      })
    } finally {
      clearTimeout(timer)
      video.onloadedmetadata = null
      video.onerror = null
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
  }
  return media.kind
}
function thumbnailBlob(data: string): Blob {
  if (data.length > THUMBNAIL_LIMIT * 1.4) fail('项目缩略图过大，请重新保存项目')
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/.exec(data)
  if (!match) fail('项目缺少有效缩略图，请在编辑器重新保存')
  let bytes: Uint8Array<ArrayBuffer>
  try {
    bytes = Uint8Array.from(atob(match[2]!), (c) => c.charCodeAt(0))
  } catch {
    return fail('项目缩略图损坏，请重新保存项目')
  }
  if (!bytes.length || bytes.length > THUMBNAIL_LIMIT) fail('项目缩略图超出支持范围')
  return new Blob([bytes], { type: match[1]! })
}
function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('无法读取作品缩略图'))
    reader.readAsDataURL(blob)
  })
}

export function artProjectPackageFilename(name: string) {
  return `${
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .trim()
      .slice(0, 60) || 'astra-art'
  }.astra`
}
export async function createArtProjectPackage(project: ArtProject): Promise<Blob> {
  if (
    !(project.source instanceof Blob) ||
    !project.source.size ||
    project.source.size > ART_PROJECT_SOURCE_LIMIT
  )
    fail('作品包支持最大 64 MB 的原始素材，请先缩小素材后重试')
  const settings = settingsOf(project.settings)
  assertArtProjectEngineCompatible(project)
  const thumbnail = thumbnailBlob(project.thumbnail)
  const source: Asset = {
    name: text(project.source.name, 255, '素材名称'),
    type: text(project.source.type, 100, '素材类型', true),
    size: project.source.size,
    lastModified: number(project.source.lastModified, 0, Number.MAX_SAFE_INTEGER, '素材日期', true),
    sha256: hex(await hash(project.source)),
  }
  if (project.kind !== mediaType(source).kind) fail('项目的素材类型不一致')
  const manifest: ArtProjectPackageManifest = {
    format: 'astra-project',
    version: 1,
    exportedAt: Date.now(),
    project: { name: text(project.name, 60, '项目名称'), settings },
    engine: {
      id: settings.editorEngine === 'calibrated' ? 'calibrated' : 'legacy',
      version: project.engineVersion ?? null,
    },
    source,
    thumbnail: { type: thumbnail.type, size: thumbnail.size, sha256: hex(await hash(thumbnail)) },
    fonts: { embedded: false, userAgent: navigator.userAgent.slice(0, 512) },
  }
  const json = new Blob([JSON.stringify(manifest)], { type: 'application/json' })
  if (json.size > MANIFEST_LIMIT) fail('作品参数过大，请缩短自定义文字后重试')
  const header = new Uint8Array(HEADER_SIZE)
  header.set(MAGIC)
  new DataView(header.buffer).setUint32(MAGIC.length, json.size, true)
  header.set(await hash(json), MAGIC.length + 4)
  return new Blob([header, json, project.source, thumbnail], { type: MIME })
}

export async function readArtProjectPackage(
  file: Blob,
): Promise<{ project: ArtProject; notice: string }> {
  if (
    file.size < HEADER_SIZE ||
    file.size > HEADER_SIZE + MANIFEST_LIMIT + ART_PROJECT_SOURCE_LIMIT + THUMBNAIL_LIMIT
  )
    fail('作品包大小无效，原始素材最多支持 64 MB')
  const header = new Uint8Array(await file.slice(0, HEADER_SIZE).arrayBuffer())
  if (!MAGIC.every((n, i) => header[i] === n)) fail('请选择 Astra 导出的 .astra 作品包')
  const length = new DataView(header.buffer).getUint32(MAGIC.length, true)
  if (!length || length > MANIFEST_LIMIT || HEADER_SIZE + length >= file.size)
    fail('作品包目录损坏或版本不支持')
  const json = file.slice(HEADER_SIZE, HEADER_SIZE + length)
  if (hex(await hash(json)) !== hex(header.slice(MAGIC.length + 4)))
    fail('作品包目录校验失败，文件可能已损坏')
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await json.arrayBuffer()))
  } catch {
    return fail('作品包目录无法读取')
  }
  const manifest = record(parsed, '目录')
  if (manifest.format !== 'astra-project' || manifest.version !== 1)
    fail('此作品包版本暂不支持，请使用对应版本的 Astra')
  number(manifest.exportedAt, 0, Number.MAX_SAFE_INTEGER, '导出日期', true)
  const info = record(manifest.project, '项目'),
    settings = settingsOf(info.settings)
  const name = text(info.name, 60, '项目名称'),
    engine = record(manifest.engine, '效果引擎')
  const expectedEngine = settings.editorEngine === 'calibrated' ? 'calibrated' : 'legacy'
  if (engine.id !== expectedEngine) fail('作品包的效果引擎与参数不一致')
  const engineVersion = engine.version === null ? undefined : text(engine.version, 40, '引擎版本')
  assertArtProjectEngineCompatible({ settings, engineVersion })
  const raw = record(manifest.source, '素材'),
    thumb = record(manifest.thumbnail, '缩略图')
  const source: Asset = {
    name: text(raw.name, 255, '素材名称'),
    type: text(raw.type, 100, '素材类型', true),
    size: number(raw.size, 1, ART_PROJECT_SOURCE_LIMIT, '素材大小', true),
    lastModified: number(raw.lastModified, 0, Number.MAX_SAFE_INTEGER, '素材日期', true),
    sha256: hashString(raw.sha256),
  }
  const thumbSize = number(thumb.size, 1, THUMBNAIL_LIMIT, '缩略图大小', true)
  const thumbType = text(thumb.type, 100, '缩略图类型')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(thumbType)) fail('作品包缩略图格式无效')
  const thumbHash = hashString(thumb.sha256),
    start = HEADER_SIZE + length
  if (file.size !== start + source.size + thumbSize) fail('作品包素材不完整或包含额外数据')
  const sourceBlob = file.slice(start, start + source.size, source.type)
  const thumbnail = file.slice(start + source.size, file.size, thumbType)
  if (hex(await hash(sourceBlob)) !== source.sha256 || hex(await hash(thumbnail)) !== thumbHash)
    fail('作品包素材校验失败，文件可能已损坏，请重新下载或导出')
  const kind = await validateMedia(sourceBlob, source, settings)
  if (
    settings.editorEngine === 'calibrated' &&
    settings.artQuality &&
    settings.artQuality !== 'classic'
  ) {
    if (
      kind === 'video' ||
      !(
        (settings.artMode === 'density' && !settings.phraseColor) ||
        (settings.artMode === 'color' && settings.artQuality === 'faithful')
      )
    )
      fail('作品包的画质档不适用于这个模式或视频，请在原编辑器重新保存')
  }
  await validateImage(thumbnail, true)
  return {
    project: {
      id: crypto.randomUUID(),
      name,
      kind,
      updatedAt: Date.now(),
      source: new File([sourceBlob], source.name, {
        type: source.type,
        lastModified: source.lastModified,
      }),
      thumbnail: await dataUrl(thumbnail),
      settings,
      ...(engineVersion ? { engineVersion } : {}),
    },
    notice: engineVersion
      ? '导入成功，已保存为新项目。不同设备的字体可能影响文字效果。'
      : '导入成功，已保存为新项目。旧项目没有版本记录，请打开检查效果。',
  }
}
