import { ref } from 'vue'
import { exportToEpub, downloadEpub } from '@/utils/epub'

export function useEpub() {
  const exporting = ref(false)
  const error = ref<string | null>(null)

  const handleExport = async (bookId: string, filename: string) => {
    exporting.value = true
    error.value = null
    try {
      const data = await exportToEpub(bookId)
      downloadEpub(data, filename)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '导出失败'
      error.value = msg
      throw e
    } finally {
      exporting.value = false
    }
  }

  return {
    exporting,
    error,
    handleExport,
  }
}
