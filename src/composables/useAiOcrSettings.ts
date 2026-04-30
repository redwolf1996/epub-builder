import { ref, watch } from 'vue'

const DOUBAO_EXE_PATH_KEY = 'epub-builder-doubao-exe-path'

export const useAiOcrSettings = () => {
  const doubaoExePath = ref(localStorage.getItem(DOUBAO_EXE_PATH_KEY) ?? '')

  watch(doubaoExePath, (value) => {
    const trimmed = value.trim()
    if (trimmed) {
      localStorage.setItem(DOUBAO_EXE_PATH_KEY, trimmed)
      return
    }

    localStorage.removeItem(DOUBAO_EXE_PATH_KEY)
  })

  const clearDoubaoExePath = () => {
    doubaoExePath.value = ''
  }

  return {
    doubaoExePath,
    clearDoubaoExePath,
  }
}
