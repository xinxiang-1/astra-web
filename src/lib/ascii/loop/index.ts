export {
  LOOP_ACCEPT,
  LOOP_DEFAULT_COLUMNS,
  LOOP_DEFAULT_FPS,
  LOOP_FLOW_CHARSET,
  LOOP_FLOW_PATTERNS,
  LOOP_MATRIX_CHARSET,
  LOOP_MAX_COLUMNS,
  LOOP_MAX_DURATION_SEC,
  LOOP_MAX_FRAMES,
  LOOP_MAX_FPS,
  type LoopFlowPattern,
} from './constants'

export { sampleDominantColor, type DominantColor } from './color'

export {
  applyFlowToFrame,
  applyFlowingBackground,
  buildBackgroundMask,
  estimateBackgroundBrightness,
  matteSourceMask,
} from './matte'

export {
  captureLoopAsciiFrames,
  captureLoopAsciiFromBitmaps,
  decodeAnimatedImageBitmaps,
  type CaptureLoopOptions,
  type CaptureLoopResult,
} from './capture'

export {
  buildLoopHtmlSnippet,
  loopHtmlToBlob,
  type BuildLoopHtmlOptions,
  type LoopHtmlFrame,
} from './export-html'
