<script setup lang="ts">
  import { NModal, NTable } from 'naive-ui'
  import { useI18n } from 'vue-i18n'
  import { renderMarkdown } from '@/utils/markdown'

  defineProps<{
    show: boolean
  }>()

  const emit = defineEmits<{
    'update:show': [value: boolean]
  }>()

  const { t } = useI18n()

  const syntaxRows: Array<[string, string, string]> = [
    ['# 标题', t('markdownHelp.rows.h1.desc'), t('markdownHelp.rows.h1.preview')],
    ['## 标题', t('markdownHelp.rows.h2.desc'), t('markdownHelp.rows.h2.preview')],
    ['### 标题', t('markdownHelp.rows.h3.desc'), t('markdownHelp.rows.h3.preview')],
    ['**粗体**', t('markdownHelp.rows.bold.desc'), t('markdownHelp.rows.bold.preview')],
    ['*斜体*', t('markdownHelp.rows.italic.desc'), t('markdownHelp.rows.italic.preview')],
    ['~~删除线~~', t('markdownHelp.rows.strikethrough.desc'), t('markdownHelp.rows.strikethrough.preview')],
    ['`行内代码`', t('markdownHelp.rows.inlineCode.desc'), t('markdownHelp.rows.inlineCode.preview')],
    ['```语言\n代码\n```', t('markdownHelp.rows.codeBlock.desc'), t('markdownHelp.rows.codeBlock.preview')],
    ['[链接](url)', t('markdownHelp.rows.link.desc'), t('markdownHelp.rows.link.preview')],
    ['![图片](url)', t('markdownHelp.rows.image.desc'), t('markdownHelp.rows.image.preview')],
    ['> 引用', t('markdownHelp.rows.quote.desc'), t('markdownHelp.rows.quote.preview')],
    ['- 列表项', t('markdownHelp.rows.unorderedList.desc'), t('markdownHelp.rows.unorderedList.preview')],
    ['1. 列表项', t('markdownHelp.rows.orderedList.desc'), t('markdownHelp.rows.orderedList.preview')],
    ['---', t('markdownHelp.rows.hr.desc'), t('markdownHelp.rows.hr.preview')],
    ['| 表头 | 表头 |', t('markdownHelp.rows.table.desc'), t('markdownHelp.rows.table.preview')],
  ]

  const renderPreview = (md: string) => renderMarkdown(md)
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="t('markdownHelp.title')"
    class="max-w-2xl"
    @update:show="emit('update:show', $event)">
    <NTable :bordered="false" :single-line="false" size="small" striped>
      <thead>
        <tr>
          <th style="width: 30%">{{ t('markdownHelp.syntax') }}</th>
          <th style="width: 20%">{{ t('markdownHelp.description') }}</th>
          <th style="width: 50%">{{ t('markdownHelp.preview') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, i) in syntaxRows" :key="i">
          <td><code class="syntax-code">{{ row[0] }}</code></td>
          <td>{{ row[1] }}</td>
          <td class="preview-cell" v-html="renderPreview(row[2])" />
        </tr>
      </tbody>
    </NTable>
  </NModal>
</template>

<style scoped>
  .syntax-code {
    background: var(--bg-hover);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 0.85em;
    color: var(--primary);
  }

  .preview-cell {
    font-size: 0.85em;
    line-height: 1.5;
  }

  .preview-cell :deep(h1) {
    font-size: 1.4em;
    font-weight: 700;
    margin: 0.2em 0;
    border: none;
    background: none;
    -webkit-text-fill-color: unset;
  }

  .preview-cell :deep(h2) {
    font-size: 1.2em;
    font-weight: 600;
    margin: 0.2em 0;
    color: var(--primary-light);
  }

  .preview-cell :deep(h3) {
    font-size: 1.1em;
    font-weight: 600;
    margin: 0.2em 0;
    color: var(--primary);
  }

  .preview-cell :deep(p) {
    margin: 0.2em 0;
  }

  .preview-cell :deep(blockquote) {
    margin: 0.3em 0;
    padding: 0.3em 0.8em;
    border-left: 3px solid var(--primary);
    background: var(--bg-hover);
    border-radius: 0 4px 4px 0;
  }

  .preview-cell :deep(code) {
    background: var(--bg-active);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.9em;
  }

  .preview-cell :deep(pre) {
    margin: 0.3em 0;
    border-radius: 4px;
    overflow: hidden;
  }

  .preview-cell :deep(pre code) {
    background: transparent;
    padding: 0;
  }

  .preview-cell :deep(ul),
  .preview-cell :deep(ol) {
    margin: 0.2em 0;
    padding-left: 1.2em;
  }

  .preview-cell :deep(li) {
    margin: 0.1em 0;
  }

  .preview-cell :deep(hr) {
    margin: 0.3em 0;
    border: none;
    height: 1px;
    background: var(--border-color);
  }

  .preview-cell :deep(table) {
    border-collapse: collapse;
  }

  .preview-cell :deep(th),
  .preview-cell :deep(td) {
    padding: 2px 8px;
    border: 1px solid var(--border-color);
  }

  .preview-cell :deep(th) {
    background: var(--bg-hover);
  }

  .preview-cell :deep(img) {
    max-width: 80px;
    border-radius: 4px;
  }

  .preview-cell :deep(a) {
    color: var(--primary);
  }

  .preview-cell :deep(del) {
    color: var(--text-muted);
  }
</style>
