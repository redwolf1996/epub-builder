import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export type ThemeName = 'dark' | 'light' | 'parchment'

const THEME_KEY = 'epub-builder-theme'

export const useThemeStore = defineStore('theme', () => {
  const saved = localStorage.getItem(THEME_KEY) as ThemeName | null
  const theme = ref<ThemeName>(saved || 'dark')

  watch(theme, (val) => {
    localStorage.setItem(THEME_KEY, val)
    applyTheme(val)
  })

  function applyTheme(name: ThemeName) {
    const root = document.documentElement
    root.setAttribute('data-theme', name)
  }

  // 初始化时立即应用
  applyTheme(theme.value)

  function setTheme(name: ThemeName) {
    theme.value = name
  }

  function cycleTheme() {
    const order: ThemeName[] = ['dark', 'light', 'parchment']
    const idx = order.indexOf(theme.value)
    theme.value = order[(idx + 1) % order.length]
  }

  return { theme, setTheme, cycleTheme }
})
