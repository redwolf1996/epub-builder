import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExport } from '@/composables/useExport'

const mocks = vi.hoisted(() => ({
  exportToEpub: vi.fn(),
  downloadEpub: vi.fn(),
  validateExport: vi.fn(),
  getExportPayload: vi.fn(),
  buildPdfOutlineItems: vi.fn(),
  buildMarkdownExport: vi.fn(),
  saveTextFile: vi.fn(),
  saveBlobFile: vi.fn(),
  savePdfFile: vi.fn(),
  buildPrintHtml: vi.fn(),
  openPrintPreview: vi.fn(),
  isTauri: vi.fn(),
  buildDocxExport: vi.fn(),
}))

vi.mock('@/utils/epub', () => ({
  exportToEpub: mocks.exportToEpub,
  downloadEpub: mocks.downloadEpub,
}))

vi.mock('@/utils/export', () => ({
  validateExport: mocks.validateExport,
  getExportPayload: mocks.getExportPayload,
  buildPdfOutlineItems: mocks.buildPdfOutlineItems,
  buildMarkdownExport: mocks.buildMarkdownExport,
  saveBlobFile: mocks.saveBlobFile,
  saveTextFile: mocks.saveTextFile,
  savePdfFile: mocks.savePdfFile,
  buildPrintHtml: mocks.buildPrintHtml,
  openPrintPreview: mocks.openPrintPreview,
  isTauri: mocks.isTauri,
}))

vi.mock('@/utils/exportDocx', () => ({
  buildDocxExport: mocks.buildDocxExport,
}))

describe('useExport', () => {
  beforeEach(() => {
    mocks.exportToEpub.mockReset()
    mocks.downloadEpub.mockReset()
    mocks.validateExport.mockReset()
    mocks.getExportPayload.mockReset()
    mocks.buildPdfOutlineItems.mockReset()
    mocks.buildMarkdownExport.mockReset()
    mocks.buildDocxExport.mockReset()
    mocks.saveBlobFile.mockReset()
    mocks.saveTextFile.mockReset()
    mocks.savePdfFile.mockReset()
    mocks.buildPrintHtml.mockReset()
    mocks.openPrintPreview.mockReset()
    mocks.isTauri.mockReset()
    mocks.isTauri.mockReturnValue(false)
  })

  it('returns saved status after a successful epub export', async () => {
    const blob = new Blob(['ok'])
    mocks.exportToEpub.mockResolvedValue(blob)
    mocks.downloadEpub.mockResolvedValue({ status: 'saved' })

    const { handleExport, exporting, error } = useExport()
    const result = await handleExport('epub', 'book-1', 'demo')

    expect(result).toEqual({ status: 'saved' })
    expect(exporting.value).toBe(false)
    expect(error.value).toBeNull()
    expect(mocks.downloadEpub).toHaveBeenCalledWith(blob, 'demo')
  })

  it('exports merged markdown text', async () => {
    const payload = {
      book: { meta: { title: 'Demo' } },
      chapters: [],
    }
    mocks.getExportPayload.mockResolvedValue(payload)
    mocks.buildMarkdownExport.mockReturnValue('# Demo')
    mocks.saveTextFile.mockResolvedValue({ status: 'saved' })

    const { handleExport } = useExport()
    const result = await handleExport('markdown', 'book-1', 'demo')

    expect(result).toEqual({ status: 'saved' })
    expect(mocks.buildMarkdownExport).toHaveBeenCalledWith(payload.book.meta, payload.chapters)
    expect(mocks.saveTextFile).toHaveBeenCalledWith('# Demo', 'demo', 'md', 'text/markdown;charset=utf-8', 'Markdown')
  })

  it('exports pdf through tauri save flow on desktop', async () => {
    const payload = {
      book: { meta: { title: 'Demo' } },
      chapters: [],
    }
    mocks.getExportPayload.mockResolvedValue(payload)
    mocks.isTauri.mockReturnValue(true)
    mocks.buildPrintHtml.mockReturnValue('<html></html>')
    mocks.buildPdfOutlineItems.mockReturnValue([{ title: 'Demo', anchor: 'chapter-1', depth: 0 }])
    mocks.savePdfFile.mockResolvedValue({ status: 'saved', filePath: 'demo.pdf' })

    const { handleExport } = useExport()
    const result = await handleExport('pdf', 'book-1', 'demo')

    expect(result).toEqual({ status: 'saved', filePath: 'demo.pdf' })
    expect(mocks.buildPrintHtml).toHaveBeenCalledWith(payload.book.meta, payload.chapters)
    expect(mocks.buildPdfOutlineItems).toHaveBeenCalledWith(payload.chapters)
    expect(mocks.savePdfFile).toHaveBeenCalledWith('<html></html>', 'Demo', 'demo', [{ title: 'Demo', anchor: 'chapter-1', depth: 0 }])
    expect(mocks.openPrintPreview).not.toHaveBeenCalled()
  })

  it('exports docx through blob save flow', async () => {
    const payload = {
      book: { meta: { title: 'Demo' } },
      chapters: [],
    }
    const blob = new Blob(['docx'])
    mocks.getExportPayload.mockResolvedValue(payload)
    mocks.buildDocxExport.mockResolvedValue(blob)
    mocks.saveBlobFile.mockResolvedValue({ status: 'saved', filePath: 'demo.docx' })

    const { handleExport } = useExport()
    const result = await handleExport('docx', 'book-1', 'demo')

    expect(result).toEqual({ status: 'saved', filePath: 'demo.docx' })
    expect(mocks.buildDocxExport).toHaveBeenCalledWith(payload.book.meta, payload.chapters)
    expect(mocks.saveBlobFile).toHaveBeenCalledWith(blob, 'demo', 'docx', 'Word Document')
  })

  it('opens the print view for pdf export in browser mode', async () => {
    const payload = {
      book: { meta: { title: 'Demo' } },
      chapters: [],
    }
    mocks.getExportPayload.mockResolvedValue(payload)
    mocks.buildPrintHtml.mockReturnValue('<html></html>')
    mocks.openPrintPreview.mockResolvedValue({ status: 'opened' })

    const { handleExport } = useExport()
    const result = await handleExport('pdf', 'book-1', 'demo')

    expect(result).toEqual({ status: 'opened' })
    expect(mocks.buildPrintHtml).toHaveBeenCalledWith(payload.book.meta, payload.chapters)
    expect(mocks.openPrintPreview).toHaveBeenCalledWith('<html></html>', 'Demo')
  })

  it('stores an error when export fails', async () => {
    mocks.exportToEpub.mockRejectedValue(new Error('boom'))

    const { handleExport, exporting, error } = useExport()
    await expect(handleExport('epub', 'book-1', 'demo')).rejects.toThrow('boom')

    expect(exporting.value).toBe(false)
    expect(error.value).toBe('boom')
  })

  it('proxies export validation results', async () => {
    const validation = { blockingErrors: [], warnings: ['warn'] }
    mocks.validateExport.mockResolvedValue(validation)

    const { validateExport } = useExport()
    await expect(validateExport('book-1')).resolves.toEqual(validation)
  })
})
