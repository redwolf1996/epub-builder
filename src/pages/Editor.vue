<script setup lang="ts">
  import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { useI18n } from 'vue-i18n'
  import { NButton, NInput, NScrollbar, NModal, useMessage } from 'naive-ui'
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
  import { open } from '@tauri-apps/plugin-dialog'
  import { invoke } from '@tauri-apps/api/core'
  import ChapterNode from '@/components/editor/ChapterNode.vue'

  const route = useRoute()
  const router = useRouter()
  const bookStore = useBookStore()
  const editorStore = useEditorStore()
  const message = useMessage()
  const { t } = useI18n()

  const bookId = route.params.id as string

  const editorActions = ref<EditorActions | null>(null)
  const cmEditorRef = ref<InstanceType<typeof CodeMirrorEditor> | null>(null)
  const previewRef = ref<InstanceType<typeof MarkdownPreview> | null>(null)
  const syncScroll = ref(true)
  const isMobile = ref(window.innerWidth < 768)
  const isFullscreen = ref(false)
  const showFullscreenDrawer = ref(false)
  const ocrProcessing = ref(false)
  const splitContainerRef = ref<HTMLElement | null>(null)

  // --- Composables ---
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

  // --- Lifecycle ---
  // 原生菜单事件处理
  const onMenuFindReplace = () => editorActions.value?.openSearch()
  const onMenuScrollSync = () => { syncScroll.value = !syncScroll.value }

  onMounted(async () => {
    await bookStore.openBook(bookId)
    window.addEventListener('resize', handleResize)
    window.addEventListener('keydown', handleKeydown)
    // 原生菜单事件
    window.addEventListener('menu-export', handleExport)
    window.addEventListener('menu-find-replace', onMenuFindReplace)
    window.addEventListener('menu-fullscreen', toggleFullscreen)
    window.addEventListener('menu-scroll-sync', onMenuScrollSync)
  })

  onBeforeUnmount(() => {
    window.removeEventListener('resize', handleResize)
    window.removeEventListener('keydown', handleKeydown)
    window.removeEventListener('menu-export', handleExport)
    window.removeEventListener('menu-find-replace', onMenuFindReplace)
    window.removeEventListener('menu-fullscreen', toggleFullscreen)
    window.removeEventListener('menu-scroll-sync', onMenuScrollSync)
  })

  // 将 CodeMirrorEditor 暴露的方法传递给 toolbar
  watch(cmEditorRef, (cm) => {
    if (cm) {
      editorActions.value = {
        insertText: (text: string) => cm.insertText(text),
        wrapSelection: (before: string, after: string) => cm.wrapSelection(before, after),
        indentSelection: () => cm.indentSelection(),
        indentAll: () => cm.indentAll(),
        dedentSelection: () => cm.dedentSelection(),
        dedentAll: () => cm.dedentAll(),
        setFontSize: (size: number) => cm.setFontSize(size),
        cyclePreviewTheme: () => previewRef.value?.cycleTheme(),
        openSearch: () => cm.openSearch(),
      }
    }
  }, { immediate: true })

  const handleResize = () => {
    isMobile.value = window.innerWidth < 768
  }

  const toggleFullscreen = () => {
    isFullscreen.value = !isFullscreen.value
    showFullscreenDrawer.value = false
  }

  const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === 'F11') {
      e.preventDefault()
      toggleFullscreen()
    }
    // Ctrl+S / Cmd+S 手动保存
    if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      editorStore.flushSave()
    }
  }

  const handleBack = () => {
    router.push('/')
  }

  const handleEditorAreaClick = () => {
    if (editingChapterId.value) {
      confirmRename()
    }
  }

  const handleContentChange = (value: string) => {
    editorStore.setContent(value)
  }

  // OCR
  const handleOcr = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'tiff', 'tif'] }],
    })
    if (!selected) return
    const filePath = selected as string

    ocrProcessing.value = true
    try {
      const text = await invoke<string>('ocr_image', { path: filePath, lang: '' })
      if (!text.trim()) {
        message.warning(t('editor.ocrNoText'))
        return
      }
      editorActions.value?.insertText(text)
      message.success(t('editor.ocrSuccess'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      message.error(`${t('editor.ocrFailed')}: ${msg}`)
    } finally {
      ocrProcessing.value = false
    }
  }

  // EPUB 导出
  const { exporting, handleExport: doExport } = useEpub()

  const handleExport = async () => {
    try {
      await editorStore.flushSave()
      const title = bookStore.activeBook?.meta.title || t('editor.exportEpub')
      const result = await doExport(bookId, title)
      if (result.status !== 'saved') return
      message.success(t('editor.exportEpub'))
      // Tauri 系统通知
      if (isTauri()) {
        import('@tauri-apps/plugin-notification').then(({ sendNotification }) => {
          sendNotification({ title: 'EPUB Builder', body: t('editor.exportEpub') })
        }).catch(() => {})
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('epub.exportFailed')
      message.error(msg)
    }
  }

  // 监听当前章节变化，加载内容
  watch(
    () => bookStore.currentChapter,
    (chapter) => {
      if (chapter) {
        void editorStore.flushSave()
        editorStore.loadChapterContent(chapter.content)
        cmEditorRef.value?.loadContent(chapter.content)
      }
    },
  )
</script>

<template>
  <div class="editor-page h-full flex" :class="{ 'is-fullscreen': isFullscreen }">
    <!-- 全屏模式章节抽屉 -->
    <Transition name="drawer">
      <aside v-if="isFullscreen && showFullscreenDrawer" class="fullscreen-drawer chapter-sidebar flex flex-col overflow-hidden"
        @click.stop>
        <div class="flex items-center justify-between px-3 shrink-0"
          style="height: 36px; border-bottom: 1px solid var(--border-color)">
          <span class="text-sm font-semibold" style="color: var(--text-secondary)">
            <span class="i-carbon-catalog mr-1" />{{ t('editor.chapterList') }}
          </span>
          <NButton quaternary size="tiny" type="primary" @click="showAddChapter = true">
            <span class="i-carbon-add" style="font-size: 16px; font-weight: 900" />
          </NButton>
        </div>

        <div class="px-2 py-1 shrink-0" style="border-bottom: 1px solid var(--border-color)">
          <NInput v-model:value="chapterSearch" size="tiny" :placeholder="t('editor.searchChapter')" clearable>
            <template #prefix>
              <span class="i-carbon-search text-xs" style="color: var(--text-muted)" />
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

        <div class="p-3" style="border-top: 1px solid var(--border-color)">
          <NButton type="primary" ghost block @click="handleBack">
            <span class="i-carbon-arrow-left mr-1" />
            {{ t('editor.backToShelf') }}
          </NButton>
        </div>
      </aside>
    </Transition>

    <!-- 全屏抽屉遮罩 -->
    <div v-if="isFullscreen && showFullscreenDrawer" class="fullscreen-overlay" @click="showFullscreenDrawer = false" />

    <!-- 左侧章节面板（非全屏） -->
    <aside
      v-if="!isMobile"
      class="chapter-sidebar shrink-0 flex flex-col overflow-hidden"
      :style="{ width: sidebarWidth + 'px' }">
      <div class="flex items-center justify-between px-3 shrink-0"
        style="height: 36px; border-bottom: 1px solid var(--border-color)">
        <span class="text-sm font-semibold" style="color: var(--text-secondary)">
          <span class="i-carbon-catalog mr-1" />{{ t('editor.chapterList') }}
        </span>
        <NButton quaternary size="tiny" type="primary" @click="showAddChapter = true">
          <span class="i-carbon-add" style="font-size: 16px; font-weight: 900" />
        </NButton>
      </div>

      <!-- 章节搜索 -->
      <div class="px-2 py-1 shrink-0" style="border-bottom: 1px solid var(--border-color)">
        <NInput v-model:value="chapterSearch" size="tiny" :placeholder="t('editor.searchChapter')" clearable>
          <template #prefix>
            <span class="i-carbon-search text-xs" style="color: var(--text-muted)" />
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
          <div v-if="bookStore.chapters.length === 0" class="text-center text-sm py-8" style="color: var(--text-muted)">
            <span class="i-carbon-document-blank text-2xl block mb-2" />
            {{ t('editor.noChapters') }}
          </div>
        </div>
      </NScrollbar>

      <div class="p-3" style="border-top: 1px solid var(--border-color)">
        <NButton type="primary" ghost block @click="handleBack">
          <span class="i-carbon-arrow-left mr-1" />
          {{ t('editor.backToShelf') }}
        </NButton>
      </div>
    </aside>

    <!-- 目录/编辑器 分割线 -->
    <div v-if="!isMobile" class="resize-handle" @mousedown="onSidebarDragStart" />

    <!-- 主编辑区 -->
    <main class="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" @click="handleEditorAreaClick">
      <!-- 工具栏 -->
      <EditorToolbar :editor-ref="editorActions" :exporting="exporting" :show-chapter-toggle="isFullscreen" :chapter-toggle-active="showFullscreenDrawer" :sync-scroll="syncScroll" @export="handleExport" @ocr="handleOcr"
        @fullscreen="toggleFullscreen" @toggle-chapter="showFullscreenDrawer = !showFullscreenDrawer" @toggle-scroll-sync="onMenuScrollSync" />

      <!-- 编辑器 + 预览 分屏 -->
      <div ref="splitContainerRef" class="split-container flex-1 flex min-h-0 overflow-hidden">
        <!-- 编辑器 -->
        <div class="min-h-0 overflow-hidden" :style="{ width: isMobile ? '100%' : (editorRatio * 100) + '%' }"
          :class="{ hidden: isMobile && editorStore.previewMode }">
          <CodeMirrorEditor ref="cmEditorRef" :model-value="editorStore.content"
            @update:model-value="handleContentChange"
            @scroll="handleEditorScroll" />
        </div>

        <!-- 编辑器/预览 分割线 -->
        <div v-if="!isMobile" class="resize-handle" @mousedown="onSplitDragStart" />

        <!-- 预览 -->
        <div class="min-h-0 overflow-hidden" :style="{ width: isMobile ? '100%' : ((1 - editorRatio) * 100) + '%' }"
          :class="{ hidden: isMobile && !editorStore.previewMode }">
          <MarkdownPreview ref="previewRef" :content="editorStore.content" @scroll="handlePreviewScroll" />
        </div>
      </div>

      <!-- 底部状态栏 -->
      <div class="editor-statusbar flex items-center justify-between px-3 shrink-0"
        style="height: 24px; border-top: 1px solid var(--border-color)">
        <span class="text-xs" style="color: var(--text-muted)">
          {{ t('editor.wordCount', { count: editorStore.wordCount }) }} · {{ t('editor.charCount', {
            count:
              editorStore.charCount
          }) }}
        </span>
        <span class="save-status text-xs" :class="'save-' + editorStore.saveStatus">
          <span class="save-dot" />
          <template v-if="editorStore.saveStatus === 'idle'">{{ t('editor.saveIdle') }}</template>
          <template v-else-if="editorStore.saveStatus === 'dirty'">{{ t('editor.saveDirty') }}</template>
          <template v-else-if="editorStore.saveStatus === 'saving'">{{ t('editor.saveSaving') }}</template>
          <template v-else>{{ t('editor.saveSaved') }}</template>
        </span>
      </div>

      <!-- 手机端底部切换 -->
      <div v-if="isMobile" class="mobile-tabs flex" style="border-top: 1px solid var(--border-color)">
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

    <!-- 新增章节弹窗 -->
    <NModal v-model:show="showAddChapter" preset="card" :title="t('editor.addChapter')" class="max-w-sm">
      <NInput v-model:value="newChapterTitle" :placeholder="t('editor.chapterTitle')" @keyup.enter="handleAddChapter" />
      <template #action>
        <div class="flex justify-end gap-2">
          <NButton @click="showAddChapter = false">{{ t('home.cancel') }}</NButton>
          <NButton type="primary" @click="handleAddChapter">{{ t('editor.addChapter') }}</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>

<style scoped>
  .editor-page {
    background: var(--bg-base);
  }

  .chapter-sidebar {
    background: var(--bg-surface);
    backdrop-filter: blur(8px);
  }

  .mobile-tabs {
    background: var(--bg-surface);
    backdrop-filter: blur(8px);
  }

  .mobile-tab {
    color: var(--text-muted);
  }

  .mobile-tab.active {
    color: var(--primary);
    background: var(--bg-active);
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

  .save-status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--text-muted);
  }

  .save-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
    transition: background 0.2s ease;
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
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(0.8); }
  }

  @keyframes dot-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .is-fullscreen {
    position: fixed;
    inset: 0;
    z-index: 100;
  }

  .is-fullscreen .chapter-sidebar:not(.fullscreen-drawer) {
    display: none;
  }

  .is-fullscreen .resize-handle:first-of-type {
    display: none;
  }

  .fullscreen-drawer {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: 260px;
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
</style>
