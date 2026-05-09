import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx'
import { replaceAssetUrls } from '@/utils/assets'
import { renderExportMarkdown } from '@/utils/markdown'
import { flattenChapters } from '@/utils/export'
import type { BookMeta, Chapter } from '@/types'

const NUMBERING_REFERENCE = 'epub-builder-ordered-list'

function extractTextContent(node: Node): string {
  return node.textContent?.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim() ?? ''
}

function parseDataUrl(source: string): { data: Uint8Array; mimeType: string } | null {
  const match = source.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,([A-Za-z0-9+/=]+)$/)
  if (!match) return null

  const [, mimeType = 'application/octet-stream', base64] = match
  const binary = atob(base64)
  const data = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    data[index] = binary.charCodeAt(index)
  }
  return { data, mimeType }
}

async function loadImageBytes(source: string): Promise<{ data: Uint8Array; mimeType: string } | null> {
  const inline = parseDataUrl(source)
  if (inline) return inline

  try {
    const response = await fetch(source)
    if (!response.ok) return null
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'application/octet-stream'
    const data = new Uint8Array(await response.arrayBuffer())
    return { data, mimeType }
  } catch {
    return null
  }
}

async function createImageChild(source: string, alt: string): Promise<ParagraphChild | null> {
  const image = await loadImageBytes(source)
  if (!image) return null
  if (image.mimeType === 'image/svg+xml') return null

  const imageType = image.mimeType === 'image/png'
    ? 'png'
    : image.mimeType === 'image/gif'
      ? 'gif'
      : image.mimeType === 'image/bmp'
        ? 'bmp'
        : 'jpg'

  return new ImageRun({
    type: imageType,
    data: image.data,
    transformation: {
      width: 480,
      height: 320,
    },
    altText: {
      name: alt || 'image',
      description: alt || 'image',
      title: alt || 'image',
    },
  })
}

function createTextRun(text: string, options: { bold?: boolean; italics?: boolean; code?: boolean } = {}): TextRun {
  return new TextRun({
    text,
    bold: options.bold,
    italics: options.italics,
    font: options.code ? 'Consolas' : undefined,
    size: options.code ? 20 : undefined,
  })
}

async function convertInlineNode(node: Node, marks: { bold?: boolean; italics?: boolean; code?: boolean } = {}): Promise<ParagraphChild[]> {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? ''
    return text ? [createTextRun(text, marks)] : []
  }

  if (!(node instanceof HTMLElement)) return []

  switch (node.tagName.toLowerCase()) {
    case 'strong':
    case 'b':
      return await convertInlineChildren(node, { ...marks, bold: true })
    case 'em':
    case 'i':
      return await convertInlineChildren(node, { ...marks, italics: true })
    case 'code':
      return await convertInlineChildren(node, { ...marks, code: true })
    case 'br':
      return [new TextRun({ break: 1 })]
    case 'a': {
      const children = await convertInlineChildren(node, marks)
      const href = node.getAttribute('href')?.trim()
      if (!href || children.length === 0) return children
      return [new ExternalHyperlink({ link: href, children })]
    }
    case 'img': {
      const src = node.getAttribute('src')?.trim()
      if (!src) return []
      const image = await createImageChild(src, node.getAttribute('alt')?.trim() ?? '')
      return image ? [image] : []
    }
    default:
      return await convertInlineChildren(node, marks)
  }
}

async function convertInlineChildren(parent: ParentNode, marks: { bold?: boolean; italics?: boolean; code?: boolean } = {}): Promise<ParagraphChild[]> {
  const items = await Promise.all(Array.from(parent.childNodes).map((child) => convertInlineNode(child, marks)))
  return items.flat()
}

function deduplicateLeadingHeading(container: HTMLElement, chapterTitle: string) {
  const firstElement = container.firstElementChild
  if (!firstElement) return

  if (!/^H[1-6]$/.test(firstElement.tagName)) return
  if (extractTextContent(firstElement) !== chapterTitle.trim()) return
  firstElement.remove()
}

async function convertList(list: HTMLOListElement | HTMLUListElement, depth: number): Promise<Paragraph[]> {
  const ordered = list.tagName.toLowerCase() === 'ol'
  const paragraphs: Paragraph[] = []

  for (const item of Array.from(list.children)) {
    if (!(item instanceof HTMLLIElement)) continue

    const inlineContainer = document.createElement('div')
    for (const child of Array.from(item.childNodes)) {
      if (child instanceof HTMLElement && (child.tagName.toLowerCase() === 'ol' || child.tagName.toLowerCase() === 'ul')) {
        continue
      }
      inlineContainer.appendChild(child.cloneNode(true))
    }

    const textChildren = await convertInlineChildren(inlineContainer)
    if (textChildren.length > 0) {
      paragraphs.push(new Paragraph({
        children: textChildren,
        bullet: ordered ? undefined : { level: Math.min(depth, 7) },
        numbering: ordered ? { reference: NUMBERING_REFERENCE, level: Math.min(depth, 7) } : undefined,
        spacing: { after: 120 },
      }))
    }

    for (const nested of Array.from(item.children)) {
      if (nested instanceof HTMLOListElement || nested instanceof HTMLUListElement) {
        paragraphs.push(...await convertList(nested, depth + 1))
      }
    }
  }

  return paragraphs
}

async function convertTable(table: HTMLTableElement): Promise<Table> {
  const rows = await Promise.all(Array.from(table.querySelectorAll('tr')).map(async (row) => {
    const cells = await Promise.all(Array.from(row.querySelectorAll('th, td')).map(async (cell) => {
      const children = await convertBlockChildren(cell)
      return new TableCell({
        children: children.length > 0 ? children : [new Paragraph('')],
        width: { size: 100 / Math.max(row.children.length, 1), type: WidthType.PERCENTAGE },
      })
    }))
    return new TableRow({ children: cells })
  }))

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
  })
}

async function convertParagraphLike(element: HTMLElement, options: { heading?: number; blockquote?: boolean; code?: boolean } = {}): Promise<Paragraph> {
  const children = options.code
    ? [createTextRun(element.textContent?.replace(/\n$/, '') ?? '', { code: true })]
    : await convertInlineChildren(element)

  return new Paragraph({
    children: children.length > 0 ? children : [new TextRun('')],
    heading: options.heading
      ? [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][Math.min(options.heading, 6) - 1]
      : undefined,
    indent: options.blockquote ? { left: 480 } : undefined,
    border: options.blockquote ? {
      left: {
        color: '9CA3AF',
        space: 1,
        style: BorderStyle.SINGLE,
        size: 6,
      },
    } : undefined,
    shading: options.code ? { fill: 'F3F4F6' } : undefined,
    spacing: { after: 160 },
  })
}

async function convertBlockNode(node: Node): Promise<Array<Paragraph | Table>> {
  if (!(node instanceof HTMLElement)) return []

  const tagName = node.tagName.toLowerCase()
  if (/^h[1-6]$/.test(tagName)) {
    return [await convertParagraphLike(node, { heading: Number.parseInt(tagName.slice(1), 10) })]
  }

  switch (tagName) {
    case 'p':
      return [await convertParagraphLike(node)]
    case 'blockquote': {
      return [await convertParagraphLike(node, { blockquote: true })]
    }
    case 'pre':
      return [await convertParagraphLike(node, { code: true })]
    case 'ul':
    case 'ol':
      return await convertList(node as HTMLOListElement | HTMLUListElement, 0)
    case 'table':
      return [await convertTable(node as HTMLTableElement)]
    case 'img': {
      const src = node.getAttribute('src')?.trim()
      if (!src) return []
      const image = await createImageChild(src, node.getAttribute('alt')?.trim() ?? '')
      return image ? [new Paragraph({ children: [image], alignment: AlignmentType.CENTER, spacing: { after: 200 } })] : []
    }
    case 'hr':
      return [new Paragraph({ thematicBreak: true })]
    default:
      return [await convertParagraphLike(node)]
  }
}

async function convertBlockChildren(parent: ParentNode): Promise<Array<Paragraph | Table>> {
  const blocks = await Promise.all(Array.from(parent.childNodes).map((child) => convertBlockNode(child)))
  return blocks.flat()
}

function createMetadataParagraphs(meta: BookMeta): Paragraph[] {
  const items: Paragraph[] = []

  if (meta.title.trim()) {
    items.push(new Paragraph({
      text: meta.title.trim(),
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 240 },
      alignment: AlignmentType.CENTER,
    }))
  }

  const metaLines = [meta.author.trim(), meta.description.trim(), meta.publishDate.trim()].filter(Boolean)
  for (const line of metaLines) {
    items.push(new Paragraph({
      text: line,
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
    }))
  }

  if (items.length > 0) {
    items.push(new Paragraph(''))
  }

  return items
}

export async function buildDocxExport(meta: BookMeta, chapters: Chapter[]): Promise<Blob> {
  const flattened = flattenChapters(chapters)
  const children: Array<Paragraph | Table> = [...createMetadataParagraphs(meta)]

  for (const chapter of flattened) {
    children.push(new Paragraph({
      text: chapter.title.trim(),
      heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][Math.min(chapter.depth, 5)],
      spacing: { before: 240, after: 160 },
    }))

    const resolvedContent = await replaceAssetUrls(chapter.content, 'export')
    const wrapper = document.createElement('div')
    wrapper.innerHTML = renderExportMarkdown(resolvedContent)
    deduplicateLeadingHeading(wrapper, chapter.title)

    const blocks = await convertBlockChildren(wrapper)
    if (blocks.length > 0) {
      children.push(...blocks)
    } else {
      children.push(new Paragraph(''))
    }
  }

  const doc = new Document({
    title: meta.title.trim() || 'Export',
    creator: meta.author.trim() || 'EPUB Builder',
    description: meta.description.trim() || undefined,
    numbering: {
      config: [{
        reference: NUMBERING_REFERENCE,
        levels: Array.from({ length: 8 }, (_, level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: {
            paragraph: {
              indent: { left: 720 + level * 360, hanging: 260 },
            },
          },
        })),
      }],
    },
    sections: [{
      children,
    }],
  })

  return Packer.toBlob(doc)
}
