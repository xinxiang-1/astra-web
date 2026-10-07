/// <reference lib="webworker" />
import { createWashTaskQueue, processSignatureWash, type SignatureWashRecipe } from './wash-style'

const scope = self as unknown as DedicatedWorkerGlobalScope
scope.onmessage = async (event: MessageEvent<{ pixels: ImageData; recipe: SignatureWashRecipe }>) => {
  const tasks = createWashTaskQueue()
  let last = 0
  try {
    const pixels = await processSignatureWash(event.data.pixels, event.data.recipe, {
      checkpoint: tasks.yield,
      progress: ratio => { const now = performance.now(); if (now - last > 80) { last = now; scope.postMessage({ type: 'progress', ratio }) } },
    })
    scope.postMessage({ type: 'done', pixels }, [pixels.data.buffer])
  } catch (error) { scope.postMessage({ type: 'error', error: error instanceof Error ? error.message : '彩绘配色失败' }) }
  finally { tasks.close(); scope.close() }
}
