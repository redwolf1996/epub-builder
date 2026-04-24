<script setup lang="ts">
  import { ref } from 'vue'
  import { NButton, NButtonGroup, NTooltip } from 'naive-ui'
  import { useI18n } from 'vue-i18n'
  import MarkdownHelp from '@/components/editor/MarkdownHelp.vue'

  const props = defineProps<{
    exporting?: boolean
  }>()

  const emit = defineEmits<{
    export: []
    ocr: []
  }>()

  export interface EditorActions {
    insertText: (text: string) => void
    wrapSelection: (before: string, after: string) => void
  }

  const editorRef = defineModel<EditorActions | null>('editorRef', { required: false })
  import { isTauri } from '@/utils/epub'
  const showHelp = ref(false)
  const { t } = useI18n()

  const handleHeading = () => {
    editorRef.value?.insertText('## ')
  }

  const handleBold = () => {
    editorRef.value?.wrapSelection('**', '**')
  }

  const handleItalic = () => {
    editorRef.value?.wrapSelection('*', '*')
  }

  const handleLink = () => {
    editorRef.value?.insertText('[链接文字](url)')
  }

  const handleCode = () => {
    editorRef.value?.wrapSelection('`', '`')
  }

  const handleCodeBlock = () => {
    editorRef.value?.insertText('\n```javascript\n\n```\n')
  }

  const handleImage = () => {
    editorRef.value?.insertText('![图片描述](image-url)')
  }

  const handleQuote = () => {
    editorRef.value?.insertText('> ')
  }

  const handleList = () => {
    editorRef.value?.insertText('- ')
  }

  const handleOcr = () => {
    emit('ocr')
  }

  const handleExport = () => {
    emit('export')
  }
</script>

<template>
  <div class="editor-toolbar flex items-center gap-1 px-3 shrink-0" style="height: 36px">
    <NButtonGroup size="tiny">
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleHeading">
            <span class="i-carbon-heading text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.heading') }}
      </NTooltip>

      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleBold">
            <span class="i-carbon-text-bold text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.bold') }}
      </NTooltip>

      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleItalic">
            <span class="i-carbon-text-italic text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.italic') }}
      </NTooltip>

      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleQuote">
            <span class="text-sm font-bold" style="line-height: 1">❝</span>
          </NButton>
        </template>
        {{ t('toolbar.quote') }}
      </NTooltip>

      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleList">
            <span class="i-carbon-list text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.list') }}
      </NTooltip>

      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleLink">
            <span class="i-carbon-link text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.link') }}
      </NTooltip>

      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleImage">
            <span class="i-carbon-image text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.image') }}
      </NTooltip>

      <NTooltip v-if="isTauri()" trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleOcr">
            <span class="i-carbon-scan text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.ocr') }}
      </NTooltip>

      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleCode">
            <span class="i-carbon-code text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.inlineCode') }}
      </NTooltip>

      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleCodeBlock">
            <span class="i-carbon-terminal text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.codeBlock') }}
      </NTooltip>
    </NButtonGroup>

    <NTooltip trigger="hover">
      <template #trigger>
        <NButton quaternary size="tiny" @click="showHelp = true">
          <span class="i-carbon-help text-sm" />
        </NButton>
      </template>
      {{ t('editor.markdownHelp') }}
    </NTooltip>

    <div class="flex-1" />

    <NButton type="primary" size="small" :loading="props.exporting" @click="handleExport">
      <span v-if="!props.exporting" class="i-carbon-download mr-1" />
      {{ props.exporting ? t('editor.exporting') : t('editor.exportEpub') }}
    </NButton>

    <MarkdownHelp v-model:show="showHelp" />
  </div>
</template>

<style scoped>
  .editor-toolbar {
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-surface);
    backdrop-filter: blur(12px);
  }
</style>
