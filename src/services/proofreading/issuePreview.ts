import { buildTextDiff } from '@/services/diff/textDiff'

export type IssueChangeRunType = 'equal' | 'removed' | 'added'

export interface IssueChangeRun {
  type: IssueChangeRunType
  text: string
}

/** Display-only diff for one proofreading issue: equal prose, removed original, added suggestion. */
export function buildIssueChangeRuns(issue: { excerpt?: string; suggestedFix?: string }): IssueChangeRun[] {
  const excerpt = (issue.excerpt ?? '').trim()
  const suggestion = (issue.suggestedFix ?? '').trim()
  if (!excerpt && !suggestion) return []
  if (!excerpt) return [{ type: 'added', text: suggestion }]
  if (!suggestion) return [{ type: 'removed', text: excerpt }]

  return buildTextDiff(excerpt, suggestion).segments.map(segment => ({
    type: segment.type === 'equal' ? 'equal' : segment.type === 'remove' ? 'removed' : 'added',
    text: segment.text,
  }))
}
