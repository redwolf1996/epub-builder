<script setup lang="ts">
  import { ref } from 'vue'
  import { NButton, NButtonGroup, NTooltip, NPopover } from 'naive-ui'
  import { useI18n } from 'vue-i18n'
  import MarkdownHelp from '@/components/editor/MarkdownHelp.vue'

  const props = defineProps<{
    exporting?: boolean
    showChapterToggle?: boolean
    chapterToggleActive?: boolean
    syncScroll?: boolean
  }>()

  const emit = defineEmits<{
    export: []
    ocr: []
    fullscreen: []
    search: []
    toggleChapter: []
    toggleScrollSync: []
  }>()

  export interface EditorActions {
    insertText: (text: string) => void
    wrapSelection: (before: string, after: string) => void
    indentSelection: () => void
    indentAll: () => void
    dedentSelection: () => void
    dedentAll: () => void
    setFontSize: (size: number) => void
    cyclePreviewTheme: () => void
    openSearch: () => void
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

  const handleIndent = () => {
    editorRef.value?.indentSelection()
  }

  const handleIndentAll = () => {
    editorRef.value?.indentAll()
  }

  const handleDedent = () => {
    editorRef.value?.dedentSelection()
  }

  const handleDedentAll = () => {
    editorRef.value?.dedentAll()
  }

  const fontSize = ref(14)
  const handleFontSizeChange = (delta: number) => {
    fontSize.value = Math.min(32, Math.max(10, fontSize.value + delta))
    editorRef.value?.setFontSize(fontSize.value)
  }

  const fontColor = ref('#FF0000')
  const bgColor = ref('#FFFF00')
  const showFontColorPicker = ref(false)
  const showBgColorPicker = ref(false)

  const webSafeColors = [
    '#000000', '#333333', '#666666', '#999999', '#CCCCCC', '#FFFFFF',
    '#FF0000', '#FF6600', '#FFCC00', '#FFFF00', '#99FF00', '#00FF00',
    '#00FF99', '#00FFFF', '#0099FF', '#0000FF', '#6600FF', '#9900FF',
    '#FF00FF', '#FF0099', '#FF0066', '#CC3333', '#CC6600', '#CCCC00',
    '#99CC00', '#00CC66', '#00CCCC', '#0066CC', '#3333CC', '#6600CC',
    '#CC00CC', '#CC0066', '#FF6666', '#FFB366', '#FFFF66', '#CCFF66',
    '#66FF66', '#66FFCC', '#66CCFF', '#6666FF', '#B366FF', '#FF66FF',
  ]

  const applyFontColor = (color: string) => {
    fontColor.value = color
    editorRef.value?.wrapSelection(`<span style="color:${color}">`, '</span>')
    showFontColorPicker.value = false
  }

  const applyBgColor = (color: string) => {
    bgColor.value = color
    editorRef.value?.wrapSelection(`<span style="background-color:${color}">`, '</span>')
    showBgColorPicker.value = false
  }

  const handleOcr = () => {
    emit('ocr')
  }

  const handleExport = () => {
    emit('export')
  }

  const handleFullscreen = () => {
    emit('fullscreen')
  }
</script>

<template>
  <div class="editor-toolbar flex items-center gap-1 px-3 shrink-0 overflow-x-auto" style="height: 36px">
    <!-- 全屏模式章节切换按钮 -->
    <NTooltip v-if="props.showChapterToggle" trigger="hover">
      <template #trigger>
        <NButton quaternary size="tiny" :type="props.chapterToggleActive ? 'primary' : 'default'" @click="emit('toggleChapter')">
          <span class="i-carbon-menu text-sm" />
        </NButton>
      </template>
      {{ t('editor.chapterList') }}
    </NTooltip>

    <!-- 格式组：始终显示 -->
    <NButtonGroup size="tiny">
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleHeading">
            <span class="i-carbon-heading text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.heading') }} (Ctrl+H)
      </NTooltip>

      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleBold">
            <span class="i-carbon-text-bold text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.bold') }} (Ctrl+B)
      </NTooltip>

      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleItalic">
            <span class="i-carbon-text-italic text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.italic') }} (Ctrl+I)
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
    </NButtonGroup>

    <div class="toolbar-divider" />

    <!-- 缩进组：首行缩进 + 全文缩进 直接显示 -->
    <NButtonGroup size="tiny">
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleIndent">
            <span class="i-carbon-text-indent-more text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.indent') }}
      </NTooltip>
      <NTooltip trigger="hover">
        <template #trigger>
          <NButton quaternary @click="handleIndentAll">
            <span class="i-carbon-text-align-justify text-sm" />
          </NButton>
        </template>
        {{ t('toolbar.indentAll') }}
      </NTooltip>
      <NPopover trigger="click" placement="bottom" :show-arrow="false" class="toolbar-popover">
        <template #trigger>
          <NButton quaternary size="tiny" class="toolbar-dropdown-btn">
            <span class="i-carbon-chevron-down text-xs" />
          </NButton>
        </template>
        <div class="flex gap-1 p-1">
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton quaternary size="tiny" @click="handleDedent">
                <span class="i-carbon-text-indent-less text-sm" />
              </NButton>
            </template>
            {{ t('toolbar.dedent') }}
          </NTooltip>
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton quaternary size="tiny" @click="handleDedentAll">
                <span class="i-carbon-text-align-left text-sm" />
              </NButton>
            </template>
            {{ t('toolbar.dedentAll') }}
          </NTooltip>
        </div>
      </NPopover>
    </NButtonGroup>

    <div class="toolbar-divider" />

    <!-- 样式组：字号 + 下拉（前景色/背景色） -->
    <NButtonGroup size="tiny">
      <NTooltip trigger="hover">
        <template #trigger>
          <NButtonGroup size="tiny">
            <NButton quaternary @click="handleFontSizeChange(-1)">
              <span class="text-xs font-bold">A-</span>
            </NButton>
            <NButton quaternary @click="handleFontSizeChange(1)">
              <span class="text-sm font-bold">A+</span>
            </NButton>
          </NButtonGroup>
        </template>
        {{ t('toolbar.fontSize') }}
      </NTooltip>

      <NPopover trigger="click" placement="bottom" :show-arrow="false" class="toolbar-popover">
        <template #trigger>
          <NButton quaternary size="tiny" class="toolbar-dropdown-btn">
            <span class="i-carbon-chevron-down text-xs" />
          </NButton>
        </template>
        <div class="flex gap-1 p-1">
          <NPopover v-model:show="showFontColorPicker" trigger="click" placement="bottom">
            <template #trigger>
              <NTooltip trigger="hover">
                <template #trigger>
                  <NButton quaternary size="tiny">
                    <span class="i-carbon-paint-brush text-sm" style="color: v-bind(fontColor)" />
                  </NButton>
                </template>
                {{ t('toolbar.fontColor') }}
              </NTooltip>
            </template>
            <div class="color-grid">
              <div v-for="c in webSafeColors" :key="c" class="color-swatch" :style="{ backgroundColor: c }"
                @click="applyFontColor(c)" />
              <label class="color-swatch color-swatch-custom" title="自定义颜色">
                <input type="color" :value="fontColor"
                  @input="(e: Event) => applyFontColor((e.target as HTMLInputElement).value)" />
              </label>
            </div>
          </NPopover>

          <NPopover v-model:show="showBgColorPicker" trigger="click" placement="bottom">
            <template #trigger>
              <NTooltip trigger="hover">
                <template #trigger>
                  <NButton quaternary size="tiny">
                    <span class="i-carbon-color-palette text-sm" style="color: v-bind(bgColor)" />
                  </NButton>
                </template>
                {{ t('toolbar.bgColor') }}
              </NTooltip>
            </template>
            <div class="color-grid">
              <div v-for="c in webSafeColors" :key="c" class="color-swatch" :style="{ backgroundColor: c }"
                @click="applyBgColor(c)" />
              <label class="color-swatch color-swatch-custom" title="自定义颜色">
                <input type="color" :value="bgColor"
                  @input="(e: Event) => applyBgColor((e.target as HTMLInputElement).value)" />
              </label>
            </div>
          </NPopover>
        </div>
      </NPopover>
    </NButtonGroup>

    <div class="toolbar-divider" />

    <!-- 插入组：图片 + OCR 直接显示，链接/代码在下拉 -->
    <NButtonGroup size="tiny">
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
      <NPopover trigger="click" placement="bottom" :show-arrow="false" class="toolbar-popover">
        <template #trigger>
          <NButton quaternary size="tiny" class="toolbar-dropdown-btn">
            <span class="i-carbon-chevron-down text-xs" />
          </NButton>
        </template>
        <div class="flex gap-1 p-1">
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton quaternary size="tiny" @click="handleLink">
                <span class="i-carbon-link text-sm" />
              </NButton>
            </template>
            {{ t('toolbar.link') }}
          </NTooltip>
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton quaternary size="tiny" @click="handleCode">
                <span class="i-carbon-code text-sm" />
              </NButton>
            </template>
            {{ t('toolbar.inlineCode') }}
          </NTooltip>
          <NTooltip trigger="hover">
            <template #trigger>
              <NButton quaternary size="tiny" @click="handleCodeBlock">
                <span class="i-carbon-terminal text-sm" />
              </NButton>
            </template>
            {{ t('toolbar.codeBlock') }}
          </NTooltip>
        </div>
      </NPopover>
    </NButtonGroup>

    <!-- 右侧独立按钮 -->
    <NTooltip trigger="hover">
      <template #trigger>
        <NButton size="tiny" :type="props.syncScroll !== false ? 'primary' : 'default'" :tertiary="props.syncScroll !== false" :quaternary="props.syncScroll === false" @click="emit('toggleScrollSync')">
          <span class="i-carbon-arrows-vertical text-sm" />
        </NButton>
      </template>
      {{ t('toolbar.scrollSync') }}
    </NTooltip>

    <NTooltip trigger="hover">
      <template #trigger>
        <NButton quaternary size="tiny" @click="editorRef?.openSearch?.()">
          <span class="i-carbon-search text-sm" />
        </NButton>
      </template>
      {{ t('toolbar.search') }} (Ctrl+F)
    </NTooltip>

    <NTooltip trigger="hover">
      <template #trigger>
        <NButton quaternary size="tiny" @click="showHelp = true">
          <span class="i-carbon-help text-sm" />
        </NButton>
      </template>
      {{ t('editor.markdownHelp') }}
    </NTooltip>

    <NTooltip trigger="hover">
      <template #trigger>
        <NButton quaternary size="tiny" @click="handleFullscreen">
          <span v-if="!props.showChapterToggle" class="i-carbon-maximize text-sm" />
          <span v-else class="i-carbon-minimize text-sm" />
        </NButton>
      </template>
      {{ props.showChapterToggle ? t('editor.exitFullscreen') : t('editor.fullscreen') }} (F11)
    </NTooltip>

    <NTooltip trigger="hover">
      <template #trigger>
        <NButton quaternary size="tiny" @click="editorRef?.cyclePreviewTheme?.()">
          <span class="i-carbon-screen text-sm" />
        </NButton>
      </template>
      {{ t('editor.previewTheme') }}
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

  .color-grid {
    display: grid;
    grid-template-columns: repeat(6, 22px);
    gap: 4px;
    padding: 4px;
  }

  .color-swatch {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid rgba(128, 128, 128, 0.3);
    transition: transform 0.1s;
  }

  .color-swatch:hover {
    transform: scale(1.2);
    z-index: 1;
  }

  .color-swatch-custom {
    display: flex;
    align-items: center;
    justify-content: center;
    background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red);
    overflow: hidden;
  }

  .color-swatch-custom input {
    opacity: 0;
    width: 100%;
    height: 100%;
    cursor: pointer;
  }

  .toolbar-divider {
    width: 1px;
    height: 20px;
    background: var(--border-color);
    margin: 0 4px;
    flex-shrink: 0;
  }

  .toolbar-dropdown-btn {
    padding: 0 2px !important;
    min-width: 20px !important;
  }
</style>
