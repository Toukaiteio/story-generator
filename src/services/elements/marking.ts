import type { StoryElement } from '@/types/element'
import { normalizeElementAliases } from './index'

/** Hover popovers appear only after this delay; shorter hovers show nothing. */
export const MARK_POPOVER_DELAY_MS = 500

export interface MarkDictionaryEntry {
  elementId: string
  text: string
  isAlias: boolean
}

export interface MarkDictionary {
  entries: MarkDictionaryEntry[]
  byText: Map<string, MarkDictionaryEntry>
}

export type MarkedSegment =
  | { type: 'text'; text: string }
  | {
      type: 'mark'
      text: string
      elementId: string
      matchedText: string
      isAlias: boolean
    }

export interface MarkedText {
  segments: MarkedSegment[]
  text: string
}

interface RankedTerm {
  text: string
  entry: MarkDictionaryEntry
}

function compareTerms(a: RankedTerm, b: RankedTerm): number {
  if (b.text.length !== a.text.length) return b.text.length - a.text.length
  return a.text < b.text ? -1 : a.text > b.text ? 1 : 0
}

/**
 * Every name and alias in the story bible, longest first so scanning always
 * prefers the most specific term. One-character terms are skipped.
 */
export function buildMarkDictionary(elements: StoryElement[] | undefined): MarkDictionary {
  const ranked: RankedTerm[] = []
  const seen = new Set<string>()

  for (const element of elements ?? []) {
    if (!element || typeof element.name !== 'string') continue
    const name = element.name.trim()
    if (!name) continue
    const terms = [name, ...normalizeElementAliases(element.aliases, name)]
    for (const [index, text] of terms.entries()) {
      if (text.length < 2 || seen.has(text)) continue
      seen.add(text)
      ranked.push({ text, entry: { elementId: element.id, text, isAlias: index > 0 } })
    }
  }

  ranked.sort(compareTerms)
  const entries = ranked.map(item => item.entry)
  return {
    entries,
    byText: new Map(entries.map(entry => [entry.text, entry])),
  }
}

export function markText(text: string, dictionary: MarkDictionary): MarkedSegment[] {
  if (!text) return []
  const segments: MarkedSegment[] = []
  let plain = ''
  let index = 0

  const flushPlain = () => {
    if (!plain) return
    segments.push({ type: 'text', text: plain })
    plain = ''
  }

  while (index < text.length) {
    let matched: MarkDictionaryEntry | null = null
    for (const entry of dictionary.entries) {
      if (text.startsWith(entry.text, index)) {
        matched = entry
        break
      }
    }

    if (!matched) {
      plain += text[index]
      index += 1
      continue
    }

    flushPlain()
    segments.push({
      type: 'mark',
      text: matched.text,
      elementId: matched.elementId,
      matchedText: matched.text,
      isAlias: matched.isAlias,
    })
    index += matched.text.length
  }

  flushPlain()
  return segments
}

export function markPlainText(text: string, dictionary: MarkDictionary): MarkedText {
  return { segments: markText(text, dictionary), text }
}

/**
 * Paragraph break contract shared with the old textarea: one paragraph per
 * line, a trailing newline keeps its empty final paragraph, and an empty
 * document has one empty paragraph.
 */
export function splitPlainText(text: string): string[] {
  return text.split('\n')
}

export function joinPlainText(paragraphs: string[]): string {
  return paragraphs.join('\n')
}

/** Replace a plain-text range and return the text plus the caret after it. */
export function splicePlainText(
  text: string,
  start: number,
  end: number,
  insert: string,
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  const inserted = insert.replace(/\r\n?/g, '\n')
  return {
    text: text.slice(0, from) + inserted + text.slice(to),
    caret: from + inserted.length,
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Renders marked segments for the preview surface; output is fully escaped. */
export function markTextToHtml(text: string, dictionary: MarkDictionary): string {
  return markText(text, dictionary)
    .map(segment => {
      if (segment.type === 'text') return escapeHtml(segment.text).replace(/\n/g, '<br>')
      return `<span class="element-mark" tabindex="0" data-element-id="${escapeHtml(segment.elementId)}" data-alias="${segment.isAlias ? 'true' : 'false'}">${escapeHtml(segment.text)}</span>`
    })
    .join('')
}

function decodeEntities(value: string): string {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|amp|lt|gt|quot|apos);/gi, (match, dec, hex) => {
    if (dec) return String.fromCodePoint(Number(dec))
    if (hex) return String.fromCodePoint(parseInt(hex, 16))
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    return named[match.slice(1, -1).toLowerCase()] ?? match
  })
}

/**
 * Restores plain text from marked HTML or a DOM node. Markup is dropped, line
 * breaks and block boundaries become \n, and entities are decoded.
 */
export function extractPlainText(markedHtmlOrNodes: string | Node): string {
  if (typeof markedHtmlOrNodes !== 'string' && markedHtmlOrNodes) {
    return markedHtmlOrNodes.textContent ?? ''
  }
  const source = typeof markedHtmlOrNodes === 'string' ? markedHtmlOrNodes : ''
  const withBreaks = source
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|blockquote|pre|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(withBreaks)
}
