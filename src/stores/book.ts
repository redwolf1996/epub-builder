import { defineStore } from 'pinia'
import { ref } from 'vue'
import { useBook } from '@/composables/useBook'
import { useChapter } from '@/composables/useChapter'
import type { Book } from '@/types'

export const useBookStore = defineStore('book', () => {
  const { books, loading: bookLoading, loadBooks, getBook, createBook, updateBookMeta, deleteBook } = useBook()
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
      selectChapter(chapters.value[0])
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

  return {
    books,
    activeBook,
    chapters,
    currentChapter,
    loading: getLoading,
    initBookList,
    openBook,
    getBook,
    createBook,
    updateBookMeta,
    deleteBook,
    addChapter,
    updateChapterContent,
    updateChapterTitle,
    renameChapter,
    deleteChapter,
    reorderChapters,
    selectChapter,
    saveCurrentChapter,
  }
})
