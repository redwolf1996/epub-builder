import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChapter } from '@/composables/useChapter'
import type { Chapter } from '@/types'

// mock db
const chaptersData: Map<string, Chapter> = new Map()

vi.mock('@/db', () => {
  const chaptersTable = {
    where: () => ({
      equals: () => ({
        sortBy: async () =>
          [...chaptersData.values()]
            .filter((c) => c.bookId === 'book1')
            .sort((a, b) => a.order - b.order),
      }),
    }),
    get: async (id: string) => chaptersData.get(id),
    add: async (chapter: Chapter) => {
      chaptersData.set(chapter.id, chapter)
    },
    update: async (id: string, changes: Partial<Chapter>) => {
      const existing = chaptersData.get(id)
      if (existing) chaptersData.set(id, { ...existing, ...changes })
    },
    delete: async (id: string) => {
      chaptersData.delete(id)
    },
  }

  return {
    db: {
      chapters: chaptersTable,
    },
  }
})

describe('useChapter', () => {
  beforeEach(() => {
    chaptersData.clear()
  })

  it('addChapter 创建章节并 order 递增', async () => {
    const { addChapter, chapters } = useChapter()
    const id = await addChapter('book1', 'Chapter 1')
    expect(id).toBeTruthy()
    expect(chapters.value).toHaveLength(1)
    expect(chapters.value[0].order).toBe(0)
    expect(chapters.value[0].title).toBe('Chapter 1')
  })

  it('addChapter 同级 order 递增', async () => {
    const { addChapter, chapters } = useChapter()
    await addChapter('book1', 'Chapter 1')
    await addChapter('book1', 'Chapter 2')
    expect(chapters.value[1].order).toBe(1)
  })

  it('updateChapterContent 同步本地状态', async () => {
    const { addChapter, updateChapterContent, chapters } = useChapter()
    const id = await addChapter('book1', 'Chapter 1')
    await updateChapterContent(id, 'new content')
    const ch = chapters.value.find((c) => c.id === id)
    expect(ch?.content).toBe('new content')
  })

  it('deleteChapter 递归删除子章节', async () => {
    const { addChapter, deleteChapter, chapters } = useChapter()
    const parentId = await addChapter('book1', 'Parent')
    const childId = await addChapter('book1', 'Child', parentId)
    expect(chapters.value).toHaveLength(2)

    await deleteChapter(parentId)
    expect(chapters.value).toHaveLength(0)
    expect(chaptersData.has(childId)).toBe(false)
  })

  it('reorderChapters 按传入顺序重排', async () => {
    const { addChapter, reorderChapters, loadChapters, chapters } = useChapter()
    const id1 = await addChapter('book1', 'C1')
    const id2 = await addChapter('book1', 'C2')

    await reorderChapters(null, [id2, id1])
    await loadChapters('book1')

    const ordered = chapters.value.map((c) => c.id)
    expect(ordered).toEqual([id2, id1])
  })

  it('moveChapterToParent 更新 parentId 和 order', async () => {
    const { addChapter, moveChapterToParent, loadChapters, chapters } = useChapter()
    const parentId = await addChapter('book1', 'Parent')
    const childId = await addChapter('book1', 'Child')

    await moveChapterToParent(childId, parentId)
    await loadChapters('book1')

    const child = chapters.value.find((c) => c.id === childId)
    expect(child?.parentId).toBe(parentId)
  })
})
