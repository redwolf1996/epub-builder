<script setup lang="ts">
import { computed, h, ref } from 'vue'
import { NButton, NDropdown, NPopover, NTooltip } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import MarkdownHelp from '@/components/editor/MarkdownHelp.vue'
import { isTauri, type ExportFormat } from '@/utils/export'

const props = defineProps<{
  exporting?: boolean
  ocrProcessing?: boolean
  showChapterToggle?: boolean
  chapterToggleActive?: boolean
  syncScroll?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  export: [format: ExportFormat]
  aiOcr: []
  openDevtools: []
  fullscreen: []
  toggleChapter: []
  toggleScrollSync: []
}>()

export interface EditorActions {
  insertText: (text: string) => void
  insertHardBreak: () => void
  wrapSelection: (before: string, after: string) => void
  indentSelection: () => void
  indentAll: () => void
  dedentSelection: () => void
  dedentAll: () => void
  setFontSize: (size: number) => void
  openSearch: () => void
}

const editorRef = defineModel<EditorActions | null>('editorRef', { required: false })
const showHelp = ref(false)
const showMore = ref(false)
const { t } = useI18n()

const optionIcon = (iconClass: string, style?: string) => () => h('span', {
  class: `${iconClass} text-sm`,
  style,
})

const exportOptions = computed(() => ([
  { label: t('editor.exportEpub'), key: 'epub', icon: optionIcon('i-carbon-book') },
  { label: t('editor.exportPdf'), key: 'pdf', icon: optionIcon('i-carbon-document-pdf') },
  { label: t('editor.exportMarkdown'), key: 'markdown', icon: optionIcon('i-carbon-document') },
]))

const moreActions = computed<Array<{ key: string; label: string; icon: () => ReturnType<typeof h> }>>(() => ([
  { key: 'inlineCode', label: t('toolbar.inlineCode'), icon: optionIcon('i-carbon-code') },
  { key: 'codeBlock', label: t('toolbar.codeBlock'), icon: optionIcon('i-carbon-terminal') },
  { key: 'link', label: t('toolbar.link'), icon: optionIcon('i-carbon-link') },
  ...(isTauri() ? [{ key: 'devtools', label: t('toolbar.devtools'), icon: optionIcon('i-carbon-development') }] : []),
]))

const insertHeading = () => {
  editorRef.value?.insertText('## ')
}

const wrapBold = () => {
  editorRef.value?.wrapSelection('**', '**')
}

const wrapItalic = () => {
  editorRef.value?.wrapSelection('*', '*')
}

const insertQuote = () => {
  editorRef.value?.insertText('> ')
}

const insertList = () => {
  editorRef.value?.insertText('- ')
}

const insertHardBreak = () => {
  editorRef.value?.insertHardBreak()
}

const insertInlineCode = () => {
  editorRef.value?.wrapSelection('`', '`')
}

const insertCodeBlock = () => {
  editorRef.value?.insertText('\n```text\n\n```\n')
}

const insertLink = () => {
  editorRef.value?.insertText('[Link](https://example.com)')
}

const insertImage = () => {
  editorRef.value?.insertText('![alt](image-url)')
}

const handleIndent = () => {
  editorRef.value?.indentSelection()
}

const handleSearch = () => {
  editorRef.value?.openSearch()
}

const handleToggleScrollSync = (event: MouseEvent) => {
  emit('toggleScrollSync')
  ;(event.currentTarget as HTMLButtonElement | null)?.blur()
}

const handleMoreSelect = (key: string) => {
  switch (key) {
    case 'inlineCode':
      insertInlineCode()
      break
    case 'codeBlock':
      insertCodeBlock()
      break
    case 'link':
      insertLink()
      break
    case 'devtools':
      emit('openDevtools')
      showMore.value = false
      break
  }
}

const withShortcut = (label: string, shortcut: string) => `${label} (${shortcut})`

const handleExportSelect = (key: string) => {
  if (key === 'epub' || key === 'pdf' || key === 'markdown') {
    emit('export', key)
  }
}
</script>

<template>
  <div class="editor-toolbar flex items-center gap-2 px-3 shrink-0 overflow-x-auto">
    <NTooltip v-if="props.showChapterToggle" trigger="hover">
      <template #trigger>
        <NButton
          quaternary
          size="tiny"
          :type="props.chapterToggleActive ? 'primary' : 'default'"
          @click="emit('toggleChapter')"
        >
          <span class="i-carbon-menu text-sm" />
        </NButton>
      </template>
      {{ t('editor.chapterList') }}
    </NTooltip>

    <div class="toolbar-group flex items-center gap-1">
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" @click="insertHeading">
            <span class="i-carbon-heading text-sm" />
          </NButton>
        </template>
        {{ withShortcut(t('toolbar.heading'), 'Ctrl+H') }}
      </NTooltip>
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" @click="insertQuote">
            <span class="i-carbon-quotes text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.quote') }}
      </NTooltip>
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" @click="insertList">
            <span class="i-carbon-list text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.list') }}
      </NTooltip>
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" @click="insertHardBreak">
            <span class="i-carbon-return text-sm" />
          </NButton>
        </template>
        {{ withShortcut(t('toolbar.hardBreak'), 'Alt+Enter') }}
      </NTooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group flex items-center gap-1">
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" @click="wrapBold">
            <span class="i-carbon-text-bold text-sm" />
          </NButton>
        </template>
        {{ withShortcut(t('toolbar.bold'), 'Ctrl+B') }}
      </NTooltip>
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" @click="wrapItalic">
            <span class="i-carbon-text-italic text-sm" />
          </NButton>
        </template>
        {{ withShortcut(t('toolbar.italic'), 'Ctrl+I') }}
      </NTooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group flex items-center gap-1">
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" @click="editorRef?.indentAll?.()">
            <span class="i-carbon-text-align-justify text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.indentAll') }}
      </NTooltip>
      <NTooltip v-if="!props.compact" trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" @click="handleIndent">
            <span class="i-carbon-text-indent-more text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.indent') }}
      </NTooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group flex items-center gap-1">
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" @click="insertImage">
            <span class="i-carbon-image text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.image') }}
      </NTooltip>
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" :disabled="props.ocrProcessing" @click="emit('aiOcr')">
            <span class="i-carbon-chat-bot text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.aiOcr') }}
      </NTooltip>
    </div>

    <div class="toolbar-divider" />

    <div class="toolbar-group flex items-center gap-1">
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton
            size="tiny"
            class="sync-toggle"
            :type="props.syncScroll !== false ? 'primary' : 'default'"
            :secondary="false"
            :tertiary="props.syncScroll !== false"
            :quaternary="props.syncScroll === false"
            @click="handleToggleScrollSync"
          >
            <span class="i-carbon-arrows-vertical text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.scrollSync') }}
      </NTooltip>
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" @click="handleSearch">
            <span class="i-carbon-search text-sm" />
          </NButton>
        </template>
        {{ withShortcut(t('toolbar.search'), 'Ctrl+F') }}
      </NTooltip>
      <NTooltip v-if="!props.compact" trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" @click="showHelp = true">
            <span class="i-carbon-help text-sm" />
          </NButton>
        </template>
        {{ t('editor.markdownHelp') }}
      </NTooltip>
      <NTooltip v-if="!props.compact" trigger="hover">
        <template #trigger>
          <NButton quaternary size="tiny" @click="emit('fullscreen')">
            <span v-if="!props.showChapterToggle" class="i-carbon-maximize text-sm" />
            <span v-else class="i-carbon-minimize text-sm" />
          </NButton>
        </template>
        {{ props.showChapterToggle ? t('editor.exitFullscreen') : t('editor.fullscreen') }}
      </NTooltip>
      <NPopover v-model:show="showMore" trigger="click" placement="bottom-end" :show-arrow="false">
        <template #trigger>
          <NButton quaternary size="tiny">
            <span class="i-carbon-overflow-menu-horizontal text-sm" />
          </NButton>
        </template>
        <div class="more-panel">
          <button
            v-for="action in moreActions"
            :key="action.key"
            class="more-action"
            type="button"
            @click="handleMoreSelect(action.key)"
          >
            <span class="more-action-icon">
              <component :is="action.icon" />
            </span>
            <span>{{ action.label }}</span>
          </button>
        </div>
      </NPopover>
    </div>

    <div class="flex-1" />

    <NDropdown :options="exportOptions" trigger="click" placement="bottom-end" @select="handleExportSelect">
      <NButton type="primary" size="small" :loading="props.exporting" :disabled="props.ocrProcessing">
        <span v-if="!props.exporting" class="i-carbon-download" :class="{ 'mr-1': !props.compact }" />
        <span v-if="!props.compact">
          {{ props.exporting ? t('editor.exporting') : t('editor.export') }}
        </span>
        <span v-if="!props.compact && !props.exporting" class="i-carbon-chevron-down ml-1 text-xs" />
      </NButton>
    </NDropdown>

    <MarkdownHelp v-model:show="showHelp" />
  </div>
</template>

<style scoped>
.editor-toolbar {
  height: 40px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-surface);
  backdrop-filter: blur(12px);
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--border-color);
  flex-shrink: 0;
}

.sync-toggle {
  min-width: 28px;
}

.more-panel {
  min-width: 180px;
  display: grid;
  gap: 4px;
  padding: 6px;
}

.more-action {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: 0;
  border-radius: 4px;
  background: transparent;
  padding: 6px;
  color: var(--text-secondary);
  text-align: left;
  cursor: pointer;
}

.more-action:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.more-action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  flex-shrink: 0;
}
</style>
