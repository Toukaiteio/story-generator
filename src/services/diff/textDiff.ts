export interface DiffHunk {
  id: string
  /** Character range replaced in the original text. Empty for pure inserts. */
  originalStart: number
  originalEnd: number
  removed: string
  added: string
}

export type DiffSegment =
  | { type: 'equal'; text: string; start: number; end: number }
  | { type: 'remove' | 'add'; text: string; hunkId: string }

export interface TextDiff {
  original: string
  revised: string
  hunks: DiffHunk[]
  segments: DiffSegment[]
  addedChars: number
  removedChars: number
  hasChanges: boolean
}

type Op =
  | { type: 'equal'; a: number; b: number }
  | { type: 'delete'; a: number }
  | { type: 'insert'; b: number }

const CJK = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff'
const TOKEN_PATTERN = new RegExp(
  `\\r\\n|\\n|[ \\t]+|[${CJK}]|[A-Za-z0-9]+(?:['’\\-][A-Za-z0-9]+)*|.`,
  'gu',
)
/** Merge a replacement across up to this many equal tokens so prose hunks stay readable. */
const HUNK_MERGE_TOKENS = 4
/** Beyond this edit distance a diff degrades to one whole-string hunk. */
const MAX_EDIT_DISTANCE = 900

export function tokenizeText(text: string): string[] {
  if (!text) return []
  return text.match(TOKEN_PATTERN) ?? []
}

function myers(a: string[], b: string[]): Op[] | null {
  const n = a.length
  const m = b.length
  const cap = Math.min(n + m, MAX_EDIT_DISTANCE)
  const v = new Map<number, number>([[1, 0]])
  const trace: Array<Map<number, number>> = []
  let found = -1

  for (let d = 0; d <= cap; d++) {
    trace.push(new Map(v))
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) {
        x = v.get(k + 1) ?? 0
      } else {
        x = (v.get(k - 1) ?? 0) + 1
      }
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) {
        x += 1
        y += 1
      }
      v.set(k, x)
      if (x >= n && y >= m) {
        found = d
        break
      }
    }
    if (found >= 0) break
  }
  if (found < 0) return null

  let x = n
  let y = m
  const reversed: Op[] = []
  for (let d = found; d > 0; d--) {
    const previous = trace[d]
    const k = x - y
    let previousK: number
    if (k === -d || (k !== d && (previous.get(k - 1) ?? -1) < (previous.get(k + 1) ?? -1))) {
      previousK = k + 1
    } else {
      previousK = k - 1
    }
    const previousX = previous.get(previousK) ?? 0
    const previousY = previousX - previousK
    while (x > previousX && y > previousY) {
      reversed.push({ type: 'equal', a: x - 1, b: y - 1 })
      x -= 1
      y -= 1
    }
    if (x === previousX) {
      reversed.push({ type: 'insert', b: y - 1 })
      y -= 1
    } else {
      reversed.push({ type: 'delete', a: x - 1 })
      x -= 1
    }
  }
  while (x > 0 && y > 0) {
    reversed.push({ type: 'equal', a: x - 1, b: y - 1 })
    x -= 1
    y -= 1
  }
  while (x > 0) {
    reversed.push({ type: 'delete', a: x - 1 })
    x -= 1
  }
  while (y > 0) {
    reversed.push({ type: 'insert', b: y - 1 })
    y -= 1
  }
  return reversed.reverse()
}

function tokenOffsets(tokens: string[]): number[] {
  const offsets: number[] = []
  let cursor = 0
  for (const token of tokens) {
    offsets.push(cursor)
    cursor += token.length
  }
  offsets.push(cursor)
  return offsets
}

function pushHunk(
  hunks: DiffHunk[],
  segments: DiffSegment[],
  pending: { start: number; end: number; removed: string; added: string } | null,
) {
  if (!pending) return
  const id = `h${hunks.length + 1}`
  hunks.push({
    id,
    originalStart: pending.start,
    originalEnd: pending.end,
    removed: pending.removed,
    added: pending.added,
  })
  if (pending.removed) segments.push({ type: 'remove', text: pending.removed, hunkId: id })
  if (pending.added) segments.push({ type: 'add', text: pending.added, hunkId: id })
}

/**
 * Character diff for prose. Adjacent insertions and deletions form one hunk so
 * a replacement reads as one reviewable change; equal runs stay verbatim.
 */
export function buildTextDiff(original: string, revised: string): TextDiff {
  const source = typeof original === 'string' ? original : ''
  const target = typeof revised === 'string' ? revised : ''
  if (source === target) {
    return {
      original: source,
      revised: target,
      hunks: [],
      segments: source ? [{ type: 'equal', text: source, start: 0, end: source.length }] : [],
      addedChars: 0,
      removedChars: 0,
      hasChanges: false,
    }
  }

  const originalTokens = tokenizeText(source)
  const revisedTokens = tokenizeText(target)
  const originalOffsets = tokenOffsets(originalTokens)
  const revisedOffsets = tokenOffsets(revisedTokens)

  let prefix = 0
  while (
    prefix < originalTokens.length
    && prefix < revisedTokens.length
    && originalTokens[prefix] === revisedTokens[prefix]
  ) prefix += 1
  let suffix = 0
  while (
    suffix < originalTokens.length - prefix
    && suffix < revisedTokens.length - prefix
    && originalTokens[originalTokens.length - 1 - suffix] === revisedTokens[revisedTokens.length - 1 - suffix]
  ) suffix += 1

  const middleOriginal = originalTokens.slice(prefix, originalTokens.length - suffix)
  const middleRevised = revisedTokens.slice(prefix, revisedTokens.length - suffix)
  const prefixChars = originalOffsets[prefix]
  const suffixStart = originalOffsets[originalTokens.length - suffix]
  const revisedPrefixChars = revisedOffsets[prefix]
  const revisedSuffixStart = revisedOffsets[revisedTokens.length - suffix]
  const segments: DiffSegment[] = []
  const hunks: DiffHunk[] = []

  if (prefix > 0) {
    segments.push({ type: 'equal', text: source.slice(0, prefixChars), start: 0, end: prefixChars })
  }

  const ops = myers(middleOriginal, middleRevised)
  if (!ops) {
    const pending = {
      start: prefixChars,
      end: suffixStart,
      removed: source.slice(prefixChars, suffixStart),
      added: target.slice(revisedPrefixChars, revisedSuffixStart),
    }
    pushHunk(hunks, segments, pending)
  } else {
    let pending: { start: number; end: number; removed: string; added: string } | null = null
    let originalCursor = prefixChars
    let equalRun = 0
    for (const op of ops) {
      if (op.type === 'equal') {
        equalRun += 1
        const merge = pending && pending.removed && pending.added && equalRun <= HUNK_MERGE_TOKENS
        if (merge) {
          const text = middleOriginal[op.a]
          pending!.removed += text
          pending!.added += text
          pending!.end += text.length
          originalCursor += text.length
          continue
        }
        pushHunk(hunks, segments, pending)
        pending = null
        const text = middleOriginal[op.a]
        segments.push({ type: 'equal', text, start: originalCursor, end: originalCursor + text.length })
        originalCursor += text.length
        continue
      }
      equalRun = 0
      if (!pending) {
        pending = { start: originalCursor, end: originalCursor, removed: '', added: '' }
      }
      if (op.type === 'delete') {
        const text = middleOriginal[op.a]
        pending.removed += text
        pending.end += text.length
        originalCursor += text.length
      } else {
        pending.added += middleRevised[op.b]
      }
    }
    pushHunk(hunks, segments, pending)
  }

  if (suffix > 0) {
    segments.push({
      type: 'equal',
      text: source.slice(suffixStart),
      start: suffixStart,
      end: source.length,
    })
  }

  let addedChars = 0
  let removedChars = 0
  for (const hunk of hunks) {
    addedChars += hunk.added.length
    removedChars += hunk.removed.length
  }

  return {
    original: source,
    revised: target,
    hunks,
    segments,
    addedChars,
    removedChars,
    hasChanges: hunks.length > 0,
  }
}

/** Offset for a token boundary inside the revised text. */
export function revisedOffsetForToken(revisedTokens: string[], index: number): number {
  return tokenOffsets(revisedTokens)[Math.max(0, Math.min(index, revisedTokens.length))]
}

/**
 * Writes back only accepted hunks. Rejected or undecided hunks keep the
 * original text, so the result always has the original's length minus the
 * accepted deletions plus the accepted insertions.
 */
export function applyDiffHunks(
  original: string,
  hunks: DiffHunk[],
  acceptedHunkIds: ReadonlySet<string>,
): string {
  const ordered = [...hunks].sort((a, b) => a.originalStart - b.originalStart)
  let cursor = 0
  let output = ''
  for (const hunk of ordered) {
    const start = Math.max(cursor, Math.min(hunk.originalStart, original.length))
    const end = Math.max(start, Math.min(hunk.originalEnd, original.length))
    output += original.slice(cursor, start)
    output += acceptedHunkIds.has(hunk.id) ? hunk.added : original.slice(start, end)
    cursor = end
  }
  output += original.slice(cursor)
  return output
}

export function diffFromOriginal(
  original: string,
  revised: string,
  acceptedHunkIds: ReadonlySet<string>,
): string {
  return applyDiffHunks(original, buildTextDiff(original, revised).hunks, acceptedHunkIds)
}
