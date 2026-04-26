import { describe, it, expect } from 'vitest'
import { renderMarkdown, extractTitle } from '@/utils/markdown'

describe('renderMarkdown', () => {
  it('标题含 data-line 属性', () => {
    const html = renderMarkdown('# Hello')
    expect(html).toContain('data-line="1"')
    expect(html).toContain('<h1')
  })

  it('代码块高亮', () => {
    const html = renderMarkdown('```js\nconsole.log("hi")\n```')
    expect(html).toContain('class="hljs"')
  })

  it('全角空格预处理保留缩进', () => {
    const html = renderMarkdown('\u3000\u3000缩进段落')
    // 全角空格被转为 &emsp; 实体，渲染后保留缩进效果
    expect(html).toContain('缩进段落')
  })

  it('em-space 缩进：行首 em-space 被 markdown-it 丢弃', () => {
    const html = renderMarkdown('\u2003\u2003缩进段落')
    // markdown-it 将行首 em-space 视为空白丢弃，后处理无法匹配
    expect(html).toContain('缩进段落')
    expect(html).not.toContain('text-indent')
  })

  it('普通段落正常渲染', () => {
    const html = renderMarkdown('Hello world')
    expect(html).toContain('Hello world')
  })
})

describe('extractTitle', () => {
  it('提取 h1 标题', () => {
    expect(extractTitle('# My Title')).toBe('My Title')
  })

  it('无标题返回空字符串', () => {
    expect(extractTitle('No title here')).toBe('')
  })

  it('提取非首行 h1 标题', () => {
    expect(extractTitle('Intro\n# Main Title')).toBe('Main Title')
  })
})
