import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useChapter, INVALID_CHAPTER_MOVE } from '@/composables/useChapter'
import type { Chapter } from '@/types'

const chaptersData: Map<string, Chapter> = new Map()

vi.mock('@/db', () => {
  const chaptersTable = {
    where: () => ({
      equals: (bookId: string) => ({
        sortBy: async () =>
          [...chaptersData.values()]
            .filter((c) => c.bookId === bookId)
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
    vi.spyOn(crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-0000-0000-000000000001')
      .mockReturnValueOnce('00000000-0000-0000-0000-000000000002')
      .mockReturnValueOnce('00000000-0000-0000-0000-000000000003')
      .mockReturnValueOnce('00000000-0000-0000-0000-000000000004')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('creates chapters with incrementing order', async () => {
    const { addChapter, chapters } = useChapter()
    const id = await addChapter('book1', 'Chapter 1')
    expect(id).toBe('00000000-0000-0000-0000-000000000001')
    expect(chapters.value).toHaveLength(1)
    expect(chapters.value[0].order).toBe(0)
  })

  it('syncs content updates locally', async () => {
    const { addChapter, updateChapterContent, chapters } = useChapter()
    const id = await addChapter('book1', 'Chapter 1')
    await updateChapterContent(id, 'new content')
    expect(chapters.value.find((c) => c.id === id)?.content).toBe('new content')
  })

  it('deletes child chapters recursively', async () => {
    const { addChapter, deleteChapter, chapters } = useChapter()
    const parentId = await addChapter('book1', 'Parent')
    const childId = await addChapter('book1', 'Child', parentId)

    await deleteChapter(parentId)

    expect(chapters.value).toHaveLength(0)
    expect(chaptersData.has(childId)).toBe(false)
  })

  it('reorders sibling chapters', async () => {
    const { addChapter, reorderChapters, loadChapters, chapters } = useChapter()
    const id1 = await addChapter('book1', 'C1')
    const id2 = await addChapter('book1', 'C2')

    await reorderChapters(null, [id2, id1])
    await loadChapters('book1')

    expect(chapters.value.map((c) => c.id)).toEqual([id2, id1])
  })

  it('moves a chapter under a different parent', async () => {
    const { addChapter, moveChapterToParent, loadChapters, chapters } = useChapter()
    const parentId = await addChapter('book1', 'Parent')
    const childId = await addChapter('book1', 'Child')

    await moveChapterToParent(childId, parentId)
    await loadChapters('book1')

    expect(chapters.value.find((c) => c.id === childId)?.parentId).toBe(parentId)
  })

  it('rejects moving a chapter into its own descendant', async () => {
    const { addChapter, moveChapterToParent, canMoveChapter } = useChapter()
    const parentId = await addChapter('book1', 'Parent')
    const childId = await addChapter('book1', 'Child', parentId)

    expect(canMoveChapter(parentId, childId)).toBe(false)
    await expect(moveChapterToParent(parentId, childId)).rejects.toThrow(INVALID_CHAPTER_MOVE)
  })
})
