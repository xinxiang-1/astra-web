declare module 'imagetracerjs' {
  type TraceOptions = Record<string, unknown> | string

  interface ImageTracerApi {
    imagedataToSVG(imgd: ImageData, options?: TraceOptions): string
    getImgdata(canvas: HTMLCanvasElement): ImageData
  }

  const ImageTracer: ImageTracerApi
  export default ImageTracer
}
