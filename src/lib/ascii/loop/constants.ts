/** Low-cap looping ASCII with background-glyph flow (still pure character art). */

export const LOOP_MAX_COLUMNS = 96
export const LOOP_MAX_FPS = 12
export const LOOP_MAX_DURATION_SEC = 4
export const LOOP_MAX_FRAMES = 48
export const LOOP_DEFAULT_COLUMNS = 72
export const LOOP_DEFAULT_FPS = 10

export const LOOP_ACCEPT =
  'image/gif,image/webp,video/mp4,video/webm,video/quicktime'

/**
 * Background cell fill patterns — motion appears when frames stack.
 * Catalog drawn from common ASCII bg libs (ASCIIGround, ascii-splash,
 * GlyphStream, ASCII Field, cli-fx): procedural fields that stay pure
 * per-cell math so each prerender frame can bake independently.
 */
export const LOOP_FLOW_PATTERNS = {
  rain: { label: '下落', hint: '背景字符向下淌' },
  wave: { label: '波浪', hint: '横向正弦推进' },
  drift: { label: '斜流', hint: '对角线漂移' },
  pulse: { label: '呼吸', hint: '疏密随帧涨落' },
  matrix: { label: '矩阵雨', hint: '分列瀑布，头亮尾淡' },
  spiral: { label: '螺旋', hint: '臂状螺旋绕中心转' },
  vortex: { label: '漩涡', hint: '向中心卷入' },
  ripple: { label: '涟漪', hint: '同心环向外扩' },
  plasma: { label: '等离子', hint: '多层正弦干涉' },
  tunnel: { label: '隧道', hint: '径向景深冲进' },
  scan: { label: '扫描', hint: '水平扫描带扫过' },
  noise: { label: '噪点', hint: '伪随机闪烁雪花' },
} as const

export type LoopFlowPattern = keyof typeof LOOP_FLOW_PATTERNS

/** Default charset for flowing background cells (dark → light). */
export const LOOP_FLOW_CHARSET = '·:+*#%@'

/** Matrix-style column rain prefers thinner glyphs. */
export const LOOP_MATRIX_CHARSET = '01:|.!░▒▓'
