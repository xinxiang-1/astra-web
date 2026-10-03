import {
  prepareArtFrame,
  type ArtFrame,
  type ArtMode,
  type ArtPointerSample,
} from '../../../src/lib/art-engine/index'
import { createCanvasArtRenderer } from '../../../src/lib/art-engine/canvas'
import { createGlyphParticlePresentation } from './presentation'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvases = [$<HTMLCanvasElement>('native'), $<HTMLCanvasElement>('particles')]
const presentation = createGlyphParticlePresentation()
let renderers = [
  createCanvasArtRenderer(canvases[0]!),
  createCanvasArtRenderer(canvases[1]!, { experimentalTrail: presentation.prepare }),
]
let frame: ArtFrame,
  ready = false,
  generation = 0,
  disposed = false,
  manual = false,
  visible = true
let strength = 0.65,
  clock = performance.now() / 1000,
  ambient = 0,
  wave = false,
  paused = false,
  focused = true,
  dirty = true
let pointer = { x: 0.5, y: 0.5, active: false, strength },
  samples: ArtPointerSample[] = []
let paintCount = 0
const renderCounts = [0, 0],
  timings: number[] = []
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
let previous = performance.now()
function paint() {
  if (!ready || disposed) return
  const start = performance.now()
  dirty = false
  presentation.setTime(clock)
  const options = {
    longEdge: 720,
    effectProfile: 'expressive' as const,
    hover: 'trail' as const,
    motion: wave && !reduced.matches ? ('wave' as const) : ('none' as const),
    motionStyle: 'studio' as const,
    motionStrength: 0.45,
    time: ambient,
    hoverStrength: reduced.matches ? 0 : strength,
    hoverRadius: 0.38,
    hoverTime: clock,
    pointer: { ...pointer, strength: reduced.matches ? 0 : strength },
    pointerSamples: reduced.matches ? [] : samples,
  }
  renderers.forEach((renderer, index) => {
    if (focused && index === 0) return
    renderer.render(frame, options)
    renderCounts[index] = renderCounts[index]! + 1
  })
  paintCount++
  samples = []
  timings.push(performance.now() - start)
  if (timings.length > 120) timings.shift()
  const ordered = [...timings].sort((a, b) => a - b)
  $('performance').textContent =
    `720px · ${frame.columns}列 · ${focused ? '单幅' : '双幅'}绘制 P95 ${(ordered[Math.floor((ordered.length - 1) * 0.95)] ?? 0).toFixed(1)} ms`
  $('status').textContent = reduced.matches
    ? '减少动效 · 静态作品'
    : pointer.active
      ? '划动中 · 字符随流体散开'
      : renderers[1]!.interactionActive || presentation.stats.moving
        ? '余波 · 正在重新归位'
        : '已归位 · 可以再次划动'
}
function reset() {
  renderers.forEach((renderer) => renderer.destroy())
  presentation.reset()
  renderers = [
    createCanvasArtRenderer(canvases[0]!),
    createCanvasArtRenderer(canvases[1]!, { experimentalTrail: presentation.prepare }),
  ]
  pointer = { ...pointer, active: false }
  samples = []
  ambient = 0
  timings.length = 0
  dirty = true
  paint()
}
async function load() {
  ready = false
  const task = ++generation
  $('status').textContent = '准备作品…'
  try {
    await document.fonts.ready
    const image = new Image()
    image.src = '/artwork/' + $<HTMLSelectElement>('source').value
    await image.decode()
    if (task !== generation || disposed) return
    const mode = $<HTMLSelectElement>('mode').value as ArtMode
    const applicable = mode === 'density' || mode === 'color'
    const control = $<HTMLSelectElement>('quality')
    control.disabled = !applicable
    if (!applicable) control.value = 'classic'
    frame = prepareArtFrame(image, image.width, image.height, {
      mode,
      columns: 112,
      phrase: '把名字写成光，把故事留在画里。',
      fontFamily: mode === 'phrase' ? 'Microsoft YaHei, monospace' : 'Consolas, monospace',
      ...(applicable && control.value !== 'classic'
        ? { rasterQuality: 'high' as const, fontWeight: 600 as const }
        : {}),
      ...(applicable && control.value === 'software'
        ? { softwareRaster: true, colorFidelity: mode === 'color', fontWeight: 400 as const }
        : {}),
    })
    ready = true
    reset()
  } catch (error) {
    if (task === generation)
      $('status').textContent =
        `作品加载失败：${error instanceof Error ? error.message : String(error)}`
    throw error
  }
}
for (const id of ['source', 'mode', 'quality'])
  $(id).addEventListener('change', () => {
    void load().catch(() => {})
  })
$('strength').addEventListener('input', () => {
  strength = Number($<HTMLInputElement>('strength').value)
  $('amount').textContent = strength.toFixed(2)
  paint()
})
$('reset').addEventListener('click', reset)
$('focus').addEventListener('click', () => {
  focused = document.querySelector('.boards')!.classList.toggle('focused')
  $('focus').textContent = focused ? '并排对照' : '只看新效果'
  reset()
})
$('full').addEventListener('click', () => {
  const host = document.querySelector<HTMLElement>('.boards')!
  void (document.fullscreenElement ? document.exitFullscreen() : host.requestFullscreen()).catch(
    () => {
      $('status').textContent = '当前浏览器未允许全屏'
    },
  )
})
$('ambient').addEventListener('click', () => {
  wave = !wave
  ambient = 0
  $('ambient').setAttribute('aria-pressed', String(wave))
  paint()
})
$('pause').addEventListener('click', () => {
  paused = !paused
  $('pause').textContent = paused ? '播放环境' : '暂停环境'
})
$('download').addEventListener('click', () => {
  if (!ready) return
  const canvas = document.createElement('canvas'),
    renderer = createCanvasArtRenderer(canvas)
  renderer.render(frame, { longEdge: 2048, motion: 'none', hoverStrength: 0 })
  canvas.toBlob((blob) => {
    if (!blob) return
    const url = URL.createObjectURL(blob),
      a = document.createElement('a')
    a.href = url
    a.download = 'astra-glyph-study.png'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }, 'image/png')
  renderer.destroy()
})
function leave(time = performance.now()) {
  pointer = { ...pointer, active: false }
  samples.push({ ...pointer, time })
}
for (const canvas of canvases) {
  const move = (event: PointerEvent) => {
    if (event.pointerType === 'touch' && event.buttons === 0) return
    const rect = canvas.getBoundingClientRect(),
      coalesced = event.getCoalescedEvents?.()
    for (const e of coalesced?.length ? coalesced : [event]) {
      pointer = {
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
        active: true,
        strength,
      }
      samples.push({ ...pointer, time: e.timeStamp })
    }
    samples = samples.slice(-128)
  }
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId)
    move(e)
  })
  for (const event of ['pointerleave', 'pointerup', 'pointercancel', 'lostpointercapture'])
    canvas.addEventListener(event, (e) => leave(e.timeStamp))
}
const observer = new IntersectionObserver((entries) => {
  visible = entries.some((e) => e.isIntersecting)
  if (!visible) leave()
  previous = performance.now()
})
observer.observe(document.querySelector('.boards')!)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) leave()
  previous = performance.now()
})
reduced.addEventListener('change', reset)
function loop(now: number) {
  if (disposed) return
  const delta = Math.max(0, (now - previous) / 1000)
  previous = now
  if (!manual && !document.hidden && visible && ready) {
    clock = now / 1000
    if (!paused && !reduced.matches) ambient += delta
    if (
      dirty ||
      samples.length ||
      renderers.some((r) => r.interactionActive) ||
      presentation.stats.moving ||
      (wave && !paused && !reduced.matches)
    )
      paint()
  }
  requestAnimationFrame(loop)
}
await load()
requestAnimationFrame(loop)
Object.assign(window, {
  astraParticlesPrototype: {
    get ready() {
      return ready
    },
    get state() {
      return {
        clock,
        ambient,
        pointer,
        strength,
        mode: frame.settings.mode,
        stats: presentation.stats,
        timings: [...timings],
        paintCount,
        renderCounts: [...renderCounts],
      }
    },
    setManual(value: boolean) {
      manual = value
      previous = performance.now()
    },
    reset,
    tick(delta: number, events: ArtPointerSample[] = []) {
      clock += delta
      for (const event of events) {
        pointer = { ...event, strength }
        samples.push(event)
      }
      if (!paused && !reduced.matches) ambient += delta
      paint()
    },
    async setScene(source: string, mode: string, quality = 'classic') {
      $<HTMLSelectElement>('source').value = source
      $<HTMLSelectElement>('mode').value = mode
      $<HTMLSelectElement>('quality').value = quality
      await load()
    },
  },
})
window.addEventListener('pagehide', () => {
  disposed = true
  observer.disconnect()
  renderers.forEach((r) => r.destroy())
  presentation.destroy()
})
