/** Character sets for brightness → glyph mapping. */
export const ASCII_CHARSETS = {
  dense: '@%#*+=-:. ',
  blocks: '█▓▒░ ',
  simple: '#Oo*. ',
  binary: '10 ',
} as const

/** Output resolution presets → character columns (sampling rate). */
export const ASCII_RESOLUTIONS = {
  low: { label: '低清', columns: 80, hint: '快预览' },
  medium: { label: '标清', columns: 120, hint: '常用' },
  high: { label: '高清', columns: 180, hint: '更细' },
  ultra: { label: '超清', columns: 240, hint: '很细' },
  max: { label: '极清', columns: 360, hint: '最细' },
} as const

/** Presets for plain-text paste vs on-screen monospace cells. */
export const ASCII_ASPECT_PRESETS = {
  /** Original on-page preview cell (Consolas-like). */
  consolas: { label: 'Consolas', value: 0.55, hint: '页面预览默认' },
  /** Match this PC's Notepad face (Microsoft YaHei ≈ 0.74). */
  notepad: { label: '记事本', value: 0.74, hint: '微软雅黑字格，对齐本机记事本' },
  detail: { label: '细密', value: 0.9, hint: '更多行，画面会偏高' },
} as const

/** Preview default: original Consolas-style cell. */
export const DEFAULT_CHAR_ASPECT = ASCII_ASPECT_PRESETS.consolas.value
/** Export / Notepad default: Microsoft YaHei cell. */
export const EXPORT_CHAR_ASPECT = ASCII_ASPECT_PRESETS.notepad.value

/**
 * On-page preview font (original mono look).
 */
export const PREVIEW_MONO_FONT =
  'Consolas, "Cascadia Mono", "Courier New", monospace'

/**
 * Export / Notepad font from this machine's settings
 * (`Microsoft YaHei` / 微软雅黑).
 */
export const NOTEPAD_MONO_FONT =
  '"Microsoft YaHei", "微软雅黑", Cascadia Mono, Consolas, "Courier New", monospace'

export const EXPORT_MONO_FONT = NOTEPAD_MONO_FONT

/** Configurable font profiles for preview vs download. */
export const ASCII_FONT_PRESETS = {
  consolas: {
    label: 'Consolas',
    family: PREVIEW_MONO_FONT,
    aspect: ASCII_ASPECT_PRESETS.consolas.value,
    hint: '页面预览默认等宽',
  },
  yahei: {
    label: '微软雅黑',
    family: NOTEPAD_MONO_FONT,
    aspect: ASCII_ASPECT_PRESETS.notepad.value,
    hint: '本机记事本默认',
  },
} as const

/** Image MIME list for `<input accept>`. */
export const IMAGE_ACCEPT =
  'image/png,image/jpeg,image/webp,image/gif,image/bmp'

/** Common browser-decodable video types. */
export const VIDEO_ACCEPT =
  'video/mp4,video/webm,video/quicktime,video/ogg,video/x-m4v'

export const MEDIA_ACCEPT = `${IMAGE_ACCEPT},${VIDEO_ACCEPT}`

/** Cap sampling columns only while video is *playing* realtime (not prerender). */
export const VIDEO_LIVE_MAX_COLUMNS = {
  /** Grayscale charset preview while playing live. */
  charset: 200,
  /** Phrase fill is heavier (CJK + color). */
  phrase: 140,
} as const

/** @deprecated Use VIDEO_LIVE_MAX_COLUMNS; kept for older call sites. */
export const VIDEO_MAX_COLUMNS = VIDEO_LIVE_MAX_COLUMNS.charset

/** Target ASCII frame rate for video preview. */
export const VIDEO_TARGET_FPS = 15

/** Above this duration, refuse prerender (ask user to lower clarity). */
export const VIDEO_PRERENDER_MAX_DURATION_SEC = 20

/** Hard cap on cached frames to bound memory. */
export const VIDEO_PRERENDER_MAX_FRAMES = 480

/**
 * Export keeps at most this many ASCII frames in memory.
 * Longer clips encode one frame, then drop it, before reading the next.
 */
export const VIDEO_EXPORT_BUFFER_FRAMES = 480

/**
 * One MP4 export, including the streaming path.
 * 3600 frames ≈ 4 min at 15 fps, or ≈ 2.5 min at 24 fps.
 */
export const VIDEO_EXPORT_MAX_FRAMES = 3600
