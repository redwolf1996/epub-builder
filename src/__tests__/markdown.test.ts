import { describe, it, expect } from 'vitest'
import { renderMarkdown, renderExportMarkdown, extractTitle } from '@/utils/markdown'

describe('renderMarkdown', () => {
  it('adds source line range data to block elements', () => {
    const html = renderMarkdown('# Hello')
    expect(html).toContain('data-line="1"')
    expect(html).toContain('data-line-end=')
    expect(html).toContain('<h1')
  })

  it('highlights code blocks', () => {
    const html = renderMarkdown('```js\nconsole.log("hi")\n```')
    expect(html).toContain('class="hljs"')
  })

  it('preserves full-width indentation', () => {
    const html = renderMarkdown('\u3000\u3000Indented')
    expect(html).toContain('Indented')
  })

  it('keeps em-space content without adding unsafe markup', () => {
    const html = renderMarkdown('\u2003\u2003Indented')
    expect(html).toContain('Indented')
    expect(html).not.toContain('<script')
  })

  it('sanitizes script tags and javascript urls', () => {
    const html = renderMarkdown('<script>alert(1)</script><a href="javascript:alert(1)">bad</a>')
    expect(html).not.toContain('<script')
    expect(html).toContain('<a>bad</a>')
  })

  it('allows safe span colors from toolbar output', () => {
    const html = renderMarkdown('<span style="color:#ff0000;background-color:rgb(0, 0, 0)" onclick="x()">hi</span>')
    expect(html).toContain('style="color:#ff0000;background-color:rgb(0, 0, 0)"')
    expect(html).not.toContain('onclick')
  })

  it('sanitizes export html with the same whitelist', () => {
    const html = renderExportMarkdown('<img src="data:image/png;base64,abc" onerror="alert(1)" />')
    expect(html).toContain('src="data:image/png;base64,abc"')
    expect(html).not.toContain('onerror')
  })
})

describe('extractTitle', () => {
  it('extracts h1 title', () => {
    expect(extractTitle('# My Title')).toBe('My Title')
  })

  it('returns empty string when no title exists', () => {
    expect(extractTitle('No title here')).toBe('')
  })

  it('extracts a non-first-line h1 title', () => {
    expect(extractTitle('Intro\n# Main Title')).toBe('Main Title')
  })
})
