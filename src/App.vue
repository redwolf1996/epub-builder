<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider, NButton, darkTheme, zhCN, dateZhCN, enUS, dateEnUS } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useBookStore } from '@/stores/book'
import ThemeSwitcher from '@/components/common/ThemeSwitcher.vue'

import { isTauri } from '@/utils/epub'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const bookStore = useBookStore()
const { t, locale } = useI18n()

const isHome = computed(() => route.path === '/')
const bookTitle = computed(() => {
  if (isHome.value) return ''
  return bookStore.activeBook?.meta.title || ''
})

// 动态窗口标题
const windowTitle = computed(() => {
  const base = 'EPUB Builder'
  if (isHome.value) return base
  const title = bookTitle.value
  if (route.path.includes('/settings')) return title ? `${base} — ${title} · ${t('settings.title')}` : base
  if (route.path.includes('/editor')) return title ? `${base} — ${title}` : base
  return base
})

watch(windowTitle, (title) => {
  document.title = title
  if (isTauri()) {
    import('@tauri-apps/api/window').then(({ getCurrentWindow }) => {
      getCurrentWindow().setTitle(title)
    }).catch(() => {})
  }
}, { immediate: true })

// 原生菜单事件监听 + 动态创建
let menuUnlisten: (() => void) | null = null

async function buildNativeMenu() {
  if (!isTauri()) return
  try {
    const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu')

    const fileMenu = await Submenu.new({
      text: t('menu.file'),
      items: [
        await MenuItem.new({ id: 'new_book', text: t('menu.newBook') }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({ id: 'export_epub', text: t('menu.exportEpub') }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Quit', text: t('menu.quit') }),
      ],
    })

    const editMenu = await Submenu.new({
      text: t('menu.edit'),
      items: [
        await PredefinedMenuItem.new({ item: 'Undo', text: t('menu.undo') }),
        await PredefinedMenuItem.new({ item: 'Redo', text: t('menu.redo') }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Cut', text: t('menu.cut') }),
        await PredefinedMenuItem.new({ item: 'Copy', text: t('menu.copy') }),
        await PredefinedMenuItem.new({ item: 'Paste', text: t('menu.paste') }),
        await PredefinedMenuItem.new({ item: 'SelectAll', text: t('menu.selectAll') }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({ id: 'find_replace', text: t('menu.findReplace') }),
      ],
    })

    const viewMenu = await Submenu.new({
      text: t('menu.view'),
      items: [
        await MenuItem.new({ id: 'toggle_theme', text: t('menu.toggleTheme') }),
        await MenuItem.new({ id: 'toggle_fullscreen', text: t('menu.toggleFullscreen') }),
        await MenuItem.new({ id: 'toggle_scroll_sync', text: t('menu.toggleScrollSync') }),
      ],
    })

    const helpMenu = await Submenu.new({
      text: t('menu.help'),
      items: [
        await MenuItem.new({ id: 'about', text: t('menu.about') }),
      ],
    })

    const menu = await Menu.new({ items: [fileMenu, editMenu, viewMenu, helpMenu] })
    await menu.setAsAppMenu()
  } catch {}
}

onMounted(async () => {
  if (!isTauri()) return
  try {
    const { listen } = await import('@tauri-apps/api/event')
    menuUnlisten = await listen<string>('menu-event', (event) => {
      switch (event.payload) {
        case 'new_book':
          if (!isHome.value) router.push('/')
          break
        case 'export_epub':
          window.dispatchEvent(new CustomEvent('menu-export'))
          break
        case 'find_replace':
          window.dispatchEvent(new CustomEvent('menu-find-replace'))
          break
        case 'toggle_theme': {
          const themes: Array<'light' | 'dark' | 'parchment'> = ['light', 'dark', 'parchment']
          const idx = themes.indexOf(themeStore.theme as 'light' | 'dark' | 'parchment')
          themeStore.setTheme(themes[(idx + 1) % themes.length])
          break
        }
        case 'toggle_fullscreen':
          window.dispatchEvent(new CustomEvent('menu-fullscreen'))
          break
        case 'toggle_scroll_sync':
          window.dispatchEvent(new CustomEvent('menu-scroll-sync'))
          break
        case 'about':
          window.dispatchEvent(new CustomEvent('menu-about'))
          break
      }
    })
    await buildNativeMenu()
  } catch {}
})

// 语言切换时重建菜单
watch(locale, () => {
  buildNativeMenu()
})

onBeforeUnmount(() => {
  menuUnlisten?.()
})

const toggleLocale = () => {
  const newLocale = locale.value === 'zh-CN' ? 'en' : 'zh-CN'
  locale.value = newLocale
  localStorage.setItem('locale', newLocale)
}

const naiveTheme = computed(() => {
  return themeStore.theme === 'light' || themeStore.theme === 'parchment' ? null : darkTheme
})

const naiveLocale = computed(() => {
  const l = locale.value
  return l === 'zh-CN' ? zhCN : enUS
})
const naiveDateLocale = computed(() => {
  const l = locale.value
  return l === 'zh-CN' ? dateZhCN : dateEnUS
})

const themeOverrides = computed<GlobalThemeOverrides>(() => {
  const isDark = themeStore.theme === 'dark'
  const primary = isDark ? '#6c63ff' : themeStore.theme === 'parchment' ? '#8b6914' : '#5b54e0'
  const primaryHover = isDark ? '#8b83ff' : themeStore.theme === 'parchment' ? '#a8841e' : '#7b74ff'
  const bgCard = isDark ? '#16213e' : themeStore.theme === 'parchment' ? '#faf0d7' : '#ffffff'
  const border = isDark ? '#2a2a4a' : themeStore.theme === 'parchment' ? '#d4c49a' : '#d8d8e8'

  return {
    common: {
      primaryColor: primary,
      primaryColorHover: primaryHover,
      primaryColorPressed: primary,
      borderRadius: '4px',
    },
    Card: {
      color: bgCard,
      borderColor: border,
    },
    Button: {
      colorPrimary: primary,
      colorHoverPrimary: primaryHover,
    },
  }
})

const handleCreateBook = () => {
  router.push({ path: '/', query: { create: '1' } })
}
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="naiveLocale" :date-locale="naiveDateLocale">
    <NMessageProvider>
      <NDialogProvider>
        <div class="app-shell h-screen flex flex-col">
          <header class="app-header flex items-center justify-between px-4 py-2 shrink-0">
            <div class="flex items-center gap-2">
              <span class="i-carbon-book text-lg" style="color: var(--primary)" />
              <span class="font-bold text-sm" style="color: var(--text-primary)">{{ t('app.title') }}</span>
              <template v-if="bookTitle">
                <span class="i-carbon-chevron-right text-xs" style="color: var(--text-muted)" />
                <span class="book-title-tag">
                  <span class="i-carbon-document text-xs" />
                  <span>{{ bookTitle }}</span>
                </span>
              </template>
            </div>
            <div class="flex items-center gap-2">
              <NButton v-if="isHome" type="primary" size="small" @click="handleCreateBook">
                <template #icon>
                  <span class="i-carbon-add" />
                </template>
                {{ t('app.createBook') }}
              </NButton>
              <NButton quaternary size="tiny" @click="toggleLocale">
                <span class="text-xs font-bold">{{ locale === 'zh-CN' ? 'EN' : '中' }}</span>
              </NButton>
              <ThemeSwitcher />
            </div>
          </header>
          <div class="flex-1 min-h-0 overflow-hidden">
            <RouterView v-slot="{ Component }">
              <Transition name="page-fade" mode="out-in">
                <component :is="Component" />
              </Transition>
            </RouterView>
          </div>
        </div>
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style>
.app-header {
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-color);
  backdrop-filter: blur(12px);
  z-index: 10;
}

.book-title-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8125rem;
  font-weight: 700;
  color: var(--primary);
  background: var(--bg-active);
  padding: 2px 10px;
  border-radius: 4px;
  border: 1px solid var(--primary);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page-fade-enter-active,
.page-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.page-fade-enter-from {
  opacity: 0;
  transform: translateY(3px);
}

.page-fade-leave-to {
  opacity: 0;
  transform: translateY(-3px);
}
</style>
