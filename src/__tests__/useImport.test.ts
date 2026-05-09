import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useImport } from '@/composables/useImport'
import type { Book, Chapter } from '@/types'

const books = new Map<string, Book>()
const chapters = new Map<string, Chapter>()

vi.mock('@/db', () => {
  const getChaptersByBook = (bookId: string) => [...chapters.values()].filter((chapter) => chapter.bookId === bookId)

  return {
    db: {
      books: {
        add: async (book: Book) => {
          books.set(book.id, book)
        },
        update: async (id: string, changes: Partial<Book>) => {
          const current = books.get(id)
          if (current) books.set(id, { ...current, ...changes })
        },
      },
      chapters: {
        add: async (chapter: Chapter) => {
          chapters.set(chapter.id, chapter)
        },
        get: async (id: string) => chapters.get(id),
        update: async (id: string, changes: Partial<Chapter>) => {
          const current = chapters.get(id)
          if (current) chapters.set(id, { ...current, ...changes })
        },
        where: () => ({
          equals: (bookId: string) => ({
            toArray: async () => getChaptersByBook(bookId),
          }),
        }),
      },
      assets: {
        add: async () => {},
      },
      transaction: async (...args: unknown[]) => {
        const callback = args[args.length - 1] as () => Promise<void>
        await callback()
      },
    },
  }
})

describe('useImport', () => {
  beforeEach(() => {
    books.clear()
    chapters.clear()
  })

  it('creates a new book and chapter tree from an import document', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-0000-0000-000000000001')
      .mockReturnValueOnce('00000000-0000-0000-0000-000000000002')
      .mockReturnValueOnce('00000000-0000-0000-0000-000000000003')

    const { applyImportDocument } = useImport()
    const result = await applyImportDocument({}, {
      format: 'markdown',
      sourceName: 'demo.md',
      meta: { title: 'Imported Demo' },
      warnings: [],
      sections: [{
        title: 'Chapter 1',
        content: 'Hello',
        children: [{
          title: 'Child',
          content: 'Nested',
          children: [],
        }],
      }],
    }, 'newBook')

    expect(result).toEqual({
      bookId: '00000000-0000-0000-0000-000000000001',
      chapterIds: ['00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003'],
    })
    expect(books.get('00000000-0000-0000-0000-000000000001')?.meta.title).toBe('Imported Demo')
    expect(chapters.get('00000000-0000-0000-0000-000000000003')?.parentId).toBe('00000000-0000-0000-0000-000000000002')
  })

  it('appends imported content to the current chapter', async () => {
    books.set('book-1', {
      id: 'book-1',
      meta: {
        title: 'Book',
        author: '',
        description: '',
        language: 'zh-CN',
        publishDate: '2026-05-08',
        coverImage: null,
      },
      createdAt: 1,
      updatedAt: 1,
    })
    chapters.set('chapter-1', {
      id: 'chapter-1',
      bookId: 'book-1',
      parentId: null,
      title: 'Current',
      content: 'Existing',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    })

    const { applyImportDocument } = useImport()
    await applyImportDocument({
      bookId: 'book-1',
      chapterId: 'chapter-1',
    }, {
      format: 'markdown',
      sourceName: 'demo.md',
      meta: {},
      warnings: [],
      sections: [{
        title: 'Imported',
        content: 'New body',
        children: [{
          title: 'Nested',
          content: 'Child body',
          children: [],
        }],
      }],
    }, 'appendToCurrentChapter')

    expect(chapters.get('chapter-1')?.content).toContain('## Imported')
    expect(chapters.get('chapter-1')?.content).toContain('### Nested')
  })

  it('inserts imported content as sibling chapters after the current chapter', async () => {
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-0000-0000-000000000010')
      .mockReturnValueOnce('00000000-0000-0000-0000-000000000011')

    books.set('book-1', {
      id: 'book-1',
      meta: {
        title: 'Book',
        author: '',
        description: '',
        language: 'zh-CN',
        publishDate: '2026-05-08',
        coverImage: null,
      },
      createdAt: 1,
      updatedAt: 1,
    })
    chapters.set('chapter-1', {
      id: 'chapter-1',
      bookId: 'book-1',
      parentId: null,
      title: 'Current',
      content: '',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    chapters.set('chapter-2', {
      id: 'chapter-2',
      bookId: 'book-1',
      parentId: null,
      title: 'Later',
      content: '',
      order: 1,
      createdAt: 1,
      updatedAt: 1,
    })

    const { applyImportDocument } = useImport()
    await applyImportDocument({
      bookId: 'book-1',
      chapterId: 'chapter-1',
    }, {
      format: 'markdown',
      sourceName: 'demo.md',
      meta: {},
      warnings: [],
      sections: [{
        title: 'Imported Root',
        content: 'Root body',
        children: [{
          title: 'Imported Child',
          content: 'Child body',
          children: [],
        }],
      }],
    }, 'insertAsSiblingChapters')

    expect(chapters.get('00000000-0000-0000-0000-000000000010')?.order).toBe(1)
    expect(chapters.get('chapter-2')?.order).toBe(2)
    expect(chapters.get('00000000-0000-0000-0000-000000000011')?.parentId).toBe('00000000-0000-0000-0000-000000000010')
  })
})
