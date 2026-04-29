<script setup lang="ts">
  import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import { useRoute } from 'vue-router'
  import { useI18n } from 'vue-i18n'
  import { NButton, NInput, NModal, NScrollbar, useDialog, useMessage } from 'naive-ui'
  import { open } from '@tauri-apps/plugin-dialog'
  import { listen, type UnlistenFn } from '@tauri-apps/api/event'
  import { invoke } from '@tauri-apps/api/core'
  import { useBookStore } from '@/stores/book'
  import { useEditorStore } from '@/stores/editor'
  import { useEpub } from '@/composables/useEpub'
  import { isTauri } from '@/utils/epub'
  import { useResizable } from '@/composables/useResizable'
  import { useChapterManager } from '@/composables/useChapterManager'
  import { useScrollSync } from '@/composables/useScrollSync'
  import CodeMirrorEditor from '@/components/editor/CodeMirrorEditor.vue'
  import type { EditorActions } from '@/components/editor/EditorToolbar.vue'
  import EditorToolbar from '@/components/editor/EditorToolbar.vue'
  import MarkdownPreview from '@/components/preview/MarkdownPreview.vue'
  import ChapterNode from '@/components/editor/ChapterNode.vue'

  type AiOcrStatus = 'running' | 'needsManual' | 'completed' | 'failed' | 'cancelled'
  type AiOcrStage = 'waitingResult' | 'manualTakeover' | 'completed' | 'cancelled'

  interface AiOcrRequest {
    provider: 'doubao'
    filePath: string
  }

  interface AiOcrResponse {
    sessionId: string
    provider: 'doubao'
    status: AiOcrStatus
    stage: AiOcrStage
    message?: string | null
    resultText?: string | null
  }

  interface AiOcrClipboardImportedEvent {
    sessionId: string
    text: string
  }

  const route = useRoute()
  const bookStore = useBookStore()
  const editorStore = useEditorStore()
  const message = useMessage()
  const dialog = useDialog()
  const { t } = useI18n()

  const bookId = route.params.id as string

  const editorActions = ref<EditorActions | null>(null)
  const cmEditorRef = ref<InstanceType<typeof CodeMirrorEditor> | null>(null)
  const previewRef = ref<InstanceType<typeof MarkdownPreview> | null>(null)
  const splitContainerRef = ref<HTMLElement | null>(null)

  const syncScroll = ref(true)
  const isMobile = ref(window.innerWidth < 768)
  const isFullscreen = ref(false)
  const showChapterDrawer = ref(false)
  const aiOcrProcessing = ref(false)
  const showAiOcrModal = ref(false)
  const pendingAiOcrPath = ref<string | null>(null)
  const aiOcrSessionId = ref<string | null>(null)
  const aiOcrStatus = ref<AiOcrStatus | null>(null)
  const aiOcrStage = ref<AiOcrStage | null>(null)
  const aiOcrStatusMessage = ref('')
  const aiOcrClipboardUnlisten = ref<UnlistenFn | null>(null)

  const { sidebarWidth, editorRatio, onSidebarDragStart, onSplitDragStart } = useResizable(splitContainerRef)
  const {
    showAddChapter, newChapterTitle,
    editingChapterId, editingTitle, chapterSearch, collapsedIds,
    localChapters, filteredChapters,
    handleChapterClick, handleChapterDblClick,
    handleAddChapter, handleAddSubChapter, handlePromoteChapter, handleDeleteChapter,
    confirmRename, cancelRename, toggleCollapse, onChapterSortEnd,
  } = useChapterManager(bookStore, editorStore, cmEditorRef, bookId, message, t)
  const { handleEditorScroll, handlePreviewScroll } = useScrollSync(cmEditorRef, previewRef, syncScroll)
  const { exporting, handleExport: doExport, validateExport } = useEpub()

  const showDrawerToggle = computed(() => isFullscreen.value || isMobile.value)
  const drawerVisible = computed(() => showDrawerToggle.value && showChapterDrawer.value)
  const anyOcrProcessing = computed(() => aiOcrProcessing.value)
  const exportStatusText = computed(() => exporting.value ? t('editor.exporting') : t('editor.exportReady'))
  const aiOcrDisplayStatus = computed(() => {
    if (aiOcrProcessing.value) return aiOcrStatusMessage.value || t('editor.aiOcrStatusRunning')
    if (!aiOcrStatus.value) return t('editor.aiOcrStatusIdle')

    switch (aiOcrStatus.value) {
      case 'needsManual':
        return aiOcrStatusMessage.value || t('editor.aiOcrStatusManual')
      case 'completed':
        return aiOcrStatusMessage.value || t('editor.aiOcrStatusCompleted')
      case 'cancelled':
        return aiOcrStatusMessage.value || t('editor.aiOcrStatusCancelled')
      default:
        return aiOcrStatusMessage.value || t('editor.aiOcrStatusRunning')
    }
  })
  const processingStatusText = computed(() => aiOcrDisplayStatus.value)

  const formatExportIssue = (issue: string) => {
    switch (issue) {
      case 'Book not found':
        return t('epub.noBook')
      case 'Book title is required for export':
        return t('epub.validation.bookTitleRequired')
      case 'No chapters to export':
        return t('epub.noChapters')
      case 'Every chapter must have a title before export':
        return t('epub.validation.chapterTitleRequired')
      case 'Duplicate chapter titles may make the table of contents harder to scan':
        return t('epub.validation.duplicateChapterTitle')
      case 'Large embedded images may affect export size and reader compatibility':
        return t('epub.validation.largeEmbeddedImage')
      default:
        return issue
    }
  }

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

  const confirmExportWarnings = (warnings: string[]) => {
    return new Promise<boolean>((resolve) => {
      dialog.warning({
        title: t('epub.validation.warningTitle'),
        content: warnings.map(formatExportIssue).join('\n'),
        positiveText: t('epub.validation.continueExport'),
        negativeText: t('home.cancel'),
        onPositiveClick: () => resolve(true),
        onNegativeClick: () => resolve(false),
        onClose: () => resolve(false),
      })
    })
  }

  const handleResize = () => {
    isMobile.value = window.innerWidth < 768
    if (!isMobile.value) return
    showChapterDrawer.value = false
  }

  const toggleFullscreen = () => {
    isFullscreen.value = !isFullscreen.value
    showChapterDrawer.value = false
  }

  const onMenuFindReplace = () => editorActions.value?.openSearch()
  const onMenuScrollSync = () => {
    syncScroll.value = !syncScroll.value
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'F11') {
      e.preventDefault()
      toggleFullscreen()
    }

    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void editorStore.flushSave()
    }
  }

  const handleEditorAreaClick = () => {
    if (editingChapterId.value) {
      confirmRename()
    }
  }

  const handleContentChange = (value: string) => {
    editorStore.setContent(value)
  }

  const handleAiOcr = async () => {
    if (!isTauri()) {
      message.warning(t('editor.aiOcrDesktopOnly'))
      return
    }

    const selected = await open({
      multiple: false,
      filters: [{ name: 'Scans', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'tiff', 'tif', 'pdf'] }],
    })
    if (!selected) return

    pendingAiOcrPath.value = selected as string
    aiOcrSessionId.value = null
    aiOcrStatus.value = null
    aiOcrStage.value = null
    aiOcrStatusMessage.value = ''
    showAiOcrModal.value = true
  }

  const applyAiOcrResult = async (resultText?: string | null) => {
    if (!resultText?.trim()) return false

    const text = resultText.trim()
    showAiOcrModal.value = false
    await nextTick()
    await sleep(120)

    const beforeContent = editorStore.content
    const spacer = beforeContent && !beforeContent.endsWith('\n') ? '\n' : ''
    const merged = `${beforeContent}${spacer}${text}`
    editorStore.setContent(merged)
    cmEditorRef.value?.loadContent(merged)
    await nextTick()
    cmEditorRef.value?.focus()

    pendingAiOcrPath.value = null
    aiOcrSessionId.value = null
    aiOcrStatus.value = 'completed'
    aiOcrStage.value = 'completed'
    aiOcrStatusMessage.value = t('editor.aiOcrStatusCompleted')
    message.success(t('editor.aiOcrImportSuccess'))
    return true
  }

  const syncAiOcrResponse = (response: AiOcrResponse) => {
    aiOcrSessionId.value = response.sessionId
    aiOcrStatus.value = response.status
    aiOcrStage.value = response.stage
    aiOcrStatusMessage.value = response.message || ''
  }

  const startAiOcrSession = async () => {
    if (!pendingAiOcrPath.value) return

    aiOcrProcessing.value = true
    aiOcrStatusMessage.value = t('editor.aiOcrStatusRunning')
    try {
      const response = await invoke<AiOcrResponse>('start_doubao_ocr_session', {
        request: {
          provider: 'doubao',
          filePath: pendingAiOcrPath.value,
        } satisfies AiOcrRequest,
      })
      syncAiOcrResponse(response)

      if (response.status === 'completed' && await applyAiOcrResult(response.resultText)) return
      if (response.status === 'needsManual') {
        message.warning(t('editor.aiOcrManualTakeover'))
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      aiOcrStatus.value = 'failed'
      aiOcrStatusMessage.value = reason
      message.error(`${t('editor.aiOcrFailed')}: ${reason}`)
    } finally {
      aiOcrProcessing.value = false
    }
  }

  const cancelAiOcr = () => {
    if (aiOcrSessionId.value) {
      void invoke<AiOcrResponse>('cancel_doubao_ocr_session', {
        sessionId: aiOcrSessionId.value,
      }).catch(() => { })
    }
    showAiOcrModal.value = false
    pendingAiOcrPath.value = null
    aiOcrSessionId.value = null
    aiOcrStatus.value = 'cancelled'
    aiOcrStage.value = 'cancelled'
    aiOcrStatusMessage.value = t('editor.aiOcrStatusCancelled')
  }

  const openDevtools = async () => {
    if (!isTauri()) {
      message.warning(t('editor.devtoolsDesktopOnly'))
      return
    }

    try {
      await invoke('open_devtools')
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      message.error(`${t('editor.devtoolsOpenFailed')}: ${reason}`)
    }
  }

  const handleExport = async () => {
    try {
      await editorStore.flushSave()

      const validation = await validateExport(bookId)
      if (validation.blockingErrors.length > 0) {
        message.error(validation.blockingErrors.map(formatExportIssue).join('\n'))
        return
      }

      if (validation.warnings.length > 0) {
        const shouldContinue = await confirmExportWarnings(validation.warnings)
        if (!shouldContinue) return
      }

      const title = bookStore.activeBook?.meta.title || t('editor.exportEpub')
      const result = await doExport(bookId, title)

      if (result.status === 'cancelled') {
        message.info(t('epub.exportCancelled'))
        return
      }

      message.success(t('epub.exportSaved'))
      if (isTauri()) {
        import('@tauri-apps/plugin-notification')
          .then(({ sendNotification }) => {
            sendNotification({ title: 'EPUB Builder', body: t('epub.exportSaved') })
          })
          .catch(() => { })
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : t('epub.exportFailed')
      message.error(reason)
    }
  }

  onMounted(async () => {
    await bookStore.openBook(bookId)
    if (isTauri()) {
      aiOcrClipboardUnlisten.value = await listen<AiOcrClipboardImportedEvent>('ai-ocr-clipboard-imported', (event) => {
        if (event.payload.sessionId !== aiOcrSessionId.value) return
        aiOcrStatusMessage.value = t('editor.aiOcrClipboardReading')
        void applyAiOcrResult(event.payload.text)
      })
    }

    window.addEventListener('resize', handleResize)
    window.addEventListener('keydown', handleKeydown)
    window.addEventListener('menu-export', handleExport)
    window.addEventListener('menu-find-replace', onMenuFindReplace)
    window.addEventListener('menu-fullscreen', toggleFullscreen)
    window.addEventListener('menu-scroll-sync', onMenuScrollSync)
  })

  onBeforeUnmount(() => {
    aiOcrClipboardUnlisten.value?.()
    aiOcrClipboardUnlisten.value = null
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('keydown', handleKeydown)
    window.removeEventListener('menu-export', handleExport)
    window.removeEventListener('menu-find-replace', onMenuFindReplace)
    window.removeEventListener('menu-fullscreen', toggleFullscreen)
    window.removeEventListener('menu-scroll-sync', onMenuScrollSync)
  })

  watch(cmEditorRef, (cm) => {
    if (!cm) return

    editorActions.value = {
      insertText: (text: string) => cm.insertText(text),
      wrapSelection: (before: string, after: string) => cm.wrapSelection(before, after),
      indentSelection: () => cm.indentSelection(),
      indentAll: () => cm.indentAll(),
      dedentSelection: () => cm.dedentSelection(),
      dedentAll: () => cm.dedentAll(),
      setFontSize: (size: number) => cm.setFontSize(size),
      openSearch: () => cm.openSearch(),
    }
  }, { immediate: true })

  watch(() => bookStore.currentChapter, (chapter) => {
    if (!chapter) return

    void editorStore.flushSave()
    editorStore.loadChapterContent(chapter.content)
    cmEditorRef.value?.loadContent(chapter.content)
    showChapterDrawer.value = false
  })
</script>

<template>
  <div class="editor-page h-full flex" :class="{ 'is-fullscreen': isFullscreen }">
    <Transition name="drawer">
      <aside
        v-if="drawerVisible"
        class="fullscreen-drawer chapter-sidebar flex flex-col overflow-hidden"
        @click.stop>
        <div class="flex items-center justify-between px-3 shrink-0 sidebar-header">
          <span class="text-sm font-semibold sidebar-title">
            <span class="i-carbon-catalog mr-1" />{{ t('editor.chapterList') }}
          </span>
          <NButton quaternary size="tiny" type="primary" @click="showAddChapter = true">
            <span class="i-carbon-add text-base font-black" />
          </NButton>
        </div>

        <div class="px-2 py-1 shrink-0 sidebar-search">
          <NInput v-model:value="chapterSearch" size="tiny" :placeholder="t('editor.searchChapter')" clearable>
            <template #prefix>
              <span class="i-carbon-search text-xs sidebar-icon" />
            </template>
          </NInput>
        </div>

        <NScrollbar class="flex-1">
          <div class="p-2">
            <ChapterNode :parent-id="null" :chapters="chapterSearch.trim() ? filteredChapters : localChapters"
              :current-chapter-id="bookStore.currentChapter?.id" :editing-chapter-id="editingChapterId"
              :editing-title="editingTitle" :collapsed-ids="collapsedIds"
              :delete-confirm-text="t('editor.confirmDeleteChapter')" :add-sub-text="t('editor.addSubChapter')"
              :promote-text="t('editor.promoteChapter')" :delete-text="t('editor.deleteChapter')"
              :confirm-text="t('editor.confirm')" :cancel-text="t('editor.cancel')"
              :rename-placeholder="t('editor.renamePlaceholder')" @select="handleChapterClick"
              @rename-start="handleChapterDblClick" @rename-confirm="confirmRename" @rename-cancel="cancelRename"
              @rename-input="editingTitle = $event" @add-sub="handleAddSubChapter" @promote="handlePromoteChapter"
              @delete="handleDeleteChapter" @reorder="onChapterSortEnd" @toggle-collapse="toggleCollapse" />
          </div>
        </NScrollbar>

        <div class="sidebar-statusbar flex items-center justify-center px-3 shrink-0">
          <span class="flex items-center gap-1 text-xs sidebar-status-text">
            <span>Powered By Love</span>
            <span class="i-carbon-favorite text-[10px]" />
          </span>
        </div>
      </aside>
    </Transition>

    <div v-if="drawerVisible" class="fullscreen-overlay" @click="showChapterDrawer = false" />

    <div v-if="anyOcrProcessing" class="ocr-overlay">
      <div class="ocr-overlay-card">
        <span class="ocr-overlay-spinner i-carbon-renew" />
        <span class="ocr-overlay-text">{{ processingStatusText || t('editor.ocrProcessing') }}</span>
      </div>
    </div>

    <aside v-if="!isMobile && !isFullscreen" class="chapter-sidebar shrink-0 flex flex-col overflow-hidden"
      :style="{ width: sidebarWidth + 'px' }">
      <div class="flex items-center justify-between px-3 shrink-0 sidebar-header">
        <span class="text-sm font-semibold sidebar-title">
          <span class="i-carbon-catalog mr-1" />{{ t('editor.chapterList') }}
        </span>
        <NButton quaternary size="tiny" type="primary" @click="showAddChapter = true">
          <span class="i-carbon-add text-base font-black" />
        </NButton>
      </div>

      <div class="px-2 py-1 shrink-0 sidebar-search">
        <NInput v-model:value="chapterSearch" size="tiny" :placeholder="t('editor.searchChapter')" clearable>
          <template #prefix>
            <span class="i-carbon-search text-xs sidebar-icon" />
          </template>
        </NInput>
      </div>

      <NScrollbar class="flex-1">
        <div class="p-2">
          <ChapterNode :parent-id="null" :chapters="chapterSearch.trim() ? filteredChapters : localChapters"
            :current-chapter-id="bookStore.currentChapter?.id" :editing-chapter-id="editingChapterId"
            :editing-title="editingTitle" :collapsed-ids="collapsedIds"
            :delete-confirm-text="t('editor.confirmDeleteChapter')" :add-sub-text="t('editor.addSubChapter')"
            :promote-text="t('editor.promoteChapter')" :delete-text="t('editor.deleteChapter')"
            :confirm-text="t('editor.confirm')" :cancel-text="t('editor.cancel')"
            :rename-placeholder="t('editor.renamePlaceholder')" @select="handleChapterClick"
            @rename-start="handleChapterDblClick" @rename-confirm="confirmRename" @rename-cancel="cancelRename"
            @rename-input="editingTitle = $event" @add-sub="handleAddSubChapter" @promote="handlePromoteChapter"
            @delete="handleDeleteChapter" @reorder="onChapterSortEnd" @toggle-collapse="toggleCollapse" />
          <div v-if="bookStore.chapters.length === 0" class="text-center text-sm py-8 sidebar-empty">
            <span class="i-carbon-document-blank text-2xl block mb-2" />
            {{ t('editor.noChapters') }}
          </div>
        </div>
      </NScrollbar>

      <div class="sidebar-statusbar flex items-center justify-center px-3 shrink-0">
        <span class="flex items-center gap-1 text-xs sidebar-status-text">
          <span>Powered By Love</span>
          <span class="i-carbon-favorite text-[10px]" />
        </span>
      </div>
    </aside>

    <div v-if="!isMobile && !isFullscreen" class="resize-handle" @mousedown="onSidebarDragStart" />

    <main class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" @click="handleEditorAreaClick">
      <EditorToolbar :editor-ref="editorActions" :exporting="exporting" :ocr-processing="anyOcrProcessing"
        :show-chapter-toggle="showDrawerToggle" :chapter-toggle-active="showChapterDrawer" :sync-scroll="syncScroll"
        :compact="isMobile" @export="handleExport" @ai-ocr="handleAiOcr" @fullscreen="toggleFullscreen"
        @open-devtools="openDevtools" @toggle-chapter="showChapterDrawer = !showChapterDrawer"
        @toggle-scroll-sync="onMenuScrollSync" />

      <div ref="splitContainerRef" class="split-container flex-1 flex min-h-0 overflow-hidden">
        <div class="min-h-0 overflow-hidden" :style="{ width: isMobile ? '100%' : `${editorRatio * 100}%` }"
          :class="{ hidden: isMobile && editorStore.previewMode }">
          <CodeMirrorEditor ref="cmEditorRef" :model-value="editorStore.content"
            @update:model-value="handleContentChange"
            @scroll="handleEditorScroll" />
        </div>

        <div v-if="!isMobile" class="resize-handle" @mousedown="onSplitDragStart" />

        <div class="min-h-0 overflow-hidden" :style="{ width: isMobile ? '100%' : `${(1 - editorRatio) * 100}%` }"
          :class="{ hidden: isMobile && !editorStore.previewMode }">
          <MarkdownPreview ref="previewRef" :content="editorStore.content" @scroll="handlePreviewScroll" />
        </div>
      </div>

      <div class="editor-statusbar flex items-center justify-between gap-3 px-3 shrink-0">
        <span class="text-xs status-counts">
          {{ t('editor.wordCount', { count: editorStore.wordCount }) }} · {{ t('editor.charCount', {
            count:
              editorStore.charCount }) }}
        </span>
        <div class="flex items-center gap-3">
          <span class="text-xs export-status" :class="{ active: exporting }">
            <span class="export-dot" />
            {{ exportStatusText }}
          </span>
          <span class="save-status text-xs" :class="`save-${editorStore.saveStatus}`">
            <span class="save-dot" />
            <template v-if="editorStore.saveStatus === 'idle'">{{ t('editor.saveIdle') }}</template>
            <template v-else-if="editorStore.saveStatus === 'dirty'">{{ t('editor.saveDirty') }}</template>
            <template v-else-if="editorStore.saveStatus === 'saving'">{{ t('editor.saveSaving') }}</template>
            <template v-else>{{ t('editor.saveSaved') }}</template>
          </span>
        </div>
      </div>

      <div v-if="isMobile" class="mobile-tabs flex">
        <button class="mobile-tab flex-1 py-2 text-sm text-center transition-colors"
          :class="{ active: !editorStore.previewMode }" @click="editorStore.previewMode = false">
          <span class="i-carbon-edit mr-1" />{{ t('mobile.edit') }}
        </button>
        <button class="mobile-tab flex-1 py-2 text-sm text-center transition-colors"
          :class="{ active: editorStore.previewMode }" @click="editorStore.previewMode = true">
          <span class="i-carbon-view mr-1" />{{ t('mobile.preview') }}
        </button>
      </div>
    </main>

    <NModal v-model:show="showAddChapter" preset="card" :title="t('editor.addChapter')" class="max-w-sm">
      <NInput v-model:value="newChapterTitle" :placeholder="t('editor.chapterTitle')" @keyup.enter="handleAddChapter" />
      <template #action>
        <div class="flex justify-end gap-2">
          <NButton @click="showAddChapter = false">{{ t('home.cancel') }}</NButton>
          <NButton type="primary" @click="handleAddChapter">{{ t('editor.addChapter') }}</NButton>
        </div>
      </template>
    </NModal>

    <NModal v-model:show="showAiOcrModal" preset="card" :title="t('editor.aiOcrTitle')" class="max-w-xl">
      <div class="ai-ocr-panel">
        <p class="ai-ocr-hint">{{ t('editor.aiOcrHint') }}</p>
        <div class="ai-ocr-field">
          <span class="ai-ocr-label">{{ t('editor.aiOcrProviderLabel') }}</span>
          <NInput :value="t('editor.aiOcrProviderValue')" readonly />
        </div>
        <div class="ai-ocr-field">
          <span class="ai-ocr-label">{{ t('editor.aiOcrFileLabel') }}</span>
          <NInput :value="pendingAiOcrPath || ''" readonly />
        </div>
        <div class="ai-ocr-field">
          <span class="ai-ocr-label">{{ t('editor.aiOcrStatusLabel') }}</span>
          <NInput :value="aiOcrDisplayStatus" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" readonly />
        </div>
      </div>
      <template #action>
        <div class="flex flex-wrap justify-end gap-2">
          <NButton @click="cancelAiOcr">{{ t('home.cancel') }}</NButton>
          <NButton
            v-if="aiOcrStatus !== 'needsManual'"
            type="primary"
            :loading="aiOcrProcessing"
            @click="startAiOcrSession"
          >
            {{ t('editor.aiOcrStart') }}
          </NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
  .editor-page {
    background: var(--bg-base);
  }

  .ai-ocr-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .ai-ocr-hint {
    margin: 0;
    color: var(--text-secondary);
    font-size: 13px;
    line-height: 1.5;
  }

  .ai-ocr-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .ai-ocr-label {
    color: var(--text-secondary);
    font-size: 12px;
    font-weight: 600;
  }

  .chapter-sidebar,
  .mobile-tabs {
    background: var(--bg-surface);
    backdrop-filter: blur(8px);
  }

  .sidebar-header,
  .sidebar-search {
    border-bottom: 1px solid var(--border-color);
  }

  .sidebar-header {
    height: 40px;
  }

  .sidebar-title {
    color: var(--text-secondary);
  }

  .sidebar-icon,
  .sidebar-empty,
  .status-counts {
    color: var(--text-muted);
  }

  .mobile-tab {
    color: var(--text-muted);
  }

  .mobile-tab.active {
    color: var(--primary);
    background: var(--bg-active);
  }

  .ocr-overlay {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.26);
    backdrop-filter: blur(2px);
  }

  .ocr-overlay-card {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 180px;
    padding: 16px 18px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-surface);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
  }

  .ocr-overlay-spinner {
    color: var(--primary);
    font-size: 18px;
    animation: dot-spin 0.8s linear infinite;
  }

  .ocr-overlay-text {
    color: var(--text-primary);
    font-size: 14px;
  }

  .resize-handle {
    width: 4px;
    cursor: col-resize;
    background: var(--border-color);
    transition: background 0.2s, width 0.15s;
    flex-shrink: 0;
  }

  .resize-handle:hover {
    background: var(--primary);
    width: 6px;
  }

  .editor-statusbar {
    min-height: 28px;
    border-top: 1px solid var(--border-color);
  }

  .sidebar-statusbar {
    min-height: 28px;
    border-top: 1px solid var(--border-color);
  }

  .sidebar-status-text {
    color: var(--text-muted);
  }

  .save-status,
  .export-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
  }

  .save-dot,
  .export-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .save-dot {
    background: var(--text-muted);
    transition: background 0.2s ease;
  }

  .export-dot {
    background: var(--text-muted);
  }

  .export-status.active {
    color: var(--primary);
  }

  .export-status.active .export-dot {
    background: var(--primary);
    animation: dot-spin 0.8s linear infinite;
  }

  .save-idle .save-dot {
    background: var(--text-muted);
  }

  .save-dirty .save-dot {
    background: #e0a040;
    animation: dot-breathe 1.5s ease-in-out infinite;
  }

  .save-dirty {
    color: #e0a040;
  }

  .save-saving .save-dot {
    background: var(--primary);
    animation: dot-spin 0.8s linear infinite;
  }

  .save-saving {
    color: var(--primary);
  }

  .save-saved .save-dot {
    background: #4caf50;
  }

  .save-saved {
    color: #4caf50;
  }

  @keyframes dot-breathe {

    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }

    50% {
      opacity: 0.5;
      transform: scale(0.8);
    }
  }

  @keyframes dot-spin {
    from {
      transform: rotate(0deg);
    }

    to {
      transform: rotate(360deg);
    }
  }

  .is-fullscreen {
    position: fixed;
    inset: 0;
    z-index: 100;
  }

  .fullscreen-drawer {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: min(300px, 86vw);
    z-index: 200;
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.15);
  }

  .fullscreen-overlay {
    position: fixed;
    inset: 0;
    z-index: 150;
    background: rgba(0, 0, 0, 0.3);
  }

  .drawer-enter-active,
  .drawer-leave-active {
    transition: transform 0.2s ease;
  }

  .drawer-enter-from,
  .drawer-leave-to {
    transform: translateX(-100%);
  }

  @media (max-width: 767px) {
    .editor-statusbar {
      padding-top: 4px;
      padding-bottom: 4px;
      flex-wrap: wrap;
    }
  }
</style>
