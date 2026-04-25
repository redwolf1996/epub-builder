import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/core'
import xml from 'highlight.js/lib/languages/xml'
import css from 'highlight.js/lib/languages/css'
import js from 'highlight.js/lib/languages/javascript'
import ts from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import yaml from 'highlight.js/lib/languages/yaml'
import markdown from 'highlight.js/lib/languages/markdown'
import sql from 'highlight.js/lib/languages/sql'
import java from 'highlight.js/lib/languages/java'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'

hljs.registerLanguage('html', xml)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('css', css)
hljs.registerLanguage('javascript', js)
hljs.registerLanguage('js', js)
hljs.registerLanguage('typescript', ts)
hljs.registerLanguage('ts', ts)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('java', java)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('go', go)

// 为 block 级元素添加 data-line 属性，用于编辑器-预览滚动同步
function sourceLinePlugin(md: MarkdownIt) {
  const blockTokens = new Set([
    'heading_open', 'paragraph_open', 'bullet_list_open', 'ordered_list_open',
    'list_item_open', 'blockquote_open', 'fence', 'code_block', 'table_open',
    'hr', 'html_block',
  ])
  md.core.ruler.push('source_line', (state) => {
    for (const token of state.tokens) {
      if (blockTokens.has(token.type) && token.map) {
        token.attrSet('data-line', String(token.map[0] + 1))
      }
    }
  })
}

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
  highlight(str: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`
      } catch {
        // fallback
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`
  },
})

md.use(sourceLinePlugin)

export function renderMarkdown(content: string): string {
  // 预处理：将行首全角空格（U+3000）转为 &emsp; 实体，避免被 markdown-it 丢弃
  const preprocessed = content.replace(/^(\u3000+)/gm, (spaces: string) => {
    return '&emsp;'.repeat(spaces.length)
  })
  let html = md.render(preprocessed)
  // 后处理：将 <p> 开头的 em-space（U+2003）转为 CSS text-indent
  html = html.replace(/<p>(\u2003+)/g, (_match, spaces: string) => {
    return `<p style="text-indent:${spaces.length}em">`
  })
  return html
}

export function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1] : ''
}
