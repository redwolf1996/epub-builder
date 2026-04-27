import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useBook } from '@/composables/useBook'
import { useChapter } from '@/composables/useChapter'
import type { Book } from '@/types'

export const useBookStore = defineStore('book', () => {
  const { books, loading: bookLoading, loadBooks, getBook, getChapterCounts, createBook, updateBookMeta: persistBookMeta, deleteBook } = useBook()
  const {
    chapters,
    currentChapter,
    loading: chapterLoading,
    loadChapters,
    addChapter,
    updateChapterContent,
    updateChapterTitle,
    deleteChapter,
    reorderChapters,
    moveChapterToParent,
    selectChapter,
  } = useChapter()

  const activeBook = ref<Book | null>(null)

  const initBookList = async () => {
    await loadBooks()
  }

  const openBook = async (bookId: string) => {
    const book = await getBook(bookId)
    if (!book) return
    activeBook.value = book
    await loadChapters(bookId)
    if (chapters.value.length > 0) {
      // 优先恢复上次编辑的章节
      const lastChapterId = localStorage.getItem(`editor-chapter-${bookId}`)
      const lastChapter = lastChapterId ? chapters.value.find((c) => c.id === lastChapterId) : null
      if (lastChapter) {
        selectChapter(lastChapter)
      } else {
        // 默认选中第一个顶级章节
        const topLevel = chapters.value
          .filter((c) => !c.parentId)
          .sort((a, b) => a.order - b.order)
        selectChapter(topLevel[0] ?? chapters.value[0])
      }
    }
  }

  const saveCurrentChapter = async (content: string) => {
    if (!currentChapter.value) return
    await updateChapterContent(currentChapter.value.id, content)
  }

  const getLoading = () => bookLoading.value || chapterLoading.value

  const renameChapter = async (chapterId: string, title: string) => {
    await updateChapterTitle(chapterId, title)
  }

  const updateBookMeta = async (id: string, meta: Partial<Book['meta']>) => {
    const updatedBook = await persistBookMeta(id, meta)
    if (!updatedBook) return null

    if (activeBook.value?.id === id) {
      activeBook.value = updatedBook
    }

    return updatedBook
  }

  return {
    books,
    activeBook,
    chapters,
    currentChapter,
    loading: getLoading,
    initBookList,
    openBook,
    getBook,
    getChapterCounts,
    createBook,
    updateBookMeta,
    deleteBook,
    addChapter,
    updateChapterContent,
    updateChapterTitle,
    renameChapter,
    deleteChapter,
    reorderChapters,
    moveChapterToParent,
    selectChapter,
    saveCurrentChapter,
  }
})
