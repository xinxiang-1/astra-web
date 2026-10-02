import { prepareArtFrame } from '../../../src/lib/art-engine/index'
import { createCanvasArtRenderer as baseline } from '../../../scripts/fixtures/kinetic-v2-renderer'
import { createCanvasArtRenderer as candidate } from '../../../src/lib/art-engine/canvas'
const motions = [
  ['breathe', '共振脉冲', '字符随冲击环向外舒展，近处抬起，后方余波收束。'],
  ['wave', '悬浮波面', '整幅作品成为悬浮曲面，前后透视与波峰光影一起移动。'],
  ['assemble', '星云聚像', '原作字符沿螺旋轨道穿梭，由远及近落位，最终完整呈现。'],
  ['current', '轨道流场', '作品沿连续轨道扭转起伏，原生 Studio 流场提供局部细节。'],
  ['reform', '层片解构', '完整字符片层错开进入前后空间，再顺滑归位停留。'],
  ['caustics', '棱镜扫光', '窄光束放大沿途真实笔画，折射推移与暗影随光线扫过。'],
] as const
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvases = ['studio', 'baseline', 'candidate'].map((id) => $<HTMLCanvasElement>(id))
const renderers = [baseline(canvases[0]!), baseline(canvases[1]!), candidate(canvases[2]!)]
let frame: ReturnType<typeof prepareArtFrame>,
  motion = 'wave',
  time = 0,
  strength = 0.65
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches,
  previous = performance.now(),
  generation = 0
let pointer = { x: 0.5, y: 0.5, strength: 0.65, active: false },
  samples: { x: number; y: number; time: number; active: boolean }[] = []
let ready = false
for (const [id, label] of motions) {
  const button = document.createElement('button')
  button.textContent = label
  button.dataset.motion = id
  button.addEventListener('click', () => select(id))
  $('motions').append(button)
}
function select(id: string) {
  motion = id
  time = 0
  for (const el of document.querySelectorAll<HTMLButtonElement>('[data-motion]'))
    el.setAttribute('aria-pressed', String(el.dataset.motion === id))
  $('description').textContent = motions.find((item) => item[0] === id)?.[2] ?? ''
}
function draw() {
  if (!ready) return
  const options = {
    longEdge: 620,
    effectProfile: 'expressive',
    motion,
    time,
    motionStrength: strength,
    hover: 'trail',
    hoverTime: performance.now() / 1000,
    hoverStrength: 0.65,
    hoverRadius: 0.38,
    pointer,
    pointerSamples: samples,
  }
  renderers.forEach((renderer, i) =>
    renderer.render(frame, {
      ...options,
      motionStyle: i === 0 ? 'studio' : 'cinematic',
    } as Parameters<typeof renderer.render>[1]),
  )
  samples = []
  $<HTMLInputElement>('seek').value = String(time % 12)
  $('time').textContent = time.toFixed(2) + 's'
}
async function load() {
  ready = false
  const task = ++generation
  await document.fonts.ready
  const image = new Image()
  image.src = '/artwork/' + $<HTMLSelectElement>('source').value
  await image.decode()
  if (task !== generation) return
  frame = prepareArtFrame(image, image.width, image.height, {
    mode: $<HTMLSelectElement>('mode').value as 'density',
    columns: 120,
    phrase: '我爱你中国，光与影。',
    fontFamily: 'Microsoft YaHei, monospace',
  })
  ready = true
  time = 0
  draw()
}
for (const id of ['source', 'mode']) $(id).addEventListener('change', load)
$('pause').addEventListener('click', () => {
  paused = !paused
  $('pause').textContent = paused ? '播放' : '暂停'
})
$('restart').addEventListener('click', () => {
  time = 0
  draw()
})
$('strength').addEventListener('input', () => {
  strength = Number($<HTMLInputElement>('strength').value)
  $('amount').textContent = strength.toFixed(2)
  draw()
})
$('seek').addEventListener('input', () => {
  paused = true
  $('pause').textContent = '播放'
  time = Number($<HTMLInputElement>('seek').value)
  draw()
})
for (const canvas of canvases) {
  const move = (event: PointerEvent) => {
    if (event.pointerType === 'touch' && event.buttons === 0) return
    const rect = canvas.getBoundingClientRect()
    for (const e of event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event]) {
      pointer = {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
        strength: 0.65,
        active: true,
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
  const leave = () => {
    pointer = { ...pointer, active: false }
    samples.push({ ...pointer, time: performance.now() })
  }
  canvas.addEventListener('pointerleave', leave)
  canvas.addEventListener('pointerup', leave)
  canvas.addEventListener('pointercancel', leave)
}
function loop(now: number) {
  const delta = Math.max(0, (now - previous) / 1000)
  previous = now
  if (!document.hidden) {
    if (!paused) time += delta
    draw()
  }
  requestAnimationFrame(loop)
}
document.addEventListener('visibilitychange', () => {
  previous = performance.now()
})
$('pause').textContent = paused ? '播放' : '暂停'
select(motion)
await load()
requestAnimationFrame(loop)
Object.assign(window, {
  astraMotionPrototype: {
    select,
    seek: (next: number) => {
      paused = true
      $('pause').textContent = '播放'
      time = next
      draw()
    },
    play: () => {
      paused = false
      $('pause').textContent = '暂停'
      previous = performance.now()
    },
    setScene: async (source: string, mode: string) => {
      $<HTMLSelectElement>('source').value = source
      $<HTMLSelectElement>('mode').value = mode
      await load()
    },
    get ready() {
      return ready
    },
    get state() {
      return { motion, time, strength, mode: frame.settings.mode }
    },
  },
})
window.addEventListener('pagehide', () => renderers.forEach((renderer) => renderer.destroy()))
