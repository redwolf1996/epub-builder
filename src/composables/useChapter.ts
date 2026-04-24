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

  const addChapter = async (bookId: string, title: string): Promise<string> => {
    const now = Date.now()
    const maxOrder = chapters.value.length > 0
      ? Math.max(...chapters.value.map((c) => c.order))
      : -1

    const id = crypto.randomUUID()
    const chapter: Chapter = {
      id,
      bookId,
      title,
      content: `# ${title}\n\n`,
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
    await db.chapters.delete(id)
    chapters.value = chapters.value.filter((c) => c.id !== id)
    if (currentChapter.value?.id === id) {
      currentChapter.value = chapters.value[0] ?? null
    }
  }

  const reorderChapters = async (orderedIds: string[]) => {
    const updates = orderedIds.map((id, index) =>
      db.chapters.update(id, { order: index, updatedAt: Date.now() })
    )
    await Promise.all(updates)
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
    selectChapter,
  }
}
