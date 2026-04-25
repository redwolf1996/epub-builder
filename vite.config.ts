import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import unocss from 'unocss/vite'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue(), unocss()],
  server: {
    port: 7788,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      path: 'path-browserify',
      fs: fileURLToPath(new URL('./src/utils/fs-browser.ts', import.meta.url)),
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('codemirror') || id.includes('@codemirror')) {
              return 'codemirror'
            }
            if (id.includes('highlight.js')) {
              return 'highlightjs'
            }
            if (id.includes('epub-gen-memory')) {
              return 'epub-gen'
            }
            if (id.includes('naive-ui') || id.includes('date-fns') || id.includes('evtd') || id.includes('css-render') || id.includes('treemate') || id.includes('vooks') || id.includes('vdirs')) {
              return 'naive-ui'
            }
            if (id.includes('vue') || id.includes('pinia') || id.includes('vue-router') || id.includes('vue-i18n')) {
              return 'vue-vendor'
            }
          }
        },
      },
    },
  },
})
