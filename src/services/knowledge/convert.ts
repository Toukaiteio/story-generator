import JSZip from 'jszip'

export interface KnowledgeDocumentImportInput {
  fileName: string
  extension: string
  text?: string
  bytes?: Uint8Array | ArrayBuffer
}

export interface KnowledgeDocumentImportResult {
  markdown: string
  detectedType: 'text' | 'html' | 'rtf' | 'docx' | 'binary-doc' | 'unknown'
  warnings: string[]
}

const DOCX_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

function toUint8Array(bytes: Uint8Array | ArrayBuffer): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
}

function decodeBytes(bytes: Uint8Array | ArrayBuffer): string {
  const decoder = new TextDecoder('utf-8', { fatal: false })
  return decoder.decode(toUint8Array(bytes))
}

function normalizeLineEndings(text: string) {
  return text.replace(/\r\n?/g, '\n')
}

function collapseBlankLines(text: string) {
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

function isHtml(text: string) {
  return /<!doctype html|<html[\s>]|<body[\s>]/i.test(text)
}

function isRtf(text: string) {
  return /^\s*\{\\rtf/i.test(text)
}

function isLikelyZip(bytes: Uint8Array) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

function plainTextToMarkdown(text: string) {
  const lines = normalizeLineEndings(text)
    .split('\n')
    .map(line => line.replace(/\s+$/g, ''))

  return collapseBlankLines(lines.join('\n'))
}

function convertHtmlNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  const el = node as Element
  const tag = el.tagName.toLowerCase()
  const children = Array.from(el.childNodes).map(convertHtmlNode).join('')

  switch (tag) {
    case 'br':
      return '\n'
    case 'p':
    case 'div':
    case 'section':
    case 'article':
    case 'header':
    case 'footer':
    case 'aside':
    case 'main':
      return `${children.trim()}\n\n`
    case 'h1':
      return `# ${children.trim()}\n\n`
    case 'h2':
      return `## ${children.trim()}\n\n`
    case 'h3':
      return `### ${children.trim()}\n\n`
    case 'h4':
      return `#### ${children.trim()}\n\n`
    case 'h5':
      return `##### ${children.trim()}\n\n`
    case 'h6':
      return `###### ${children.trim()}\n\n`
    case 'li':
      return `- ${children.trim()}\n`
    case 'ul':
    case 'ol':
      return `\n${children.trim()}\n\n`
    case 'strong':
    case 'b':
      return `**${children.trim()}**`
    case 'em':
    case 'i':
      return `*${children.trim()}*`
    case 'code':
      return `\`${children.trim()}\``
    case 'pre':
      return `\n\`\`\`\n${children.trim()}\n\`\`\`\n\n`
    case 'a': {
      const href = el.getAttribute('href')?.trim()
      if (!href) return children
      return `[${children.trim() || href}](${href})`
    }
    case 'table':
      return `${convertHtmlTable(el)}\n\n`
    case 'tbody':
    case 'thead':
    case 'tr':
    case 'td':
    case 'th':
      return children
    default:
      return children
  }
}

function convertHtmlTable(table: Element) {
  const rows = Array.from(table.querySelectorAll('tr')).map((row) =>
    Array.from(row.querySelectorAll('th,td')).map(cell => normalizeLineEndings(cell.textContent || '').trim())
  ).filter(row => row.length)

  if (!rows.length) return ''
  const width = Math.max(...rows.map(row => row.length))
  const normalized = rows.map(row => {
    const next = [...row]
    while (next.length < width) next.push('')
    return next
  })

  if (normalized.length === 1) {
    return normalized[0].join(' | ')
  }

  const [header, ...body] = normalized
  const separator = header.map(() => '---')
  return [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')
}

function htmlToMarkdown(text: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(text, 'text/html')
  const markdown = Array.from(doc.body.childNodes).map(convertHtmlNode).join('')
  return collapseBlankLines(normalizeLineEndings(markdown))
}

function decodeRtfHex(value: string) {
  return value.replace(/\\'([0-9a-fA-F]{2})/g, (_match, hex) => {
    const code = Number.parseInt(hex, 16)
    return String.fromCharCode(code)
  })
}

function rtfToMarkdown(text: string) {
  let output = normalizeLineEndings(text)
  output = decodeRtfHex(output)
  output = output
    .replace(/\{\\\*?\\[^}]+\}/g, '')
    .replace(/[{}]/g, '')
    .replace(/\\par[d]?\s?/gi, '\n\n')
    .replace(/\\line\s?/gi, '\n')
    .replace(/\\tab\s?/gi, '\t')
    .replace(/\\[a-z]+\d* ?/gi, '')
  return plainTextToMarkdown(output)
}

function collectDocxText(node: Node): string {
  switch (node.nodeName) {
    case '#text':
      return node.textContent || ''
    case 'w:t':
      return node.textContent || ''
    case 'w:tab':
      return '\t'
    case 'w:br':
    case 'w:cr':
      return '\n'
    default:
      return Array.from(node.childNodes).map(collectDocxText).join('')
  }
}

function getDocxStyleName(paragraph: Element): string {
  const styleNodes = paragraph.getElementsByTagNameNS(DOCX_NS, 'pStyle')
  const styleNode = styleNodes[0]
  if (!styleNode) return ''
  return (
    styleNode.getAttribute('w:val')
    || styleNode.getAttribute('val')
    || styleNode.getAttributeNS(DOCX_NS, 'val')
    || ''
  ).trim()
}

function hasDocxNumbering(paragraph: Element) {
  return paragraph.getElementsByTagNameNS(DOCX_NS, 'numPr').length > 0
}

function convertDocxParagraph(paragraph: Element) {
  const raw = normalizeLineEndings(collectDocxText(paragraph)).trim()
  if (!raw) return ''

  const styleName = getDocxStyleName(paragraph)
  const headingMatch = styleName.match(/heading\s*(\d+)/i)

  if (styleName.toLowerCase() === 'title') {
    return `# ${raw}`
  }

  if (headingMatch) {
    const level = Math.min(6, Math.max(1, Number.parseInt(headingMatch[1], 10) || 1))
    return `${'#'.repeat(level)} ${raw}`
  }

  if (hasDocxNumbering(paragraph) || /list/i.test(styleName)) {
    return `- ${raw}`
  }

  return raw
}

function convertDocxTable(table: Element) {
  const rows = Array.from(table.getElementsByTagNameNS(DOCX_NS, 'tr')).map((row) => {
    return Array.from(row.getElementsByTagNameNS(DOCX_NS, 'tc')).map((cell) => {
      const text = normalizeLineEndings(collectDocxText(cell)).replace(/\s+/g, ' ').trim()
      return text
    })
  }).filter(row => row.length)

  if (!rows.length) return ''

  const width = Math.max(...rows.map(row => row.length))
  const normalized = rows.map(row => {
    const next = [...row]
    while (next.length < width) next.push('')
    return next
  })

  if (normalized.length === 1) {
    return normalized[0].join(' | ')
  }

  const [header, ...body] = normalized
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...body.map(row => `| ${row.join(' | ')} |`),
  ].join('\n')
}

async function convertDocxToMarkdown(bytes: Uint8Array | ArrayBuffer) {
  const zip = await JSZip.loadAsync(bytes)
  const documentXml = await zip.file('word/document.xml')?.async('text')
  if (!documentXml) {
    throw new Error('DOCX file is missing word/document.xml')
  }

  const parser = new DOMParser()
  const xml = parser.parseFromString(documentXml, 'application/xml')
  const parserError = xml.querySelector('parsererror')
  if (parserError) {
    throw new Error('Failed to parse DOCX XML')
  }

  const body = xml.getElementsByTagNameNS(DOCX_NS, 'body')[0]
  if (!body) {
    throw new Error('DOCX file is missing document body')
  }

  const blocks: string[] = []
  for (const child of Array.from(body.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue
    const el = child as Element
    if (el.localName === 'p') {
      const paragraph = convertDocxParagraph(el)
      if (paragraph) blocks.push(paragraph)
      continue
    }
    if (el.localName === 'tbl') {
      const table = convertDocxTable(el)
      if (table) blocks.push(table)
    }
  }

  return collapseBlankLines(blocks.join('\n\n'))
}

function extractAsciiRuns(bytes: Uint8Array) {
  const chunks: string[] = []
  let current = ''

  const flush = () => {
    const trimmed = current.trim()
    if (trimmed.length >= 4) chunks.push(trimmed)
    current = ''
  }

  for (const byte of bytes) {
    const isPrintable =
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      (byte >= 0x20 && byte <= 0x7e)

    if (isPrintable) {
      current += String.fromCharCode(byte)
    } else {
      if (current.endsWith('\r') || current.endsWith('\n')) {
        current += '\n'
      }
      flush()
    }
  }

  flush()
  return chunks.join('\n\n')
}

function extractUtf16LeRuns(bytes: Uint8Array) {
  const chars: string[] = []
  let current = ''

  const flush = () => {
    const trimmed = current.trim()
    if (trimmed.length >= 4) chars.push(trimmed)
    current = ''
  }

  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const low = bytes[i]
    const high = bytes[i + 1]
    if (high === 0x00 && (low === 0x09 || low === 0x0a || low === 0x0d || (low >= 0x20 && low <= 0x7e))) {
      current += String.fromCharCode(low)
    } else {
      flush()
    }
  }

  flush()
  return chars.join('\n\n')
}

function extractReadableBinaryText(bytes: Uint8Array) {
  const utf8Text = decodeBytes(bytes)
  const asciiRuns = extractAsciiRuns(bytes)
  const utf16Runs = extractUtf16LeRuns(bytes)

  const candidates = [utf8Text, asciiRuns, utf16Runs]
    .map(text => normalizeLineEndings(text).replace(/\u0000/g, ''))
    .map(text => text.trim())
    .filter(Boolean)

  candidates.sort((a, b) => b.length - a.length)
  return candidates[0] || ''
}

export async function convertKnowledgeDocumentToMarkdown(input: KnowledgeDocumentImportInput): Promise<KnowledgeDocumentImportResult> {
  const extension = input.extension.toLowerCase()
  const warnings: string[] = []

  if (input.text && !input.bytes) {
    if (isRtf(input.text)) {
      return {
        markdown: rtfToMarkdown(input.text),
        detectedType: 'rtf',
        warnings,
      }
    }

    if (isHtml(input.text)) {
      return {
        markdown: htmlToMarkdown(input.text),
        detectedType: 'html',
        warnings,
      }
    }

    return {
      markdown: plainTextToMarkdown(input.text),
      detectedType: 'text',
      warnings,
    }
  }

  if (!input.bytes && !input.text) {
    return {
      markdown: '',
      detectedType: 'unknown',
      warnings: ['Empty document'],
    }
  }

  const bytes = input.bytes ? toUint8Array(input.bytes) : null
  const text = input.text ?? (bytes ? decodeBytes(bytes) : '')

  if (bytes && (extension === 'docx' || isLikelyZip(bytes))) {
    return {
      markdown: await convertDocxToMarkdown(bytes),
      detectedType: 'docx',
      warnings,
    }
  }

  if (text && isRtf(text)) {
    return {
      markdown: rtfToMarkdown(text),
      detectedType: 'rtf',
      warnings,
    }
  }

  if (text && isHtml(text)) {
    return {
      markdown: htmlToMarkdown(text),
      detectedType: 'html',
      warnings,
    }
  }

  if (extension === 'doc' && bytes) {
    const extracted = extractReadableBinaryText(bytes)
    if (extracted.trim()) {
      warnings.push('DOC formatting was approximated as plain markdown text')
      return {
        markdown: plainTextToMarkdown(extracted),
        detectedType: 'binary-doc',
        warnings,
      }
    }
    throw new Error('Unable to extract text from DOC file')
  }

  if (bytes) {
    const extracted = extractReadableBinaryText(bytes)
    if (extracted.trim()) {
      return {
        markdown: plainTextToMarkdown(extracted),
        detectedType: 'text',
        warnings,
      }
    }
  }

  return {
    markdown: plainTextToMarkdown(text),
    detectedType: 'text',
    warnings,
  }
}
