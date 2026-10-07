/// <reference lib="webworker" />
import { isolateSignaturePixels, type SignatureCutoutSettings } from './signature-cutout'

self.onmessage = (event: MessageEvent<{ pixels: ImageData; settings: SignatureCutoutSettings }>) => {
  try {
    const result = isolateSignaturePixels(event.data.pixels, event.data.settings)
    self.postMessage({ result }, [result.pixels.data.buffer])
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : '签名抠图失败' })
  }
}
