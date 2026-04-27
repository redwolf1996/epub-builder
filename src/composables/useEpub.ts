import { ref } from 'vue'
import { exportToEpub, downloadEpub, type DownloadEpubResult } from '@/utils/epub'

export function useEpub() {
  const exporting = ref(false)
  const error = ref<string | null>(null)

  const handleExport = async (bookId: string, filename: string): Promise<DownloadEpubResult> => {
    exporting.value = true
    error.value = null
    try {
      const data = await exportToEpub(bookId)
      return await downloadEpub(data, filename)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '瀵煎嚭澶辫触'
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
