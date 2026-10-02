import { prepareArtFrame } from '../../../src/lib/art-engine/index'
import { createCanvasArtRenderer as baseline } from '../../../scripts/fixtures/depth-v3-renderer'
import { createCanvasArtRenderer as candidate } from '../../../src/lib/art-engine/canvas'
const motions = [
  ['breathe', '弹性冲击', '冲击前沿推开字符，反向余波回弹，主体保持可辨识。'],
  ['wave', '液态绸面', '连续流线带动画面，折痕反光跟随运动，不让人脸局部鼓包。'],
  ['assemble', '流束显影', '字符沿弯曲流束从画面侧边汇入，顺序落位，停留展示完整作品。'],
  ['current', '双涡流动', '两个相反方向的流场缓缓穿过作品，局部细节由 Studio 底座驱动。'],
  ['reform', '爆散回弹', '原作字符向外爆散，沿原路径带回弹重组，之后完整停留。'],
  ['caustics', '流光折射', '连续交叠焦散沿原作笔画流动，窄亮边与暗部形成材质层次。'],
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
