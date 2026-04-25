import { renderMarkdown } from '@/utils/markdown'
import { db } from '@/db'
import type { BookMeta, Chapter } from '@/types'
import type { Options, Content } from 'epub-gen-memory'

/**
 * 如果 Markdown 渲染后的 HTML 首行标题与章节标题相同，则去除该标题避免重复
 * 匹配 h1~h6
 */
function deduplicateChapterTitle(html: string, chapterTitle: string): string {
  const hMatch = html.match(/^\s*<h([1-6])>(.*?)<\/h[1-6]>/)
  if (hMatch) {
    const headingText = hMatch[2].replace(/<[^>]*>/g, '').trim()
    if (headingText === chapterTitle.trim()) {
      return html.slice(hMatch[0].length)
    }
  }
  return html
}

/**
 * 根据层级深度生成章节标题 HTML
 * depth=0 → h1 (2em), depth=1 → h2 (1.5em), depth=2 → h3 (1.25em) ...
 */
function prependChapterTitle(title: string, depth: number): string {
  const level = Math.min(depth + 1, 6)
  const sizes = ['2em', '1.5em', '1.25em', '1.1em', '1em', '0.9em']
  const fontSize = sizes[depth] ?? '0.9em'
  return `<h${level} style="font-size:${fontSize};font-weight:bold;color:red;margin:0.5em 0">${title}</h${level}>`
}

/** 将层级深度编码到标题中，供 TOC 模板解析 */
function encodeDepth(title: string, depth: number): string {
  return `D${depth}|${title}`
}

/** 自定义 toc.xhtml 模板：嵌套 ol 结构，EPUB 阅读器会显示树形展开/收起箭头 */
const tocXHTMLTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="<%- lang %>" lang="<%- lang %>">
<head>
    <title><%= title %></title>
    <meta charset="UTF-8" />
    <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
    <h1 class="h1"><%= tocTitle %></h1>
    <nav id="toc" epub:type="toc">
<% var _stack = []; %>
<% content.forEach(function(item, index){ %>
  <% if(!item.excludeFromToc){
     var _t = item.title, _d = 0;
     var _p = _t.split('|');
     var _mm = _p[0].match(/^D(\\d+)$/);
     if(_mm){ _d = parseInt(_mm[1]); _t = _p.slice(1).join('|'); }
     // 回到更浅层级：关闭深层
     while(_stack.length > _d){ %></li></ol><% _stack.pop(); } %>
     <% // 同级：关闭前一个 li %>
     <% if(_stack.length === _d && _stack.length > 0){ %></li><% } %>
     <% // 进入更深层：在当前 li 内开新 ol %>
     <% if(_d > _stack.length){ %><ol style="list-style:none"><% _stack.push(_d); } %>
     <% // 根级：首次开 ol %>
     <% if(_stack.length === 0){ %><ol style="list-style:none"><% _stack.push(0); } %>
            <li class="table-of-content"><a href="<%= item.filename %>"><%= _t %></a>
<%   } %>
<% }) %>
<% // 关闭所有剩余标签 %>
<% while(_stack.length > 0){ %></li></ol><% _stack.pop(); } %>
    </nav>
</body>
</html>`

/** 自定义 toc.ncx 模板：嵌套 navPoint 结构，支持阅读器导航树 */
const tocNCXTemplate = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
    <head>
        <meta name="dtb:uid" content="<%= id %>" />
        <meta name="dtb:generator" content="epub-gen"/>
        <meta name="dtb:depth" content="1"/>
        <meta name="dtb:totalPageCount" content="0"/>
        <meta name="dtb:maxPageNumber" content="0"/>
    </head>
    <docTitle>
        <text><%= title %></text>
    </docTitle>
    <docAuthor>
        <text><%= author %></text>
    </docAuthor>
    <navMap>
<% var _idx = 0, _stack = []; %>
<% content.forEach(function(item, index){ %>
  <% if(!item.excludeFromToc && !item.beforeToc){
     var _nt = item.title, _d = 0;
     var _pp = _nt.split('|');
     var _mm = _pp[0].match(/^D(\\d+)$/);
     if(_mm){ _d = parseInt(_mm[1]); _nt = _pp.slice(1).join('|'); }
     // 回到更浅层级：关闭深层 navPoint
     while(_stack.length > _d){ %></navPoint><% _stack.pop(); } %>
        <navPoint id="content_<%= index %>_<%= item.id %>" playOrder="<%= _idx++ %>" class="chapter">
            <navLabel>
                <text><%= (numberChaptersInTOC ? (1+index) + ". " : "") + _nt %></text>
            </navLabel>
            <content src="<%= item.filename %>"/>
<%     _stack.push(_d); %>
<%   } %>
<% }) %>
<% // 关闭所有剩余 navPoint %>
<% while(_stack.length > 0){ %></navPoint><% _stack.pop(); } %>
    </navMap>
</ncx>`

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

  const allChapters = await db.chapters
    .where('bookId')
    .equals(bookId)
    .sortBy('order')

  if (allChapters.length === 0) throw new Error('没有章节可导出')

  // 将树形章节展平为有序列表，同时记录每个章节的层级深度
  type FlatChapter = Chapter & { depth: number }
  const flattenChapters = (parentId: string | null, depth: number): FlatChapter[] => {
    const roots = allChapters.filter((c) => c.parentId === parentId).sort((a, b) => a.order - b.order)
    const result: FlatChapter[] = []
    for (const ch of roots) {
      result.push({ ...ch, depth })
      result.push(...flattenChapters(ch.id, depth + 1))
    }
    return result
  }
  const chapters = flattenChapters(null, 0)

  // 扉页章节（目录之前）
  const titlePageContent: Content[number] = {
    title: '扉页',
    content: generateTitlePage(book.meta),
    excludeFromToc: true,
    beforeToc: true,
  }

  const chapterContent: Content = chapters.map((ch) => {
    const html = renderMarkdown(ch.content)
    const bodyHtml = deduplicateChapterTitle(html, ch.title)
    return {
      title: encodeDepth(ch.title, ch.depth),
      content: prependChapterTitle(ch.title, ch.depth) + bodyHtml,
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
    tocXHTML: tocXHTMLTemplate,
    tocNCX: tocNCXTemplate,
  }

  // 动态导入 epub-gen-memory，避免 CJS/fs 模块影响编辑器加载
  const ePubModule = await import('epub-gen-memory')
  // eslint-disable-next-line ts/no-explicit-any -- CJS/ESM 互操作：可能存在双重 default 包装
  const ePub = (ePubModule as any).default?.default || (ePubModule as any).default || ePubModule
  // 浏览器环境 genEpub 返回 Blob (type='blob')
  const result = await ePub(options, content)
  if (result instanceof Blob) {
    return result
  }
  // 兜底：如果返回 ArrayBuffer/Buffer
  return new Blob([new Uint8Array(result as unknown as ArrayBuffer)], { type: 'application/epub+zip' })
}

export function isTauri(): boolean {
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
