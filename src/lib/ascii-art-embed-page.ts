import type { StudioSettings } from 'asciify-engine/studio'
import { PREVIEW_MONO_FONT } from '@/lib/ascii/constants'

/** Standalone embed page: Studio ASCII + hover/motion + Consolas (matches AsciiArt preview). */
export function asciiArtEmbedPage(options: {
  settings: StudioSettings
  ratio: number
  /** When set, mounts immediately without a file picker. */
  dataUrl?: string
  title?: string
  /** Canvas glyph stack; defaults to AsciiArt preview Consolas stack. */
  fontFamily?: string
}) {
  const settingsJson = JSON.stringify(options.settings, null, 2).replace(
    /</g,
    '\\u003c',
  )
  const dataUrlJson = options.dataUrl
    ? JSON.stringify(options.dataUrl).replace(/</g, '\\u003c')
    : 'null'
  const fontJson = JSON.stringify(
    options.fontFamily?.trim() || PREVIEW_MONO_FONT,
  ).replace(/</g, '\\u003c')
  const ratio = options.ratio > 0 ? options.ratio : 1
  const title = (options.title || '字符画动效').replace(/</g, '')
  const open = '<' + 'script type="module">'
  const close = '<' + '/script>'
  const hasMedia = Boolean(options.dataUrl)

  const hover = options.settings.hover?.effect ?? 'none'
  const motion = options.settings.motion?.type ?? 'none'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  html, body { margin: 0; background: #0a0a0a; color: #eee; font: 14px/1.4 system-ui, sans-serif; }
  .bar {
    display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center;
    padding: 12px 16px; border-bottom: 1px solid #222;
  }
  .bar label { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; color: #c8c8c8; }
  .bar select, .bar input[type="file"] { color: inherit; background: #141414; border: 1px solid #333; border-radius: 6px; padding: 4px 8px; }
  .stage {
    width: min(100%, calc((100vh - 5.5rem) * ${ratio}));
    max-height: calc(100vh - 5.5rem);
    aspect-ratio: ${ratio};
    margin-inline: auto;
    background: #0a0a0a;
  }
  canvas { display: block; width: 100%; height: 100%; touch-action: none; }
  .hint { color: #9a9a9a; font-size: 12px; }
  #status { font-size: 13px; color: #bdbdbd; }
</style>
</head>
<body>
  <div class="bar">
    ${
      hasMedia
        ? '<span id="status">加载中…</span>'
        : '<label>图片 / 视频 <input id="file" type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.gif" /></label><span id="status">选择素材后按当前参数渲染</span>'
    }
    <label>悬停
      <select id="hover">
        <option value="trail"${hover === 'trail' ? ' selected' : ''}>拖尾</option>
        <option value="water"${hover === 'water' ? ' selected' : ''}>水面</option>
        <option value="silk"${hover === 'silk' ? ' selected' : ''}>丝绸</option>
        <option value="vortex"${hover === 'vortex' ? ' selected' : ''}>漩涡</option>
        <option value="contour"${hover === 'contour' ? ' selected' : ''}>等高</option>
        <option value="dissolve"${hover === 'dissolve' ? ' selected' : ''}>溶解</option>
        <option value="none"${hover === 'none' ? ' selected' : ''}>关闭</option>
      </select>
    </label>
    <label>微动
      <select id="motion">
        <option value="current"${motion === 'current' ? ' selected' : ''}>慢流</option>
        <option value="reform"${motion === 'reform' ? ' selected' : ''}>重组</option>
        <option value="caustics"${motion === 'caustics' ? ' selected' : ''}>光斑</option>
        <option value="none"${motion === 'none' ? ' selected' : ''}>关闭</option>
      </select>
    </label>
    ${
      hasMedia
        ? '<label class="hint">替换 <input id="file" type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.gif" /></label>'
        : ''
    }
    <span class="hint">在画面上移动鼠标 · 字体 Consolas</span>
  </div>
  <div class="stage" id="stage"><canvas id="art"></canvas></div>
  ${open}
    // Match AsciiArt static preview: engine CDN hardcodes \`monospace\` (often Courier).
    const PREVIEW_FONT = ${fontJson}
    ;(function patchCanvasFont() {
      const desc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'font')
      if (!desc || !desc.get || !desc.set) return
      Object.defineProperty(CanvasRenderingContext2D.prototype, 'font', {
        configurable: true,
        enumerable: desc.enumerable,
        get() { return desc.get.call(this) },
        set(value) {
          if (typeof value === 'string' && !/Consolas/i.test(value)) {
            value = value.replace(/\\bmonospace\\b/, PREVIEW_FONT)
          }
          desc.set.call(this, value)
        },
      })
    })()

    import { mountStudio } from 'https://esm.sh/asciify-engine@4.1.0/studio'
    const settings = ${settingsJson}
    const baked = ${dataUrlJson}
    const canvas = document.querySelector('#art')
    const stage = document.querySelector('#stage')
    const status = document.querySelector('#status')
    const hoverEl = document.querySelector('#hover')
    const motionEl = document.querySelector('#motion')
    let studio = null

    function readEffects() {
      return {
        hover: {
          effect: hoverEl.value,
          strength: settings.hover?.strength ?? 0.65,
          radius: settings.hover?.radius ?? 0.38,
          edgeSafe: settings.hover?.edgeSafe ?? false,
        },
        motion: {
          type: motionEl.value,
          speed: settings.motion?.speed ?? 0.45,
        },
      }
    }

    function fit() {
      if (!studio) return
      const rect = stage.getBoundingClientRect()
      const dpr = Math.min(devicePixelRatio || 1, 2, 1920 / Math.max(rect.width, rect.height))
      studio.resize(Math.round(rect.width * dpr), Math.round(rect.height * dpr), dpr)
    }

    function syncStatus() {
      const h = hoverEl.value
      const m = motionEl.value
      const parts = []
      if (h !== 'none') parts.push('悬停 ' + hoverEl.selectedOptions[0].textContent)
      if (m !== 'none') parts.push('微动 ' + motionEl.selectedOptions[0].textContent)
      status.textContent = parts.length
        ? parts.join(' · ') + ' · 在画面上移动鼠标'
        : '已加载（悬停/微动已关闭）'
    }

    async function mount(source) {
      studio?.destroy()
      status.textContent = '加载中…'
      const effects = readEffects()
      studio = await mountStudio(canvas, source, {
        settings: { ...settings, ...effects },
        adaptive: false,
        maxDimension: 1920,
        maxCells: 180000,
      })
      const media = studio.media
      if (settings.aspectRatio === 'original' && media.width && media.height) {
        const next = media.width / media.height
        stage.style.aspectRatio = String(next)
        stage.style.width = 'min(100%, calc((100vh - 5.5rem) * ' + next + '))'
      }
      new ResizeObserver(fit).observe(stage)
      fit()
      syncStatus()
    }

    function patchEffects() {
      if (!studio) return
      studio.update(readEffects())
      syncStatus()
    }

    hoverEl.addEventListener('change', patchEffects)
    motionEl.addEventListener('change', patchEffects)

    const file = document.querySelector('#file')
    if (file) {
      file.addEventListener('change', (event) => {
        const picked = event.target.files && event.target.files[0]
        if (picked) mount(picked).catch((error) => { status.textContent = error.message })
      })
    }
    if (baked) {
      mount(baked).catch((error) => { status.textContent = error.message })
    }
  ${close}
</body>
</html>
`
}
