import type { StudioSettings } from 'asciify-engine/studio'

/** Standalone page that remounts the current Studio look. */
export function asciiLivePage(settings: StudioSettings, ratio: number) {
  const settingsJson = JSON.stringify(settings, null, 2).replace(/</g, '\\u003c')
  const open = '<' + 'script type="module">'
  const close = '<' + '/script>'
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>动态字符</title>
<style>
  html, body { margin: 0; background: #0a0a0a; color: #eee; font: 14px/1.4 system-ui, sans-serif; }
  .bar { display: flex; gap: 12px; align-items: center; padding: 12px 16px; }
  .stage { width: min(100%, calc((100vh - 4.5rem) * ${ratio})); max-height: calc(100vh - 4.5rem); aspect-ratio: ${ratio}; margin-inline: auto; background: #0a0a0a; }
  canvas { display: block; width: 100%; height: 100%; }
  input { color: inherit; }
</style>
</head>
<body>
  <div class="bar">
    <label>图片 / 视频 <input id="file" type="file" accept="image/*,video/mp4,video/webm,video/quicktime,.gif" /></label>
    <span id="status">选择素材后按当前参数渲染</span>
  </div>
  <div class="stage" id="stage"><canvas id="art"></canvas></div>
  ${open}
    import { mountStudio } from 'https://esm.sh/asciify-engine@4.1.0/studio'
    const settings = ${settingsJson}
    const canvas = document.querySelector('#art')
    const stage = document.querySelector('#stage')
    const status = document.querySelector('#status')
    let studio = null
    function fit() {
      if (!studio) return
      const rect = stage.getBoundingClientRect()
      const dpr = Math.min(devicePixelRatio || 1, 2, 1920 / Math.max(rect.width, rect.height))
      studio.resize(Math.round(rect.width * dpr), Math.round(rect.height * dpr), dpr)
    }
    async function mount(source) {
      studio?.destroy()
      status.textContent = '加载中…'
      studio = await mountStudio(canvas, source, {
        settings,
        adaptive: false,
        maxDimension: 1920,
        maxCells: 120000,
      })
      const media = studio.media
      if (settings.aspectRatio === 'original' && media.width && media.height) {
        const ratio = media.width / media.height
        stage.style.aspectRatio = String(ratio)
        stage.style.width = 'min(100%, calc((100vh - 4.5rem) * ' + ratio + '))'
      }
      new ResizeObserver(fit).observe(stage)
      fit()
      status.textContent = '在画面上移动鼠标'
    }
    document.querySelector('#file').addEventListener('change', (event) => {
      const file = event.target.files && event.target.files[0]
      if (file) mount(file).catch((error) => { status.textContent = error.message })
    })
  ${close}
</body>
</html>
`
}
