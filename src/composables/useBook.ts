import { ref } from 'vue'
import { db } from '@/db'
import type { Book, BookMeta } from '@/types'

export function useBook() {
  const books = ref<Book[]>([])
  const loading = ref(false)

  const loadBooks = async () => {
    loading.value = true
    try {
      const list = await db.books.orderBy('updatedAt').reverse().toArray()
      books.value = list
    } finally {
      loading.value = false
    }
  }

  const getBook = async (id: string): Promise<Book | undefined> => {
    return db.books.get(id)
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

    // 创建默认第一章
    const chapterId = crypto.randomUUID()
    await db.chapters.add({
      id: chapterId,
      bookId: id,
      title: '第一章',
      content: '# 第一章\n\n开始书写你的故事...',
      order: 0,
      createdAt: now,
      updatedAt: now,
    })

    return id
  }

  const updateBookMeta = async (id: string, meta: Partial<BookMeta>) => {
    const book = await db.books.get(id)
    if (!book) return

    await db.books.update(id, {
      meta: { ...book.meta, ...meta },
      updatedAt: Date.now(),
    })
  }

  const deleteBook = async (id: string) => {
    await db.chapters.where('bookId').equals(id).delete()
    await db.books.delete(id)
    books.value = books.value.filter((b) => b.id !== id)
  }

  return {
    books,
    loading,
    loadBooks,
    getBook,
    createBook,
    updateBookMeta,
    deleteBook,
  }
}
