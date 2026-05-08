import { renderExportMarkdown } from '@/utils/markdown'
import {
  buildChapterBody,
  deduplicateChapterTitle,
  flattenChapters,
  getExportPayload,
  isTauri,
  saveBlobFile,
} from '@/utils/export'
import type { BookMeta, Chapter } from '@/types'
import type { Options, Content } from 'epub-gen-memory'

type ExportChapter = {
  id: string
  title: string
  content: string
  filename: string
  author: string[]
  excludeFromToc?: boolean
  beforeToc?: boolean
  depth: number
  anchor: string
  tocHref: string
}

type ExportChapterNode = ExportChapter & {
  children: ExportChapterNode[]
}

export type DownloadEpubResult =
  | { status: 'saved'; filePath?: string }
  | { status: 'cancelled' }

const tocXHTMLTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="<%- lang %>" lang="<%- lang %>">
<head>
  <meta charset="UTF-8" />
  <title><%= title %></title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
  <h1 class="h1"><%= tocTitle %></h1>
  <nav id="toc" epub:type="toc">
    <%- tocXhtmlBody %>
  </nav>
</body>
</html>`

const tocNCXTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="<%= id %>" />
    <meta name="dtb:generator" content="epub-gen"/>
    <meta name="dtb:depth" content="<%= tocDepth %>"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle>
    <text><%= title %></text>
  </docTitle>
  <docAuthor>
    <text><%= author.join(', ') %></text>
  </docAuthor>
  <navMap>
    <%- tocNcxBody %>
  </navMap>
</ncx>`

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeXml(value: string): string {
  return escapeHtml(value)
}

function normalizeAuthor(author: string): string[] {
  return author
    ? author.split(/[&,，]/).map((item) => item.trim()).filter(Boolean)
    : ['Unknown Author']
}

export { deduplicateChapterTitle, buildChapterBody, flattenChapters, isTauri }

export function buildExportChapters(chapters: Chapter[]): ExportChapter[] {
  return flattenChapters(chapters).map((chapter, index) => {
    const anchor = `chapter-${chapter.id}`
    const filename = `${index + 1}-${chapter.id}.xhtml`
    const renderedHtml = renderExportMarkdown(chapter.content)

    return {
      id: chapter.id,
      title: chapter.title,
      author: [],
      content: buildChapterBody(chapter.title, renderedHtml, anchor),
      filename,
      depth: chapter.depth,
      anchor,
      tocHref: `${filename}#${anchor}`,
    }
  })
}

export function buildExportChapterTree(chapters: ExportChapter[]): ExportChapterNode[] {
  const roots: ExportChapterNode[] = []
  const stack: ExportChapterNode[] = []

  for (const chapter of chapters) {
    const node: ExportChapterNode = { ...chapter, children: [] }

    while (stack.length > chapter.depth) {
      stack.pop()
    }

    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1].children.push(node)
    }

    stack.push(node)
  }

  return roots
}

export function getMaxTocDepth(chapters: ExportChapter[]): number {
  if (chapters.length === 0) return 1
  return Math.max(...chapters.map((chapter) => chapter.depth)) + 1
}

export function buildTocXhtmlBody(tree: ExportChapterNode[]): string {
  const renderNodes = (nodes: ExportChapterNode[]): string => {
    const items = nodes.map((node) => {
      const children = node.children.length > 0 ? renderNodes(node.children) : ''
      return `<li class="table-of-content"><a href="${escapeHtml(node.tocHref)}">${escapeHtml(node.title)}</a>${children}</li>`
    }).join('')

    return `<ol>${items}</ol>`
  }

  return renderNodes(tree)
}

export function buildTocNcxBody(tree: ExportChapterNode[]): string {
  let playOrder = 1

  const renderNodes = (nodes: ExportChapterNode[]): string => {
    return nodes.map((node) => {
      const currentPlayOrder = playOrder++
      const children = node.children.length > 0 ? renderNodes(node.children) : ''
      return `<navPoint id="nav-${escapeHtml(node.id)}" playOrder="${currentPlayOrder}" class="chapter"><navLabel><text>${escapeXml(node.title)}</text></navLabel><content src="${escapeHtml(node.tocHref)}"/>${children}</navPoint>`
    }).join('')
  }

  return renderNodes(tree)
}

function validateExportChapters(chapters: ExportChapter[]) {
  const hrefs = new Set<string>()

  for (const chapter of chapters) {
    if (!chapter.title.trim()) {
      throw new Error('Chapter title is required for export')
    }
    if (!chapter.filename?.endsWith('.xhtml')) {
      throw new Error(`Invalid chapter filename: ${chapter.filename}`)
    }
    if (!chapter.anchor.trim()) {
      throw new Error(`Missing chapter anchor for ${chapter.id}`)
    }
    if (!chapter.tocHref.includes(`#${chapter.anchor}`)) {
      throw new Error(`Invalid TOC target for ${chapter.id}`)
    }
    if (hrefs.has(chapter.tocHref)) {
      throw new Error(`Duplicate TOC target: ${chapter.tocHref}`)
    }
    hrefs.add(chapter.tocHref)
  }
}

function generateTitlePage(meta: BookMeta): string {
  const coverImg = meta.coverImage
    ? `<div style="text-align:center;margin-bottom:2em"><img src="${meta.coverImage}" alt="Cover" style="max-width:60%;max-height:400px;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.2)" /></div>`
    : ''

  return `
${coverImg}
<div style="text-align:center;padding:2em 0">
  <h1 style="font-size:2em;margin:0.5em 0;border:none">${escapeHtml(meta.title)}</h1>
  ${meta.author ? `<p style="font-size:1.2em;color:#555;margin:0.5em 0">${escapeHtml(meta.author)} 著</p>` : ''}
  ${meta.description ? `<p style="font-size:0.9em;color:#777;margin:1em auto;max-width:80%;line-height:1.6">${escapeHtml(meta.description)}</p>` : ''}
  <hr style="border:none;border-top:1px solid #ddd;margin:1.5em auto;width:40%" />
  ${meta.publishDate ? `<p style="font-size:0.85em;color:#999">出版日期：${escapeHtml(meta.publishDate)}</p>` : ''}
  <p style="font-size:0.8em;color:#aaa;margin-top:1em">EPUB Builder</p>
</div>
`
}

async function toCoverFile(coverImage: string | null): Promise<string | File | undefined> {
  if (!coverImage) return undefined

  const match = coverImage.match(/^data:(image\/[^;]+);base64,(.+)$/)
  if (!match) return coverImage

  const mime = match[1]
  const ext = mime.split('/')[1] || 'png'
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return new File([bytes], `cover.${ext}`, { type: mime })
}

export async function exportToEpub(bookId: string): Promise<Blob> {
  const { book, chapters: allChapters } = await getExportPayload(bookId)

  if (allChapters.length === 0) throw new Error('No chapters to export')

  const exportChapters = buildExportChapters(allChapters)
  validateExportChapters(exportChapters)

  const chapterTree = buildExportChapterTree(exportChapters)
  const tocXhtmlBody = buildTocXhtmlBody(chapterTree)
  const tocNcxBody = buildTocNcxBody(chapterTree)
  const tocDepth = getMaxTocDepth(exportChapters)

  const titlePageContent: Content[number] = {
    title: 'Title Page',
    content: generateTitlePage(book.meta),
    excludeFromToc: true,
    beforeToc: true,
  }

  const content: Content = [titlePageContent, ...exportChapters]
  const cover = await toCoverFile(book.meta.coverImage)

  const options: Options & {
    tocXhtmlBody: string
    tocNcxBody: string
    tocDepth: number
  } = {
    title: book.meta.title,
    author: normalizeAuthor(book.meta.author),
    publisher: 'EPUB Builder',
    description: book.meta.description || undefined,
    cover,
    date: book.meta.publishDate || undefined,
    lang: book.meta.language || 'zh-CN',
    tocTitle: '目录',
    tocInTOC: true,
    numberChaptersInTOC: false,
    prependChapterTitles: false,
    version: 3,
    tocXHTML: tocXHTMLTemplate,
    tocNCX: tocNCXTemplate,
    tocXhtmlBody,
    tocNcxBody,
    tocDepth,
  }

  const ePubModule = await import('epub-gen-memory')
  // eslint-disable-next-line ts/no-explicit-any -- CJS/ESM interop
  const ePub = (ePubModule as any).default?.default || (ePubModule as any).default || ePubModule
  const result = await ePub(options, content)

  if (result instanceof Blob) {
    return result
  }

  return new Blob([new Uint8Array(result as unknown as ArrayBuffer)], { type: 'application/epub+zip' })
}

export async function downloadEpub(blob: Blob, filename: string): Promise<DownloadEpubResult> {
  return saveBlobFile(blob, filename, 'epub', 'EPUB')
}
