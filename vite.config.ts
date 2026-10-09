import { fileURLToPath, URL } from 'node:url'

import { fileViewerRenderers } from '@file-viewer/vite-plugin'
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { defineConfig, type Plugin } from 'vite'

/**
 * asciify-engine hardcodes `px monospace` for glyph fillText.
 * On Windows that often resolves to Courier New, while AsciiArt static
 * preview uses Consolas — hover/motion then looks like a different face.
 * Rewrite to the same stack as PREVIEW_MONO_FONT (single quotes so both
 * template literals and "…" string concat stay valid).
 */
function asciifyEnginePreviewFont(): Plugin {
  const from = 'px monospace'
  const to = "px Consolas, 'Cascadia Mono', 'Courier New', monospace"
  return {
    name: 'asciify-engine-preview-font',
    enforce: 'pre',
    transform(code, id) {
      const norm = id.replace(/\\/g, '/')
      if (!norm.includes('/asciify-engine/')) return null
      if (!code.includes(from)) return null
      return { code: code.replaceAll(from, to), map: null }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode, isPreview }) => {
  const portIndex = process.argv.indexOf('--port')
  const port =
    process.argv.find((arg) => arg.startsWith('--port='))?.slice(7) ??
    (portIndex >= 0 ? process.argv[portIndex + 1] : undefined) ??
    '5173'
  const cacheScope = `${isPreview ? 'preview' : command}-${mode}-${/^\d+$/.test(port) ? port : '5173'}`
  return {
    // Concurrent dev servers and SSR contracts must not replace each other's optimized modules.
    cacheDir: process.env.ASTRA_VITE_CACHE_DIR || `node_modules/.vite-astra/${cacheScope}`,
    plugins: [
      asciifyEnginePreviewFont(),
      vue(),
      vueDevTools(),
      wgslVitePlugin(),
      fileViewerRenderers({
        copyAssets: true,
        chunkStrategy: 'renderer',
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // Ensure Studio/core go through the font transform (not a stale prebundle).
    optimizeDeps: {
      include: ['webgl-fluid'],
      exclude: ['asciify-engine'],
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8080',
          changeOrigin: true,
        },
      },
    },
  }
})
