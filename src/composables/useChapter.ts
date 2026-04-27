import { ref } from 'vue'
import { db } from '@/db'
import type { Chapter } from '@/types'

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

  const addChapter = async (bookId: string, title: string, parentId: string | null = null): Promise<string> => {
    const now = Date.now()
    // 同级章节的 maxOrder
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

    // 同步更新本地状态
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
    // 递归删除子章节
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

  /** 重排同级章节 */
  const reorderChapters = async (parentId: string | null, orderedIds: string[]) => {
    const updates = orderedIds.map((id, index) =>
      db.chapters.update(id, { order: index, parentId, updatedAt: Date.now() })
    )
    await Promise.all(updates)
    await loadChapters(chapters.value[0]?.bookId ?? '')
  }

  /** 将章节移为某个父章节的子章节 */
  const moveChapterToParent = async (chapterId: string, parentId: string | null) => {
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
    selectChapter,
  }
}
