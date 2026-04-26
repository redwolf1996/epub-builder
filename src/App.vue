<script setup lang="ts">
import { computed } from 'vue'
import { NConfigProvider, NMessageProvider, NDialogProvider, NButton, darkTheme, zhCN, dateZhCN, enUS, dateEnUS } from 'naive-ui'
import type { GlobalThemeOverrides } from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { useThemeStore } from '@/stores/theme'
import { useBookStore } from '@/stores/book'
import ThemeSwitcher from '@/components/common/ThemeSwitcher.vue'

const route = useRoute()
const router = useRouter()
const themeStore = useThemeStore()
const bookStore = useBookStore()
const { t, locale } = useI18n()

const toggleLocale = () => {
  const newLocale = locale.value === 'zh-CN' ? 'en' : 'zh-CN'
  locale.value = newLocale
  localStorage.setItem('locale', newLocale)
}

const isHome = computed(() => route.path === '/')
const bookTitle = computed(() => {
  if (isHome.value) return ''
  return bookStore.activeBook?.meta.title || ''
})

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
