import type { ReviewPublicMessage } from './types'
import { createId } from './definitions'

export function normalizePublicMessage(raw: any): ReviewPublicMessage | null {
  if (!raw || typeof raw !== 'object') return null
  const role = raw.role === 'user' || raw.role === 'agent' || raw.role === 'system' ? raw.role : 'system'
  const content = String(raw.content ?? '').trim()
  if (!content) return null
  return {
    id: String(raw.id || createId('msg')),
    role,
    agentId: typeof raw.agentId === 'string' ? raw.agentId : undefined,
    agentName: typeof raw.agentName === 'string' ? raw.agentName : undefined,
    content,
    tool: raw.tool && typeof raw.tool === 'object' ? raw.tool : undefined,
    actionVoteSnapshot: raw.actionVoteSnapshot && typeof raw.actionVoteSnapshot === 'object' ? raw.actionVoteSnapshot : undefined,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  }
}

export function toStoredMessages(messages: ReviewPublicMessage[]) {
  return messages.map(message => ({
    id: message.id,
    role: message.role === 'agent' ? 'assistant' as const : message.role,
    content: JSON.stringify(message),
    timestamp: message.createdAt,
  }))
}

export function fromStoredMessages(messages: any[]) {
  return (messages || [])
    .map((message: any) => {
      try {
        const parsed = JSON.parse(String(message.content ?? ''))
        if (message.role === 'assistant') parsed.role = 'agent'
        return normalizePublicMessage(parsed)
      } catch {
        const role = message.role === 'assistant' ? 'agent' : message.role
        const validRole = role === 'user' || role === 'agent' || role === 'system' ? role : 'system'
        return normalizePublicMessage({
          id: message.id,
          role: validRole,
          content: message.content,
          createdAt: message.timestamp,
        })
      }
    })
    .filter(Boolean) as ReviewPublicMessage[]
}
