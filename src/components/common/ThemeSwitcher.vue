<script setup lang="ts">
import { NButton, NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useThemeStore, type ThemeName } from '@/stores/theme'

const themeStore = useThemeStore()
const { t: tt } = useI18n()

const themeIcons: Record<ThemeName, string> = {
  dark: 'i-carbon-moon',
  light: 'i-carbon-sun',
  parchment: 'i-carbon-document',
}

const themeLabels: Record<ThemeName, string> = {
  dark: tt('theme.dark'),
  light: tt('theme.light'),
  parchment: tt('theme.parchment'),
}
</script>

<template>
  <div class="theme-switcher flex items-center gap-1">
    <NTooltip v-for="t in (['dark', 'light', 'parchment'] as ThemeName[])" :key="t" trigger="hover">
      <template #trigger>
        <NButton
          :type="themeStore.theme === t ? 'primary' : 'default'"
          :tertiary="themeStore.theme === t"
          :quaternary="themeStore.theme !== t"
          size="tiny"
          @click="themeStore.setTheme(t)"
        >
          <span :class="themeIcons[t]" class="text-sm" />
        </NButton>
      </template>
      {{ themeLabels[t] }}
    </NTooltip>
  </div>
</template>
