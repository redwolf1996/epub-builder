import { BlobWriter, TextReader, Uint8ArrayReader, ZipWriter } from '@zip.js/zip.js'
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

  it('decodes non-utf8 opf and xhtml entries using declared encodings', async () => {
    const writer = new ZipWriter(new BlobWriter('application/epub+zip'))

    const containerBytes = Uint8Array.from(Buffer.from(
      '3c3f786d6c2076657273696f6e3d22312e302220656e636f64696e673d2267623138303330223f3e0a3c636f6e7461696e65722076657273696f6e3d22312e302220786d6c6e733d2275726e3a6f617369733a6e616d65733a74633a6f70656e646f63756d656e743a786d6c6e733a636f6e7461696e6572223e0a20203c726f6f7466696c65733e0a202020203c726f6f7466696c652066756c6c2d706174683d224f50532f636f6e74656e742e6f706622206d656469612d747970653d226170706c69636174696f6e2f6f656270732d7061636b6167652b786d6c22202f3e0a20203c2f726f6f7466696c65733e0a3c2f636f6e7461696e65723e',
      'hex',
    ))
    const opfBytes = Uint8Array.from(Buffer.from(
      '3c3f786d6c2076657273696f6e3d22312e302220656e636f64696e673d2267623138303330223f3e0a3c7061636b6167652076657273696f6e3d22332e302220786d6c6e733d22687474703a2f2f7777772e696470662e6f72672f323030372f6f70662220756e697175652d6964656e7469666965723d22426f6f6b4964223e0a20203c6d6574616461746120786d6c6e733a64633d22687474703a2f2f7075726c2e6f72672f64632f656c656d656e74732f312e312f223e0a202020203c64633a7469746c653ec8abc7f2cda8cab73c2f64633a7469746c653e0a202020203c64633a63726561746f723ecbb9cbfeb7f2c0efb0a2c5b5cbb93c2f64633a63726561746f723e0a20203c2f6d657461646174613e0a20203c6d616e69666573743e0a202020203c6974656d2069643d2263686170312220687265663d22636861707465722d312e7868746d6c22206d656469612d747970653d226170706c69636174696f6e2f7868746d6c2b786d6c22202f3e0a20203c2f6d616e69666573743e0a20203c7370696e653e0a202020203c6974656d7265662069647265663d22636861703122202f3e0a20203c2f7370696e653e0a3c2f7061636b6167653e',
      'hex',
    ))
    const chapterBytes = Uint8Array.from(Buffer.from(
      '3c3f786d6c2076657273696f6e3d22312e302220656e636f64696e673d2267623138303330223f3e0a3c68746d6c20786d6c6e733d22687474703a2f2f7777772e77332e6f72672f313939392f7868746d6c223e0a3c686561643e0a20203c6d65746120687474702d65717569763d22436f6e74656e742d547970652220636f6e74656e743d22746578742f68746d6c3b20636861727365743d6762313830333022202f3e0a20203c7469746c653eb5dad2bbd5c23c2f7469746c653e0a3c2f686561643e0a3c626f64793e0a20203c68313eb5dad2bbd5c23c2f68313e0a20203c703ecec4c3f7d6aec7b0b5c4c8cbc0e03c2f703e0a3c2f626f64793e0a3c2f68746d6c3e',
      'hex',
    ))

    await writer.add('META-INF/container.xml', new Uint8ArrayReader(containerBytes))
    await writer.add('OPS/content.opf', new Uint8ArrayReader(opfBytes))
    await writer.add('OPS/chapter-1.xhtml', new Uint8ArrayReader(chapterBytes))

    const blob = await writer.close()
    const file = new File([blob], 'encoded.epub', { type: 'application/epub+zip' })

    const document = await parseEpubImport(file)

    expect(document.meta.title).toBe('全球通史')
    expect(document.meta.author).toBe('斯塔夫里阿诺斯')
    expect(document.sections).toHaveLength(1)
    expect(document.sections[0].title).toBe('第一章')
    expect(document.sections[0].content).toContain('文明之前的人类')
  })
})
