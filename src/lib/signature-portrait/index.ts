export {
  createTextStamp,
  extractStampFromImage,
  loadImageElement,
  measureStampTraits,
  stampFromDrawnCanvas,
  stampFromFile,
  thickenInk,
  type ExtractStampOptions,
  type SignatureStamp,
} from './extract'

export {
  canvasToPngBlob,
  paintPlacementsRegion,
  paintPlacementsRegionResponsive,
  paintPlacementsScaled,
  paintPlacementsTiled,
  renderSignaturePortrait,
  triggerDownload,
  type Placement,
  type SignatureLayoutOptions,
} from './layout'

export {
  SIGNATURE_GPU_PREVIEW_VERIFIED,
  createGlStampPreview,
  isGlStampPreview,
  type GlStampPreview,
  type GlViewRect,
} from './gl-preview'

export {
  buildPlacementsSvg,
  svgElementToBlob,
  type SvgBuildOptions,
} from './svg'

export {
  buildPathSvgDocument,
  pathSvgToBlob,
  stampHasVector,
  traceStamp,
  traceStampCanvas,
  traceStamps,
  type StampVector,
  type TracedStamp,
} from './trace'

export {
  addStampToBank,
  addStampsToBank,
  deleteBank,
  deleteBankEntry,
  ensureBank,
  getBank,
  listBankEntries,
  listBanks,
  loadBankAsStamps,
  revokeEntryUrls,
  replaceBankStamps,
  type BankEntryView,
  type NameBank,
} from './bank'

export {
  generateHandwritingVariants,
  type VariantGenOptions,
} from './variants'

export { SIGNATURE_FONTS, type SignatureFontId } from './fonts'

export { prepareSignatureInk, type SignatureInkStyle } from './ink-style'
