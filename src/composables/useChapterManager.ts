import { ref, watch, computed, type Ref } from 'vue'
import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider'
import type { useBookStore } from '@/stores/book'
import type { useEditorStore } from '@/stores/editor'
import type CodeMirrorEditor from '@/components/editor/CodeMirrorEditor.vue'
import type { Chapter } from '@/types'
import { INVALID_CHAPTER_MOVE } from '@/composables/useChapter'

type CmEditorRef = InstanceType<typeof CodeMirrorEditor>

export function useChapterManager(
  bookStore: ReturnType<typeof useBookStore>,
  editorStore: ReturnType<typeof useEditorStore>,
  cmEditorRef: Ref<CmEditorRef | null>,
  bookId: string,
  message: MessageApiInjection,
  t: (key: string) => string,
) {
  const invalidMoveMessage = '涓嶈兘灏嗙珷鑺傜Щ鍔ㄥ埌鑷繁鎴栧叾瀛愮骇涓嬮潰'
  const showAddChapter = ref(false)
  const newChapterTitle = ref('')
  const addChapterParentId = ref<string | null>(null)
  const editingChapterId = ref<string | null>(null)
  const editingTitle = ref('')
  const chapterSearch = ref('')
  const collapsedIds = ref<Set<string>>(new Set())

  const localChapters = ref<Chapter[]>([])

  watch(() => bookStore.chapters, (chapters) => {
    localChapters.value = [...chapters]
  }, { immediate: true, deep: true })

  const filteredChapters = computed(() => {
    const keyword = chapterSearch.value.trim().toLowerCase()
    if (!keyword) return localChapters.value
    return localChapters.value.filter((c) => c.title.toLowerCase().includes(keyword))
  })

  const handleSelectChapter = (chapterId: string) => {
    const chapter = bookStore.chapters.find((c) => c.id === chapterId)
    if (chapter) {
      editorStore.flushSave()
      editorStore.cancelPendingSave()
      bookStore.selectChapter(chapter)
      editorStore.loadChapterContent(chapter.content)
      cmEditorRef.value?.loadContent(chapter.content)
      localStorage.setItem(`editor-chapter-${bookId}`, chapter.id)
    }
  }

  const handleChapterClick = (chapter: { id: string; title: string }) => {
    if (editingChapterId.value === chapter.id) return
    if (editingChapterId.value) {
      confirmRename()
    }
    handleSelectChapter(chapter.id)
  }

  const handleChapterDblClick = (chapter: { id: string; title: string }) => {
    handleSelectChapter(chapter.id)
    startRenameChapter(chapter.id, chapter.title)
  }

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
    try {
      await bookStore.moveChapterToParent(chapterId, null)
      message.success(t('editor.chapterPromoted'))
    } catch (error) {
      if (error instanceof Error && error.message === INVALID_CHAPTER_MOVE) {
        message.error(invalidMoveMessage)
        return
      }
      throw error
    }
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

  const onChapterSortEnd = async (parentId: string | null, orderedIds: string[]) => {
    try {
      await bookStore.reorderChapters(parentId, orderedIds)
    } catch (error) {
      localChapters.value = [...bookStore.chapters]
      if (error instanceof Error && error.message === INVALID_CHAPTER_MOVE) {
        message.error(invalidMoveMessage)
        return
      }
      throw error
    }
  }

  return {
    showAddChapter,
    newChapterTitle,
    addChapterParentId,
    editingChapterId,
    editingTitle,
    chapterSearch,
    collapsedIds,
    localChapters,
    filteredChapters,
    handleChapterClick,
    handleChapterDblClick,
    handleAddChapter,
    handleAddSubChapter,
    handlePromoteChapter,
    handleDeleteChapter,
    startRenameChapter,
    confirmRename,
    cancelRename,
    toggleCollapse,
    onChapterSortEnd,
  }
}
