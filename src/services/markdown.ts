const MARKDOWN_SIGNAL_PATTERNS = [
  /^#{1,6}\s+\S/m,
  /^>\s+\S/m,
  /^[-*+]\s+\S/m,
  /^\d+\.\s+\S/m,
  /^```[\s\S]*?```/m,
  /^\|.+\|\s*$/m,
  /\[[^\]]+\]\([^)]+\)/,
  /(\*\*|__)[^\n]+(\*\*|__)/,
  /(^|\n)---+(\n|$)/,
]

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function sanitizeHref(value: string): string {
  const trimmed = value.trim()
  if (/^(https?:|mailto:|#|\/)/i.test(trimmed)) return trimmed
  return '#'
}

export function detectMarkdown(content: string): boolean {
  const text = content.trim()
  if (!text) return false

  let score = 0
  for (const pattern of MARKDOWN_SIGNAL_PATTERNS) {
    if (pattern.test(text)) score += 1
  }

  const hasStructuredBlocks = /^(#{1,6}|[-*+]|\d+\.|>|```|\|)/m.test(text)
  return score >= 2 || (score >= 1 && hasStructuredBlocks)
}

function renderInline(value: string): string {
  const codeSpans: string[] = []
  let html = escapeHtml(value).replace(/`([^`]+)`/g, (_, code: string) => {
    const index = codeSpans.push(`<code>${code}</code>`) - 1
    return `@@CODE_${index}@@`
  })

  html = html
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_match, label: string, href: string) => {
      return `<a href="${escapeAttribute(sanitizeHref(href))}" target="_blank" rel="noreferrer">${label}</a>`
    })
    .replace(/(\*\*|__)(.+?)\1/g, '<strong>$2</strong>')
    .replace(/(\*|_)([^*_]+?)\1/g, '<em>$2</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>')

  return html.replace(/@@CODE_(\d+)@@/g, (_match, index: string) => codeSpans[Number(index)] ?? '')
}

function parseTable(lines: string[], startIndex: number): { html: string; nextIndex: number } | null {
  const header = lines[startIndex]
  const divider = lines[startIndex + 1]
  if (!header?.includes('|') || !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(divider ?? '')) {
    return null
  }

  const readCells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(cell => cell.trim())

  const headers = readCells(header)
  const rows: string[][] = []
  let index = startIndex + 2
  while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
    rows.push(readCells(lines[index]))
    index += 1
  }

  const thead = `<thead><tr>${headers.map(cell => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead>`
  const tbody = rows.length
    ? `<tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${renderInline(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
    : ''

  return { html: `<table>${thead}${tbody}</table>`, nextIndex: index }
}

export function markdownToHtml(content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const blocks: string[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      if (index < lines.length) index += 1
      const langClass = language ? ` class="language-${escapeAttribute(language)}"` : ''
      blocks.push(`<pre><code${langClass}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      continue
    }

    const table = parseTable(lines, index)
    if (table) {
      blocks.push(table.html)
      index = table.nextIndex
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed)
    if (heading) {
      const level = heading[1].length
      blocks.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`)
      index += 1
      continue
    }

    if (/^---+$/.test(trimmed)) {
      blocks.push('<hr>')
      index += 1
      continue
    }

    if (/^>\s?/.test(trimmed)) {
      const quoteLines: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quoteLines.push(lines[index].trim().replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push(`<blockquote>${quoteLines.map(item => `<p>${renderInline(item)}</p>`).join('')}</blockquote>`)
      continue
    }

    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^[-*+]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*+]\s+/, ''))
        index += 1
      }
      blocks.push(`<ul>${items.map(item => `<li>${renderInline(item)}</li>`).join('')}</ul>`)
      continue
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ''))
        index += 1
      }
      blocks.push(`<ol>${items.map(item => `<li>${renderInline(item)}</li>`).join('')}</ol>`)
      continue
    }

    const paragraphLines: string[] = []
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6}\s+|```|>\s?|[-*+]\s+|\d+\.\s+|---+$)/.test(lines[index].trim())
    ) {
      if (parseTable(lines, index)) break
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    blocks.push(`<p>${renderInline(paragraphLines.join(' '))}</p>`)
  }

  return blocks.join('\n')
}
