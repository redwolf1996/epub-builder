import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      path: 'path-browserify',
      fs: fileURLToPath(new URL('./src/utils/fs-browser.ts', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
  },
})
