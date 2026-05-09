import { describe, expect, it, vi } from 'vitest'
import type { Chapter } from '@/types'
import {
  buildMarkdownExport,
  buildPdfExportPayload,
  buildPrintHtml,
  getExportFilename,
  openPrintPreview,
} from '@/utils/export'

const meta = {
  title: 'Demo Book',
  author: 'Alice',
  description: 'Short intro',
  language: 'zh-CN',
  publishDate: '2026-05-06',
  coverImage: null,
}

const chapters: Chapter[] = [
  {
    id: 'root-1',
    bookId: 'book-1',
    parentId: null,
    title: 'Root 1',
    content: 'Intro',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'child-1',
    bookId: 'book-1',
    parentId: 'root-1',
    title: 'Child 1',
    content: 'Nested body',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  },
]

describe('buildMarkdownExport', () => {
  it('exports clean nested chapter headings without a duplicated toc block', async () => {
    const markdown = await buildMarkdownExport(meta, chapters)

    expect(markdown).toContain('# Demo Book')
    expect(markdown).not.toContain('## 目录')
    expect(markdown).toContain('## Root 1')
    expect(markdown).toContain('### Child 1')
    expect(markdown).toContain('Nested body')
  })

  it('removes duplicate leading chapter headings from chapter content', async () => {
    const markdown = await buildMarkdownExport(meta, [{
      ...chapters[0],
      content: '# Root 1\n\nIntro',
    }])

    expect(markdown.match(/^## Root 1$/gm)).toHaveLength(1)
    expect(markdown).toContain('Intro')
  })
})

describe('buildPrintHtml', () => {
  it('renders a printable document with title, toc, and chapter content', async () => {
    const html = await buildPrintHtml(meta, chapters)

    expect(html).toContain('<title>Demo Book</title>')
    expect(html).toContain('<section class="toc">')
    expect(html).toContain('chapter-root-1')
    expect(html).toContain('href="#chapter-root-1"')
    expect(html).toContain('class="toc-number">1.</span>')
    expect(html).toContain('>Intro</p>')
  })
})

describe('buildPdfExportPayload', () => {
  it('converts markdown into stable text and image blocks', () => {
    const payload = buildPdfExportPayload(meta, [{
      ...chapters[0],
      title: 'Root 1',
      content: '# Root 1\n\nParagraph\n\n- Item A\n- Item B\n\n> Quote\n\n```ts\nconst a = 1\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n![hero](data:image/png;base64,abc)',
    }])

    expect(payload.chapters[0].blocks).toEqual([
      { type: 'paragraph', text: 'Paragraph', variant: 'body' },
      { type: 'paragraph', text: '- Item A', variant: 'body' },
      { type: 'paragraph', text: '- Item B', variant: 'body' },
      { type: 'paragraph', text: 'Quote', variant: 'blockquote' },
      { type: 'paragraph', text: 'const a = 1', variant: 'code' },
      { type: 'paragraph', text: 'A | B\n1 | 2', variant: 'table' },
      { type: 'image', src: 'data:image/png;base64,abc', alt: 'hero' },
    ])
  })

  it('extracts html image tags and blockquotes without literal markdown markers', () => {
    const payload = buildPdfExportPayload(meta, [{
      ...chapters[0],
      title: 'Root 1',
      content: '> 引用内容\n\n<img src="file:///C:/tmp/demo.png" alt="demo" />',
    }])

    expect(payload.chapters[0].blocks).toEqual([
      { type: 'paragraph', text: '引用内容', variant: 'blockquote' },
      { type: 'image', src: 'file:///C:/tmp/demo.png', alt: 'demo' },
    ])
  })
})

describe('getExportFilename', () => {
  it('sanitizes invalid filename characters', () => {
    expect(getExportFilename('Demo:/Book?', 'fallback')).toBe('Demo Book')
  })
})

describe('openPrintPreview', () => {
  it('returns cancelled when the print iframe has no document context', async () => {
    const iframe = document.createElement('iframe')
    Object.defineProperty(iframe, 'contentDocument', { value: null })
    Object.defineProperty(iframe, 'contentWindow', { value: null })

    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'iframe') return iframe
      return document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLElement
    })

    await expect(openPrintPreview('<html></html>', 'Demo')).resolves.toEqual({ status: 'cancelled' })

    createElementSpy.mockRestore()
  })

  it('keeps the print iframe alive until after printing finishes', async () => {
    vi.useFakeTimers()

    const iframe = document.createElement('iframe')
    const removeSpy = vi.spyOn(iframe, 'remove')
    const focus = vi.fn()
    const print = vi.fn()
    let afterPrintHandler: (() => void) | null = null

    const doc = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
      querySelectorAll: vi.fn(() => []),
      readyState: 'complete',
      title: '',
    }

    const win = {
      focus,
      print,
      addEventListener: vi.fn((event: string, handler: () => void) => {
        if (event === 'afterprint') afterPrintHandler = handler
      }),
    }

    Object.defineProperty(iframe, 'contentDocument', { value: doc })
    Object.defineProperty(iframe, 'contentWindow', { value: win })

    const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      if (tagName === 'iframe') return iframe
      return document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLElement
    })

    const resultPromise = openPrintPreview('<html></html>', 'Demo')
    await vi.advanceTimersByTimeAsync(50)

    await expect(resultPromise).resolves.toEqual({ status: 'opened' })
    expect(print).toHaveBeenCalledTimes(1)
    expect(removeSpy).not.toHaveBeenCalled()

    const handler = afterPrintHandler as (() => void) | null
    expect(handler).not.toBeNull()
    handler?.()
    await vi.advanceTimersByTimeAsync(1000)

    expect(removeSpy).toHaveBeenCalledTimes(1)

    createElementSpy.mockRestore()
    vi.useRealTimers()
  })
})
