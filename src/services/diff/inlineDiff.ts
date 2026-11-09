import type { DiffDecision, DiffReview } from './review'

/** Unchanged prose lines kept around each pending hunk before the toolbar jumps in. */
export const INLINE_DIFF_CONTEXT_LINES = 2

export type InlineDiffRunType = 'text' | 'removed' | 'added'

export interface InlineDiffRun {
  type: InlineDiffRunType
  text: string
  hunkId?: string
}

export interface InlineDiffParagraph {
  runs: InlineDiffRun[]
  hunkIds: string[]
}

export interface InlineDiffPlacement {
  id: string
  firstParagraph: number
  lastParagraph: number
  /** First unchanged paragraph line that should stay visible above the hunk. */
  contextStart: number
  /** Last unchanged paragraph line that should stay visible below the hunk. */
  contextEnd: number
}

export interface InlineDiffLayout {
  paragraphs: InlineDiffParagraph[]
  placements: Record<string, InlineDiffPlacement>
  /** Pending hunk ids in document order; the toolbar walks this list. */
  pendingIds: string[]
}

export interface InlineDiffInput {
  /** Chapter text frozen when the review opened. */
  base: string
  start: number
  end: number
  review: Pick<DiffReview, 'original' | 'diff' | 'decisions'>
}

function decisionFor(input: InlineDiffInput, hunkId: string): DiffDecision {
  return input.review.decisions[hunkId] ?? 'pending'
}

function resolveRange(base: string, start: number, end: number, original: string): { from: number; to: number } {
  const from = Math.max(0, Math.min(start, base.length))
  const to = Math.max(from, Math.min(end, base.length))
  if (base.slice(from, to) === original) return { from, to }
  if (!original) return { from, to }
  const found = base.indexOf(original)
  if (found < 0) return { from, to }
  return { from: found, to: found + original.length }
}

function appendRun(paragraphs: InlineDiffParagraph[], run: InlineDiffRun): void {
  if (!run.text) return
  const lines = run.text.split('\n')
  for (let index = 0; index < lines.length; index++) {
    if (index > 0) paragraphs.push({ runs: [], hunkIds: [] })
    const line = lines[index]
    if (!line) {
      if (run.hunkId) {
        const paragraph = paragraphs[paragraphs.length - 1]
        if (!paragraph.hunkIds.includes(run.hunkId)) paragraph.hunkIds.push(run.hunkId)
      }
      continue
    }
    const paragraph = paragraphs[paragraphs.length - 1]
    const last = paragraph.runs[paragraph.runs.length - 1]
    if (last && last.type === run.type && last.hunkId === run.hunkId) {
      last.text += line
    } else {
      paragraph.runs.push({ ...run, text: line })
    }
    if (run.hunkId && !paragraph.hunkIds.includes(run.hunkId)) paragraph.hunkIds.push(run.hunkId)
  }
}

/**
 * Maps a frozen review onto chapter text for inline rendering. Equal text stays
 * normal prose; a pending hunk contributes its removed text then its added text
 * at the original position. Accepted hunks render as plain added prose and
 * rejected hunks as plain original prose, so a decided hunk immediately looks
 * like the rest of the chapter.
 */
export function buildInlineDiffLayout(input: InlineDiffInput): InlineDiffLayout {
  const base = typeof input.base === 'string' ? input.base : ''
  const original = typeof input.review.original === 'string' ? input.review.original : ''
  const range = resolveRange(base, input.start, input.end, original)

  const paragraphs: InlineDiffParagraph[] = [{ runs: [], hunkIds: [] }]
  if (range.from > 0) appendRun(paragraphs, { type: 'text', text: base.slice(0, range.from) })

  for (const segment of input.review.diff.segments) {
    if (segment.type === 'equal') {
      appendRun(paragraphs, { type: 'text', text: segment.text })
      continue
    }
    const decision = decisionFor(input, segment.hunkId)
    if (segment.type === 'remove') {
      if (decision === 'pending') appendRun(paragraphs, { type: 'removed', text: segment.text, hunkId: segment.hunkId })
      if (decision === 'rejected') appendRun(paragraphs, { type: 'text', text: segment.text })
      continue
    }
    if (decision === 'pending') appendRun(paragraphs, { type: 'added', text: segment.text, hunkId: segment.hunkId })
    if (decision === 'accepted') appendRun(paragraphs, { type: 'text', text: segment.text })
  }

  if (range.to < base.length) appendRun(paragraphs, { type: 'text', text: base.slice(range.to) })

  const placements: Record<string, InlineDiffPlacement> = {}
  const pendingIds: string[] = []
  for (const hunk of input.review.diff.hunks) {
    const first = paragraphs.findIndex(paragraph => paragraph.hunkIds.includes(hunk.id))
    if (first < 0) continue
    let last = first
    for (let index = first + 1; index < paragraphs.length; index++) {
      if (paragraphs[index].hunkIds.includes(hunk.id)) last = index
    }
    let contextStart = first
    let seen = 0
    for (let index = first - 1; index >= 0 && seen < INLINE_DIFF_CONTEXT_LINES; index--) {
      if (paragraphs[index].hunkIds.length) break
      seen += 1
      contextStart = index
    }
    let contextEnd = last
    seen = 0
    for (let index = last + 1; index < paragraphs.length && seen < INLINE_DIFF_CONTEXT_LINES; index++) {
      if (paragraphs[index].hunkIds.length) break
      seen += 1
      contextEnd = index
    }
    placements[hunk.id] = { id: hunk.id, firstParagraph: first, lastParagraph: last, contextStart, contextEnd }
    if (decisionFor(input, hunk.id) === 'pending') pendingIds.push(hunk.id)
  }

  return { paragraphs, placements, pendingIds }
}
