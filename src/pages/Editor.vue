<script setup lang="ts">
  import { onMounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { useI18n } from 'vue-i18n'
  import { NButton, NInput, NScrollbar, NModal, useMessage } from 'naive-ui'
  import { useBookStore } from '@/stores/book'
  import { useEditorStore } from '@/stores/editor'
  import { useEpub } from '@/composables/useEpub'
  import CodeMirrorEditor from '@/components/editor/CodeMirrorEditor.vue'
  import type { EditorActions } from '@/components/editor/EditorToolbar.vue'
  import EditorToolbar from '@/components/editor/EditorToolbar.vue'
  import MarkdownPreview from '@/components/preview/MarkdownPreview.vue'
  import { open } from '@tauri-apps/plugin-dialog'
  import { invoke } from '@tauri-apps/api/core'
  import type { Chapter } from '@/types'
  import ChapterNode from '@/components/editor/ChapterNode.vue'

  const route = useRoute()
  const router = useRouter()
  const bookStore = useBookStore()
  const editorStore = useEditorStore()
  const message = useMessage()
  const { t } = useI18n()

  const editorActions = ref<EditorActions | null>(null)
  const cmEditorRef = ref<InstanceType<typeof CodeMirrorEditor> | null>(null)
  const showAddChapter = ref(false)
  const newChapterTitle = ref('')
  const addChapterParentId = ref<string | null>(null)
  const editingChapterId = ref<string | null>(null)
  const editingTitle = ref('')
  const isMobile = ref(window.innerWidth < 768)
  const collapsedIds = ref<Set<string>>(new Set())

  // 拖拽分割线宽度（持久化）
  const sidebarWidth = ref(Number(localStorage.getItem('editor-sidebar-width')) || 240)
  const editorRatio = ref(Number(localStorage.getItem('editor-split-ratio')) || 0.5)
  const splitContainerRef = ref<HTMLElement | null>(null)

  const SIDEBAR_MIN = 160
  const SIDEBAR_MAX = 400

  // 持久化保存
  watch(sidebarWidth, (val) => localStorage.setItem('editor-sidebar-width', String(val)))
  watch(editorRatio, (val) => localStorage.setItem('editor-split-ratio', String(val)))

  let draggingSidebar = false
  let draggingSplit = false
  let dragStartX = 0
  let dragStartWidth = 0
  let dragStartRatio = 0

  const onSidebarDragStart = (e: MouseEvent) => {
    draggingSidebar = true
    dragStartX = e.clientX
    dragStartWidth = sidebarWidth.value
    document.addEventListener('mousemove', onSidebarDragMove)
    document.addEventListener('mouseup', onDragEnd)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  const onSidebarDragMove = (e: MouseEvent) => {
    if (!draggingSidebar) return
    const delta = e.clientX - dragStartX
    sidebarWidth.value = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, dragStartWidth + delta))
  }

  const onSplitDragStart = (e: MouseEvent) => {
    draggingSplit = true
    dragStartX = e.clientX
    dragStartRatio = editorRatio.value
    document.addEventListener('mousemove', onSplitDragMove)
    document.addEventListener('mouseup', onDragEnd)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  }

  const onSplitDragMove = (e: MouseEvent) => {
    if (!draggingSplit || !splitContainerRef.value) return
    const rect = splitContainerRef.value.getBoundingClientRect()
    const delta = e.clientX - dragStartX
    const deltaRatio = delta / rect.width
    editorRatio.value = Math.min(0.8, Math.max(0.2, dragStartRatio + deltaRatio))
  }

  const onDragEnd = () => {
    draggingSidebar = false
    draggingSplit = false
    document.removeEventListener('mousemove', onSidebarDragMove)
    document.removeEventListener('mousemove', onSplitDragMove)
    document.removeEventListener('mouseup', onDragEnd)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  const bookId = route.params.id as string

  onMounted(async () => {
    await bookStore.openBook(bookId)
    window.addEventListener('resize', handleResize)
  })

  // 将 CodeMirrorEditor 暴露的方法传递给 toolbar
  watch(cmEditorRef, (cm) => {
    if (cm) {
      editorActions.value = {
        insertText: (text: string) => cm.insertText(text),
        wrapSelection: (before: string, after: string) => cm.wrapSelection(before, after),
      }
    }
  }, { immediate: true })

  const handleResize = () => {
    isMobile.value = window.innerWidth < 768
  }

  const handleBack = () => {
    router.push('/')
  }

  const handleSelectChapter = (chapterId: string) => {
    const chapter = bookStore.chapters.find((c) => c.id === chapterId)
    if (chapter) {
      bookStore.selectChapter(chapter)
      editorStore.loadChapterContent(chapter.content)
    }
  }

  // 单击章节：仅选中
  const handleChapterClick = (chapter: { id: string; title: string }) => {
    if (editingChapterId.value === chapter.id) return // 正在编辑此章节
    if (editingChapterId.value) {
      confirmRename() // 先保存正在编辑的
    }
    handleSelectChapter(chapter.id)
  }

  // 双击章节：选中 + 进入编辑
  const handleChapterDblClick = (chapter: { id: string; title: string }) => {
    handleSelectChapter(chapter.id)
    startRenameChapter(chapter.id, chapter.title)
  }

  // 点击编辑区外部退出编辑
  const handleEditorAreaClick = () => {
    if (editingChapterId.value) {
      confirmRename()
    }
  }

  // 拖拽排序后的回调
  const onChapterSortEnd = async (parentId: string | null, orderedIds: string[]) => {
    await bookStore.reorderChapters(parentId, orderedIds)
  }

  // 本地可拖拽章节列表（VueDraggable 需要 v-model 可写）
  const localChapters = ref<Chapter[]>([])

  // 同步 store → local
  watch(() => bookStore.chapters, (chapters) => {
    localChapters.value = [...chapters]
  }, { immediate: true, deep: true })

  const handleAddChapter = async () => {
    if (!newChapterTitle.value.trim()) {
      message.warning(t('editor.chapterTitle'))
      return
    }
    await bookStore.addChapter(bookId, newChapterTitle.value.trim(), addChapterParentId.value)
    newChapterTitle.value = ''
    addChapterParentId.value = null
    showAddChapter.value = false
    message.success(t('editor.chapterAdded'))
  }

  const handleAddSubChapter = (parentId: string) => {
    addChapterParentId.value = parentId
    showAddChapter.value = true
  }

  const handlePromoteChapter = async (chapterId: string) => {
    await bookStore.moveChapterToParent(chapterId, null)
    message.success(t('editor.chapterPromoted'))
  }

  const handleDeleteChapter = async (chapterId: string) => {
    await bookStore.deleteChapter(chapterId)
    message.success(t('editor.chapterDeleted'))
  }

  const startRenameChapter = (chapterId: string, currentTitle: string) => {
    editingChapterId.value = chapterId
    editingTitle.value = currentTitle
  }

  const confirmRename = async () => {
    if (!editingChapterId.value) return
    const title = editingTitle.value.trim()
    if (!title) {
      message.warning(t('editor.titleEmpty'))
      return
    }
    await bookStore.renameChapter(editingChapterId.value, title)
    editingChapterId.value = null
    editingTitle.value = ''
  }

  const cancelRename = () => {
    editingChapterId.value = null
    editingTitle.value = ''
  }

  const toggleCollapse = (id: string) => {
    const s = new Set(collapsedIds.value)
    if (s.has(id)) s.delete(id)
    else s.add(id)
    collapsedIds.value = s
  }

  const handleContentChange = (value: string) => {
    editorStore.setContent(value)
  }

  const ocrProcessing = ref(false)

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

  const { exporting, handleExport: doExport } = useEpub()

  const handleExport = async () => {
    try {
      const title = bookStore.activeBook?.meta.title || t('editor.exportEpub')
      await doExport(bookId, title)
      message.success(t('editor.exportEpub'))
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
        editorStore.loadChapterContent(chapter.content)
      }
    },
  )
</script>

<template>
  <div class="editor-page h-full flex">
    <!-- 左侧章节面板 -->
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

      <NScrollbar class="flex-1">
        <div class="p-2">
          <ChapterNode
            :parent-id="null"
            :chapters="localChapters"
            :current-chapter-id="bookStore.currentChapter?.id"
            :editing-chapter-id="editingChapterId"
            :collapsed-ids="collapsedIds"
            :delete-confirm-text="t('editor.confirmDeleteChapter')"
            :add-sub-text="t('editor.addSubChapter')"
            :promote-text="t('editor.promoteChapter')"
            :delete-text="t('editor.deleteChapter')"
            :confirm-text="t('editor.confirm')"
            :cancel-text="t('editor.cancel')"
            @select="handleChapterClick"
            @rename-start="handleChapterDblClick"
            @rename-confirm="confirmRename"
            @rename-cancel="cancelRename"
            @add-sub="handleAddSubChapter"
            @promote="handlePromoteChapter"
            @delete="handleDeleteChapter"
            @reorder="onChapterSortEnd"
            @toggle-collapse="toggleCollapse" />
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
      <EditorToolbar :editor-ref="editorActions" :exporting="exporting" @export="handleExport" @ocr="handleOcr" />

      <!-- 编辑器 + 预览 分屏 -->
      <div ref="splitContainerRef" class="split-container flex-1 flex min-h-0 overflow-hidden">
        <!-- 编辑器 -->
        <div class="min-h-0 overflow-hidden" :style="{ width: isMobile ? '100%' : (editorRatio * 100) + '%' }"
          :class="{ hidden: isMobile && editorStore.previewMode }">
          <CodeMirrorEditor ref="cmEditorRef" :model-value="editorStore.content"
            @update:model-value="handleContentChange" />
        </div>

        <!-- 编辑器/预览 分割线 -->
        <div v-if="!isMobile" class="resize-handle" @mousedown="onSplitDragStart" />

        <!-- 预览 -->
        <div class="min-h-0 overflow-hidden" :style="{ width: isMobile ? '100%' : ((1 - editorRatio) * 100) + '%' }"
          :class="{ hidden: isMobile && !editorStore.previewMode }">
          <MarkdownPreview :content="editorStore.content" />
        </div>
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
    transition: background 0.2s;
    flex-shrink: 0;
  }

  .resize-handle:hover {
    background: var(--primary);
  }
</style>
