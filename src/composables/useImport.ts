import { computed, ref } from 'vue'
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js'
import { db } from '@/db'
import type {
  ApplyImportResult,
  ApplyImportTarget,
  BookAsset,
  Book,
  BookMeta,
  Chapter,
  ImportDocument,
  ImportFormat,
  ImportMode,
  ImportSection,
} from '@/types'
import {
  createBookAsset,
  decodeEpubAssetPlaceholder,
  toAssetUrl,
} from '@/utils/assets'
import { parseEpubImport } from '@/utils/importEpub'
import { parseMarkdownImport } from '@/utils/importMarkdown'
import { parsePdfImport } from '@/utils/importPdf'
import { parseWordImport } from '@/utils/importWord'

type ParseImportResult = {
  document: ImportDocument
  format: ImportFormat
}

function filenameWithoutExt(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

function detectImportFormat(file: File): ImportFormat {
  const ext = file.name.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'epub':
      return 'epub'
    case 'pdf':
      return 'pdf'
    case 'docx':
      return 'docx'
    default:
      throw new Error(`Unsupported import format: ${ext || 'unknown'}`)
  }
}

function defaultBookMeta(sourceName: string, meta: Partial<BookMeta>): BookMeta {
  return {
    title: meta.title?.trim() || filenameWithoutExt(sourceName) || 'Imported Book',
    author: meta.author?.trim() || '',
    description: meta.description?.trim() || '',
    language: meta.language?.trim() || 'zh-CN',
    publishDate: meta.publishDate?.trim() || new Date().toISOString().slice(0, 10),
    coverImage: null,
  }
}

function normalizeSection(section: ImportSection, fallbackIndex: number): ImportSection {
  return {
    title: section.title.trim() || `Imported Section ${fallbackIndex + 1}`,
    content: section.content.trim(),
    children: section.children.map((child, childIndex) => normalizeSection(child, childIndex)),
  }
}

function serializeSection(section: ImportSection, depth = 0): string {
  const headingLevel = Math.min(depth + 2, 6)
  const heading = `${'#'.repeat(headingLevel)} ${section.title}`
  const children = section.children.map((child) => serializeSection(child, depth + 1)).filter(Boolean).join('\n\n')
  return [heading, section.content, children].filter(Boolean).join('\n\n').trim()
}

type ReadableZipEntry = {
  filename: string
  getData: <T>(writer: BlobWriter) => Promise<T>
}

function isReadableZipEntry(entry: unknown): entry is ReadableZipEntry {
  return typeof entry === 'object' && entry !== null && 'getData' in entry
}

async function materializeImportAssets(bookId: string, document: ImportDocument): Promise<Map<string, BookAsset>> {
  const replacements = new Map<string, BookAsset>()
  const assets = document.assets ?? []
  if (assets.length === 0 || document.format !== 'epub' || !document.sourceFile) {
    return replacements
  }

  const zipReader = new ZipReader(new BlobReader(document.sourceFile))
  const entries = await zipReader.getEntries()
  const entryMap = new Map(entries.map((entry) => [entry.filename, entry]))

  try {
    for (const assetSource of assets) {
      const sourcePath = decodeEpubAssetPlaceholder(assetSource.placeholder)
      const entry = entryMap.get(sourcePath)
      if (!isReadableZipEntry(entry)) continue

      const blob = await entry.getData<Blob>(new BlobWriter(assetSource.mimeType))
      const bytes = new Uint8Array(await blob.arrayBuffer())
      const asset = await createBookAsset(bookId, assetSource, bytes)
      replacements.set(assetSource.placeholder, asset)
    }
  } finally {
    await zipReader.close()
  }

  return replacements
}

function replaceSectionAssetPlaceholders(section: ImportSection, replacements: Map<string, BookAsset>): ImportSection {
  let content = section.content
  for (const [placeholder, asset] of replacements.entries()) {
    content = content.replaceAll(placeholder, toAssetUrl(asset.id))
  }

  return {
    ...section,
    content,
    children: section.children.map((child) => replaceSectionAssetPlaceholders(child, replacements)),
  }
}

async function insertSectionTree(bookId: string, sections: ImportSection[], parentId: string | null, chapterIds: string[]) {
  let order = 0

  for (const section of sections) {
    const now = Date.now()
    const chapterId = crypto.randomUUID()
    const chapter: Chapter = {
      id: chapterId,
      bookId,
      parentId,
      title: section.title.trim() || `Imported Section ${order + 1}`,
      content: section.content.trim(),
      order,
      createdAt: now,
      updatedAt: now,
    }
    order += 1

    await db.chapters.add(chapter)
    chapterIds.push(chapterId)

    if (section.children.length > 0) {
      await insertSectionTree(bookId, section.children, chapterId, chapterIds)
    }
  }
}

export function useImport() {
  const importing = ref(false)
  const parsedDocument = ref<ImportDocument | null>(null)
  const importError = ref<string | null>(null)

  const canApplyImport = computed(() => parsedDocument.value !== null)

  const parseImportFile = async (file: File): Promise<ParseImportResult> => {
    importing.value = true
    importError.value = null

    try {
      const format = detectImportFormat(file)
      const document = format === 'markdown'
        ? await parseMarkdownImport(file)
        : format === 'epub'
          ? await parseEpubImport(file)
          : format === 'pdf'
            ? await parsePdfImport(file)
            : await parseWordImport(file)

      parsedDocument.value = document
      return { document, format }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import file'
      importError.value = message
      throw error
    } finally {
      importing.value = false
    }
  }

  const resetImportState = () => {
    parsedDocument.value = null
    importError.value = null
  }

  const applyImportDocument = async (
    target: ApplyImportTarget,
    document: ImportDocument,
    mode: ImportMode,
  ): Promise<ApplyImportResult> => {
    let normalizedSections = document.sections.map((section, index) => normalizeSection(section, index))

    if (mode === 'newBook') {
      const now = Date.now()
      const bookId = crypto.randomUUID()
      const book: Book = {
        id: bookId,
        meta: defaultBookMeta(document.sourceName, document.meta),
        createdAt: now,
        updatedAt: now,
      }
      const chapterIds: string[] = []
      const replacements = await materializeImportAssets(bookId, document)
      normalizedSections = normalizedSections.map((section) => replaceSectionAssetPlaceholders(section, replacements))

      await db.transaction('rw', db.books, db.chapters, db.assets, async () => {
        await db.books.add(book)
        await insertSectionTree(bookId, normalizedSections, null, chapterIds)
      })

      return { bookId, chapterIds }
    }

    if (!target.bookId || !target.chapterId) {
      throw new Error('Missing import target for chapter import')
    }

    const bookId = target.bookId
    const chapterId = target.chapterId

    if (mode === 'appendToCurrentChapter') {
      const chapter = await db.chapters.get(chapterId)
      if (!chapter) {
        throw new Error('Target chapter not found')
      }

      const replacements = await materializeImportAssets(bookId, document)
      normalizedSections = normalizedSections.map((section) => replaceSectionAssetPlaceholders(section, replacements))

      const importedMarkdown = normalizedSections
        .map((section) => serializeSection(section))
        .filter(Boolean)
        .join('\n\n')
      const spacer = chapter.content.trim() ? '\n\n' : ''
      const nextContent = `${chapter.content}${spacer}${importedMarkdown}`.trim()
      await db.chapters.update(chapter.id, {
        content: nextContent,
        updatedAt: Date.now(),
      })
      await db.books.update(bookId, { updatedAt: Date.now() })
      return { bookId, chapterIds: [chapter.id] }
    }

    const currentChapter = await db.chapters.get(chapterId)
    if (!currentChapter) {
      throw new Error('Target chapter not found')
    }

    const chapterIds: string[] = []
    const replacements = await materializeImportAssets(bookId, document)
    normalizedSections = normalizedSections.map((section) => replaceSectionAssetPlaceholders(section, replacements))

    await db.transaction('rw', db.books, db.chapters, db.assets, async () => {
      for (const chapter of await db.chapters.where('bookId').equals(bookId).toArray()) {
        if (chapter.parentId === currentChapter.parentId && chapter.order > currentChapter.order) {
          await db.chapters.update(chapter.id, { order: chapter.order + normalizedSections.length })
        }
      }

      let rootOrder = currentChapter.order + 1
      for (const section of normalizedSections) {
        const now = Date.now()
        const rootId = crypto.randomUUID()
        await db.chapters.add({
          id: rootId,
          bookId,
          parentId: currentChapter.parentId,
          title: section.title,
          content: section.content,
          order: rootOrder,
          createdAt: now,
          updatedAt: now,
        })
        chapterIds.push(rootId)
        rootOrder += 1

        if (section.children.length > 0) {
          await insertSectionTree(bookId, section.children, rootId, chapterIds)
        }
      }

      await db.books.update(bookId, { updatedAt: Date.now() })
    })

    return { bookId, chapterIds: chapterIds.length > 0 ? chapterIds : [currentChapter.id] }
  }

  return {
    importing,
    parsedDocument,
    importError,
    canApplyImport,
    parseImportFile,
    applyImportDocument,
    resetImportState,
  }
}
