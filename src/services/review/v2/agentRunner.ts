/**
 * Meeting v2 — Agent Runner (Master-Worker)
 *
 * Two modes:
 * - runSubAgentAnalysis: reviewer produces a short specialist report (no tools needed)
 * - runMasterTurn: master reads all reports + context, outputs a structured action
 */

import { providerManager } from '@/services/provider'
import type { ToolDefinition } from '@/services/provider'
import type { FunctionCallingResponse } from '@/services/provider/tools'
import { decodeProviderModelRef } from '@/services/provider/catalog'
import { fitMessagesToContextSmart } from '@/services/context'
import { buildProjectContext } from '@/services/review/context'
import { stripReasoningText } from '@/services/review/utils'
import type { ChatMessage } from '@/types/provider'
import type { ProviderModelRef } from '@/types/provider'
import type {
  AgentIntent,
  AgentState,
  AgentTurnResult,
  ChangeRequest,
  ChangeTarget,
  ChangeAction,
  ContextElement,
  MeetingContext,
  MeetingMessage,
} from './types'

// ─── Tools (master only) ──────────────────────────────────────────────────────

const MASTER_TOOLS: ToolDefinition[] = [
  {
    name: 'execute_action',
    description: 'Execute a concrete project change immediately.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['master-outline', 'chapter-plan', 'characters', 'consensus'] },
        action: { type: 'string', enum: ['create', 'read', 'update', 'delete'] },
        scope: { type: 'string', description: 'What specifically to change.' },
        purpose: { type: 'string', description: 'Why this change is needed.' },
        content: { type: 'string', description: 'The new content. For chapter-plan use JSON: {"objective":"...","conflict":"...","keyEvents":[...],"characterActions":[...],"infoReveals":[...],"endingHook":"..."}' },
      },
      required: ['target', 'action', 'scope', 'purpose', 'content'],
    },
  },
  {
    name: 'ask_user',
    description: 'Ask the user a clarification question before acting.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: { type: 'array', items: { type: 'string' } },
        reason: { type: 'string' },
      },
      required: ['question', 'options', 'reason'],
    },
  },
  {
    name: 'end_meeting',
    description: 'End the meeting when the goal is fully achieved.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string' } },
      required: ['reason'],
    },
  },
  {
    name: 'send_message',
    description: 'Send a public message to the user without taking action.',
    parameters: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
    },
  },
]

export interface ProviderStoreLike {
  providers: any[]
  getAvailableModelRefForRole: (role: any, preferred?: ProviderModelRef | null) => ProviderModelRef | null
  getDefaultModelRefForRole: (role: any) => ProviderModelRef | null
}

// ─── Sub-agent analysis ───────────────────────────────────────────────────────

/**
 * Sub-agent produces a short specialist analysis report.
 * Returns plain text — no tool calls needed.
 */
export async function runSubAgentAnalysis(
  agent: AgentState,
  messages: MeetingMessage[],
  context: MeetingContext,
  focus: string,
  contextElements: ContextElement[],
  providerStore: ProviderStoreLike,
  signal?: AbortSignal,
): Promise<string> {
  providerManager.setProviders(providerStore.providers)
  const preferred = decodeProviderModelRef(agent.modelValue)
  const model =
    providerStore.getAvailableModelRefForRole(agent.defaultModelRole, preferred) ??
    providerStore.getAvailableModelRefForRole('chapterPlanner') ??
    providerStore.getAvailableModelRefForRole('proofreader') ??
    providerStore.getDefaultModelRefForRole(agent.defaultModelRole)
  if (!model) return ''

  const projectContext = buildProjectContext(context as any, contextElements as any)
  const lang = context.project?.language || 'the project Primary Language'
  const recentHistory = messages.slice(-10).map(m =>
    m.role === 'user' ? `User: ${m.content}` : m.role === 'agent' ? `[${m.agentName}]: ${m.content}` : m.content
  ).join('\n')

  const chatMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        agent.customSystemPrompt || agent.systemPrompt,
        `Language: ${lang}.`,
        'You are a specialist analyst. Provide a concise analysis report (3-6 sentences) from your role perspective.',
        'Focus on: what is the most important issue or opportunity, and what concrete change would best address it.',
        'Be specific — name exact chapters, characters, or outline elements.',
        'Do NOT ask questions. Do NOT propose vague directions. Output your analysis directly.',
      ].join('\n'),
    },
    { role: 'user', content: `${projectContext}\n\nFocus: ${focus}\n\nRecent discussion:\n${recentHistory || 'None.'}\n\nYour specialist analysis:` },
  ]

  const compressed = fitMessagesToContextSmart(chatMessages, providerManager.getModelConfigForRef(model)?.model.contextTokens, 800)
  const response = await providerManager.chat(
    compressed.compressed ? compressed.messages : chatMessages,
    model,
    800,
    0.4,
    signal,
  )
  return stripReasoningText(response).trim()
}

// ─── Master turn ──────────────────────────────────────────────────────────────

/**
 * Master agent reads all sub-agent reports and project context,
 * then directly outputs a structured action via tool call.
 */
export async function runMasterTurn(
  master: AgentState,
  subAgentReports: Array<{ agentName: string; report: string }>,
  messages: MeetingMessage[],
  context: MeetingContext,
  focus: string,
  contextElements: ContextElement[],
  providerStore: ProviderStoreLike,
  turnInstruction: string,
  signal?: AbortSignal,
): Promise<AgentTurnResult> {
  providerManager.setProviders(providerStore.providers)
  const preferred = decodeProviderModelRef(master.modelValue)
  const model =
    providerStore.getAvailableModelRefForRole(master.defaultModelRole, preferred) ??
    providerStore.getAvailableModelRefForRole('chapterPlanner') ??
    providerStore.getDefaultModelRefForRole(master.defaultModelRole)

  if (!model) {
    return { agentId: master.id, agentName: master.name, publicMessage: null, intent: null, privateNote: 'No model.' }
  }

  const projectContext = buildProjectContext(context as any, contextElements as any)
  const lang = context.project?.language || 'the project Primary Language'
  const reportsText = subAgentReports.length
    ? subAgentReports.map(r => `[${r.agentName}]\n${r.report}`).join('\n\n')
    : 'No sub-agent reports available.'
  const recentHistory = messages.slice(-8).map(m =>
    m.role === 'user' ? `User: ${m.content}` : m.role === 'agent' ? `[${m.agentName}]: ${m.content}` : m.content
  ).join('\n')

  const chatMessages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        master.customSystemPrompt || master.systemPrompt,
        `Language: ${lang}.`,
        'You are the Master Agent. You have read specialist reports from your team.',
        'Your job: decide the single most impactful action and execute it immediately using execute_action.',
        'Rules:',
        '- Call execute_action with complete, structured content. For chapter-plan, content MUST be valid JSON.',
        '- For chapter-plan JSON use: {"objective":"...","conflict":"...","keyEvents":["..."],"characterActions":["..."],"infoReveals":["..."],"endingHook":"..."}',
        '- For master-outline, content is a plain string with the full updated outline.',
        '- For characters, content is a JSON array: [{"name":"...","role":"...","description":"..."}]',
        '- If you need user input before acting, call ask_user.',
        '- If the meeting goal is fully achieved, call end_meeting.',
        '- You may call send_message to explain your decision to the user.',
        '- Do NOT produce vague descriptions. The content field must be the actual new value to write.',
        turnInstruction,
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: [
        projectContext,
        '',
        `Focus: ${focus}`,
        '',
        'Specialist reports:',
        reportsText,
        '',
        recentHistory ? `Recent conversation:\n${recentHistory}` : '',
        '',
        'Now decide and act. Call execute_action with complete content.',
      ].filter(Boolean).join('\n'),
    },
  ]

  const compressed = fitMessagesToContextSmart(chatMessages, providerManager.getModelConfigForRef(model)?.model.contextTokens, 2000)
  const toolResponse = await providerManager.chatWithTools(
    compressed.compressed ? compressed.messages : chatMessages,
    model,
    MASTER_TOOLS,
    2400,
    0.3,
    { toolChoice: 'required' },
    signal,
  )

  return parseMasterResponse(master, toolResponse)
}

// ─── Parse master response ────────────────────────────────────────────────────

function parseMasterResponse(master: AgentState, toolResponse: FunctionCallingResponse): AgentTurnResult {
  const clean = stripReasoningText(toolResponse.content ?? '')
  let publicMessage: string | null = null
  let intent: AgentIntent | null = null

  for (const call of toolResponse.tool_calls) {
    const args = call.arguments || {}
    if (call.name === 'execute_action') {
      const req = parseChangeRequest(args)
      if (req) intent = { type: 'propose_action', request: req }
    } else if (call.name === 'ask_user') {
      const question = s(args.question)
      const options = Array.isArray(args.options) ? args.options.map(s).filter(Boolean) : []
      const reason = s(args.reason)
      if (question && options.length >= 2 && reason) {
        intent = { type: 'ask_user', question, options, reason }
      }
    } else if (call.name === 'end_meeting') {
      const reason = s(args.reason)
      if (reason) intent = { type: 'request_end', reason }
    } else if (call.name === 'send_message') {
      const msg = s(args.content)
      if (msg) publicMessage = msg
    }
  }

  // Fallback: no tool calls but has content
  if (!publicMessage && !intent && toolResponse.tool_calls.length === 0 && clean.trim()) {
    publicMessage = clean.trim()
  }

  return {
    agentId: master.id,
    agentName: master.name,
    publicMessage,
    intent,
    privateNote: clean.slice(0, 700),
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function s(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function parseChangeRequest(args: Record<string, any>): ChangeRequest | null {
  const validTargets: ChangeTarget[] = ['master-outline', 'chapter-plan', 'characters', 'consensus']
  const target = s(args.target) as ChangeTarget
  if (!validTargets.includes(target)) return null
  const action = normalizeAction(s(args.action))
  const scope = s(args.scope)
  const purpose = s(args.purpose)
  const content = s(args.content) || (action === 'read' ? 'N/A' : '')
  if (!scope || !purpose || !content) return null
  return { target, action, scope, purpose, content }
}

function normalizeAction(raw: string): ChangeAction {
  if (raw === 'create' || raw === 'read' || raw === 'update' || raw === 'delete') return raw
  return 'update'
}
