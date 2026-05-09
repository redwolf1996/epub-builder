import type { ImportDocument, ImportSection } from '@/types'

const headingPattern = /^(#{1,6})\s+(.+?)\s*$/

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function trimBlock(content: string): string {
  return content.replace(/^\n+|\n+$/g, '')
}

function createSection(title: string): ImportSection {
  return {
    title: title.trim(),
    content: '',
    children: [],
  }
}

export function parseMarkdownSections(content: string): { metaTitle: string; sections: ImportSection[] } {
  const normalized = normalizeLineEndings(content)
  const lines = normalized.split('\n')
  const stack: Array<{ level: number; section: ImportSection }> = []
  const roots: ImportSection[] = []
  let metaTitle = ''
  let currentSection: ImportSection | null = null
  let buffer: string[] = []

  const flushBuffer = () => {
    if (!currentSection) return
    currentSection.content = trimBlock(buffer.join('\n'))
    buffer = []
  }

  for (const line of lines) {
    const match = line.match(headingPattern)
    if (!match) {
      buffer.push(line)
      continue
    }

    const level = match[1].length
    const title = match[2].trim()

    if (level === 1 && !metaTitle && roots.length === 0 && !currentSection && buffer.every((item) => !item.trim())) {
      metaTitle = title
      buffer = []
      continue
    }

    flushBuffer()

    const section = createSection(title || `Section ${roots.length + 1}`)
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    if (stack.length === 0) {
      roots.push(section)
    } else {
      stack[stack.length - 1].section.children.push(section)
    }

    stack.push({ level, section })
    currentSection = section
  }

  flushBuffer()

  if (roots.length === 0) {
    const title = metaTitle || 'Imported Section'
    return {
      metaTitle,
      sections: [{
        title,
        content: trimBlock(normalized),
        children: [],
      }],
    }
  }

  if (!currentSection && trimBlock(normalized)) {
    roots.unshift({
      title: metaTitle || 'Imported Section',
      content: trimBlock(normalized),
      children: [],
    })
  }

  return {
    metaTitle,
    sections: roots,
  }
}

export async function parseMarkdownImport(file: File): Promise<ImportDocument> {
  const content = await file.text()
  const { metaTitle, sections } = parseMarkdownSections(content)

  return {
    format: 'markdown',
    sourceName: file.name,
    meta: {
      title: metaTitle || file.name.replace(/\.[^.]+$/, ''),
    },
    sections,
    warnings: [],
    assets: [],
  }
}
