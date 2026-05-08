import { BaseAgent } from './base'
import type { AgentType } from '@/types/agent'
import type { ToolDefinition, ToolCall, ToolResult } from '@/services/provider/tools'
import type { ExtractedRelationshipEvent, RelationshipEventType, RelationshipStatus } from '@/types/relationship'
import { getRelationshipQueryTools, handleRelationshipQueryTool } from '@/services/relationship/tools'

function normalizeStatus(value: any): RelationshipStatus | undefined {
  if (value === 'active' || value === 'changed' || value === 'ended' || value === 'unknown') {
    return value
  }
  return undefined
}

function normalizeScoreDelta(value: any) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.max(-100, Math.min(100, Math.round(parsed)))
}

function normalizeEventType(value: any): RelationshipEventType {
  const allowed: RelationshipEventType[] = [
    'first_meeting',
    'cooperation',
    'conflict',
    'betrayal',
    'reconciliation',
    'revelation',
    'rescue',
    'threat',
    'promise',
    'secret_shared',
    'secret_hidden',
    'romantic_shift',
    'trust_gain',
    'trust_loss',
    'separation',
    'other',
  ]
  return allowed.includes(value) ? value : 'other'
}

export class RelationshipTrackerExpert extends BaseAgent {
  type: AgentType = 'relationshipTracker'
  name = 'Relationship Tracker'

  protected getValidationRetryLimit(): number {
    return 1
  }

  protected getTools(): ToolDefinition[] {
    return [
      ...getRelationshipQueryTools(),
      {
        name: 'record_relationship_event',
        description: 'Record a relationship change that happened in the chapter.',
        parameters: {
          type: 'object',
          properties: {
            fromName: {
              type: 'string',
              description: 'The character whose perspective or directed relationship changed.',
            },
            toName: {
              type: 'string',
              description: 'The related character.',
            },
            label: {
              type: 'string',
              description: 'Concise relationship label, such as ally, rival, mentor, suspicious of, betrayed by.',
            },
            type: {
              type: 'string',
              description: 'Categorized relationship event type.',
              enum: [
                'first_meeting',
                'cooperation',
                'conflict',
                'betrayal',
                'reconciliation',
                'revelation',
                'rescue',
                'threat',
                'promise',
                'secret_shared',
                'secret_hidden',
                'romantic_shift',
                'trust_gain',
                'trust_loss',
                'separation',
                'other',
              ],
            },
            summary: {
              type: 'string',
              description: 'Short event summary that can be shown in an event list.',
            },
            description: {
              type: 'string',
              description: 'One-sentence description of the relationship after this chapter.',
            },
            status: {
              type: 'string',
              description: 'Relationship status after the chapter.',
              enum: ['active', 'changed', 'ended', 'unknown'],
            },
            trustDelta: {
              type: 'number',
              description: 'Change in trust from -100 to 100.',
            },
            affinityDelta: {
              type: 'number',
              description: 'Change in affinity from -100 to 100.',
            },
            tensionDelta: {
              type: 'number',
              description: 'Change in tension from -100 to 100.',
            },
            evidence: {
              type: 'string',
              description: 'Brief textual evidence from the chapter.',
            },
          },
          required: ['fromName', 'toName', 'type', 'summary', 'label', 'description', 'evidence'],
        },
      },
      {
        name: 'finalize_relationship_events',
        description: 'Finalize relationship tracking for this chapter.',
        parameters: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Short summary of the relationship changes, or "No relationship changes".',
            },
          },
          required: ['summary'],
        },
      },
    ]
  }

  protected async handleToolCall(toolCall: ToolCall, context: Record<string, any>): Promise<ToolResult> {
    const relationshipResult = context.project
      ? await handleRelationshipQueryTool(toolCall, context.project)
      : null
    if (relationshipResult) return relationshipResult

    if (toolCall.name === 'record_relationship_event') {
      if (!Array.isArray(context._relationshipEvents)) {
        context._relationshipEvents = []
      }

      const args = toolCall.arguments
      const event: ExtractedRelationshipEvent = {
        fromName: String(args.fromName ?? '').trim(),
        toName: String(args.toName ?? '').trim(),
        type: normalizeEventType(args.type),
        summary: String(args.summary ?? '').trim(),
        label: String(args.label ?? '').trim(),
        description: String(args.description ?? '').trim(),
        status: normalizeStatus(args.status),
        trustDelta: normalizeScoreDelta(args.trustDelta),
        affinityDelta: normalizeScoreDelta(args.affinityDelta),
        tensionDelta: normalizeScoreDelta(args.tensionDelta),
        evidence: String(args.evidence ?? '').trim(),
      }

      if (event.fromName && event.toName && event.fromName !== event.toName) {
        context._relationshipEvents.push(event)
      }

      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, totalEvents: context._relationshipEvents.length }),
      }
    }

    if (toolCall.name === 'finalize_relationship_events') {
      context._relationshipEventsFinalized = true
      return {
        tool_call_id: toolCall.id,
        content: JSON.stringify({ success: true, totalEvents: context._relationshipEvents?.length ?? 0 }),
      }
    }

    return {
      tool_call_id: toolCall.id,
      content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
    }
  }

  protected getSystemPrompt(): string {
    return `You track relationship continuity in fiction.
Extract only relationship changes that are clearly supported by the chapter text.
Use directed relationships: if both characters' attitudes changed, record two events.
Do not invent off-page relationship changes.
Every event must have one stable event type and a compact summary suitable for an event list.
Use small deltas for subtle changes and larger deltas only for major betrayals, revelations, reconciliations, confessions, or direct conflict.
If nothing meaningful changed, call finalize_relationship_events without recording events.`
  }

  protected buildPrompt(context: Record<string, any>): string {
    const {
      chapterIndex,
      chapterNumber,
      chapterTitle,
      characters,
      chapterContent,
      project,
      language,
    } = context

    const displayChapterNumber = Number.isInteger(chapterNumber) ? chapterNumber : chapterIndex + 1
    const previousChapterIndex = Number.isInteger(chapterNumber) ? chapterNumber - 2 : chapterIndex - 1

    return `Track relationship changes for this chapter.

Chapter ${displayChapterNumber}: ${chapterTitle}
Primary language: ${language || 'English'}

Characters:
${characters}

Relationship context is intentionally not inlined to reduce prompt size.
Use relationship query tools only for the specific characters or events needed.
For prior state, query chapterIndex ${Math.max(-1, previousChapterIndex)} with character IDs from the compact directory.
${project ? '' : 'No project object is available, so relationship query tools may be unavailable.'}

Chapter text:
${chapterContent}

For each meaningful relationship change, call record_relationship_event.
Then call finalize_relationship_events.`
  }

  parseResponse(response: string): any {
    return { content: response }
  }
}
