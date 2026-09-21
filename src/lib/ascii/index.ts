/** Browser-side image/video → ASCII (no network). */

export {
  ASCII_ASPECT_PRESETS,
  ASCII_CHARSETS,
  ASCII_FONT_PRESETS,
  ASCII_RESOLUTIONS,
  DEFAULT_CHAR_ASPECT,
  EXPORT_CHAR_ASPECT,
  EXPORT_MONO_FONT,
  IMAGE_ACCEPT,
  MEDIA_ACCEPT,
  NOTEPAD_MONO_FONT,
  PREVIEW_MONO_FONT,
  VIDEO_ACCEPT,
  VIDEO_EXPORT_BUFFER_FRAMES,
  VIDEO_EXPORT_MAX_FRAMES,
  VIDEO_LIVE_MAX_COLUMNS,
  VIDEO_MAX_COLUMNS,
  VIDEO_PRERENDER_MAX_DURATION_SEC,
  VIDEO_PRERENDER_MAX_FRAMES,
  VIDEO_TARGET_FPS,
} from './constants'

export type {
  AsciiAspectPresetKey,
  AsciiCharsetKey,
  AsciiConvertOptions,
  AsciiConvertResult,
  AsciiFontPresetKey,
  AsciiFrameSource,
  AsciiMediaKind,
  AsciiMode,
  AsciiPaintOptions,
  AsciiPaintSize,
  AsciiPhraseOptions,
  AsciiPngOptions,
  AsciiResolutionKey,
  AsciiToneOptions,
  FitZoomOptions,
  MonoCellMetrics,
  PrerenderFrame,
} from './types'

export {
  convertBitmapToAscii,
  convertBitmapToPhraseAscii,
  convertSourceToAscii,
  convertSourceToPhraseAscii,
  hasCjkText,
  imageDataToAscii,
  imageDataToPhraseAscii,
  sampleImageData,
} from './convert'

export {
  asciiStudioEffectsActive,
  buildAsciiStudioSettings,
  charsetForStudio,
  mountCharsetStudio,
  resizeCharsetStudio,
  studioCellSizeFromColumns,
  studioPatchFromInput,
  toStudioCharset,
} from './studio-preview'

export type {
  AsciiStudioHoverEffect,
  AsciiStudioMotion,
  AsciiStudioPreviewInput,
  CharsetStudioHandle,
} from './studio-preview'

export {
  asciiToPngBlob,
  measureMonoCellAspect,
  measureMonoCellMetrics,
  paintAsciiToCanvas,
  pickMetricGlyph,
  suggestFitZoom,
  triggerDownload,
} from './paint'

export {
  exportAsciiVideo,
  pickRecorderMimeType,
  planVideoExportFrames,
  type AsciiVideoExportOptions,
  type AsciiVideoExportResult,
  type AsciiVideoFrameInput,
} from './export-video'

export {
  clampColumnsForMedia,
  fileToImageBitmap,
  isImageFile,
  isVideoFile,
  loadVideoElement,
  needsVideoPrerender,
  resolveAsciiColumns,
  seekVideoTo,
  videoLiveColumnCap,
} from './media'

export {
  buildPrerenderCacheKey,
  nearestPrerenderIndex,
  prerenderVideoFrames,
  type PrerenderCacheKeyInputs,
  type PrerenderVideoOptions,
  type PrerenderVideoResult,
} from './prerender'

export {
  createLiveFrameLoop,
  createPrerenderFrameLoop,
  type FrameLoopHandle,
} from './playback'
