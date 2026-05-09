import { BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js'
import { describe, expect, it } from 'vitest'
import { parseEpubImport } from '@/utils/importEpub'

async function createEpubFile(): Promise<File> {
  const writer = new ZipWriter(new BlobWriter('application/epub+zip'))

  await writer.add('META-INF/container.xml', new TextReader([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
    '  <rootfiles>',
    '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />',
    '  </rootfiles>',
    '</container>',
  ].join('')))

  await writer.add('OEBPS/content.opf', new TextReader([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId">',
    '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
    '    <dc:title>EPUB Import Demo</dc:title>',
    '    <dc:creator>Tester</dc:creator>',
    '  </metadata>',
    '  <manifest>',
    '    <item id="chap1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />',
    '    <item id="chap2" href="chapter-2.xhtml" media-type="application/xhtml+xml" />',
    '  </manifest>',
    '  <spine>',
    '    <itemref idref="chap1" />',
    '    <itemref idref="chap2" />',
    '  </spine>',
    '</package>',
  ].join('')))

  await writer.add('OEBPS/chapter-1.xhtml', new TextReader('<html><body><h1>Chapter 1</h1><p>First body</p></body></html>'))
  await writer.add('OEBPS/chapter-2.xhtml', new TextReader('<html><body><h1>Chapter 2</h1><p>Second body</p></body></html>'))

  const blob = await writer.close()
  return new File([blob], 'demo.epub', { type: 'application/epub+zip' })
}

describe('parseEpubImport', () => {
  it('restores sections in spine order', async () => {
    const file = await createEpubFile()
    const document = await parseEpubImport(file)

    expect(document.meta.title).toBe('EPUB Import Demo')
    expect(document.sections.map((section) => section.title)).toEqual(['Chapter 1', 'Chapter 2'])
    expect(document.sections[0].content).toContain('First body')
    expect(document.sections[1].content).toContain('Second body')
  })

  it('skips nav spine items and strips heavy non-content markup', async () => {
    const writer = new ZipWriter(new BlobWriter('application/epub+zip'))

    await writer.add('META-INF/container.xml', new TextReader([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">',
      '  <rootfiles>',
      '    <rootfile full-path="OPS/content.opf" media-type="application/oebps-package+xml" />',
      '  </rootfiles>',
      '</container>',
    ].join('')))

    await writer.add('OPS/content.opf', new TextReader([
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="BookId">',
      '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">',
      '    <dc:title>Heavy EPUB</dc:title>',
      '  </metadata>',
      '  <manifest>',
      '    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />',
      '    <item id="chap1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml" />',
      '  </manifest>',
      '  <spine>',
      '    <itemref idref="nav" />',
      '    <itemref idref="chap1" />',
      '  </spine>',
      '</package>',
    ].join('')))

    await writer.add('OPS/nav.xhtml', new TextReader('<html><body><nav><ol><li>TOC</li></ol></nav></body></html>'))
    await writer.add('OPS/text/chapter-1.xhtml', new TextReader([
      '<html><head><style>.huge{display:none}</style></head><body>',
      '<svg><text>Decorative</text></svg>',
      '<h1>Chapter 1</h1>',
      '<p>Actual body</p>',
      '</body></html>',
    ].join('')))

    const blob = await writer.close()
    const file = new File([blob], 'heavy.epub', { type: 'application/epub+zip' })

    const document = await parseEpubImport(file)

    expect(document.sections).toHaveLength(1)
    expect(document.sections[0].title).toBe('Chapter 1')
    expect(document.sections[0].content).toContain('Actual body')
    expect(document.sections[0].content).not.toContain('Decorative')
    expect(document.sections[0].content).not.toContain('TOC')
  })
})
