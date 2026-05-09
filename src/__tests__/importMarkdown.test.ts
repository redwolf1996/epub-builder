import { describe, expect, it } from 'vitest'
import { parseMarkdownSections } from '@/utils/importMarkdown'

describe('parseMarkdownSections', () => {
  it('uses the first h1 as book title and restores nested sections', () => {
    const result = parseMarkdownSections([
      '# Demo Book',
      '',
      '## Chapter 1',
      '',
      'Intro',
      '',
      '### Scene 1',
      '',
      'Nested body',
    ].join('\n'))

    expect(result.metaTitle).toBe('Demo Book')
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].title).toBe('Chapter 1')
    expect(result.sections[0].content).toBe('Intro')
    expect(result.sections[0].children).toHaveLength(1)
    expect(result.sections[0].children[0].title).toBe('Scene 1')
    expect(result.sections[0].children[0].content).toBe('Nested body')
  })

  it('falls back to a single imported section when the file has no headings', () => {
    const result = parseMarkdownSections('Plain text only')

    expect(result.sections).toEqual([{
      title: 'Imported Section',
      content: 'Plain text only',
      children: [],
    }])
  })
})
