import { ref } from 'vue'
import { db } from '@/db'
import type { Book, BookMeta } from '@/types'

export function useBook() {
  const books = ref<Book[]>([])
  const loading = ref(false)

  const sortBooks = (list: Book[]) => {
    return [...list].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  const loadBooks = async () => {
    loading.value = true
    try {
      try {
        const list = await db.books.orderBy('updatedAt').reverse().toArray()
        books.value = sortBooks(list)
      } catch (error) {
        console.error('loadBooks orderBy(updatedAt) failed, falling back to toArray()', error)
        const list = await db.books.toArray()
        books.value = sortBooks(list)
      }
    } finally {
      loading.value = false
    }
  }

  const getBook = async (id: string): Promise<Book | undefined> => {
    return db.books.get(id)
  }

  const getChapterCounts = async (bookIds: string[]): Promise<Record<string, number>> => {
    const uniqueBookIds = Array.from(new Set(bookIds))
    const counts: Record<string, number> = {}

    await Promise.all(uniqueBookIds.map(async (bookId) => {
      counts[bookId] = await db.chapters.where('bookId').equals(bookId).count()
    }))

    return counts
  }

  const createBook = async (meta: BookMeta): Promise<string> => {
    const now = Date.now()
    const id = crypto.randomUUID()
    const book: Book = {
      id,
      meta,
      createdAt: now,
      updatedAt: now,
    }

    await db.books.add(book)
    await loadBooks()

    const chapterId = crypto.randomUUID()
    await db.chapters.add({
      id: chapterId,
      bookId: id,
      parentId: null,
      title: '第一章',
      content: '# 第一章\n\n开始在这里写下你的内容。',
      order: 0,
      createdAt: now,
      updatedAt: now,
    })

    return id
  }

  const updateBookMeta = async (id: string, meta: Partial<BookMeta>): Promise<Book | null> => {
    const book = await db.books.get(id)
    if (!book) return null

    const updatedAt = Date.now()
    const updatedBook: Book = {
      ...book,
      meta: { ...book.meta, ...meta },
      updatedAt,
    }

    await db.books.put(updatedBook)
    await loadBooks()

    return updatedBook
  }

  const deleteBook = async (id: string) => {
    await db.chapters.where('bookId').equals(id).delete()
    await db.books.delete(id)
    await loadBooks()
  }

  return {
    books,
    loading,
    loadBooks,
    getBook,
    getChapterCounts,
    createBook,
    updateBookMeta,
    deleteBook,
  }
}
