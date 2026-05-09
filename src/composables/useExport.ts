import { ref } from 'vue'
import { downloadEpub, exportToEpub } from '@/utils/epub'
import { buildDocxExport } from '@/utils/exportDocx'
import {
  buildPdfOutlineItems,
  buildMarkdownExport,
  buildPrintHtml,
  getExportPayload,
  isTauri,
  openPrintPreview,
  saveBlobFile,
  savePdfFile,
  saveTextFile,
  type ExportFormat,
  type ExportValidationResult,
  type PrintExportResult,
  type SavedExportResult,
  validateExport,
} from '@/utils/export'

export type ExportResult = SavedExportResult | PrintExportResult

export function useExport() {
  const exporting = ref(false)
  const error = ref<string | null>(null)

  const handleExport = async (format: ExportFormat, bookId: string, filename: string): Promise<ExportResult> => {
    exporting.value = true
    error.value = null

    try {
      switch (format) {
        case 'epub': {
          const data = await exportToEpub(bookId)
          return await downloadEpub(data, filename)
        }
        case 'markdown': {
          const { book, chapters } = await getExportPayload(bookId)
          const content = await buildMarkdownExport(book.meta, chapters)
          return await saveTextFile(content, filename, 'md', 'text/markdown;charset=utf-8', 'Markdown')
        }
        case 'pdf': {
          const { book, chapters } = await getExportPayload(bookId)
          const html = await buildPrintHtml(book.meta, chapters)
          if (isTauri()) {
            const outlineItems = buildPdfOutlineItems(chapters)
            return await savePdfFile(html, book.meta.title || filename, filename, outlineItems)
          }

          return await openPrintPreview(html, book.meta.title || filename)
        }
        case 'docx': {
          const { book, chapters } = await getExportPayload(bookId)
          const blob = await buildDocxExport(book.meta, chapters)
          return await saveBlobFile(blob, filename, 'docx', 'Word Document')
        }
      }
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
    validateExport: (bookId: string): Promise<ExportValidationResult> => validateExport(bookId),
  }
}
