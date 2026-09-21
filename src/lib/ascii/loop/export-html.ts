import type { DominantColor } from './color'

export type LoopHtmlFrame = {
  text: string
}

export type BuildLoopHtmlOptions = {
  frames: LoopHtmlFrame[]
  fps: number
  color: DominantColor
  foreground?: string
  background?: string
  title?: string
}

/** Self-contained HTML: cycling <pre> frames (flow already baked into glyphs). */
export function buildLoopHtmlSnippet(options: BuildLoopHtmlOptions): string {
  const fps = Math.max(6, Math.min(12, options.fps))
  const frames = options.frames.map((f) => f.text)
  const payload = JSON.stringify(frames)
  const fg = options.foreground ?? '#e8eeff'
  const bg = options.background ?? '#070a12'
  const title = options.title ?? 'ascii-loop'

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: ${bg}; font-family: ui-monospace, Consolas, monospace; }
  pre { margin: 0; padding: 16px; color: ${fg};
    font: 11px/1.15 ui-monospace, Consolas, monospace;
    white-space: pre; background: transparent; }
</style>
</head>
<body>
<pre id="out"></pre>
<script>
const frames = ${payload};
const fps = ${fps};
const out = document.getElementById('out');
let i = 0;
function tick() {
  out.textContent = frames[i % frames.length] || '';
  i += 1;
}
tick();
setInterval(tick, Math.round(1000 / fps));
</script>
</body>
</html>
`
}

export function loopHtmlToBlob(html: string): Blob {
  return new Blob([html], { type: 'text/html;charset=utf-8' })
}
