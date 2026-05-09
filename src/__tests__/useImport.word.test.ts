import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useImport } from '@/composables/useImport'

const mocks = vi.hoisted(() => ({
  parseWordImport: vi.fn(),
}))

vi.mock('@/utils/importWord', () => ({
  parseWordImport: mocks.parseWordImport,
}))

vi.mock('@/utils/importMarkdown', () => ({
  parseMarkdownImport: vi.fn(),
}))

vi.mock('@/utils/importEpub', () => ({
  parseEpubImport: vi.fn(),
}))

vi.mock('@/utils/importPdf', () => ({
  parsePdfImport: vi.fn(),
}))

describe('useImport docx parsing', () => {
  beforeEach(() => {
    mocks.parseWordImport.mockReset()
  })

  it('detects docx files and delegates to the word parser', async () => {
    const document = {
      format: 'docx' as const,
      sourceName: 'demo.docx',
      meta: { title: 'Demo' },
      sections: [{ title: 'Chapter 1', content: 'Body', children: [] }],
      warnings: [],
      assets: [],
    }
    mocks.parseWordImport.mockResolvedValue(document)

    const { parseImportFile, parsedDocument } = useImport()
    const file = new File([new Uint8Array([1, 2, 3])], 'demo.docx')
    const result = await parseImportFile(file)

    expect(result).toEqual({ document, format: 'docx' })
    expect(parsedDocument.value).toEqual(document)
    expect(mocks.parseWordImport).toHaveBeenCalledWith(file)
  })
})
