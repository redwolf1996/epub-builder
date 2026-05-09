import { beforeEach, describe, expect, it } from 'vitest'
import { GlobalWorkerOptions } from 'pdfjs-dist'
import { detectPdfWarnings } from '@/utils/importPdf'

describe('detectPdfWarnings', () => {
  beforeEach(() => {
    GlobalWorkerOptions.workerSrc = ''
  })

  it('configures the pdf worker before parsing', async () => {
    const module = await import('@/utils/importPdf')
    const file = new File([new Uint8Array([37, 80, 68, 70])], 'sample.pdf', { type: 'application/pdf' })

    const task = module.parsePdfImport(file).catch(() => null)
    await task

    expect(GlobalWorkerOptions.workerSrc).toContain('pdf.worker.min.mjs')
  })

  it('warns when extractable text is too short', () => {
    expect(detectPdfWarnings('tiny text')).toEqual([{
      code: 'pdf-low-text',
      message: 'The PDF contains very little extractable text. If this is a scanned document, use AI OCR for better results.',
    }])
  })

  it('does not warn when enough text is present', () => {
    const content = 'This is a long paragraph with enough extractable text to avoid the OCR fallback warning.'.repeat(2)
    expect(detectPdfWarnings(content)).toEqual([])
  })
})
