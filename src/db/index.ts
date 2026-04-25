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
    this.version(2).stores({
      books: 'id, meta.title, createdAt, updatedAt',
      chapters: 'id, bookId, parentId, order, createdAt, updatedAt',
    }).upgrade((tx) => {
      // 旧数据 parentId 默认为 null（顶级章节）
      return (tx.table('chapters') as Dexie.Table<Chapter, string>).toCollection().modify((ch: Chapter) => {
        if (ch.parentId === undefined) ch.parentId = null
      })
    })
  }
}

export const db = new EpubBuilderDB()
