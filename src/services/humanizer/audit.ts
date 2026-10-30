import { HUMANIZER_RULES, type HumanizerMatch, type HumanizerSeverity } from './rules'

export interface HumanizerIssue {
  ruleId: string
  label: string
  severity: HumanizerSeverity
  excerpt: string
  advice: string
}

export interface HumanizerAudit {
  issues: HumanizerIssue[]
  counts: Record<HumanizerSeverity, number>
  score: number
  blocking: boolean
}

const SEVERITY_WEIGHT: Record<HumanizerSeverity, number> = { high: 12, medium: 5, low: 2 }
const MAX_PER_RULE = 2
const MAX_TOTAL = 40

export function auditHumanText(text: string): HumanizerAudit {
  const source = text.trim()
  const issues: HumanizerIssue[] = []
  const counts: Record<HumanizerSeverity, number> = { high: 0, medium: 0, low: 0 }

  if (source) {
    for (const rule of HUMANIZER_RULES) {
      let matches: HumanizerMatch[] = []
      try {
        matches = rule.detect(source)
      } catch {
        matches = []
      }
      for (const match of matches.slice(0, MAX_PER_RULE)) {
        issues.push({
          ruleId: rule.id,
          label: rule.label,
          severity: rule.severity,
          excerpt: match.excerpt,
          advice: rule.advice,
        })
        counts[rule.severity]++
        if (issues.length >= MAX_TOTAL) break
      }
      if (issues.length >= MAX_TOTAL) break
    }
  }

  const score = Math.max(0, Math.min(100,
    100 - counts.high * SEVERITY_WEIGHT.high - counts.medium * SEVERITY_WEIGHT.medium - counts.low * SEVERITY_WEIGHT.low,
  ))

  return { issues, counts, score, blocking: counts.high > 0 }
}

export function formatAuditForPrompt(audit: HumanizerAudit, limit = 10): string {
  if (!audit.issues.length) return ''
  const lines = audit.issues
    .slice(0, limit)
    .map(issue => `- [${issue.ruleId}] "${issue.excerpt}" → ${issue.advice}`)
  return `Detected AI-writing tells:\n${lines.join('\n')}`
}

export function summarizeAudit(audit: HumanizerAudit): string {
  const { high, medium, low } = audit.counts
  return `humanizer score ${audit.score}/100 (high ${high}, medium ${medium}, low ${low})`
}
