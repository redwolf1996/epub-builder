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

    const chapterId = crypto.randomUUID()
    await db.chapters.add({
      id: chapterId,
      bookId: id,
      parentId: null,
      title: '绗竴绔?',
      content: '# 绗竴绔燶n\n寮€濮嬩功鍐欎綘鐨勬晠浜?..',
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

    const index = books.value.findIndex((item) => item.id === id)
    if (index !== -1) {
      books.value.splice(index, 1, updatedBook)
      books.value.sort((a, b) => b.updatedAt - a.updatedAt)
    }

    return updatedBook
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
