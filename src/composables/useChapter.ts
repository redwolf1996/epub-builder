import { ref } from 'vue'
import { db } from '@/db'
import type { Chapter } from '@/types'

const INVALID_CHAPTER_MOVE = 'INVALID_CHAPTER_MOVE'

export function useChapter() {
  const chapters = ref<Chapter[]>([])
  const currentChapter = ref<Chapter | null>(null)
  const loading = ref(false)

  const loadChapters = async (bookId: string) => {
    loading.value = true
    try {
      const list = await db.chapters
        .where('bookId')
        .equals(bookId)
        .sortBy('order')
      chapters.value = list
    } finally {
      loading.value = false
    }
  }

  const getChapter = async (id: string): Promise<Chapter | undefined> => {
    return db.chapters.get(id)
  }

  const getLocalChapter = (id: string) => chapters.value.find((chapter) => chapter.id === id)

  const isDescendantChapter = (chapterId: string, ancestorId: string): boolean => {
    let current = getLocalChapter(chapterId)
    while (current?.parentId) {
      if (current.parentId === ancestorId) {
        return true
      }
      current = getLocalChapter(current.parentId)
    }
    return false
  }

  const canMoveChapter = (chapterId: string, parentId: string | null): boolean => {
    if (parentId === null) return !!getLocalChapter(chapterId)
    if (chapterId === parentId) return false

    const chapter = getLocalChapter(chapterId)
    const parent = getLocalChapter(parentId)
    if (!chapter || !parent) return false
    if (chapter.bookId !== parent.bookId) return false

    return !isDescendantChapter(parentId, chapterId)
  }

  const assertValidChapterMove = (chapterId: string, parentId: string | null) => {
    if (!canMoveChapter(chapterId, parentId)) {
      throw new Error(INVALID_CHAPTER_MOVE)
    }
  }

  const addChapter = async (bookId: string, title: string, parentId: string | null = null): Promise<string> => {
    const now = Date.now()
    const siblings = chapters.value.filter((c) => c.parentId === parentId)
    const maxOrder = siblings.length > 0
      ? Math.max(...siblings.map((c) => c.order))
      : -1

    const id = crypto.randomUUID()
    const chapter: Chapter = {
      id,
      bookId,
      parentId,
      title,
      content: '',
      order: maxOrder + 1,
      createdAt: now,
      updatedAt: now,
    }
    await db.chapters.add(chapter)
    chapters.value.push(chapter)
    return id
  }

  const updateChapterContent = async (id: string, content: string) => {
    const now = Date.now()
    await db.chapters.update(id, {
      content,
      updatedAt: now,
    })

    const idx = chapters.value.findIndex((c) => c.id === id)
    if (idx !== -1) {
      chapters.value[idx].content = content
      chapters.value[idx].updatedAt = now
    }
    if (currentChapter.value?.id === id) {
      currentChapter.value.content = content
      currentChapter.value.updatedAt = now
    }
  }

  const updateChapterTitle = async (id: string, title: string) => {
    await db.chapters.update(id, { title, updatedAt: Date.now() })
    const idx = chapters.value.findIndex((c) => c.id === id)
    if (idx !== -1) {
      chapters.value[idx].title = title
    }
  }

  const deleteChapter = async (id: string) => {
    const children = chapters.value.filter((c) => c.parentId === id)
    for (const child of children) {
      await deleteChapter(child.id)
    }
    await db.chapters.delete(id)
    chapters.value = chapters.value.filter((c) => c.id !== id)
    if (currentChapter.value?.id === id) {
      currentChapter.value = chapters.value[0] ?? null
    }
  }

  const reorderChapters = async (parentId: string | null, orderedIds: string[]) => {
    for (const id of orderedIds) {
      assertValidChapterMove(id, parentId)
    }

    const updatedAt = Date.now()
    const updates = orderedIds.map((id, index) =>
      db.chapters.update(id, { order: index, parentId, updatedAt })
    )
    await Promise.all(updates)
    await loadChapters(chapters.value[0]?.bookId ?? '')
  }

  const moveChapterToParent = async (chapterId: string, parentId: string | null) => {
    assertValidChapterMove(chapterId, parentId)

    const siblings = chapters.value.filter((c) => c.parentId === parentId && c.id !== chapterId)
    const maxOrder = siblings.length > 0
      ? Math.max(...siblings.map((c) => c.order))
      : -1
    await db.chapters.update(chapterId, { parentId, order: maxOrder + 1, updatedAt: Date.now() })
    await loadChapters(chapters.value[0]?.bookId ?? '')
  }

  const selectChapter = (chapter: Chapter) => {
    currentChapter.value = chapter
  }

  return {
    chapters,
    currentChapter,
    loading,
    loadChapters,
    getChapter,
    addChapter,
    updateChapterContent,
    updateChapterTitle,
    deleteChapter,
    reorderChapters,
    moveChapterToParent,
    canMoveChapter,
    selectChapter,
  }
}

export { INVALID_CHAPTER_MOVE }
