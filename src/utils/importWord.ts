import mammoth from 'mammoth'
import TurndownService from 'turndown'
import { parseMarkdownSections } from '@/utils/importMarkdown'
import type { ImportDocument, ImportWarning } from '@/types'

function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()
}

function tableToMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.querySelectorAll('tr'))
  if (rows.length === 0) return ''

  const cells = rows.map((row) => Array.from(row.querySelectorAll('th, td')).map((cell) => escapeMarkdownTableCell(cell.textContent || '')))
  const columnCount = Math.max(...cells.map((row) => row.length), 0)
  if (columnCount === 0) return ''

  const normalizedRows = cells.map((row) => {
    const next = [...row]
    while (next.length < columnCount) next.push('')
    return next
  })

  const header = normalizedRows[0]
  const separator = new Array(columnCount).fill('---')
  const body = normalizedRows.slice(1)
  return [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function normalizeWordHtml(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html

  for (const paragraph of template.content.querySelectorAll('p')) {
    if (!paragraph.textContent?.trim() && paragraph.querySelectorAll('img').length === 0) {
      paragraph.remove()
    }
  }

  for (const table of template.content.querySelectorAll('table')) {
    const markdown = tableToMarkdown(table)
    const replacement = document.createElement('p')
    replacement.textContent = markdown
    table.replaceWith(replacement)
  }

  return template.innerHTML
}

function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  })

  service.addRule('lineBreak', {
    filter: 'br',
    replacement: () => '  \n',
  })

  return service
}

function mapMammothWarnings(messages: Array<{ type: 'warning' | 'error'; message: string }>): ImportWarning[] {
  const warnings: ImportWarning[] = []

  for (const item of messages) {
    const message = item.message.trim()
    if (!message) continue

    warnings.push({
      code: item.type === 'error' ? 'word-import-error' : 'word-import-warning',
      message,
    })
  }

  return warnings
}

export async function parseWordImport(file: File): Promise<ImportDocument> {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml({ arrayBuffer })
  const turndownService = createTurndownService()
  const normalizedHtml = normalizeWordHtml(result.value)
  const markdown = normalizeLineEndings(turndownService.turndown(normalizedHtml)).trim()
  const { metaTitle, sections } = parseMarkdownSections(markdown)

  return {
    format: 'docx',
    sourceName: file.name,
    meta: {
      title: metaTitle || file.name.replace(/\.[^.]+$/, ''),
    },
    sections,
    warnings: mapMammothWarnings(result.messages),
    assets: [],
  }
}
