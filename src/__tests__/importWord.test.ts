import { describe, expect, it, vi } from 'vitest'
import { parseWordImport } from '@/utils/importWord'

vi.mock('mammoth', () => ({
  default: {
    convertToHtml: vi.fn(),
  },
}))

describe('parseWordImport', () => {
  it('extracts title, nested sections, images, links, and warnings from docx html', async () => {
    const mammoth = await import('mammoth')
    vi.mocked(mammoth.default.convertToHtml).mockResolvedValue({
      value: [
        '<h1>Demo Book</h1>',
        '<h2>Chapter 1</h2>',
        '<p><strong>Bold</strong> and <em>italic</em> <a href="https://example.com">link</a></p>',
        '<p><img src="data:image/png;base64,AA==" alt="hero" /></p>',
        '<h3>Scene 1</h3>',
        '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
      ].join(''),
      messages: [{ type: 'warning' as const, message: 'Unrecognized paragraph style: Fancy' }],
    })

    const file = new File([new Uint8Array([1, 2, 3])], 'demo.docx')
    const result = await parseWordImport(file)

    expect(result.format).toBe('docx')
    expect(result.meta.title).toBe('Demo Book')
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0].title).toBe('Chapter 1')
    expect(result.sections[0].content).toContain('**Bold**')
    expect(result.sections[0].content).toContain('*italic*')
    expect(result.sections[0].content).toContain('[link](https://example.com)')
    expect(result.sections[0].content).toContain('![hero](data:image/png;base64,AA==)')
    expect(result.sections[0].children[0].title).toBe('Scene 1')
    expect(result.sections[0].children[0].content).toContain('| A | B |')
    expect(result.warnings).toEqual([{
      code: 'word-import-warning',
      message: 'Unrecognized paragraph style: Fancy',
    }])
  })

  it('falls back to a single imported section when no headings exist', async () => {
    const mammoth = await import('mammoth')
    vi.mocked(mammoth.default.convertToHtml).mockResolvedValue({
      value: '<p>Plain text only</p>',
      messages: [],
    })

    const file = new File([new Uint8Array([1])], 'plain.docx')
    const result = await parseWordImport(file)

    expect(result.meta.title).toBe('plain')
    expect(result.sections).toEqual([{
      title: 'Imported Section',
      content: 'Plain text only',
      children: [],
    }])
  })
})
