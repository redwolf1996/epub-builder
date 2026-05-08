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

type RenderTarget = 'preview' | 'export'
export type MarkdownToken = ReturnType<MarkdownIt['parse']>[number]

const allowedTags = new Set([
  'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'img', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td',
  'th', 'thead', 'tr', 'ul',
])

const blockedTags = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button',
  'textarea', 'select', 'option', 'link', 'meta',
])

const globalAttributes = new Set(['data-line'])

const allowedAttributesByTag = new Map<string, Set<string>>([
  ['a', new Set(['href', 'title'])],
  ['img', new Set(['src', 'alt', 'title'])],
  ['span', new Set(['style'])],
  ['p', new Set(['style'])],
  ['code', new Set(['class'])],
  ['pre', new Set(['class'])],
])

const allowedStylePropertiesByTag = new Map<string, Set<string>>([
  ['p', new Set(['text-indent'])],
  ['span', new Set(['color', 'background-color'])],
])

const colorPattern = /^(#[0-9a-f]{3,8}|rgb(a)?\(\s*[\d.\s,%]+\)|hsl(a)?\(\s*[\d.\s,%]+\)|[a-z]+)$/i
const lengthPattern = /^-?\d+(\.\d+)?(px|em|rem|%)$/i

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

function createMarkdownRenderer() {
  const instance = new MarkdownIt({
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
      return `<pre class="hljs"><code>${instance.utils.escapeHtml(str)}</code></pre>`
    },
  })

  instance.use(sourceLinePlugin)

  return instance
}

const previewMarkdown = createMarkdownRenderer()
const exportMarkdown = createMarkdownRenderer()

function preprocessMarkdown(content: string): string {
  return content.replace(/^(\u3000+)/gm, (spaces: string) => '&emsp;'.repeat(spaces.length))
}

export function preprocessMarkdownForRender(content: string): string {
  return preprocessMarkdown(content)
}

function postprocessRenderedHtml(html: string): string {
  return html.replace(/<p>(\u2003+)/g, (_match, spaces: string) => `<p style="text-indent:${spaces.length}em">`)
}

function sanitizeUrl(value: string, tagName: string, attrName: 'href' | 'src'): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('#') || trimmed.startsWith('/')) return trimmed

  const normalized = trimmed.toLowerCase()
  if (attrName === 'src' && tagName === 'img' && normalized.startsWith('data:image/')) {
    return trimmed
  }

  const schemeMatch = normalized.match(/^([a-z][a-z0-9+.-]*):/)
  if (!schemeMatch) return trimmed

  const scheme = schemeMatch[1]
  if (attrName === 'href' && ['http', 'https', 'mailto', 'tel'].includes(scheme)) {
    return trimmed
  }
  if (attrName === 'src' && ['http', 'https'].includes(scheme)) {
    return trimmed
  }

  return null
}

function sanitizeStyle(tagName: string, styleValue: string): string | null {
  const allowedProperties = allowedStylePropertiesByTag.get(tagName)
  if (!allowedProperties) return null

  const sanitizedDeclarations: string[] = []
  for (const declaration of styleValue.split(';')) {
    const separatorIndex = declaration.indexOf(':')
    if (separatorIndex === -1) continue

    const property = declaration.slice(0, separatorIndex).trim().toLowerCase()
    const value = declaration.slice(separatorIndex + 1).trim()
    if (!allowedProperties.has(property) || !value) continue

    if (
      (property === 'text-indent' && lengthPattern.test(value))
      || ((property === 'color' || property === 'background-color') && colorPattern.test(value))
    ) {
      sanitizedDeclarations.push(`${property}:${value}`)
    }
  }

  return sanitizedDeclarations.length > 0 ? sanitizedDeclarations.join(';') : null
}

function sanitizeElement(element: Element) {
  const tagName = element.tagName.toLowerCase()

  if (blockedTags.has(tagName)) {
    element.remove()
    return
  }

  if (!allowedTags.has(tagName)) {
    element.replaceWith(...Array.from(element.childNodes))
    return
  }

  for (const attr of Array.from(element.attributes)) {
    const attrName = attr.name.toLowerCase()
    const allowedAttributes = allowedAttributesByTag.get(tagName)
    const isAllowed = globalAttributes.has(attrName) || !!allowedAttributes?.has(attrName)

    if (attrName.startsWith('on') || !isAllowed) {
      element.removeAttribute(attr.name)
      continue
    }

    if (attrName === 'href' || attrName === 'src') {
      const sanitized = sanitizeUrl(attr.value, tagName, attrName)
      if (!sanitized) {
        element.removeAttribute(attr.name)
        continue
      }
      element.setAttribute(attr.name, sanitized)
      continue
    }

    if (attrName === 'style') {
      const sanitized = sanitizeStyle(tagName, attr.value)
      if (!sanitized) {
        element.removeAttribute(attr.name)
        continue
      }
      element.setAttribute(attr.name, sanitized)
    }
  }

  if (tagName === 'a' && element.hasAttribute('href')) {
    element.setAttribute('rel', 'noopener noreferrer nofollow')
  }
}

function sanitizeHtml(html: string, _target: RenderTarget): string {
  const template = document.createElement('template')
  template.innerHTML = html

  const nodes = Array.from(template.content.querySelectorAll('*'))
  for (const node of nodes) {
    sanitizeElement(node)
  }

  return template.innerHTML
}

function renderWithPipeline(content: string, target: RenderTarget): string {
  const renderer = target === 'preview' ? previewMarkdown : exportMarkdown
  const preprocessed = preprocessMarkdown(content)
  const rendered = renderer.render(preprocessed)
  const postprocessed = postprocessRenderedHtml(rendered)
  return sanitizeHtml(postprocessed, target)
}

export function renderPreviewMarkdown(content: string): string {
  return renderWithPipeline(content, 'preview')
}

export function renderExportMarkdown(content: string): string {
  return renderWithPipeline(content, 'export')
}

export function parseExportMarkdownTokens(content: string): MarkdownToken[] {
  return exportMarkdown.parse(preprocessMarkdown(content), {})
}

export function renderMarkdown(content: string): string {
  return renderPreviewMarkdown(content)
}

export function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1] : ''
}
