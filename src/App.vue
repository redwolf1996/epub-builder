<script setup lang="ts">
  import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
  import { NConfigProvider, NMessageProvider, NDialogProvider, NButton, NModal, darkTheme, zhCN, dateZhCN, enUS, dateEnUS } from 'naive-ui'
  import type { GlobalThemeOverrides } from 'naive-ui'
  import { useRoute, useRouter } from 'vue-router'
  import { useI18n } from 'vue-i18n'
  import { useThemeStore } from '@/stores/theme'
  import { useBookStore } from '@/stores/book'
  import ThemeSwitcher from '@/components/common/ThemeSwitcher.vue'

  import { isTauri } from '@/utils/export'

  const route = useRoute()
  const router = useRouter()
  const themeStore = useThemeStore()
  const bookStore = useBookStore()
  const { t, locale } = useI18n()
  const MENU_VISIBLE_KEY = 'epub-builder-menu-visible'
  type NativeMenuHandles = {
    fileMenu: import('@tauri-apps/api/menu').Submenu
    editMenu: import('@tauri-apps/api/menu').Submenu
    viewMenu: import('@tauri-apps/api/menu').Submenu
    helpMenu: import('@tauri-apps/api/menu').Submenu
    newBookItem: import('@tauri-apps/api/menu').MenuItem
    quitItem: import('@tauri-apps/api/menu').PredefinedMenuItem
    undoItem: import('@tauri-apps/api/menu').PredefinedMenuItem
    redoItem: import('@tauri-apps/api/menu').PredefinedMenuItem
    cutItem: import('@tauri-apps/api/menu').PredefinedMenuItem
    copyItem: import('@tauri-apps/api/menu').PredefinedMenuItem
    pasteItem: import('@tauri-apps/api/menu').PredefinedMenuItem
    selectAllItem: import('@tauri-apps/api/menu').PredefinedMenuItem
    exportEpubItem: import('@tauri-apps/api/menu').MenuItem
    exportPdfItem: import('@tauri-apps/api/menu').MenuItem
    exportMarkdownItem: import('@tauri-apps/api/menu').MenuItem
    exportWordItem: import('@tauri-apps/api/menu').MenuItem
    findReplaceItem: import('@tauri-apps/api/menu').MenuItem
    toggleThemeItem: import('@tauri-apps/api/menu').MenuItem
    appFullscreenItem: import('@tauri-apps/api/menu').MenuItem
    toggleScrollSyncItem: import('@tauri-apps/api/menu').MenuItem
    aboutItem: import('@tauri-apps/api/menu').MenuItem
  }

  const isHome = computed(() => route.path === '/')
  const isEditor = computed(() => route.path.includes('/editor'))
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
      }).catch(() => { })
    }
  }, { immediate: true })

  // 原生菜单事件监听 + 动态创建
  let menuUnlisten: (() => void) | null = null
  let menuVisible = true
  let nativeMenuHandles: NativeMenuHandles | null = null

  const getStoredMenuVisible = () => {
    if (!isTauri()) return true
    return localStorage.getItem(MENU_VISIBLE_KEY) !== 'false'
  }

  const setStoredMenuVisible = (visible: boolean) => {
    menuVisible = visible
    if (!isTauri()) return
    localStorage.setItem(MENU_VISIBLE_KEY, String(visible))
  }

  async function buildNativeMenu() {
    if (!isTauri()) return
    try {
      const { Menu, Submenu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu')

      const exportEpubItem = await MenuItem.new({ id: 'export_epub', text: t('menu.exportEpub'), accelerator: 'Ctrl+E' })
      const exportPdfItem = await MenuItem.new({ id: 'export_pdf', text: t('menu.exportPdf') })
      const exportMarkdownItem = await MenuItem.new({ id: 'export_markdown', text: t('menu.exportMarkdown') })
      const exportWordItem = await MenuItem.new({ id: 'export_word', text: t('menu.exportWord') })
      const newBookItem = await MenuItem.new({ id: 'new_book', text: t('menu.newBook'), accelerator: 'Ctrl+N' })
      const quitItem = await PredefinedMenuItem.new({ item: 'Quit', text: t('menu.quit') })
      const fileMenu = await Submenu.new({
        text: t('menu.file'),
        items: [
          newBookItem,
          await PredefinedMenuItem.new({ item: 'Separator' }),
          exportEpubItem,
          exportPdfItem,
          exportMarkdownItem,
          exportWordItem,
          await PredefinedMenuItem.new({ item: 'Separator' }),
          quitItem,
        ],
      })

      const findReplaceItem = await MenuItem.new({ id: 'find_replace', text: t('menu.findReplace'), accelerator: 'Ctrl+F' })
      const undoItem = await PredefinedMenuItem.new({ item: 'Undo', text: t('menu.undo') })
      const redoItem = await PredefinedMenuItem.new({ item: 'Redo', text: t('menu.redo') })
      const cutItem = await PredefinedMenuItem.new({ item: 'Cut', text: t('menu.cut') })
      const copyItem = await PredefinedMenuItem.new({ item: 'Copy', text: t('menu.copy') })
      const pasteItem = await PredefinedMenuItem.new({ item: 'Paste', text: t('menu.paste') })
      const selectAllItem = await PredefinedMenuItem.new({ item: 'SelectAll', text: t('menu.selectAll') })
      const editMenu = await Submenu.new({
        text: t('menu.edit'),
        items: [
          undoItem,
          redoItem,
          await PredefinedMenuItem.new({ item: 'Separator' }),
          cutItem,
          copyItem,
          pasteItem,
          selectAllItem,
          await PredefinedMenuItem.new({ item: 'Separator' }),
          findReplaceItem,
        ],
      })

      const toggleScrollSyncItem = await MenuItem.new({ id: 'toggle_scroll_sync', text: t('menu.toggleScrollSync') })
      const toggleThemeItem = await MenuItem.new({ id: 'toggle_theme', text: t('menu.toggleTheme') })
      const appFullscreenItem = await MenuItem.new({ id: 'app_fullscreen', text: t('menu.appFullscreen'), accelerator: 'Ctrl+Enter' })
      const viewMenu = await Submenu.new({
        text: t('menu.view'),
        items: [
          toggleThemeItem,
          appFullscreenItem,
          toggleScrollSyncItem,
        ],
      })

      const aboutItem = await MenuItem.new({ id: 'about', text: t('menu.about') })
      const helpMenu = await Submenu.new({
        text: t('menu.help'),
        items: [
          aboutItem,
        ],
      })

      const menu = await Menu.new({ items: [fileMenu, editMenu, viewMenu, helpMenu] })
      await menu.setAsAppMenu()
      nativeMenuHandles = {
        fileMenu,
        editMenu,
        viewMenu,
        helpMenu,
        newBookItem,
        quitItem,
        undoItem,
        redoItem,
        cutItem,
        copyItem,
        pasteItem,
        selectAllItem,
        exportEpubItem,
        exportPdfItem,
        exportMarkdownItem,
        exportWordItem,
        findReplaceItem,
        toggleThemeItem,
        appFullscreenItem,
        toggleScrollSyncItem,
        aboutItem,
      }
      await syncNativeMenuState()
    } catch (e) { console.error('buildNativeMenu failed', e) }
  }

  async function updateNativeMenuTexts() {
    if (!nativeMenuHandles) return

    await Promise.all([
      nativeMenuHandles.fileMenu.setText(t('menu.file')),
      nativeMenuHandles.editMenu.setText(t('menu.edit')),
      nativeMenuHandles.viewMenu.setText(t('menu.view')),
      nativeMenuHandles.helpMenu.setText(t('menu.help')),
      nativeMenuHandles.newBookItem.setText(t('menu.newBook')),
      nativeMenuHandles.quitItem.setText(t('menu.quit')),
      nativeMenuHandles.undoItem.setText(t('menu.undo')),
      nativeMenuHandles.redoItem.setText(t('menu.redo')),
      nativeMenuHandles.cutItem.setText(t('menu.cut')),
      nativeMenuHandles.copyItem.setText(t('menu.copy')),
      nativeMenuHandles.pasteItem.setText(t('menu.paste')),
      nativeMenuHandles.selectAllItem.setText(t('menu.selectAll')),
      nativeMenuHandles.exportEpubItem.setText(t('menu.exportEpub')),
      nativeMenuHandles.exportPdfItem.setText(t('menu.exportPdf')),
      nativeMenuHandles.exportMarkdownItem.setText(t('menu.exportMarkdown')),
      nativeMenuHandles.exportWordItem.setText(t('menu.exportWord')),
      nativeMenuHandles.findReplaceItem.setText(t('menu.findReplace')),
      nativeMenuHandles.toggleThemeItem.setText(t('menu.toggleTheme')),
      nativeMenuHandles.appFullscreenItem.setText(t('menu.appFullscreen')),
      nativeMenuHandles.toggleScrollSyncItem.setText(t('menu.toggleScrollSync')),
      nativeMenuHandles.aboutItem.setText(t('menu.about')),
    ])
  }

  async function syncNativeMenuState() {
    if (!nativeMenuHandles) return

    const editorOnly = isEditor.value
    await Promise.all([
      nativeMenuHandles.editMenu.setEnabled(editorOnly),
      nativeMenuHandles.exportEpubItem.setEnabled(editorOnly),
      nativeMenuHandles.exportPdfItem.setEnabled(editorOnly),
      nativeMenuHandles.exportMarkdownItem.setEnabled(editorOnly),
      nativeMenuHandles.exportWordItem.setEnabled(editorOnly),
      nativeMenuHandles.toggleScrollSyncItem.setEnabled(editorOnly),
    ])
  }

  async function applyMenuVisibility(visible: boolean) {
    if (!isTauri()) return
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const appliedVisible = await invoke<boolean>('toggle_menu', { visible })
      setStoredMenuVisible(appliedVisible)
    } catch (e) { console.error('applyMenuVisibility failed', e) }
  }

  async function toggleMenuVisibility() {
    if (!isTauri()) return
    try {
      await applyMenuVisibility(!menuVisible)
    } catch (e) { console.error('toggleMenuVisibility failed', e) }
  }

  onMounted(async () => {
    if (!isTauri()) return
    menuVisible = getStoredMenuVisible()
    try {
      const { listen } = await import('@tauri-apps/api/event')
      menuUnlisten = await listen<string>('menu-event', (event) => {
        switch (event.payload) {
          case 'new_book':
            navigateToCreateBook()
            break
          case 'export_epub':
            window.dispatchEvent(new CustomEvent('menu-export', { detail: 'epub' }))
            break
          case 'export_pdf':
            window.dispatchEvent(new CustomEvent('menu-export', { detail: 'pdf' }))
            break
          case 'export_markdown':
            window.dispatchEvent(new CustomEvent('menu-export', { detail: 'markdown' }))
            break
          case 'export_word':
            window.dispatchEvent(new CustomEvent('menu-export', { detail: 'docx' }))
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
          case 'app_fullscreen':
            toggleAppFullscreen()
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
      if (!menuVisible) {
        await applyMenuVisibility(false)
      }
    } catch { }
  })

  // 语言切换时重建菜单
  watch(locale, () => {
    if (!isTauri()) return
    void updateNativeMenuTexts()
  })

  watch(() => route.path, () => {
    if (!isTauri()) return
    void syncNativeMenuState()
  }, { immediate: true })

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

  const showAbout = ref(false)
  const appFullscreen = ref(false)

  const toggleAppFullscreen = async () => {
    if (!isTauri()) return
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const win = getCurrentWindow()
      if (appFullscreen.value) {
        await win.setFullscreen(false)
        appFullscreen.value = false
      } else {
        await win.setFullscreen(true)
        appFullscreen.value = true
      }
    } catch (e) { console.error('setFullscreen failed', e) }
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (isTauri() && (e.key === 'F5' || (e.key.toLowerCase() === 'r' && e.ctrlKey))) {
      e.preventDefault()
      return
    }
    if (e.key === 'Escape' && appFullscreen.value) {
      toggleAppFullscreen()
    }
    if (e.key.toLowerCase() === 'm' && e.ctrlKey) {
      e.preventDefault()
      toggleMenuVisibility()
    }
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      toggleAppFullscreen()
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown)
  })

  const buildTime = __BUILD_TIME__.replace('T', ' ').slice(0, 19)
  const appVersion = __APP_VERSION__
  const tauriVer = ref('—')
  const webviewVer = ref('—')

  const detectVersions = async () => {
    if (isTauri()) {
      try {
        const { getTauriVersion } = await import('@tauri-apps/api/app')
        tauriVer.value = await getTauriVersion()
      } catch { }
    }
    const ua = navigator.userAgent
    const chromeMatch = ua.match(/Chrome\/([\d.]+)/)
    if (chromeMatch) webviewVer.value = chromeMatch[1]
  }

  detectVersions()

  const handleAbout = () => {
    showAbout.value = true
  }

  onMounted(() => {
    window.addEventListener('menu-about', handleAbout)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('menu-about', handleAbout)
  })

  const navigateToCreateBook = () => {
    router.push({
      path: '/',
      query: { create: String(Date.now()) },
    })
  }

  const handleBackToShelf = () => {
    void bookStore.initBookList()
    router.push('/')
  }
</script>

<template>
  <NConfigProvider :theme="naiveTheme" :theme-overrides="themeOverrides" :locale="naiveLocale"
    :date-locale="naiveDateLocale">
    <NMessageProvider>
      <NDialogProvider>
        <div class="app-shell h-screen flex flex-col">
          <header class="app-header flex items-center justify-between gap-3 px-4 py-2 shrink-0">
            <div class="app-header-main flex min-w-0 items-center gap-2">
              <span class="i-carbon-book text-lg" style="color: var(--primary)" />
              <span class="shrink-0 font-bold text-sm" style="color: var(--text-primary)">{{ t('app.title') }}</span>
              <template v-if="bookTitle">
                <span class="shrink-0 i-carbon-chevron-right text-xs" style="color: var(--text-muted)" />
                <span class="book-title-tag">
                  <span class="i-carbon-document text-xs" />
                  <span class="book-title-text">{{ bookTitle }}</span>
                </span>
              </template>
            </div>
            <div class="app-header-actions">
              <button
                v-if="isEditor"
                type="button"
                class="app-back-btn"
                @click="handleBackToShelf"
              >
                <span class="i-carbon-arrow-left text-sm" />
                <span>{{ t('editor.backToShelf') }}</span>
              </button>
              <NButton quaternary size="tiny" class="app-locale-btn" @click="toggleLocale">
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
        <NModal v-model:show="showAbout" preset="card" :title="t('menu.about')" style="max-width: 380px"
          :bordered="false">
          <div class="flex flex-col items-center gap-2 py-2">
            <span class="i-carbon-book text-4xl" style="color: var(--primary)" />
            <span class="text-lg font-bold">EPUB Builder</span>
            <span class="text-xs" style="color: var(--text-muted)">v{{ appVersion }}</span>
            <p class="text-center text-sm" style="color: var(--text-secondary)">{{ t('about.desc') }}</p>
            <div class="w-full mt-2 text-xs" style="color: var(--text-muted); line-height: 1.8">
              <div class="flex justify-between"><span>{{ t('about.author') }}</span><span
                  style="color: var(--text-secondary)">邵云翔</span></div>
              <div class="flex justify-between"><span>{{ t('about.buildTime') }}</span><span
                  style="color: var(--text-secondary)">{{ buildTime }}</span></div>
              <div class="flex justify-between"><span>{{ t('about.tauriVersion') }}</span><span
                  style="color: var(--text-secondary)">{{ tauriVer }}</span></div>
              <div class="flex justify-between"><span>{{ t('about.webviewVersion') }}</span><span
                  style="color: var(--text-secondary)">{{ webviewVer }}</span></div>
            </div>
          </div>
        </NModal>
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
    height: 24px;
    box-sizing: border-box;
    min-width: 0;
    flex-shrink: 1;
    font-size: 0.8125rem;
    font-weight: 700;
    color: var(--primary);
    background: var(--bg-active);
    padding: 0 10px;
    border-radius: 4px;
    border: 1px solid var(--primary);
    max-width: 200px;
    overflow: hidden;
    white-space: nowrap;
    transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
  }

  .book-title-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .app-header-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    flex: 0 0 auto;
    min-width: fit-content;
  }

  .app-back-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    box-sizing: border-box;
    min-width: 0;
    padding: 0 10px;
    font-weight: 600;
    font-size: 0.8125rem;
    line-height: 1;
    white-space: nowrap;
    color: var(--text-primary);
    background: var(--bg-elevated);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.18s ease, border-color 0.18s ease, color 0.18s ease;
  }

  .app-locale-btn {
    flex: 0 0 auto;
  }

  .app-locale-btn :deep(.n-button__content) {
    transition: opacity 0.18s ease;
  }

  .app-back-btn:hover {
    color: var(--primary);
    background: var(--bg-active);
    border-color: var(--border-light);
  }

  @media (max-width: 767px) {
    .app-header-actions {
      gap: 6px;
    }

    .book-title-tag {
      max-width: 140px;
    }
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
