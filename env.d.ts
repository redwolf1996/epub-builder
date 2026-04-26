/// <reference types="vite/client" />

declare const __BUILD_TIME__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

interface Window {
  __TAURI_INTERNALS__?: unknown
}
