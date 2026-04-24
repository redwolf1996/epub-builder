import { defineStore } from 'pinia'
import { ref } from 'vue'
import { debounce } from '@/utils/debounce'
import { useBookStore } from './book'

export const useEditorStore = defineStore('editor', () => {
  const content = ref('')
  const previewMode = ref(false) // 手机端切换编辑/预览

  const bookStore = useBookStore()

  const autoSave = debounce((value: string) => {
    bookStore.saveCurrentChapter(value)
  }, 500)

  const setContent = (value: string) => {
    content.value = value
    autoSave(value)
  }

  const loadChapterContent = (chapterContent: string) => {
    content.value = chapterContent
  }

  const togglePreviewMode = () => {
    previewMode.value = !previewMode.value
  }

  return {
    content,
    previewMode,
    setContent,
    loadChapterContent,
    togglePreviewMode,
  }
})
