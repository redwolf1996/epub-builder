import { describe, it, expect } from 'vitest'
import type { Chapter } from '@/types'
import {
  deduplicateChapterTitle,
  buildChapterBody,
  buildExportChapters,
  buildExportChapterTree,
  buildTocXhtmlBody,
  buildTocNcxBody,
  getMaxTocDepth,
} from '@/utils/epub'
import { validateExportPayload } from '@/utils/export'

const chapters: Chapter[] = [
  {
    id: 'root-1',
    bookId: 'book-1',
    parentId: null,
    title: 'Root 1',
    content: '# Root 1\n\nIntro',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'child-1',
    bookId: 'book-1',
    parentId: 'root-1',
    title: 'Child 1',
    content: 'Child body',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'child-2',
    bookId: 'book-1',
    parentId: 'root-1',
    title: 'Child 2',
    content: '',
    order: 1,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'root-2',
    bookId: 'book-1',
    parentId: null,
    title: 'Root 2',
    content: 'Root 2 body',
    order: 1,
    createdAt: 1,
    updatedAt: 1,
  },
]

describe('deduplicateChapterTitle', () => {
  it('removes a duplicate first heading', () => {
    const html = '<h1>Chapter 1</h1><p>Content</p>'
    expect(deduplicateChapterTitle(html, 'Chapter 1')).toBe('<p>Content</p>')
  })

  it('keeps the original html when the first heading differs', () => {
    const html = '<h1>Different</h1><p>Content</p>'
    expect(deduplicateChapterTitle(html, 'Chapter 1')).toBe(html)
  })
})

describe('buildChapterBody', () => {
  it('keeps a stable heading anchor even when the chapter has no body', () => {
    const body = buildChapterBody('Chapter', '', 'chapter-1')
    expect(body).toContain('<h1 id="chapter-1"')
    expect(body).toContain('>Chapter</h1>')
    expect(body).toContain('<p></p>')
  })

  it('deduplicates a repeated markdown heading from the body', () => {
    const body = buildChapterBody('Chapter', '<h1>Chapter</h1><p>Text</p>', 'chapter-1')
    expect(body).toContain('<h1 id="chapter-1"')
    expect(body).toContain('>Chapter</h1>')
    expect(body).not.toContain('<h1>Chapter</h1><p>Text</p>')
    expect(body).toContain('<p>Text</p>')
  })
})

describe('export chapter model', () => {
  it('builds chapters with real titles and explicit TOC hrefs', () => {
    const result = buildExportChapters(chapters)
    expect(result.map((chapter) => chapter.title)).toEqual(['Root 1', 'Child 1', 'Child 2', 'Root 2'])
    expect(result[0].tocHref).toBe(`${result[0].filename}#chapter-root-1`)
    expect(result[1].depth).toBe(1)
    expect(result[2].content).toContain('<h1 id="chapter-child-2"')
    expect(result[2].content).toContain('>Child 2</h1>')
  })

  it('builds a tree that preserves nested chapter relationships', () => {
    const result = buildExportChapterTree(buildExportChapters(chapters))
    expect(result).toHaveLength(2)
    expect(result[0].children.map((child) => child.title)).toEqual(['Child 1', 'Child 2'])
  })

  it('reports the actual maximum TOC depth', () => {
    const result = buildExportChapters(chapters)
    expect(getMaxTocDepth(result)).toBe(2)
  })
})

describe('TOC rendering', () => {
  it('renders nested ol/li markup for toc.xhtml', () => {
    const tree = buildExportChapterTree(buildExportChapters(chapters))
    const toc = buildTocXhtmlBody(tree)
    expect(toc).toContain('<ol>')
    expect(toc).toContain('Child 1')
    expect(toc).toContain(`${tree[0].children[0].filename}#chapter-child-1`)
  })

  it('renders nested navPoint markup for toc.ncx with anchored targets', () => {
    const tree = buildExportChapterTree(buildExportChapters(chapters))
    const ncx = buildTocNcxBody(tree)
    expect(ncx).toContain('playOrder="1"')
    expect(ncx).toContain('<navPoint id="nav-root-1"')
    expect(ncx).toContain(`<content src="${tree[0].children[1].filename}#chapter-child-2"/>`)
  })
})

describe('validateExport', () => {
  it('reports blocking errors for missing title and chapters', async () => {
    expect(validateExportPayload('', [])).toEqual({
      blockingErrors: ['Book title is required for export', 'No chapters to export'],
      warnings: [],
    })
  })

  it('reports warnings for duplicate titles and large embedded images', async () => {
    const largeBase64 = `data:image/png;base64,${'a'.repeat(1_400_000)}`
    const warningChapters: Chapter[] = [
      {
        id: 'chapter-1',
        bookId: 'book-1',
        parentId: null,
        title: 'Intro',
        content: `![hero](${largeBase64})`,
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: 'chapter-2',
        bookId: 'book-1',
        parentId: null,
        title: 'Intro',
        content: 'Body',
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ]

    expect(validateExportPayload('Demo', warningChapters)).toEqual({
      blockingErrors: [],
      warnings: [
        'Duplicate chapter titles may make the table of contents harder to scan',
        'Large embedded images may affect export size and reader compatibility',
      ],
    })
  })
})
