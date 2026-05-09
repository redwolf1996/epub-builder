const defaultDecodingCandidates = ['utf-8', 'gb18030', 'gbk', 'utf-16', 'utf-16le', 'utf-16be'] as const

type DecodeImportTextOptions = {
  declaredEncoding?: string | null
  mediaType?: string | null
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

function hasUtf16LeBom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
}

function hasUtf16BeBom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
}

function normalizeEncodingLabel(encoding?: string | null): string | null {
  if (!encoding) return null

  const normalized = encoding.trim().replace(/^["']|["']$/g, '').toLowerCase()
  if (!normalized) return null

  switch (normalized) {
    case 'utf8':
      return 'utf-8'
    case 'utf16':
      return 'utf-16'
    case 'utf16le':
      return 'utf-16le'
    case 'utf16be':
      return 'utf-16be'
    case 'gb2312':
    case 'gb_2312':
    case 'gb-2312':
    case 'gbk':
    case 'gb18030':
      return 'gb18030'
    default:
      return normalized
  }
}

function isXmlLikeMediaType(mediaType?: string | null): boolean {
  if (!mediaType) return false
  return /xml/i.test(mediaType)
}

function isHtmlLikeMediaType(mediaType?: string | null): boolean {
  if (!mediaType) return false
  return /html|xhtml/i.test(mediaType)
}

export function extractDeclaredEncoding(bytes: Uint8Array, mediaType?: string | null): string | null {
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 2048))
  const xmlMatch = head.match(/<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/i)
  if (xmlMatch?.[1]) {
    return normalizeEncodingLabel(xmlMatch[1])
  }

  if (!isHtmlLikeMediaType(mediaType) && !isXmlLikeMediaType(mediaType)) {
    return null
  }

  const metaCharset = head.match(/<meta[^>]+charset\s*=\s*["']?\s*([^"'\s/>]+)/i)
  if (metaCharset?.[1]) {
    return normalizeEncodingLabel(metaCharset[1])
  }

  const contentTypeCharset = head.match(/<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([^"';\s/>]+)/i)
  if (contentTypeCharset?.[1]) {
    return normalizeEncodingLabel(contentTypeCharset[1])
  }

  return null
}

export function decodeImportText(bytes: Uint8Array, options: DecodeImportTextOptions = {}): string {
  const declaredEncoding = normalizeEncodingLabel(options.declaredEncoding)
  const mediaType = options.mediaType ?? null
  const sniffedEncoding = extractDeclaredEncoding(bytes, mediaType)
  const preferredCandidates = hasUtf8Bom(bytes)
    ? ['utf-8']
    : hasUtf16LeBom(bytes)
      ? ['utf-16le', 'utf-16']
      : hasUtf16BeBom(bytes)
        ? ['utf-16be', 'utf-16']
        : [declaredEncoding, sniffedEncoding, ...defaultDecodingCandidates].filter((value, index, list): value is string => {
          return Boolean(value) && list.indexOf(value) === index
        })

  for (const encoding of preferredCandidates) {
    try {
      return new TextDecoder(encoding, { fatal: true }).decode(bytes)
    } catch {
      continue
    }
  }

  return new TextDecoder().decode(bytes)
}
