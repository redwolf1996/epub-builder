import Dexie from 'dexie'
import type { Book, Chapter } from '@/types'

class EpubBuilderDB extends Dexie {
  books!: Dexie.Table<Book, string>
  chapters!: Dexie.Table<Chapter, string>

  constructor() {
    super('epub-builder')
    this.version(1).stores({
      books: 'id, meta.title, createdAt, updatedAt',
      chapters: 'id, bookId, order, createdAt, updatedAt',
    })
  }
}

export const db = new EpubBuilderDB()
