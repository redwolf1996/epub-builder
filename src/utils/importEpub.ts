import { BlobReader, TextWriter, ZipReader } from '@zip.js/zip.js'
import TurndownService from 'turndown'
import { toEpubAssetPlaceholder } from '@/utils/assets'
import type { ImportAssetSource, ImportDocument, ImportSection, ImportWarning } from '@/types'

type ManifestItem = {
  id: string
  href: string
  mediaType: string
  properties: string[]
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
})

type ReadableZipEntry = {
  filename: string
  directory?: boolean
  getData: <T>(writer: TextWriter) => Promise<T>
}

function parseXml(content: string): Document {
  return new DOMParser().parseFromString(content, 'application/xml')
}

function parseHtml(content: string): Document {
  return new DOMParser().parseFromString(content, 'text/html')
}

function getTextContentByLocalName(doc: Document, localName: string): string {
  const node = Array.from(doc.getElementsByTagName('*')).find((element) => element.localName === localName)
  return node?.textContent?.trim() ?? ''
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/')
  return index === -1 ? '' : path.slice(0, index)
}

function resolvePath(basePath: string, relativePath: string): string {
  const baseParts = basePath.split('/')
  baseParts.pop()

  for (const part of relativePath.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      baseParts.pop()
      continue
    }
    baseParts.push(part)
  }

  return baseParts.join('/')
}

function filenameWithoutExt(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

function isReadableEntry(entry: unknown): entry is ReadableZipEntry {
  return typeof entry === 'object' && entry !== null && 'getData' in entry
}

function getMimeTypeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'svg':
      return 'image/svg+xml'
    case 'webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}

function extractHeadingTitle(doc: Document): string {
  const heading = doc.querySelector('h1, h2, h3, h4, h5, h6')
  return heading?.textContent?.trim() ?? ''
}

function createChapterRoot(doc: Document): HTMLElement {
  const root = doc.body?.cloneNode(true) as HTMLElement | null
  const chapterRoot = root ?? doc.createElement('div')

  for (const selector of [
    'script',
    'style',
    'link',
    'meta',
    'title',
    'svg',
    'canvas',
    'iframe',
    'object',
    'embed',
    'nav',
  ]) {
    for (const node of Array.from(chapterRoot.querySelectorAll(selector))) {
      node.remove()
    }
  }

  return chapterRoot
}

export async function parseEpubImport(file: File): Promise<ImportDocument> {
  const zipReader = new ZipReader(new BlobReader(file))
  const entries = await zipReader.getEntries()
  const entryMap = new Map(entries.map((entry) => [entry.filename, entry]))
  const warnings: ImportWarning[] = []
  const assets: ImportAssetSource[] = []

  try {
    const containerEntry = entryMap.get('META-INF/container.xml')
    if (!isReadableEntry(containerEntry)) {
      throw new Error('Missing META-INF/container.xml')
    }

    const containerXml = await containerEntry.getData<string>(new TextWriter())
    const containerDoc = parseXml(containerXml)
    const rootFilePath = Array.from(containerDoc.getElementsByTagName('*'))
      .find((node) => node.localName === 'rootfile')
      ?.getAttribute('full-path')

    if (!rootFilePath) {
      throw new Error('Missing OPF rootfile path')
    }

    const opfEntry = entryMap.get(rootFilePath)
    if (!isReadableEntry(opfEntry)) {
      throw new Error(`Missing OPF package: ${rootFilePath}`)
    }

    const opfText = await opfEntry.getData<string>(new TextWriter())
    const opfDoc = parseXml(opfText)
    const opfDir = dirname(rootFilePath)

    const manifestItems = Array.from(opfDoc.getElementsByTagName('*'))
      .filter((node) => node.localName === 'item')
      .map((node) => ({
        id: node.getAttribute('id') ?? '',
        href: node.getAttribute('href') ?? '',
        mediaType: node.getAttribute('media-type') ?? '',
        properties: (node.getAttribute('properties') ?? '').split(/\s+/).filter(Boolean),
      }))

    const manifest = new Map<string, ManifestItem>(manifestItems.map((item) => [item.id, item]))
    const spineIds = Array.from(opfDoc.getElementsByTagName('*'))
      .filter((node) => node.localName === 'itemref')
      .map((node) => node.getAttribute('idref') ?? '')
      .filter(Boolean)

    const sections: ImportSection[] = []

    for (const [index, itemId] of spineIds.entries()) {
      const item = manifest.get(itemId)
      if (!item) continue
      if (!/html|xhtml/i.test(item.mediaType)) continue
      if (item.properties.includes('nav')) continue

      const entryPath = opfDir ? resolvePath(rootFilePath, item.href) : item.href
      const chapterEntry = entryMap.get(entryPath)
      if (!isReadableEntry(chapterEntry)) {
        warnings.push({
          code: 'missing-spine-entry',
          message: `EPUB chapter resource is missing: ${entryPath}`,
        })
        continue
      }

      const chapterHtml = await chapterEntry.getData<string>(new TextWriter())
      const chapterDoc = parseHtml(chapterHtml)
      const chapterRoot = createChapterRoot(chapterDoc)

      for (const image of Array.from(chapterRoot.querySelectorAll('img'))) {
        const src = image.getAttribute('src')?.trim()
        if (!src || src.startsWith('data:')) continue

        const resolvedPath = resolvePath(entryPath, src)
        const label = image.getAttribute('alt')?.trim() || src || 'Image'
        const assetEntry = entryMap.get(resolvedPath)
        if (!isReadableEntry(assetEntry)) {
          warnings.push({
            code: 'missing-image',
            message: `EPUB image could not be resolved: ${src}`,
          })
          continue
        }

        const sourceName = resolvedPath.split('/').pop() || 'image'
        const mimeType = getMimeTypeFromPath(sourceName)
        const placeholderSrc = toEpubAssetPlaceholder(resolvedPath)
        assets.push({
          placeholder: placeholderSrc,
          sourcePath: resolvedPath,
          sourceName,
          mimeType,
        })
        image.setAttribute('src', placeholderSrc)
        image.setAttribute('alt', label)
      }

      const title = extractHeadingTitle(chapterDoc) || filenameWithoutExt(item.href) || `Imported Section ${index + 1}`
      const markdown = turndown.turndown(chapterRoot.innerHTML).trim()
      sections.push({
        title,
        content: markdown,
        children: [],
      })
    }

    if (sections.length === 0) {
      warnings.push({
        code: 'empty-epub',
        message: 'No readable chapters were found in the EPUB spine.',
      })
    }

    return {
      format: 'epub',
      sourceName: file.name,
      meta: {
        title: getTextContentByLocalName(opfDoc, 'title') || filenameWithoutExt(file.name),
        author: getTextContentByLocalName(opfDoc, 'creator'),
        language: getTextContentByLocalName(opfDoc, 'language'),
        description: getTextContentByLocalName(opfDoc, 'description'),
        publishDate: getTextContentByLocalName(opfDoc, 'date'),
      },
      sections: sections.length > 0
        ? sections
        : [{
          title: filenameWithoutExt(file.name),
          content: '',
          children: [],
        }],
      warnings,
      assets,
      sourceFile: file,
    }
  } finally {
    await zipReader.close()
  }
}
