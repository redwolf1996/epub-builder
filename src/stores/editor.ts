import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { debounce } from '@/utils/debounce'
import { useBookStore } from './book'

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved'

export const useEditorStore = defineStore('editor', () => {
  const content = ref('')
  const previewMode = ref(false)
  const saveStatus = ref<SaveStatus>('idle')

  const bookStore = useBookStore()
  let lastSaveTask: Promise<void> | null = null

  const persistContent = async (value: string) => {
    saveStatus.value = 'saving'
    await bookStore.saveCurrentChapter(value)
    saveStatus.value = content.value === value ? 'saved' : 'dirty'
  }

  const autoSave = debounce((value: string) => {
    lastSaveTask = persistContent(value)
  }, 500)

  const setContent = (value: string) => {
    content.value = value
    saveStatus.value = 'dirty'
    autoSave(value)
  }

  const flushSave = async () => {
    if (saveStatus.value === 'dirty') {
      autoSave.flush(content.value)
    }
    if (lastSaveTask) {
      await lastSaveTask
    }
  }

  const cancelPendingSave = () => {
    autoSave.cancel()
  }

  const charCount = computed(() => content.value.length)
  const wordCount = computed(() => {
    const text = content.value.replace(/<[^>]*>/g, '').replace(/[#>*+\-`|~!\[\]_]/g, '')
    const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0
    const words = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ').trim().split(/\s+/).filter(Boolean).length
    return cjk + words
  })

  const loadChapterContent = (chapterContent: string) => {
    cancelPendingSave()
    content.value = chapterContent
    saveStatus.value = 'idle'
  }

  const togglePreviewMode = () => {
    previewMode.value = !previewMode.value
  }

  return {
    content,
    previewMode,
    saveStatus,
    charCount,
    wordCount,
    setContent,
    flushSave,
    cancelPendingSave,
    loadChapterContent,
    togglePreviewMode,
  }
})
