import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { ImportDocument, ImportWarning } from '@/types'

type TextItem = {
  str: string
  transform: number[]
}

let workerConfigured = false

function ensurePdfWorker() {
  if (workerConfigured) return

  GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  workerConfigured = true
}

function filenameWithoutExt(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

function joinPageItems(items: TextItem[]): string {
  const lines: Array<{ y: number; parts: string[] }> = []

  for (const item of items) {
    const text = item.str.trim()
    if (!text) continue

    const y = Math.round(item.transform[5] ?? 0)
    const line = lines.find((entry) => Math.abs(entry.y - y) <= 2)
    if (line) {
      line.parts.push(text)
    } else {
      lines.push({ y, parts: [text] })
    }
  }

  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => line.parts.join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

export function detectPdfWarnings(content: string): ImportWarning[] {
  const plainText = content.replace(/\s+/g, ' ').trim()
  if (plainText.length >= 80) return []

  return [{
    code: 'pdf-low-text',
    message: 'The PDF contains very little extractable text. If this is a scanned document, use AI OCR for better results.',
  }]
}

export async function parsePdfImport(file: File): Promise<ImportDocument> {
  ensurePdfWorker()

  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await getDocument({
    data,
    useWorkerFetch: false,
    disableFontFace: true,
  }).promise

  const pages: string[] = []

  for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
    const page = await pdf.getPage(pageIndex)
    const textContent = await page.getTextContent()
    const pageText = joinPageItems(textContent.items as TextItem[])
    if (pageText) {
      pages.push(`## Page ${pageIndex}\n\n${pageText}`)
    }
  }

  const content = pages.join('\n\n').trim()
  const warnings = detectPdfWarnings(content)
  const title = filenameWithoutExt(file.name)

  return {
    format: 'pdf',
    sourceName: file.name,
    meta: {
      title,
    },
    sections: [{
      title,
      content,
      children: [],
    }],
    warnings,
    assets: [],
  }
}
