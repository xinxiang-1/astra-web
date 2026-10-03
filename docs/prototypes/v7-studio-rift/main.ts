import {
  prepareArtFrame,
  type ArtFrame,
  type ArtMode,
  type ArtPointerSample,
} from '../../../src/lib/art-engine/index'
import { createCanvasArtRenderer as native } from '../../../scripts/fixtures/spatial-v6-renderer'
import { createCanvasArtRenderer } from '../../../src/lib/art-engine/canvas'
import { createRiftPresentation } from './presentation'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvases = [$<HTMLCanvasElement>('native'), $<HTMLCanvasElement>('rift')]
const presentation = createRiftPresentation()
let renderers = [
  native(canvases[0]!),
  createCanvasArtRenderer(canvases[1]!, { experimentalTrail: presentation.prepare }),
]
let frame: ArtFrame,
  ready = false,
  generation = 0,
  manual = false,
  visible = true,
  disposed = false
let strength = 0.65,
  clock = performance.now() / 1000,
  ambient = 0,
  wave = false,
  paused = false
let pointer = { x: 0.5, y: 0.5, active: false, strength },
  samples: ArtPointerSample[] = []
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
let previous = performance.now()
function paint() {
  if (!ready || disposed) return
  const start = performance.now()
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
  renderers.forEach((renderer) => renderer.render(frame, options))
  samples = []
  timings.push(performance.now() - start)
  if (timings.length > 180) timings.shift()
  $('status').textContent = reduced.matches
    ? '减少动效已启用'
    : pointer.active
      ? '两侧同步响应中'
      : renderers[1]!.interactionActive
        ? '余波正在复原'
        : '已归位 · 可以再次划动'
}
const timings: number[] = []
function reset() {
  renderers.forEach((renderer) => renderer.destroy())
  renderers = [
    native(canvases[0]!),
    createCanvasArtRenderer(canvases[1]!, { experimentalTrail: presentation.prepare }),
  ]
  pointer = { ...pointer, active: false }
  samples = []
  ambient = 0
  timings.length = 0
  paint()
}
async function load() {
  ready = false
  const task = ++generation
  await document.fonts.ready
  const image = new Image()
  image.src = '/artwork/' + $<HTMLSelectElement>('source').value
  await image.decode()
  if (task !== generation || disposed) return
  const mode = $<HTMLSelectElement>('mode').value as ArtMode
  const applicable = mode === 'density' || mode === 'color'
  const qualityControl = $<HTMLSelectElement>('quality')
  qualityControl.disabled = !applicable
  if (!applicable) qualityControl.value = 'classic'
  const quality = qualityControl.value
  frame = prepareArtFrame(image, image.width, image.height, {
    mode,
    columns: 112,
    phrase: '我爱你中国，光与影。',
    fontFamily: 'Microsoft YaHei, monospace',
    ...(applicable && quality !== 'classic'
      ? { rasterQuality: 'high' as const, fontWeight: 600 as const }
      : {}),
    ...(applicable && quality === 'software'
      ? { softwareRaster: true, colorFidelity: mode === 'color', fontWeight: 400 as const }
      : {}),
  })
  ready = true
  reset()
}
for (const id of ['source', 'mode', 'quality'])
  $(id).addEventListener('change', () => {
    void load()
  })
$('strength').addEventListener('input', () => {
  strength = Number($<HTMLInputElement>('strength').value)
  $('amount').textContent = strength.toFixed(2)
  paint()
})
$('reset').addEventListener('click', reset)
$('focus').addEventListener('click', () => {
  const focused = document.querySelector('.boards')!.classList.toggle('focused')
  $('focus').textContent = focused ? '并排对照' : '只看新效果'
})
$('full').addEventListener('click', () => {
  const host = document.querySelector<HTMLElement>('.boards')!
  void (document.fullscreenElement ? document.exitFullscreen() : host.requestFullscreen())
})
$('ambient').addEventListener('click', () => {
  wave = !wave
  $('ambient').setAttribute('aria-pressed', String(wave))
  ambient = 0
  paint()
})
$('pause').addEventListener('click', () => {
  paused = !paused
  $('pause').textContent = paused ? '播放环境' : '暂停环境'
})
function leave() {
  pointer = { ...pointer, active: false }
  samples.push({ ...pointer, time: performance.now() })
}
for (const canvas of canvases) {
  const move = (event: PointerEvent) => {
    if (event.pointerType === 'touch' && event.buttons === 0) return
    const rect = canvas.getBoundingClientRect()
    const coalesced = event.getCoalescedEvents?.()
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
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId)
    move(event)
  })
  for (const event of ['pointerleave', 'pointerup', 'pointercancel', 'lostpointercapture'])
    canvas.addEventListener(event, leave)
}
const observer = new IntersectionObserver((entries) => {
  visible = entries.some((entry) => entry.isIntersecting)
  if (!visible) leave()
  previous = performance.now()
})
observer.observe(document.querySelector('.boards')!)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) leave()
  previous = performance.now()
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && document.fullscreenElement) void document.exitFullscreen()
})
reduced.addEventListener('change', reset)
function loop(now: number) {
  if (disposed) return
  const delta = Math.max(0, (now - previous) / 1000)
  previous = now
  if (!manual && !document.hidden && visible) {
    clock = now / 1000
    if (!paused && !reduced.matches) ambient += delta
    paint()
  }
  requestAnimationFrame(loop)
}
await load()
requestAnimationFrame(loop)
Object.assign(window, {
  astraRiftPrototype: {
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
      }
    },
    get fields() {
      return (renderers[1] as ReturnType<typeof createCanvasArtRenderer>).sampleFluidField(0.5, 0.5)
    },
    setManual: (value: boolean) => {
      manual = value
      previous = performance.now()
    },
    reset,
    tick: (delta: number, events: ArtPointerSample[] = []) => {
      clock += delta
      for (const sample of events) {
        pointer = { ...sample, strength }
        samples.push(sample)
      }
      if (!paused && !reduced.matches) ambient += delta
      paint()
    },
    setScene: async (source: string, mode: string, quality = 'classic') => {
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
  renderers.forEach((renderer) => renderer.destroy())
})
