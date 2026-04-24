import { renderMarkdown } from '@/utils/markdown'
import { db } from '@/db'
import type { BookMeta } from '@/types'
import type { Options, Content } from 'epub-gen-memory'

/**
 * 如果 Markdown 渲染后的 HTML 首行 <h1> 与章节标题相同，则去除该 <h1> 避免重复
 */
function deduplicateChapterTitle(html: string, chapterTitle: string): string {
  const h1Match = html.match(/^\s*<h1>(.*?)<\/h1>/)
  if (h1Match) {
    const headingText = h1Match[1].replace(/<[^>]*>/g, '').trim()
    if (headingText === chapterTitle.trim()) {
      return html.slice(h1Match[0].length)
    }
  }
  return html
}

/**
 * 生成扉页 HTML
 */
function generateTitlePage(meta: BookMeta): string {
  const coverImg = meta.coverImage
    ? `<div style="text-align:center;margin-bottom:2em"><img src="${meta.coverImage}" alt="封面" style="max-width:60%;max-height:400px;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.2)" /></div>`
    : ''
  return `
${coverImg}
<div style="text-align:center;padding:2em 0">
  <h1 style="font-size:2em;margin:0.5em 0;border:none">${meta.title}</h1>
  ${meta.author ? `<p style="font-size:1.2em;color:#555;margin:0.5em 0">${meta.author} 著</p>` : ''}
  ${meta.description ? `<p style="font-size:0.9em;color:#777;margin:1em auto;max-width:80%;line-height:1.6">${meta.description}</p>` : ''}
  <hr style="border:none;border-top:1px solid #ddd;margin:1.5em auto;width:40%" />
  ${meta.publishDate ? `<p style="font-size:0.85em;color:#999">出版日期：${meta.publishDate}</p>` : ''}
  <p style="font-size:0.8em;color:#aaa;margin-top:1em">EPUB Builder</p>
</div>
`
}

export async function exportToEpub(bookId: string): Promise<Blob> {
  const book = await db.books.get(bookId)
  if (!book) throw new Error('书籍不存在')

  const chapters = await db.chapters
    .where('bookId')
    .equals(bookId)
    .sortBy('order')

  if (chapters.length === 0) throw new Error('没有章节可导出')

  // 扉页章节（目录之前）
  const titlePageContent: Content[number] = {
    title: '扉页',
    content: generateTitlePage(book.meta),
    excludeFromToc: true,
    beforeToc: true,
  }

  const chapterContent: Content = chapters.map((ch) => {
    const html = renderMarkdown(ch.content)
    return {
      title: ch.title,
      content: deduplicateChapterTitle(html, ch.title),
    }
  })

  const content: Content = [titlePageContent, ...chapterContent]

  // 将 base64 data URL 转为 File 对象（epub-gen-memory 对字符串 cover 使用 fetch，不支持 data URL）
  let cover: string | File | undefined
  if (book.meta.coverImage) {
    const dataUrl = book.meta.coverImage
    const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/)
    if (match) {
      const mime = match[1]
      const ext = mime.split('/')[1] || 'png'
      const binary = atob(match[2])
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
      }
      cover = new File([bytes], `cover.${ext}`, { type: mime })
    } else {
      cover = dataUrl
    }
  }

  const options: Options = {
    title: book.meta.title,
    author: book.meta.author ? book.meta.author.split(/[&,，]/).map((s) => s.trim()).filter(Boolean) : ['未知作者'],
    publisher: 'EPUB Builder',
    description: book.meta.description || undefined,
    cover,
    date: book.meta.publishDate || undefined,
    lang: book.meta.language || 'zh-CN',
    tocTitle: '目录',
    tocInTOC: true,
    numberChaptersInTOC: false,
    prependChapterTitles: false,
  }

  // 动态导入 epub-gen-memory，避免 CJS/fs 模块影响编辑器加载
  const ePubModule = await import('epub-gen-memory')
  // eslint-disable-next-line ts/no-explicit-any -- CJS default export interop
  const ePub = (ePubModule as any).default || ePubModule
  // 浏览器环境 genEpub 返回 Blob (type='blob')
  const result = await ePub(options, content)
  if (result instanceof Blob) {
    return result
  }
  // 兜底：如果返回 ArrayBuffer/Buffer
  return new Blob([new Uint8Array(result as unknown as ArrayBuffer)], { type: 'application/epub+zip' })
}

function isTauri(): boolean {
  return !!window.__TAURI_INTERNALS__
}

async function downloadEpubTauri(blob: Blob, filename: string) {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  const filePath = await save({
    defaultPath: `${filename}.epub`,
    filters: [{ name: 'EPUB', extensions: ['epub'] }],
  })
  if (!filePath) return
  const buffer = await blob.arrayBuffer()
  await writeFile(filePath, new Uint8Array(buffer))
}

export function downloadEpub(blob: Blob, filename: string) {
  if (isTauri()) {
    downloadEpubTauri(blob, filename)
    return
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.epub`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
