import { getRelationshipQueryTools } from '@/services/relationship/tools'
import type { ToolDefinition } from '@/services/provider'
import type { ChapterAuditIssue } from './types'

export function getChapterIssueReportTool(): ToolDefinition {
  return {
    name: 'report_chapter_issues',
    description: 'Report concrete issues found in the chapter after checking it against plan, characters, relationships, continuity, and factual logic.',
    parameters: {
      type: 'object',
      properties: {
        issues: {
          type: 'array',
          description: 'Concrete issues found in the current chapter. Return an empty array if no issues are found.',
          items: {
            type: 'object',
            properties: {
              severity: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: 'How serious the issue is.',
              },
              category: {
                type: 'string',
                enum: ['chapter_plan', 'character', 'relationship', 'continuity', 'factual', 'logic', 'style'],
                description: 'The issue category.',
              },
              title: {
                type: 'string',
                description: 'A short issue title.',
              },
              excerpt: {
                type: 'string',
                description: 'The shortest exact excerpt from the chapter that demonstrates the issue. Leave empty only if no exact excerpt exists.',
              },
              explanation: {
                type: 'string',
                description: 'Why this is inconsistent, implausible, or unsupported.',
              },
              suggestedFix: {
                type: 'string',
                description: 'A concrete fix instruction that Vibe AI can apply.',
              },
            },
            required: ['severity', 'category', 'title', 'explanation', 'suggestedFix'],
          },
        },
      },
      required: ['issues'],
    },
  }
}

export function getProofreadingTools(): ToolDefinition[] {
  return [
    ...getRelationshipQueryTools(),
    {
      name: 'report_proofreading_issues',
      description: 'Report concrete grammar, typo, style, and consistency issues found in the chapter.',
      parameters: {
        type: 'object',
        properties: {
          issues: {
            type: 'array',
            description: 'List of specific issues found. Return an empty array if no issues are found.',
            items: {
              type: 'object',
              properties: {
                severity: {
                  type: 'string',
                  enum: ['low', 'medium', 'high'],
                  description: 'How serious the issue is.',
                },
                category: {
                  type: 'string',
                  enum: ['grammar', 'typo', 'style', 'consistency', 'pacing', 'logic'],
                  description: 'The issue category.',
                },
                title: {
                  type: 'string',
                  description: 'A short issue title.',
                },
                excerpt: {
                  type: 'string',
                  description: 'The exact excerpt from the text that contains the issue.',
                },
                explanation: {
                  type: 'string',
                  description: 'Why this is an issue.',
                },
                suggestedFix: {
                  type: 'string',
                  description: 'Specific instruction on how to fix this issue.',
                },
              },
              required: ['severity', 'category', 'title', 'excerpt', 'explanation', 'suggestedFix'],
            },
          },
        },
        required: ['issues'],
      },
    },
  ]
}

export function getEditingAuditSystemPrompt() {
  return [
    'You are Editing AI. Audit the current chapter against the supplied chapter plan, characters, relationship state, and story context.',
    'The prompt intentionally includes only compact character and relationship context.',
    'Use get_character_profile and relationship query tools for specific facts before reporting relationship or character consistency issues.',
    'Focus on concrete contradictions, unsupported facts, chronology errors, relationship inconsistencies, missing plan beats, logic problems, and factual implausibility inside the story world.',
    'Use report_chapter_issues. Do not return free-form prose.',
    'Do not invent problems. If the chapter is coherent, report an empty issues array.',
  ].join('\n')
}

export function getProofreadingSystemPrompt() {
  return [
    'You are a Proofreading Expert. Your job is to audit a chapter for grammar, typos, consistency, pacing, and logical flow errors through tools.',
    'You are not a rewriting agent. Do not return corrected prose, markdown reports, JSON text, bullet lists, or explanations in assistant text.',
    'Your final response for each submitted segment must be a tool call to report_proofreading_issues.',
    'Focus on:',
    '- Grammatical errors, typos, and punctuation issues.',
    '- Consistency in character names, descriptions, and behaviors.',
    '- Timeline and logical consistency within the chapter.',
    '- Narrative pacing and prose style.',
    'The prompt intentionally includes only compact character and relationship context.',
    'Use get_character_profile and relationship query tools for specific facts before reporting character or relationship consistency issues.',
    'Use report_proofreading_issues to report concrete findings. Assistant text is invalid.',
    'Do not invent problems. If the current segment is sound, call report_proofreading_issues with {"issues": []}.',
  ].join('\n')
}

export function mapEditingAuditIssues(rawIssues: any[]): ChapterAuditIssue[] {
  return rawIssues.map((issue, index) => ({
    id: `issue-${Date.now()}-${index}`,
    severity: issue?.severity === 'high' || issue?.severity === 'medium' || issue?.severity === 'low' ? issue.severity : 'medium',
    category: ['chapter_plan', 'character', 'relationship', 'continuity', 'factual', 'logic', 'style'].includes(issue?.category) ? issue.category : 'logic',
    title: String(issue?.title ?? `Issue ${index + 1}`).trim(),
    excerpt: String(issue?.excerpt ?? '').trim(),
    explanation: String(issue?.explanation ?? '').trim(),
    suggestedFix: String(issue?.suggestedFix ?? '').trim(),
  })).filter(issue => issue.title && issue.explanation && issue.suggestedFix)
}

export function mapProofreadingIssues(rawIssues: any[]): ChapterAuditIssue[] {
  return rawIssues.map((issue, index) => ({
    id: `issue-${Date.now()}-${index}`,
    severity: issue?.severity === 'high' || issue?.severity === 'medium' || issue?.severity === 'low' ? issue.severity : 'medium',
    category: (['grammar', 'typo', 'style', 'consistency', 'pacing', 'logic'].includes(issue?.category) ? issue.category : 'grammar') as any,
    title: String(issue?.title ?? `Issue ${index + 1}`).trim(),
    excerpt: String(issue?.excerpt ?? '').trim(),
    explanation: String(issue?.explanation ?? '').trim(),
    suggestedFix: String(issue?.suggestedFix ?? '').trim(),
  })).filter(issue => issue.title && issue.explanation && issue.suggestedFix)
}

export function getChapterRegion(content: string, args: Record<string, any>) {
  const mode = args?.mode
  const start = Math.max(1, Math.trunc(Number(args?.start)))
  const end = Math.max(start, Math.trunc(Number(args?.end ?? start)))
  if (!content.trim()) {
    return {
      ok: true,
      warning: 'Current chapter content is empty. Returning an empty region.',
      mode,
      start: Number.isFinite(start) ? start : 1,
      end: Number.isFinite(end) ? end : Number.isFinite(start) ? start : 1,
      total: 0,
      label: 'Empty chapter',
      content: '',
    }
  }
  if (!Number.isFinite(start) || start < 1) return { ok: false, error: 'start must be a positive one-based index.' }

  const sliceItems = (items: string[], label: string) => {
    if (start > items.length) {
      return { ok: false, error: `${label} ${start} is outside the available range 1-${items.length}.` }
    }
    const selected = items.slice(start - 1, Math.min(end, items.length))
    return {
      ok: true,
      mode,
      start,
      end: Math.min(end, items.length),
      total: items.length,
      label: `${label} ${start}-${Math.min(end, items.length)}`,
      content: selected.join(mode === 'lines' ? '\n' : '\n\n'),
    }
  }

  if (mode === 'lines') {
    return sliceItems(content.split(/\r?\n/), 'Lines')
  }
  if (mode === 'paragraphs') {
    return sliceItems(content.split(/\n\s*\n/).map(item => item.trim()).filter(Boolean), 'Paragraphs')
  }
  if (mode === 'sections') {
    const sections = content
      .split(/(?=^#{1,6}\s+.+$)/m)
      .map(item => item.trim())
      .filter(Boolean)
    return sliceItems(sections.length ? sections : content.split(/\n\s*\n/).map(item => item.trim()).filter(Boolean), 'Sections')
  }

  return { ok: false, error: 'mode must be one of: lines, paragraphs, sections.' }
}
