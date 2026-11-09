import type { ElementKind, ElementStatus, StoryElement } from '@/types/element'
import type { MarkDictionary } from './marking'
import { elementStateAt } from './index'

export const COMPLETION_LIMIT = 8

/** Whitespace, ASCII punctuation, and CJK punctuation end a word token. */
const TOKEN_BOUNDARY = /[\s.,;:!?()[\]{}<>"'`~@#$%^&*+=|\\/、，。；：！？（）【】《》〈〉「」『』“”‘’—…·]/

export type CompletionTrigger = 'auto' | 'manual' | 'explicit'

export interface CompletionContext {
  /** The characters typed after the token boundary, or after `@`. */
  query: string
  /** Offset of the first replaced character (the `@` for explicit triggers). */
  start: number
  /** Caret offset when the context was read. */
  end: number
  trigger: CompletionTrigger
}

export interface CompletionItem {
  elementId: string
  name: string
  /** Name or alias text inserted into the prose. */
  insertText: string
  /** Name, or `别名：…` when the match came from an alias. */
  label: string
  isAlias: boolean
  kind: ElementKind
  status?: ElementStatus
  presentThisChapter: boolean
  match: 'prefix' | 'contains'
}

export interface CompletionRequest {
  text: string
  caret: number
  trigger: CompletionTrigger
  composing: boolean
  elementList: StoryElement[] | undefined
  dictionary: MarkDictionary
  chapterIndex: number
  limit?: number
}

export interface CompletionResult {
  context: CompletionContext | null
  items: CompletionItem[]
}

export function isCjkChar(char: string): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(char)
}

/** One character is enough to trigger, in every language (VS Code parity). */
export function minimumPrefixLength(_query?: string): number {
  return 1
}

export function readCompletionContext(text: string, caret: number): CompletionContext {
  const source = typeof text === 'string' ? text : ''
  const end = Math.max(0, Math.min(typeof caret === 'number' ? caret : 0, source.length))
  let start = end
  while (start > 0 && !TOKEN_BOUNDARY.test(source[start - 1])) start -= 1
  const query = source.slice(start, end)
  if (start > 0 && source[start - 1] === '@') {
    return { query, start: start - 1, end, trigger: 'explicit' }
  }
  return { query, start, end, trigger: 'auto' }
}

function matchText(text: string, query: string): 'prefix' | 'contains' | null {
  if (!query) return 'contains'
  const haystack = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  if (haystack.startsWith(needle)) return 'prefix'
  if (haystack.includes(needle)) return 'contains'
  return null
}

interface RankedItem {
  item: CompletionItem
  match: 'prefix' | 'contains'
}

function compareRanked(a: RankedItem, b: RankedItem): number {
  const order = { prefix: 0, contains: 1 }
  if (order[a.match] !== order[b.match]) return order[a.match] - order[b.match]
  if (a.item.insertText.length !== b.item.insertText.length) {
    return a.item.insertText.length - b.item.insertText.length
  }
  if (a.item.insertText !== b.item.insertText) return a.item.insertText < b.item.insertText ? -1 : 1
  return a.item.elementId < b.item.elementId ? -1 : a.item.elementId > b.item.elementId ? 1 : 0
}

/**
 * One row per element. When both the name and an alias match, the shortest
 * matching term wins, and an alias hit is labelled as an alias.
 */
export function buildCompletionItems(
  request: Pick<CompletionRequest, 'elementList' | 'dictionary' | 'chapterIndex' | 'limit'>,
  context: CompletionContext,
): CompletionItem[] {
  const byId = new Map<string, StoryElement>()
  for (const element of request.elementList ?? []) {
    if (element && typeof element.id === 'string') byId.set(element.id, element)
  }

  const query = context.query
  const ranked = new Map<string, RankedItem>()

  for (const entry of request.dictionary.entries) {
    const element = byId.get(entry.elementId)
    if (!element) continue
    const match = matchText(entry.text, query)
    if (!match) continue
    const previous = ranked.get(element.id)
    const candidate: RankedItem = {
      match,
      item: {
        elementId: element.id,
        name: element.name,
        insertText: entry.text,
        label: entry.isAlias ? `别名：${entry.text}` : entry.text,
        isAlias: entry.isAlias,
        kind: element.kind,
        status: elementStateAt(element, request.chapterIndex)?.status,
        presentThisChapter: Boolean(elementStateAt(element, request.chapterIndex)),
        match,
      },
    }
    if (!previous || compareRanked(candidate, previous) < 0) ranked.set(element.id, candidate)
  }

  const items = [...ranked.values()]
  if (context.trigger === 'manual' && !query) {
    items.sort((a, b) => {
      if (a.item.presentThisChapter !== b.item.presentThisChapter) {
        return a.item.presentThisChapter ? -1 : 1
      }
      return compareRanked(a, b)
    })
  } else {
    items.sort(compareRanked)
  }

  const limit = Math.max(1, request.limit ?? COMPLETION_LIMIT)
  return items.slice(0, limit).map(entry => entry.item)
}

/**
 * Single decision point for automatic, manual, and explicit completion.
 * Composing (IME) input returns nothing and never rebuilds the list.
 */
export function resolveCompletion(request: CompletionRequest): CompletionResult {
  if (request.composing) return { context: null, items: [] }

  const base = readCompletionContext(request.text, request.caret)
  const context: CompletionContext = request.trigger === 'manual'
    ? { ...base, trigger: 'manual' }
    : request.trigger === 'explicit'
      ? { ...base, trigger: 'explicit' }
      : { ...base, trigger: base.trigger }

  if (context.trigger === 'auto') {
    if (!context.query) return { context: null, items: [] }
    if (context.query.length < minimumPrefixLength(context.query)) {
      return { context: null, items: [] }
    }
  }

  let items = buildCompletionItems(request, context)
  if (context.trigger === 'auto') items = items.filter(item => item.match === 'prefix')
  if (!items.length) return { context: null, items: [] }
  return { context, items }
}

/** Replace the typed token (or `@` segment) and return the text plus caret. */
export function applyCompletion(
  text: string,
  context: CompletionContext,
  item: CompletionItem,
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(context.start, text.length))
  const to = Math.max(from, Math.min(context.end, text.length))
  return {
    text: text.slice(0, from) + item.insertText + text.slice(to),
    caret: from + item.insertText.length,
  }
}
