import { db } from '@/db'
import { parseExportMarkdownTokens, renderExportMarkdown, type MarkdownToken } from '@/utils/markdown'
import type { Book, BookMeta, Chapter } from '@/types'

export type ExportFormat = 'epub' | 'pdf' | 'markdown'

export type ExportValidationResult = {
  blockingErrors: string[]
  warnings: string[]
}

export type SavedExportResult =
  | { status: 'saved'; filePath?: string }
  | { status: 'cancelled' }

export type PrintExportResult =
  | { status: 'opened' }
  | { status: 'cancelled' }

export type ExportPayload = {
  book: Book
  chapters: Chapter[]
}

export type PdfTextVariant = 'body' | 'blockquote' | 'code' | 'table'

export type PdfBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string; variant: PdfTextVariant }
  | { type: 'image'; src: string; alt: string }

export type PdfExportChapter = {
  title: string
  depth: number
  blocks: PdfBlock[]
}

export type PdfExportPayload = {
  meta: BookMeta
  chapters: PdfExportChapter[]
}

export type PdfOutlineItem = {
  title: string
  anchor: string
  depth: number
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value)
}

function sanitizeFilenameSegment(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
}

function isMeaningfulContent(html: string): boolean {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim().length > 0
}

function collectEmbeddedImageWarnings(chapters: Chapter[]): string[] {
  const maxEmbeddedImageBytes = 1_000_000

  for (const chapter of chapters) {
    const matches = chapter.content.match(/!\[[^\]]*]\((data:image\/[^)]+)\)/g) ?? []
    for (const match of matches) {
      const base64 = match.match(/base64,([A-Za-z0-9+/=]+)/)?.[1]
      if (!base64) continue

      const estimatedBytes = Math.floor(base64.length * 0.75)
      if (estimatedBytes > maxEmbeddedImageBytes) {
        return ['Large embedded images may affect export size and reader compatibility']
      }
    }
  }

  return []
}

function buildTocItems(chapters: Array<Chapter & { depth: number }>): string {
  const counters: number[] = []

  return chapters.map((chapter) => {
    counters[chapter.depth] = (counters[chapter.depth] ?? 0) + 1
    counters.length = chapter.depth + 1

    const numbering = counters.join('.')
    const indent = chapter.depth * 24
    const anchor = `chapter-${chapter.id}`

    return [
      `<li class="toc-item depth-${chapter.depth}" style="padding-left:${indent}px">`,
      `<a href="#${escapeAttribute(anchor)}" class="toc-link">`,
      `<span class="toc-number">${escapeHtml(numbering)}.</span>`,
      `<span class="toc-title">${escapeHtml(chapter.title)}</span>`,
      '</a>',
      '</li>',
    ].join('')
  }).join('')
}

export function isTauri(): boolean {
  return !!window.__TAURI_INTERNALS__
}

export function getExportFilename(baseName: string, fallbackName: string): string {
  const normalized = sanitizeFilenameSegment(baseName)
  return normalized || sanitizeFilenameSegment(fallbackName) || 'export'
}

export function deduplicateChapterTitle(html: string, chapterTitle: string): string {
  const headingMatch = html.match(/^\s*<h([1-6])(?:\s[^>]*)?>(.*?)<\/h[1-6]>/)
  if (!headingMatch) return html

  const headingText = headingMatch[2].replace(/<[^>]*>/g, '').trim()
  if (headingText !== chapterTitle.trim()) return html

  return html.slice(headingMatch[0].length).trimStart()
}

function deduplicateMarkdownHeading(content: string, chapterTitle: string): string {
  const headingMatch = content.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m)
  if (!headingMatch || headingMatch.index !== 0) return content.trim()

  if (normalizeBlockText(headingMatch[1]) !== normalizeBlockText(chapterTitle)) {
    return content.trim()
  }

  return content.slice(headingMatch[0].length).trimStart()
}

export function buildChapterBody(title: string, html: string, anchor: string): string {
  const bodyHtml = deduplicateChapterTitle(html, title)
  const bodyContent = isMeaningfulContent(bodyHtml) ? bodyHtml : '<p></p>'
  return `<section epub:type="chapter"><h1 id="${escapeAttribute(anchor)}" style="color:#00AA44">${escapeHtml(title)}</h1>${bodyContent}</section>`
}

export function flattenChapters(chapters: Chapter[]): Array<Chapter & { depth: number }> {
  const flatten = (parentId: string | null, depth: number): Array<Chapter & { depth: number }> => {
    const siblings = chapters
      .filter((chapter) => chapter.parentId === parentId)
      .sort((a, b) => a.order - b.order)

    const result: Array<Chapter & { depth: number }> = []
    for (const chapter of siblings) {
      result.push({ ...chapter, depth })
      result.push(...flatten(chapter.id, depth + 1))
    }
    return result
  }

  return flatten(null, 0)
}

export async function getExportPayload(bookId: string): Promise<ExportPayload> {
  const book = await db.books.get(bookId)
  if (!book) throw new Error('Book not found')

  const chapters = await db.chapters
    .where('bookId')
    .equals(bookId)
    .sortBy('order')

  return { book, chapters }
}

export async function validateExport(bookId: string): Promise<ExportValidationResult> {
  const book = await db.books.get(bookId)
  if (!book) {
    return {
      blockingErrors: ['Book not found'],
      warnings: [],
    }
  }

  const chapters = await db.chapters
    .where('bookId')
    .equals(bookId)
    .sortBy('order')

  return validateExportPayload(book.meta.title, chapters)
}

export function validateExportPayload(bookTitle: string, chapters: Chapter[]): ExportValidationResult {
  const blockingErrors: string[] = []
  const warnings: string[] = []

  if (!bookTitle.trim()) {
    blockingErrors.push('Book title is required for export')
  }

  if (chapters.length === 0) {
    blockingErrors.push('No chapters to export')
  }

  const emptyChapterTitles = chapters.some((chapter) => !chapter.title.trim())
  if (emptyChapterTitles) {
    blockingErrors.push('Every chapter must have a title before export')
  }

  const normalizedTitles = chapters
    .map((chapter) => chapter.title.trim().toLocaleLowerCase())
    .filter(Boolean)
  const hasDuplicateTitles = new Set(normalizedTitles).size !== normalizedTitles.length
  if (hasDuplicateTitles) {
    warnings.push('Duplicate chapter titles may make the table of contents harder to scan')
  }

  warnings.push(...collectEmbeddedImageWarnings(chapters))

  return {
    blockingErrors,
    warnings,
  }
}

export function buildMarkdownExport(meta: BookMeta, chapters: Chapter[]): string {
  const flattened = flattenChapters(chapters)
  const lines: string[] = []

  if (meta.title.trim()) {
    lines.push(`# ${meta.title.trim()}`, '')
  }

  for (const chapter of flattened) {
    const level = Math.min(chapter.depth + 2, 6)
    const heading = `${'#'.repeat(level)} ${chapter.title.trim()}`
    lines.push(heading, '')

    const content = deduplicateMarkdownHeading(chapter.content, chapter.title)
    if (content) {
      lines.push(content, '')
    }
  }

  return `${lines.join('\n').trim()}\n`
}

function normalizeBlockText(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function deduplicateChapterHeadingBlocks(blocks: PdfBlock[], chapterTitle: string): PdfBlock[] {
  const first = blocks[0]
  if (!first || first.type !== 'heading') return blocks
  if (normalizeBlockText(first.text) !== normalizeBlockText(chapterTitle)) return blocks
  return blocks.slice(1)
}

function getTokenAttr(token: MarkdownToken, name: string): string | null {
  return token.attrGet(name)
}

function extractImageBlocksFromHtmlSnippet(html: string): Array<Extract<PdfBlock, { type: 'image' }>> {
  if (!html.includes('<img')) return []

  const template = document.createElement('template')
  template.innerHTML = html

  return Array.from(template.content.querySelectorAll('img'))
    .map((image) => {
      const src = image.getAttribute('src')?.trim() ?? ''
      if (!src) return null
      return {
        type: 'image' as const,
        src,
        alt: image.getAttribute('alt')?.trim() ?? '',
      }
    })
    .filter((block): block is Extract<PdfBlock, { type: 'image' }> => block !== null)
}

function extractInlineTextAndImages(token: MarkdownToken): { text: string; images: Array<Extract<PdfBlock, { type: 'image' }>> } {
  const parts: string[] = []
  const images: Array<Extract<PdfBlock, { type: 'image' }>> = []

  for (const child of token.children ?? []) {
    switch (child.type) {
      case 'text':
      case 'code_inline':
        parts.push(child.content)
        break
      case 'html_inline':
        images.push(...extractImageBlocksFromHtmlSnippet(child.content))
        parts.push(normalizeBlockText(child.content.replace(/<[^>]+>/g, ' ')))
        break
      case 'softbreak':
      case 'hardbreak':
        parts.push('\n')
        break
      case 'image': {
        const src = getTokenAttr(child, 'src')?.trim() ?? ''
        if (src) {
          images.push({
            type: 'image',
            src,
            alt: child.content.trim(),
          })
        }
        break
      }
      default:
        break
    }
  }

  return {
    text: normalizeBlockText(parts.join('')),
    images,
  }
}

function parseListBlocks(tokens: MarkdownToken[], startIndex: number): { blocks: PdfBlock[]; nextIndex: number } {
  const ordered = tokens[startIndex].type === 'ordered_list_open'
  const closeType = ordered ? 'ordered_list_close' : 'bullet_list_close'
  const blocks: PdfBlock[] = []
  let itemIndex = 0
  let index = startIndex + 1

  while (index < tokens.length && tokens[index].type !== closeType) {
    const token = tokens[index]
    if (token.type === 'list_item_open') {
      itemIndex += 1
      const fragments: string[] = []
      index += 1

      while (index < tokens.length && tokens[index].type !== 'list_item_close') {
        const current = tokens[index]
        if (current.type === 'inline') {
          const { text } = extractInlineTextAndImages(current)
          if (text) fragments.push(text)
        } else if (current.type === 'fence' || current.type === 'code_block') {
          const text = normalizeBlockText(current.content)
          if (text) fragments.push(text)
        }
        index += 1
      }

      const marker = ordered ? `${itemIndex}. ` : '- '
      const text = normalizeBlockText(`${marker}${fragments.join('\n')}`)
      if (text) {
        blocks.push({ type: 'paragraph', text, variant: 'body' })
      }
    }
    index += 1
  }

  return { blocks, nextIndex: index + 1 }
}

function parseTableBlock(tokens: MarkdownToken[], startIndex: number): { block: PdfBlock | null; nextIndex: number } {
  const rows: string[] = []
  let index = startIndex + 1
  let currentCells: string[] = []

  while (index < tokens.length && tokens[index].type !== 'table_close') {
    const token = tokens[index]

    if (token.type === 'tr_open') {
      currentCells = []
    } else if (token.type === 'inline') {
      const { text } = extractInlineTextAndImages(token)
      if (text) currentCells.push(text)
    } else if (token.type === 'tr_close') {
      const row = currentCells.join(' | ')
      if (row) rows.push(row)
    }

    index += 1
  }

  const text = normalizeBlockText(rows.join('\n'))
  return {
    block: text ? { type: 'paragraph', text, variant: 'table' } : null,
    nextIndex: index + 1,
  }
}

function extractPdfBlocksFromMarkdown(content: string, chapterTitle: string): PdfBlock[] {
  const tokens = parseExportMarkdownTokens(content)
  const blocks: PdfBlock[] = []
  let blockquoteDepth = 0

  for (let index = 0; index < tokens.length;) {
    const token = tokens[index]

    if (token.type === 'blockquote_open') {
      blockquoteDepth += 1
      index += 1
      continue
    }

    if (token.type === 'blockquote_close') {
      blockquoteDepth = Math.max(0, blockquoteDepth - 1)
      index += 1
      continue
    }

    if (token.type === 'heading_open') {
      const inline = tokens[index + 1]
      if (inline?.type === 'inline') {
        const { text, images } = extractInlineTextAndImages(inline)
        if (text) {
          blocks.push({
            type: 'heading',
            level: Number.parseInt(token.tag.slice(1), 10),
            text,
          })
        }
        blocks.push(...images)
      }
      index += 3
      continue
    }

    if (token.type === 'paragraph_open') {
      const inline = tokens[index + 1]
      if (inline?.type === 'inline') {
        const { text, images } = extractInlineTextAndImages(inline)
        if (text) {
          blocks.push({
            type: 'paragraph',
            text,
            variant: blockquoteDepth > 0 ? 'blockquote' : 'body',
          })
        }
        blocks.push(...images)
      }
      index += 3
      continue
    }

    if (token.type === 'fence' || token.type === 'code_block') {
      const text = normalizeBlockText(token.content)
      if (text) {
        blocks.push({ type: 'paragraph', text, variant: 'code' })
      }
      index += 1
      continue
    }

    if (token.type === 'html_block') {
      blocks.push(...extractImageBlocksFromHtmlSnippet(token.content))
      index += 1
      continue
    }

    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const result = parseListBlocks(tokens, index)
      blocks.push(...result.blocks)
      index = result.nextIndex
      continue
    }

    if (token.type === 'table_open') {
      const result = parseTableBlock(tokens, index)
      if (result.block) blocks.push(result.block)
      index = result.nextIndex
      continue
    }

    index += 1
  }

  return deduplicateChapterHeadingBlocks(blocks, chapterTitle)
}

export function buildPdfExportPayload(meta: BookMeta, chapters: Chapter[]): PdfExportPayload {
  const flattened = flattenChapters(chapters)

  return {
    meta,
    chapters: flattened.map((chapter) => ({
      title: chapter.title.trim(),
      depth: chapter.depth,
      blocks: extractPdfBlocksFromMarkdown(chapter.content, chapter.title),
    })),
  }
}

export function buildPdfOutlineItems(chapters: Chapter[]): PdfOutlineItem[] {
  return flattenChapters(chapters).map((chapter) => ({
    title: chapter.title.trim(),
    anchor: `chapter-${chapter.id}`,
    depth: chapter.depth,
  }))
}

export function buildPrintHtml(meta: BookMeta, chapters: Chapter[]): string {
  const flattened = flattenChapters(chapters)
  const sectionHtml = flattened.map((chapter) => {
    const anchor = `chapter-${chapter.id}`
    const content = buildChapterBody(chapter.title, renderExportMarkdown(chapter.content), anchor)
    return `<article class="chapter depth-${chapter.depth}">${content}</article>`
  }).join('')

  const tocHtml = flattened.length > 0
    ? `<section class="toc"><h2>目录</h2><ol>${buildTocItems(flattened)}</ol></section>`
    : ''

  const titleMeta = [
    meta.author.trim() ? `<p class="meta-line">${escapeHtml(meta.author.trim())}</p>` : '',
    meta.description.trim() ? `<p class="description">${escapeHtml(meta.description.trim())}</p>` : '',
    meta.publishDate.trim() ? `<p class="meta-line">${escapeHtml(meta.publishDate.trim())}</p>` : '',
  ].filter(Boolean).join('')

  const coverHtml = meta.coverImage
    ? `<img class="cover" src="${escapeAttribute(meta.coverImage)}" alt="Cover" />`
    : ''

  return `<!DOCTYPE html>
<html lang="${escapeAttribute(meta.language || 'zh-CN')}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(meta.title || 'Export')}</title>
  <style>
    @page {
      size: auto;
      margin: 18mm 16mm 20mm;
    }

    :root {
      color-scheme: light;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      color: #111827;
      font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      line-height: 1.75;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    main {
      max-width: 820px;
      margin: 0 auto;
    }

    .title-page {
      min-height: 70vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      page-break-after: always;
      gap: 12px;
    }

    .cover {
      max-width: 220px;
      max-height: 320px;
      object-fit: contain;
    }

    .book-title {
      margin: 0;
      font-size: 32px;
      line-height: 1.25;
    }

    .meta-line,
    .description {
      margin: 0;
      color: #4b5563;
      font-size: 14px;
    }

    .description {
      max-width: 560px;
      white-space: pre-wrap;
    }

    .toc {
      page-break-after: always;
    }

    .toc h2 {
      margin: 0 0 16px;
      font-size: 24px;
    }

    .toc ol {
      margin: 0;
      padding-left: 0;
      list-style: none;
    }

    .toc li {
      margin: 6px 0;
      break-inside: avoid;
    }

    .toc-link {
      display: flex;
      align-items: baseline;
      gap: 10px;
      color: #111827;
      text-decoration: none;
    }

    .toc-number {
      min-width: 48px;
      font-variant-numeric: tabular-nums;
      font-feature-settings: "tnum" 1;
      font-weight: 600;
      color: #374151;
      flex: 0 0 auto;
    }

    .toc-title {
      flex: 1 1 auto;
      min-width: 0;
    }

    .chapter {
      page-break-before: always;
    }

    .chapter h1,
    .chapter h2,
    .chapter h3,
    .chapter h4,
    .chapter h5,
    .chapter h6 {
      break-after: avoid;
      color: #111827;
    }

    .chapter p,
    .chapter li,
    .chapter blockquote {
      orphans: 3;
      widows: 3;
    }

    .chapter img {
      max-width: 100%;
      height: auto;
      break-inside: avoid;
    }

    .chapter pre {
      white-space: pre-wrap;
      word-break: break-word;
      background: #f3f4f6;
      border-radius: 6px;
      padding: 12px;
      overflow: hidden;
    }

    .chapter table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    .chapter th,
    .chapter td {
      border: 1px solid #d1d5db;
      padding: 8px;
      vertical-align: top;
      word-break: break-word;
    }

    .chapter blockquote {
      margin: 16px 0;
      padding-left: 12px;
      border-left: 3px solid #9ca3af;
      color: #374151;
    }
  </style>
</head>
<body>
  <main>
    <section class="title-page">
      ${coverHtml}
      <h1 class="book-title">${escapeHtml(meta.title || 'Export')}</h1>
      ${titleMeta}
    </section>
    ${tocHtml}
    ${sectionHtml}
  </main>
</body>
</html>`
}

async function saveBlobInTauri(blob: Blob, filename: string, extension: string, filterName: string): Promise<SavedExportResult> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  const filePath = await save({
    defaultPath: `${filename}.${extension}`,
    filters: [{ name: filterName, extensions: [extension] }],
  })

  if (!filePath) return { status: 'cancelled' }

  const buffer = await blob.arrayBuffer()
  await writeFile(filePath, new Uint8Array(buffer))
  return { status: 'saved', filePath }
}

async function saveBlobInBrowser(blob: Blob, filename: string, extension: string): Promise<SavedExportResult> {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.${extension}`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)

  return { status: 'saved' }
}

export async function saveBlobFile(blob: Blob, filename: string, extension: string, filterName: string): Promise<SavedExportResult> {
  if (isTauri()) {
    return saveBlobInTauri(blob, filename, extension, filterName)
  }

  return saveBlobInBrowser(blob, filename, extension)
}

export async function saveTextFile(content: string, filename: string, extension: string, mimeType: string, filterName: string): Promise<SavedExportResult> {
  const blob = new Blob([content], { type: mimeType })
  return saveBlobFile(blob, filename, extension, filterName)
}

export async function savePdfFile(html: string, title: string, filename: string, outlineItems: PdfOutlineItem[]): Promise<SavedExportResult> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { invoke } = await import('@tauri-apps/api/core')

  const filePath = await save({
    defaultPath: `${filename}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })

  if (!filePath) return { status: 'cancelled' }

  await invoke('export_pdf', {
    request: {
      html,
      title,
      filePath,
      outlineItems,
    },
  })

  return { status: 'saved', filePath }
}

export async function openPrintPreview(html: string, title: string): Promise<PrintExportResult> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '0'
  iframe.style.bottom = '0'
  iframe.style.width = '0'
  iframe.style.height = '0'
  iframe.style.border = '0'
  iframe.style.visibility = 'hidden'

  document.body.appendChild(iframe)

  try {
    const doc = iframe.contentDocument
    const win = iframe.contentWindow
    if (!doc || !win) {
      return { status: 'cancelled' }
    }

    doc.open()
    doc.write(html)
    doc.close()
    doc.title = title

    await new Promise<void>((resolve) => {
      let resolved = false
      const complete = () => {
        if (resolved) return
        resolved = true
        resolve()
      }

      if (doc.readyState === 'complete') {
        complete()
        return
      }

      iframe.addEventListener('load', () => complete(), { once: true })
      window.setTimeout(() => complete(), 500)
    })

    await new Promise<void>((resolve) => {
      const images = Array.from(doc.querySelectorAll('img'))
      if (images.length === 0) {
        resolve()
        return
      }

      let pending = images.length
      const finish = () => {
        pending -= 1
        if (pending <= 0) resolve()
      }

      for (const image of images) {
        if (image.complete) {
          finish()
          continue
        }

        image.addEventListener('load', finish, { once: true })
        image.addEventListener('error', finish, { once: true })
      }

      window.setTimeout(() => resolve(), 1200)
    })

    if ('fonts' in doc && doc.fonts) {
      await Promise.race([
        doc.fonts.ready,
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, 1500)
        }),
      ])
    }

    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve())
      })
    })

    let cleanedUp = false
    const cleanup = () => {
      if (cleanedUp) return
      cleanedUp = true
      iframe.remove()
    }

    const handleAfterPrint = () => {
      window.setTimeout(cleanup, 1000)
    }

    win.addEventListener('afterprint', handleAfterPrint, { once: true })
    window.setTimeout(cleanup, 120000)

    win.focus()
    win.print()
    return { status: 'opened' }
  } finally {
    if (!iframe.contentDocument || !iframe.contentWindow) {
      iframe.remove()
    }
  }
}
