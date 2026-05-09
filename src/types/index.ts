export interface BookMeta {
  title: string
  author: string
  description: string
  language: string
  publishDate: string
  coverImage: string | null
}

export interface Book {
  id: string
  meta: BookMeta
  createdAt: number
  updatedAt: number
}

export interface Chapter {
  id: string
  bookId: string
  parentId: string | null
  title: string
  content: string
  order: number
  createdAt: number
  updatedAt: number
}

export interface BookAsset {
  id: string
  bookId: string
  path: string
  mimeType: string
  sourceName: string
  createdAt: number
}

export type ImportFormat = 'markdown' | 'epub' | 'pdf' | 'docx'

export type ImportMode = 'newBook' | 'appendToCurrentChapter' | 'insertAsSiblingChapters'

export interface ImportWarning {
  code: string
  message: string
}

export interface ImportAssetSource {
  placeholder: string
  sourcePath: string
  sourceName: string
  mimeType: string
}

export interface ImportSection {
  title: string
  content: string
  children: ImportSection[]
}

export interface ImportDocument {
  format: ImportFormat
  sourceName: string
  meta: Partial<BookMeta>
  sections: ImportSection[]
  warnings: ImportWarning[]
  assets?: ImportAssetSource[]
  sourceFile?: File
}

export interface ApplyImportTarget {
  bookId?: string
  chapterId?: string
}

export interface ApplyImportResult {
  bookId: string
  chapterIds: string[]
}
