import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import unocss from 'unocss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string
}

const matchesPackage = (id: string, pkg: string) => {
  return id.includes(`/node_modules/${pkg}/`)
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [vue(), unocss()],
  server: {
    host: '127.0.0.1',
    port: 3401,
    strictPort: true,
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
            if (
              matchesPackage(id, 'vue')
              || matchesPackage(id, 'pinia')
              || matchesPackage(id, 'vue-router')
              || matchesPackage(id, 'vue-i18n')
            ) {
              return 'vue-vendor'
            }
          }
        },
      },
    },
  },
})
