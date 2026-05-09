import { convertFileSrc } from '@tauri-apps/api/core'
import { appLocalDataDir, BaseDirectory, join } from '@tauri-apps/api/path'
import { exists, mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import { db } from '@/db'
import { isTauri } from '@/utils/export'
import type { BookAsset, ImportAssetSource } from '@/types'

const ASSET_SCHEME = 'asset://'
const EPUB_ASSET_SCHEME = 'epub-asset://'
const ASSET_ROOT = 'book-assets'

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function getExtensionFromMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/svg+xml':
      return 'svg'
    case 'image/webp':
      return 'webp'
    default:
      return 'bin'
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim() || 'asset'
}

function assetRelativePath(bookId: string, assetId: string, mimeType: string, sourceName: string): string {
  const ext = getExtensionFromMimeType(mimeType)
  const base = sanitizeFileName(sourceName.replace(/\.[^.]+$/, ''))
  return `${ASSET_ROOT}/${bookId}/${assetId}-${base}.${ext}`
}

export function isAssetUrl(value: string): boolean {
  return value.startsWith(ASSET_SCHEME)
}

export function isEpubAssetPlaceholder(value: string): boolean {
  return value.startsWith(EPUB_ASSET_SCHEME)
}

export function toAssetUrl(assetId: string): string {
  return `${ASSET_SCHEME}${assetId}`
}

export function toEpubAssetPlaceholder(sourcePath: string): string {
  return `${EPUB_ASSET_SCHEME}${encodeURIComponent(sourcePath)}`
}

export function decodeEpubAssetPlaceholder(placeholder: string): string {
  return decodeURIComponent(placeholder.slice(EPUB_ASSET_SCHEME.length))
}

async function ensureAssetDirectory(bookId: string) {
  await mkdir(`${ASSET_ROOT}/${bookId}`, {
    baseDir: BaseDirectory.AppLocalData,
    recursive: true,
  })
}

export async function createBookAsset(bookId: string, source: ImportAssetSource, data: Uint8Array): Promise<BookAsset> {
  if (!isTauri()) {
    throw new Error('Local asset storage is only supported in the desktop app.')
  }

  const assetId = crypto.randomUUID()
  const relativePath = assetRelativePath(bookId, assetId, source.mimeType, source.sourceName)
  await ensureAssetDirectory(bookId)
  await writeFile(relativePath, data, {
    baseDir: BaseDirectory.AppLocalData,
  })

  const asset: BookAsset = {
    id: assetId,
    bookId,
    path: relativePath,
    mimeType: source.mimeType,
    sourceName: source.sourceName,
    createdAt: Date.now(),
  }

  await db.assets.add(asset)
  return asset
}

export async function getBookAsset(assetId: string): Promise<BookAsset | undefined> {
  return db.assets.get(assetId)
}

export async function resolveAssetUrl(assetId: string): Promise<string | null> {
  const asset = await getBookAsset(assetId)
  if (!asset) return null

  if (!isTauri()) return null

  const basePath = await appLocalDataDir()
  const absolutePath = await join(basePath, asset.path)
  return convertFileSrc(absolutePath)
}

export async function resolveAssetDataUrl(assetId: string): Promise<string | null> {
  const asset = await getBookAsset(assetId)
  if (!asset) return null

  const bytes = await readFile(asset.path, {
    baseDir: BaseDirectory.AppLocalData,
  })

  return `data:${asset.mimeType};base64,${toBase64(bytes)}`
}

export async function replaceAssetUrls(content: string, mode: 'preview' | 'export'): Promise<string> {
  const matches = Array.from(content.matchAll(/asset:\/\/([a-f0-9-]+)/gi))
  if (matches.length === 0) return content

  let resolved = content
  for (const match of matches) {
    const assetId = match[1]
    const replacement = mode === 'preview'
      ? await resolveAssetDataUrl(assetId)
      : await resolveAssetDataUrl(assetId)
    if (!replacement) continue
    resolved = resolved.replaceAll(match[0], replacement)
  }

  return resolved
}

export async function deleteBookAssets(bookId: string) {
  const assets = await db.assets.where('bookId').equals(bookId).toArray()
  for (const asset of assets) {
    if (await exists(asset.path, { baseDir: BaseDirectory.AppLocalData })) {
      await remove(asset.path, { baseDir: BaseDirectory.AppLocalData })
    }
  }

  if (assets.length > 0) {
    await remove(`${ASSET_ROOT}/${bookId}`, {
      baseDir: BaseDirectory.AppLocalData,
      recursive: true,
    }).catch(() => {})
  }

  await db.assets.where('bookId').equals(bookId).delete()
}
