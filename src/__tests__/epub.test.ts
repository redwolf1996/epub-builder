import { describe, it, expect } from 'vitest'
import { deduplicateChapterTitle, prependChapterTitle, encodeDepth } from '@/utils/epub'

describe('deduplicateChapterTitle', () => {
  it('标题匹配时去除首行 h 标签', () => {
    const html = '<h1>Chapter 1</h1><p>Content</p>'
    expect(deduplicateChapterTitle(html, 'Chapter 1')).toBe('<p>Content</p>')
  })

  it('标题不匹配时原样返回', () => {
    const html = '<h1>Different</h1><p>Content</p>'
    expect(deduplicateChapterTitle(html, 'Chapter 1')).toBe(html)
  })

  it('无标题行时原样返回', () => {
    const html = '<p>No heading here</p>'
    expect(deduplicateChapterTitle(html, 'Chapter 1')).toBe(html)
  })

  it('匹配 h2~h6', () => {
    const html = '<h2>Sub</h2><p>Text</p>'
    expect(deduplicateChapterTitle(html, 'Sub')).toBe('<p>Text</p>')
  })

  it('标题匹配时去除带属性的 h 标签（如 data-line）', () => {
    const html = '<h1 data-line="1">Chapter 1</h1><p>Content</p>'
    expect(deduplicateChapterTitle(html, 'Chapter 1')).toBe('<p>Content</p>')
  })

  it('带属性但标题不匹配时原样返回', () => {
    const html = '<h1 data-line="1">Different</h1><p>Content</p>'
    expect(deduplicateChapterTitle(html, 'Chapter 1')).toBe(html)
  })
})

describe('prependChapterTitle', () => {
  it('depth=0 生成 h1 + 2em', () => {
    const result = prependChapterTitle('Title', 0)
    expect(result).toContain('<h1')
    expect(result).toContain('font-size:2em')
  })

  it('depth=5 生成 h6 + 0.9em', () => {
    const result = prependChapterTitle('Title', 5)
    expect(result).toContain('<h6')
    expect(result).toContain('font-size:0.9em')
  })

  it('depth>5 饱和为 h6 + 0.9em', () => {
    const result = prependChapterTitle('Title', 10)
    expect(result).toContain('<h6')
    expect(result).toContain('font-size:0.9em')
  })
})

describe('encodeDepth', () => {
  it('编码深度到标题', () => {
    expect(encodeDepth('Chapter 1', 2)).toBe('D2|Chapter 1')
  })

  it('depth=0', () => {
    expect(encodeDepth('Root', 0)).toBe('D0|Root')
  })
})
