import { fileURLToPath, URL } from 'node:url'

import { fileViewerRenderers } from '@file-viewer/vite-plugin'
import { wgslVitePlugin } from '@vgpu/wgsl/loader-vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
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
})
