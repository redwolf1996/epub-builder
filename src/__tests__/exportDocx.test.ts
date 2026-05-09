import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

const replaceAssetUrls = vi.fn(async (content: string) => content)

vi.mock('@/utils/assets', () => ({
  replaceAssetUrls,
}))

describe('buildDocxExport', () => {
  afterEach(() => {
    replaceAssetUrls.mockReset()
    replaceAssetUrls.mockImplementation(async (content: string) => content)
  })

  it('writes metadata, chapter headings, links, tables, and images into a docx document', async () => {
    const { buildDocxExport } = await import('@/utils/exportDocx')

    const blob = await buildDocxExport({
      title: 'Demo Book',
      author: 'Alice',
      description: 'Short intro',
      language: 'zh-CN',
      publishDate: '2026-05-09',
      coverImage: null,
    }, [{
      id: 'chapter-1',
      bookId: 'book-1',
      parentId: null,
      title: 'Root Chapter',
      content: [
        '# Root Chapter',
        '',
        'Paragraph with [link](https://example.com).',
        '',
        '| A | B |',
        '| - | - |',
        '| 1 | 2 |',
        '',
        '![hero](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=)',
      ].join('\n'),
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }])

    const zipReader = new ZipReader(new BlobReader(blob))
    const entries = await zipReader.getEntries()
    const documentEntry = entries.find((entry) => entry.filename === 'word/document.xml')
    const relsEntry = entries.find((entry) => entry.filename === 'word/_rels/document.xml.rels')

    expect(documentEntry).toBeDefined()
    expect(relsEntry).toBeDefined()

    const documentXml = await documentEntry!.getData!(new TextWriter())
    const relsXml = await relsEntry!.getData!(new TextWriter())

    expect(documentXml).toContain('Demo Book')
    expect(documentXml).toContain('Alice')
    expect(documentXml).toContain('Root Chapter')
    expect(documentXml).toContain('Paragraph with ')
    expect(documentXml).toContain('A')
    expect(documentXml).toContain('1')
    expect(relsXml).toContain('https://example.com')
    expect(entries.some((entry) => entry.filename.startsWith('word/media/'))).toBe(true)

    await zipReader.close()
  })

  it('resolves asset urls before rendering images', async () => {
    replaceAssetUrls.mockResolvedValueOnce('![asset](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0ioAAAAASUVORK5CYII=)')

    const { buildDocxExport } = await import('@/utils/exportDocx')
    await buildDocxExport({
      title: 'Demo Book',
      author: '',
      description: '',
      language: 'zh-CN',
      publishDate: '2026-05-09',
      coverImage: null,
    }, [{
      id: 'chapter-1',
      bookId: 'book-1',
      parentId: null,
      title: 'Root Chapter',
      content: '![asset](asset://image-1)',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }])

    expect(replaceAssetUrls).toHaveBeenCalledWith('![asset](asset://image-1)', 'export')
  })
})
