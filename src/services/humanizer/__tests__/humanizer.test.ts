import { describe, expect, it } from 'vitest'
import { auditHumanText, formatAuditForPrompt } from '../audit'
import { buildHumanizerDirective, withHumanizer } from '../directives'
import { chunkForHumanize } from '../chunk'

describe('humanizer audit', () => {
  it('passes clean concrete prose', () => {
    const audit = auditHumanText(
      'Mara counted the coins twice. Twelve, not thirteen. She put three back in the tin and left the rest on the table.',
    )
    expect(audit.issues).toEqual([])
    expect(audit.score).toBe(100)
    expect(audit.blocking).toBe(false)
  })

  it('flags the strongest AI tells as blocking', () => {
    const audit = auditHumanText(
      'Great question! It is not just a map, it is a promise. At its core, this marks a pivotal moment in the story. I hope this helps!',
    )
    const ids = audit.issues.map(issue => issue.ruleId)
    expect(ids).toContain('chatbot-residue')
    expect(ids).toContain('not-x-but-y')
    expect(ids).toContain('staged-runup')
    expect(ids).toContain('inflated-significance')
    expect(audit.blocking).toBe(true)
    expect(audit.score).toBeLessThan(100)
  })

  it('detects style patterns without blocking', () => {
    const audit = auditHumanText(
      'The hall was silent — she listened. She listened. She listened. She listened. The room was high-quality.\n\nShe said “come in” and waited.',
    )
    const ids = audit.issues.map(issue => issue.ruleId)
    expect(ids).toContain('dash-overuse')
    expect(ids).toContain('repeated-opening')
    expect(ids).toContain('curly-quotes')
    expect(ids).toContain('hyphen-after-copula')
    expect(audit.blocking).toBe(false)
  })

  it('detects shallow -ing riders, sales language, and vague sources', () => {
    const audit = auditHumanText(
      'The town is nestled in a breathtaking valley, showcasing its vibrant market, reflecting a rich heritage. Experts believe the market matters.',
    )
    const ids = audit.issues.map(issue => issue.ruleId)
    expect(ids).toContain('sales-language')
    expect(ids).toContain('shallow-ing')
    expect(ids).toContain('vague-source')
  })

  it('formats findings for a repair prompt', () => {
    const audit = auditHumanText('It is not just a tool, it is a mirror.')
    const text = formatAuditForPrompt(audit)
    expect(text).toContain('Detected AI-writing tells')
    expect(text).toContain('not-x-but-y')
  })
})

describe('humanizer directive', () => {
  it('carries the core rules and formatting constraints', () => {
    const directive = buildHumanizerDirective({ mode: 'fiction' })
    expect(directive).toContain('State the point directly')
    expect(directive).toContain('Not X but Y')
    expect(directive).toContain('em dashes')
    expect(directive).toContain('never present an invented detail as real-world fact')
  })

  it('uses a voice sample when provided', () => {
    const directive = buildHumanizerDirective({ voiceSample: 'She walked. She stopped.' })
    expect(directive).toContain('Match this writing sample')
    expect(directive).toContain('She walked. She stopped.')
  })

  it('appends the directive to a prompt', () => {
    const prompt = withHumanizer('Write the scene.')
    expect(prompt.startsWith('Write the scene.')).toBe(true)
    expect(prompt).toContain('Human prose rules')
  })
})

describe('humanize chunking', () => {
  it('keeps short prose in one chunk', () => {
    expect(chunkForHumanize('One paragraph.')).toEqual(['One paragraph.'])
  })

  it('splits on paragraph boundaries near the limit', () => {
    const paragraph = 'A'.repeat(40)
    const text = Array.from({ length: 8 }, () => paragraph).join('\n\n')
    const chunks = chunkForHumanize(text, 120)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(160)
    expect(chunks.join('\n\n').replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''))
  })

  it('hard-splits an oversized paragraph', () => {
    const text = 'Sentence one. '.repeat(80).trim()
    const chunks = chunkForHumanize(text, 100)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(140)
  })
})
