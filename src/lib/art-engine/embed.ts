import { ART_DEFAULTS, ART_ENGINE_VERSION, createArtCore, createCanvasArtRenderer } from './index'
import type { ArtFrame, ArtHover, ArtMotion, ArtRenderOptions, ArtPointerSample } from './types'

type PortableFrame = Omit<ArtFrame, 'glyphs' | 'indices' | 'alpha' | 'colors'> & {
  glyphs: { char: string; coverage: number; png: string }[]
  indices: number[]
  alpha: number[]
  colors: number[]
}
type PagePayload = {
  frame: PortableFrame
  title: string
  motion: ArtMotion
  hover: ArtHover | 'none'
  transparent: boolean
  effectProfile?: ArtRenderOptions['effectProfile']
  motionSpeed?: number
  motionStrength?: number
  hoverStrength?: number
  hoverRadius?: number
  source?: { kind: 'image' | 'video'; dataUrl: string; start: number; end: number }
}

/** This function has no module globals: the exact runtime is copied into HTML. */
async function runArtworkPage(
  makeCore: typeof createArtCore,
  makeRenderer: typeof createCanvasArtRenderer,
  defaults: typeof ART_DEFAULTS,
  version: string,
) {
  const data: PagePayload = JSON.parse(document.getElementById('art-data')!.textContent!)
  const canvas = document.querySelector('canvas')!
  const host = document.getElementById('art-stage')!
  const status = document.getElementById('art-status')!
  const button = document.getElementById('play') as HTMLButtonElement
  const core = makeCore(defaults, version),
    renderer = makeRenderer(canvas)
  const glyphs = await Promise.all(
    data.frame.glyphs.map(async (item) => {
      const image = new Image()
      image.src = item.png
      await image.decode()
      const tile = document.createElement('canvas')
      tile.width = image.width
      tile.height = image.height
      tile.getContext('2d')!.drawImage(image, 0, 0)
      return { char: item.char, coverage: item.coverage, tile }
    }),
  )
  let frame: ArtFrame = {
    ...data.frame,
    glyphs,
    indices: new Uint16Array(data.frame.indices),
    alpha: new Float32Array(data.frame.alpha),
    colors: new Uint8ClampedArray(data.frame.colors),
  }
  core.primeAtlas(frame)
  document.title = data.title
  document.getElementById('title')!.textContent = data.title
  document.body.style.background = frame.settings.background
  let video: HTMLVideoElement | null = null
  let running = false,
    raf = 0,
    last = 0,
    lastVideoTime = -1,
    animationTime = 0,
    interactionTime = 0,
    previousTime = 0
  const reduced = matchMedia('(prefers-reduced-motion: reduce)')
  const pointer = { x: 0.5, y: 0.5, strength: 0, target: 0 }
  const pointerSamples: ArtPointerSample[] = []
  function paint() {
    const size = Math.max(
      64,
      Math.min(
        2048,
        Math.round(
          Math.max(host.clientWidth, host.clientHeight) * Math.min(2, devicePixelRatio || 1),
        ),
      ),
    )
    renderer.render(frame, {
      longEdge: size,
      transparent: data.transparent,
      time: animationTime,
      hoverTime: interactionTime,
      effectProfile: data.effectProfile,
      motionSpeed: data.motionSpeed,
      motionStrength: data.motionStrength,
      hoverRadius: data.hoverRadius,
      hoverStrength: reduced.matches || data.hover === 'none' ? 0 : data.hoverStrength,
      pointerSamples: pointerSamples.splice(0),
      motion: reduced.matches ? 'none' : data.motion,
      hover: data.hover === 'none' ? 'light' : data.hover,
      pointer: {
        ...pointer,
        active: pointer.target > 0 && !reduced.matches && data.hover !== 'none',
        strength:
          data.hover === 'none' || reduced.matches
            ? 0
            : pointer.strength * (data.hoverStrength ?? 1),
      },
    })
    canvas.dataset.ready = 'true'
    canvas.dataset.time = String(video?.currentTime ?? animationTime)
  }
  function queue() {
    if (!raf && !document.hidden) raf = requestAnimationFrame(tick)
  }
  function tick(now: number) {
    raf = 0
    if (now - last < 1000 / 24) {
      queue()
      return
    }
    const delta = previousTime ? Math.min(0.15, (now - previousTime) / 1000) : 0
    previousTime = now
    last = now
    if (running && !reduced.matches) animationTime += delta
    interactionTime += delta
    pointer.strength +=
      (pointer.target - pointer.strength) * (1 - Math.exp(-Math.max(delta, 1 / 60) / 0.16))
    if (!pointer.target && pointer.strength < 0.002) pointer.strength = 0
    if (video && data.source && running && (video.currentTime >= data.source.end || video.ended))
      video.currentTime = data.source.start
    if (
      video &&
      !video.seeking &&
      video.readyState >= 2 &&
      Math.abs(video.currentTime - lastVideoTime) > 0.001
    ) {
      frame = core.prepareArtFrame(video, video.videoWidth, video.videoHeight, data.frame.settings)
      lastVideoTime = video.currentTime
    }
    paint()
    if (
      (running && (video || (!reduced.matches && data.motion !== 'none'))) ||
      pointer.strength > 0.002 ||
      pointer.target > 0 ||
      renderer.interactionActive
    )
      queue()
  }
  function movePointer(event: PointerEvent) {
    if (data.hover === 'none' || reduced.matches) return
    const rect = canvas.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width,
      y = (event.clientY - rect.top) / rect.height
    pointer.target = x >= 0 && x <= 1 && y >= 0 && y <= 1 ? 1 : 0
    if (pointer.target) {
      pointer.x = x
      pointer.y = y
      const samples = event.getCoalescedEvents?.() ?? []
      for (const sample of samples.length ? samples : [event]) {
        const sx = (sample.clientX - rect.left) / rect.width, sy = (sample.clientY - rect.top) / rect.height
        if (sx >= 0 && sx <= 1 && sy >= 0 && sy <= 1) pointerSamples.push({ x: sx, y: sy, time: sample.timeStamp, active: true })
      }
      if (pointerSamples.length > 128) pointerSamples.splice(0, pointerSamples.length - 128)
    }
    queue()
  }
  host.addEventListener('pointermove', movePointer)
  host.addEventListener('pointerdown', movePointer)
  function leavePointer() {
    pointer.target = 0
    pointerSamples.push({ x: pointer.x, y: pointer.y, time: performance.now(), active: false })
    if (pointerSamples.length > 128) pointerSamples.shift()
    queue()
  }
  host.addEventListener('pointerup', (event) => {
    if (event.pointerType !== 'mouse') {
      leavePointer()
    }
  })
  host.addEventListener('pointercancel', leavePointer)
  host.addEventListener('pointerleave', leavePointer)
  button.onclick = async () => {
    running = !running
    previousTime = 0
    if (video) {
      if (running)
        await video.play().catch(() => {
          running = false
          status.textContent = '无法播放，请选择其他视频'
        })
      else video.pause()
    }
    button.textContent = running ? '暂停作品' : '播放作品'
    queue()
  }
  document.getElementById('restart')!.onclick = () => {
    animationTime = 0
    if (video && data.source) video.currentTime = data.source.start
    queue()
  }
  document.getElementById('download-text')!.onclick = () => {
    const url = URL.createObjectURL(
      new Blob(['\uFEFF', frame.text], { type: 'text/plain;charset=utf-8' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = 'astra-art.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  new ResizeObserver(() => {
    paint()
  }).observe(host)
  reduced.addEventListener('change', () => {
    pointer.target = 0
    pointer.strength = 0
    queue()
  })
  document.addEventListener('visibilitychange', () => {
    previousTime = 0
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      video?.pause()
    } else {
      if (running) void video?.play()
      queue()
    }
  })
  if (data.source?.kind === 'video') {
    video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = data.source.dataUrl
    await new Promise<void>((resolve, reject) => {
      video!.onloadeddata = () => resolve()
      video!.onerror = () => reject(new Error('视频读取失败'))
    })
    video.addEventListener('seeked', () => {
      lastVideoTime = -1
      queue()
    })
    if (data.source.start > 0) {
      await new Promise<void>((resolve) => {
        video!.addEventListener('seeked', () => resolve(), { once: true })
        video!.currentTime = data.source!.start
      })
    }
    lastVideoTime = video.currentTime
  }
  paint()
  status.textContent = '移动指针探索光影 · 作品可离线打开'
  window.addEventListener(
    'pagehide',
    () => {
      if (raf) cancelAnimationFrame(raf)
      video?.pause()
      renderer.destroy()
    },
    { once: true },
  )
}

export function artworkEmbedPage(frame: ArtFrame, options: Omit<PagePayload, 'frame'>): string {
  const payload: PagePayload = {
    ...options,
    frame: {
      ...frame,
      glyphs: frame.glyphs.map((glyph) => ({
        char: glyph.char,
        coverage: glyph.coverage,
        png: glyph.tile.toDataURL('image/png'),
      })),
      indices: [...frame.indices],
      alpha: [...frame.alpha],
      colors: [...frame.colors],
    },
  }
  const json = JSON.stringify(payload)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
  return `<!doctype html><!-- Native interaction fields adapted from asciify-engine 4.1.0. MIT License

Copyright (c) 2026 ayangabryl

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
 --><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Astra 作品</title><style>*{box-sizing:border-box}body{margin:0;color:#eeeae2;font:14px system-ui,sans-serif}main{max-width:1440px;margin:auto;padding:24px}header{display:flex;gap:20px;align-items:center;flex-wrap:wrap}header b{letter-spacing:.18em}h1{font-size:18px;font-weight:500}#art-stage{height:calc(100dvh - 180px);min-height:240px;display:flex;justify-content:center;align-items:center;overflow:hidden;margin:20px 0}canvas{display:block;max-width:100%;max-height:100%;object-fit:contain}nav{display:flex;gap:10px;flex-wrap:wrap}button{border:1px solid #ffffff40;background:#ffffff0b;color:inherit;padding:10px 18px;border-radius:24px;cursor:pointer}button:hover{border-color:#58e8ed}button:focus-visible{outline:2px solid #58e8ed;outline-offset:3px}p{font-size:12px;opacity:.7}</style><main><header><b>ASTRA</b><h1 id="title">正在打开作品</h1></header><div id="art-stage"><canvas aria-label="字符艺术作品"></canvas></div><nav><button id="play">播放作品</button><button id="restart">重新开始</button><button id="download-text">下载字符文本</button></nav><p id="art-status" role="status">正在准备作品…</p></main><script id="art-data" type="application/json">${json}</script><script>(${runArtworkPage.toString()})(${createArtCore.toString()},${createCanvasArtRenderer.toString()},${JSON.stringify(ART_DEFAULTS)},${JSON.stringify(ART_ENGINE_VERSION)}).catch(error=>{document.getElementById('art-status').textContent=error.message;console.error(error)})</script></html>`
}
