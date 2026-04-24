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
  title: string
  content: string
  order: number
  createdAt: number
  updatedAt: number
}
