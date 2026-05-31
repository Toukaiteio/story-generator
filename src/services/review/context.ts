import type { StoryProject } from '@/types/project'
import type { Chapter } from '@/types/chapter'
import type { ChatMessage } from '@/types/provider'
import type {
  ReviewContextElement,
  MultiAgentReviewContext,
  ReviewAgentState,
  ReviewPublicMessage,
  ReviewSpeechRequest,
  ReviewEndVoteSession,
  ReviewActionVoteSession,
  ReviewAskUserSession,
} from './types'
import { elementLink } from './utils'
import { useKnowledgeStore } from '@/stores/knowledge'
import { buildKnowledgeContext, buildKnowledgeQuery } from '@/services/knowledge/context'
import { estimateTokens } from '@/services/knowledge/chunker'

const REVIEW_CONTEXT_DEFAULT_BUDGET_TOKENS = 5600

const REVIEW_ELEMENT_TOKEN_BUDGET: Record<ReviewContextElement, number> = {
  'story-config': 700,
  'master-outline': 1500,
  'characters': 1300,
  'knowledge-base': 1400,
  'selected-chapter': 500,
  'chapter-plan': 1200,
  'chapter-plan-overview': 1300,
  'chapter-draft': 1300,
}

function truncateToTokenBudget(text: string, maxTokens: number, notice = 'Content truncated to fit context budget.'): string {
  const normalized = String(text || '')
  if (!normalized.trim()) return normalized
  if (maxTokens <= 0) return `[${notice}]`
  if (estimateTokens(normalized) <= maxTokens) return normalized

  let low = 0
  let high = normalized.length
  let best = ''
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = normalized.slice(0, mid).trimEnd()
    const candidateWithNotice = `${candidate}\n\n[${notice}]`
    if (estimateTokens(candidateWithNotice) <= maxTokens) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }

  return `${best.trimEnd()}\n\n[${notice}]`
}

function buildKnowledgeReferenceContext(context: MultiAgentReviewContext) {
  const project = context.project
  if (!project) return 'No active project is selected.'
  if (!Array.isArray(project.knowledgeBaseIds) || project.knowledgeBaseIds.length === 0) {
    return 'No knowledge bases are linked to this project.'
  }

  const knowledgeStore = useKnowledgeStore()
  const linkedBases = knowledgeStore.knowledgeBases.filter(base => project.knowledgeBaseIds.includes(base.id))
  if (!linkedBases.length) return 'Linked knowledge bases were not found in local storage.'

  const withDocs = linkedBases.filter(base => base.documents.length > 0)
  if (!withDocs.length) {
    return [
      `Linked knowledge bases: ${linkedBases.map(base => base.name).join(', ')}`,
      'None of the linked bases currently has documents.',
    ].join('\n')
  }

  const chapter = context.chapter
  const knowledgeQuery = buildKnowledgeQuery({
    theme: project.theme,
    genre: project.genre,
    targetReader: project.targetReader,
    language: project.language,
    style: project.writingStyleSnapshot?.content || project.style || '',
    customRequirements: project.customRequirements,
    outline: context.outline || project.outline || '',
    chapterTitle: chapter?.title || '',
    chapterOutline: chapter ? JSON.stringify(chapter.outline) : '',
    content: chapter?.content || '',
  })
  const contextText = buildKnowledgeContext(withDocs, knowledgeQuery, 2200)
  return [
    `Linked knowledge bases: ${linkedBases.map(base => base.name).join(', ')}`,
    contextText.trim() || 'No relevant knowledge snippets were retrieved for the current meeting context.',
  ].join('\n\n')
}

function buildElementContext(context: MultiAgentReviewContext, element: ReviewContextElement) {
  const project = context.project
  const chapter = context.chapter
  if (!project) return 'No active project is selected.'

  if (element === 'chapter-plan-overview') {
    const chapters = Array.isArray(project.chapters) ? project.chapters : []
    if (!chapters.length) {
      return truncateToTokenBudget(
        `${elementLink('chapter-plan-overview', 'All Chapter Plans')}\nNo chapters exist in this project yet.`,
        REVIEW_ELEMENT_TOKEN_BUDGET['chapter-plan-overview']
      )
    }

    const lines = chapters.map((item, idx) => {
      const outline = item?.outline || {}
      const keyEvents = Array.isArray(outline.keyEvents) ? outline.keyEvents.filter(Boolean).length : 0
      const actions = Array.isArray(outline.characterActions) ? outline.characterActions.filter(Boolean).length : 0
      const reveals = Array.isArray(outline.infoReveals) ? outline.infoReveals.filter(Boolean).length : 0
      const objective = typeof outline.objective === 'string' ? outline.objective.trim() : ''
      const conflict = typeof outline.conflict === 'string' ? outline.conflict.trim() : ''
      const hook = typeof outline.endingHook === 'string' ? outline.endingHook.trim() : ''
      const hasPlan = Boolean(objective || conflict || hook || keyEvents || actions || reveals)
      return [
        `Chapter ${idx + 1}: ${item?.title?.trim() || 'Untitled'}`,
        `- id: ${item?.id || 'unknown'}`,
        `- status: ${item?.status || 'unknown'}`,
        `- plan_exists: ${hasPlan ? 'yes' : 'no'}`,
        `- objective: ${objective ? 'set' : 'empty'}`,
        `- conflict: ${conflict ? 'set' : 'empty'}`,
        `- key_events: ${keyEvents}`,
        `- character_actions: ${actions}`,
        `- info_reveals: ${reveals}`,
        `- ending_hook: ${hook ? 'set' : 'empty'}`,
      ].join('\n')
    })

    return truncateToTokenBudget(
      `${elementLink('chapter-plan-overview', 'All Chapter Plans')}\n${lines.join('\n\n')}`,
      REVIEW_ELEMENT_TOKEN_BUDGET['chapter-plan-overview']
    )
  }

  if (element === 'story-config') {
    return truncateToTokenBudget([
      `${elementLink('story-config', 'Story Configuration')}`,
      `Project: ${project.name || 'Untitled'}`,
      `Theme: ${project.theme || 'Not set'}`,
      `Genre: ${project.genre || 'Not set'}`,
      `Target Reader: ${project.targetReader || 'Not set'}`,
      `Language: ${project.language || 'English'}`,
      `Writing Format: ${project.writingFormat}`,
      `Writing Style: ${project.writingStyleSnapshot?.name || project.styleId || 'default'}`,
      `Required Elements: ${project.constraints.required.length ? project.constraints.required.join(', ') : 'None'}`,
      `Forbidden Elements: ${project.constraints.forbidden.length ? project.constraints.forbidden.join(', ') : 'None'}`,
      project.customRequirements ? `Custom Requirements: ${project.customRequirements}` : 'Custom Requirements: None',
    ].join('\n'), REVIEW_ELEMENT_TOKEN_BUDGET['story-config'])
  }

  if (element === 'master-outline') {
    return truncateToTokenBudget(
      `${elementLink('master-outline', 'Master Outline')}\n${context.outline || project.outline || 'Not set'}`,
      REVIEW_ELEMENT_TOKEN_BUDGET['master-outline']
    )
  }

  if (element === 'characters') {
    return truncateToTokenBudget(
      `${elementLink('characters', 'Characters')}\n${context.characters || 'None'}`,
      REVIEW_ELEMENT_TOKEN_BUDGET['characters']
    )
  }

  if (element === 'knowledge-base') {
    return truncateToTokenBudget(
      `${elementLink('knowledge-base', 'Knowledge Base')}\n${buildKnowledgeReferenceContext(context)}`,
      REVIEW_ELEMENT_TOKEN_BUDGET['knowledge-base']
    )
  }

  if (!chapter) return 'No chapter is selected.'

  if (element === 'selected-chapter') {
    return truncateToTokenBudget([
      `${elementLink('selected-chapter', `Chapter ${chapter.index + 1}`)}`,
      `Title: ${chapter.title || 'Untitled'}`,
      `Summary: ${chapter.summary || 'None'}`,
      `Status: ${chapter.status}`,
    ].join('\n'), REVIEW_ELEMENT_TOKEN_BUDGET['selected-chapter'])
  }

  if (element === 'chapter-draft') {
    return truncateToTokenBudget(
      `${elementLink('chapter-draft', `Chapter ${chapter.index + 1} Draft`)}\n${chapter.content?.trim() ? chapter.content : 'No draft content yet.'}`,
      REVIEW_ELEMENT_TOKEN_BUDGET['chapter-draft']
    )
  }

  return truncateToTokenBudget(
    `${elementLink('chapter-plan', `Chapter ${chapter.index + 1} Plan`)}\n${JSON.stringify(chapter.outline, null, 2)}`,
    REVIEW_ELEMENT_TOKEN_BUDGET['chapter-plan']
  )
}

export function buildProjectContext(
  context: MultiAgentReviewContext,
  elements: ReviewContextElement[],
  maxTokens = REVIEW_CONTEXT_DEFAULT_BUDGET_TOKENS
) {
  const selected: ReviewContextElement[] = elements.length
    ? elements
    : ['story-config', 'master-outline', 'characters', 'knowledge-base', 'chapter-plan']
  const header = 'Meeting Context Elements:'
  const footer = 'Reference rule: cite locations using [[element:label]] markers when possible. Short-form [[element]] references are also allowed.'
  let used = estimateTokens(`${header}\n${footer}`)
  const sections: string[] = []

  for (const element of selected) {
    const remaining = maxTokens - used
    if (remaining <= 180) {
      sections.push(`[${element}] Skipped due to context budget.`)
      continue
    }

    const elementBudget = Math.min(REVIEW_ELEMENT_TOKEN_BUDGET[element], Math.max(180, remaining))
    const section = truncateToTokenBudget(
      buildElementContext(context, element),
      elementBudget,
      `${element} context truncated to fit meeting context budget.`
    )
    sections.push(section)
    used += estimateTokens(section)
  }

  return [header, ...sections, '', footer].join('\n')
}

function formatToolEvidence(tool: ReviewPublicMessage['tool']) {
  if (!tool) return ''
  const parts: string[] = []
  parts.push(`[System: Tool '${tool.name}' executed with status '${tool.status}']`)
  if (tool.title) parts.push(`Tool title: ${tool.title}`)
  if (tool.description) parts.push(`Tool description: ${tool.description}`)
  if (tool.detail) parts.push(`Tool detail: ${tool.detail}`)
  if (tool.after && String(tool.after).trim()) {
    const raw = String(tool.after).trim()
    const clipped = raw.length > 2400 ? `${raw.slice(0, 2400)}\n[Tool output truncated]` : raw
    parts.push(`Tool output:\n${clipped}`)
  }
  return parts.join('\n')
}

export function buildAgentMessages(
  agent: ReviewAgentState,
  publicMessages: ReviewPublicMessage[],
  context: MultiAgentReviewContext,
  focus: string,
  contextElements: ReviewContextElement[],
  request?: ReviewSpeechRequest,
  options: { mandatoryBrainstorm?: boolean; openDiscussionTurnCount?: number; enabledAgentCount?: number } = {}
): ChatMessage[] {
  const isFirstOpenTurn = !options.mandatoryBrainstorm && (options.openDiscussionTurnCount || 0) <= 1
  const isProposerAgent = agent.id === 'proposer'
  const isFatigued = !options.mandatoryBrainstorm && (options.openDiscussionTurnCount || 0) >= ((options.enabledAgentCount || 0) * 2)

  const systemContent = [
    agent.customSystemPrompt || agent.systemPrompt,
    '',
    'You are participating in a public multi-agent story meeting.',
    `Meeting language: write all meeting-facing content in ${context.project?.language || 'the project Primary Language'}.`,
    'Rules:',
    '- Public chat messages are shared context. Use them to maintain a cohesive conversation.',
    '- Your private memory below belongs only to you.',
    '- Do not claim that another agent can read your private memory.',
    '- Do not claim to have edited project files or chapter data.',
    '- Do not claim to have checked chapter existence/progress unless the evidence is present in the current context (for example [[chapter-plan-overview]]) or in a read-tool result already visible in public messages.',
    '- If evidence is missing, state uncertainty explicitly and ask for context or request a read action; do not present an unverified conclusion as fact.',
    '- Story Configuration is already provided in the Meeting Context when selected. Do not repeatedly ask to re-check the full story configuration every round unless the user has changed it or a specific required field is genuinely missing.',
    '- Prefer on-demand verification over preloading large context. If cross-chapter facts are needed, call request_project_action with action=read and target=chapter-plan (scope like "all chapters" or "chapter N"), then continue after the tool result.',
    '- Your raw assistant output is private scratch space. It is NOT automatically sent to the public meeting.',
    '- To speak publicly, use the function tool send_public_message with parameter content.',
    '- You may run multiple internal tool/thinking turns before a final public statement. Use request_speech if you need another turn in your own sequence, and only call send_public_message when your conclusion is ready.',
    '- Do not copy or reveal internal instruction labels in a public message.',
    '- Modify means agree: after a voted project change is applied, it becomes accepted source-of-truth.',
    '- Tool execution is not the end of the meeting. After a tool applies a change, review the result and request ending only through request_end_meeting(reason).',
    '- If you believe the meeting is over, you MUST call request_end_meeting to start a vote. The meeting continues until everyone agrees to end or the user stops it.',
    '- Do NOT use target=consensus unless absolutely no text in the project files needs updating. If you identify a flaw in the story, you MUST propose a concrete action via request_project_action with target master-outline, chapter-plan, chapter-draft, characters, or consensus.',
    '- Proposal creation is a tool action, not a vague statement. If you conclude that a read/write action is needed, you MUST call request_project_action yourself in the same response.',
    '- If you want to publicly announce a proposal, call send_public_message with a concise announcement, then call request_project_action with the actionable payload.',
    '- Do not say "enter proposal stage", "someone should create a proposal", or "this should be voted on" without actually calling request_project_action when you already have enough information.',
    '- Do not end your public message with a question unless you are explicitly using ask_user_clarification or directly asking a specific other agent to respond next.',
    '- If you already have enough context to form a view, end with your concrete judgment, recommendation, or decision instead of a generic follow-up question.',
    '- Do NOT repeat or echo another agent\'s public message, analysis, or tool call. If another agent already called request_project_action with the same target/action/scope you were about to propose, do something different: add a new perspective, propose a different action, or wait for the tool result. Duplicating another agent\'s exact proposal wastes meeting time.',
    options.mandatoryBrainstorm
      ? '- Mandatory brainstorm phase: do not call request_project_action, request_end_meeting, or propose_focus. Use send_public_message to publish role-based analysis and directions.'
      : '- Open meeting phase: respond like a real meeting participant. Read other agents\' messages carefully. You may question, rebut, refine, combine, or support their points. Direct your message to specific agents if helpful.\n- CRITICAL: DO NOT copy, repeat, or echo the previous agent\'s message. You must add new insights, debate points, or propose a concrete action. If you agree, explain WHY from your unique perspective and push the conversation forward.',
    isFirstOpenTurn && !isProposerAgent
      ? '- THIS IS THE FIRST OPEN-DISCUSSION TURN. You may share your first reaction, but it must still be additive. Do NOT repeat earlier points verbatim. Do not call request_project_action, request_end_meeting, or propose_focus in this turn unless the user explicitly demanded immediate action.'
      : '',
    !options.mandatoryBrainstorm && !isFirstOpenTurn
      ? '- You are responding after at least one other agent has already spoken in open discussion. You MUST build on, challenge, narrow, or refine earlier messages. Do not restate the same summary in different words.'
      : '',
    !options.mandatoryBrainstorm && !isFirstOpenTurn
      ? '- Before making your point, silently identify what is missing, weak, mistaken, or still undecided in the earlier public messages. Your response should target that gap directly.'
      : '',
    isFatigued
      ? '- SYSTEM WARNING: The discussion has been going on for a long time. You MUST now converge by doing one of the following in this response: call request_project_action, call ask_user_clarification, call propose_focus, or call request_end_meeting. Do not continue open-ended discussion.'
      : '',
    isProposerAgent && !options.mandatoryBrainstorm
      ? '- As the Proposer Agent, you have priority to synthesize earlier comments into an actionable proposal. Once the discussion contains enough information, you should be the one who calls request_project_action instead of waiting for another agent.'
      : '',
    '- Tool Usage Instruction:',
    '  - Use function tools only. Do not use tagged block formats in your response.',
    '  - send_public_message(content): publish a public message.',
    '  - call_agent(target): request another agent to speak next; target can be agent id/name or "all".',
    '  - request_speech(note?): request another turn for yourself.',
    '  - propose_focus(content, reason?): suggest shifting the meeting focus.',
    '  - request_project_action(target, action, scope, purpose, content): propose a concrete read/write action on project data.',
    '  - Read examples with request_project_action:',
    '    - target=chapter-plan, action=read, scope="all chapters", content="N/A"',
    '    - target=chapter-plan, action=read, scope="chapter 2", content="N/A"',
    '  - ask_user_clarification(question, options, reason): request clarification from the user.',
    '  - request_end_meeting(reason): propose ending the meeting.',
    '',
    buildProjectContext(context, contextElements),
    '',
    `Your Private Memory:\n${agent.privateMemory.length ? agent.privateMemory.map(item => `- ${item}`).join('\n') : 'No private memory yet.'}`
  ].filter(Boolean).join('\n')

  const chatMessages: ChatMessage[] = [
    { role: 'system', content: systemContent }
  ]

  const contextPublicMessages = options.mandatoryBrainstorm
    ? publicMessages.slice(agent.lastSeenMessageIndex)
    : publicMessages

  let userBuffer: string[] = []

  // Conversation framing rule:
  // - self agent history -> assistant messages
  // - all other agent/user/system messages -> user-side context
  for (const msg of contextPublicMessages) {
    const isSelfAgentMessage = msg.role === 'agent' && msg.agentId === agent.id
    if (isSelfAgentMessage) {
      if (userBuffer.length > 0) {
        chatMessages.push({ role: 'user', content: userBuffer.join('\n\n') })
        userBuffer = []
      } else if (chatMessages.length === 1) {
        chatMessages.push({ role: 'user', content: '[System] Meeting started. Waiting for your first input.' })
      }

      const assistantContent = msg.content.replace(/^\s*\[[^\]]*?\bAgent\]\s*/i, '')

      const lastMsg = chatMessages[chatMessages.length - 1]
      if (lastMsg && lastMsg.role === 'assistant') {
        lastMsg.content += `\n\n${assistantContent}`
      } else {
        chatMessages.push({ role: 'assistant', content: assistantContent })
      }
    } else {
      const speaker = msg.role === 'agent' ? (msg.agentName || 'Agent') : msg.role === 'user' ? 'User' : 'System'
      let text = `[${speaker}] ${msg.content}`
      if (msg.tool) {
        const toolEvidence = formatToolEvidence(msg.tool)
        if (toolEvidence) text += `\n${toolEvidence}`
      }
      userBuffer.push(text)
    }
  }

  userBuffer.push(`Current Meeting Focus:\n${focus || 'Discuss the selected story context.'}`)

  if (request?.requestedBy === 'user') {
    userBuffer.push(`User Requested Your Next Turn:\n${request.userInstruction || 'The user explicitly asked you to speak next.'}`)
  } else {
    userBuffer.push('Speaking Permission: You are speaking because it is your turn in the meeting flow.')
  }

  if (options.mandatoryBrainstorm) {
    userBuffer.push('Current Phase: mandatory brainstorm. Focus on your specific role and share your initial thoughts.')
  } else {
    userBuffer.push('Current Phase: open meeting discussion. Be reactive and collaborative. Use call_agent when you need a specific reply. If you already know a read/write action is needed, call request_project_action now instead of postponing it. Do not end with a vague question when you already have enough context to state your view.')
  }

  if (userBuffer.length > 0) {
    const lastMsg = chatMessages[chatMessages.length - 1]
    if (lastMsg && lastMsg.role === 'user') {
      lastMsg.content += `\n\n${userBuffer.join('\n\n')}`
    } else {
      chatMessages.push({ role: 'user', content: userBuffer.join('\n\n') })
    }
  } else if (chatMessages[chatMessages.length - 1]?.role === 'assistant') {
    chatMessages.push({ role: 'user', content: 'Continue.' })
  }

  return chatMessages
}

export function buildEndVoteMessages(
  agent: ReviewAgentState,
  publicMessages: ReviewPublicMessage[],
  context: MultiAgentReviewContext,
  focus: string,
  contextElements: ReviewContextElement[],
  session: ReviewEndVoteSession
): ChatMessage[] {
  const visiblePublicContext = publicMessages.length
    ? publicMessages.slice(-16).map(message => {
      const speaker = message.role === 'agent' ? (message.agentName || message.agentId || 'Agent') : message.role === 'user' ? 'User' : 'System'
      return `[${speaker}] ${message.content}`
    }).join('\n\n')
    : 'No public messages yet.'

  const privateMemory = agent.privateMemory.length
    ? agent.privateMemory.map(item => `- ${item}`).join('\n')
    : 'No private memory yet.'

  return [
    {
      role: 'system',
      content: [
        agent.customSystemPrompt || agent.systemPrompt,
        '',
        'You are voting in a multi-agent story meeting end-review.',
        `Use ${context.project?.language || 'the project Primary Language'} for any user-facing wording.`,
        'The user request is the highest-priority evaluation standard.',
        'Vote yes only if the latest user request is satisfied by the current project state or accepted consensus.',
        'Vote no if the meeting merely rejected a proposal, applied a tool once, or still lacks a concrete result that satisfies the user.',
        'You must submit the vote by calling function submit_end_vote(vote, reason).',
        'Use vote=approve or vote=reject.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        buildProjectContext(context, contextElements),
        '',
        `Current Meeting Focus:\n${focus || 'No focus set.'}`,
        '',
        `End Request:\n${session.requestedByAgentName} requested ending the meeting because: ${session.reason}`,
        '',
        `Your Private Memory:\n${privateMemory}`,
        '',
        `Recent Public Meeting Messages:\n${visiblePublicContext}`,
      ].join('\n'),
    },
  ]
}

export function buildActionVoteMessages(
  agent: ReviewAgentState,
  publicMessages: ReviewPublicMessage[],
  context: MultiAgentReviewContext,
  focus: string,
  contextElements: ReviewContextElement[],
  session: ReviewActionVoteSession
): ChatMessage[] {
  const visiblePublicContext = publicMessages.length
    ? publicMessages.slice(-16).map(message => {
      const speaker = message.role === 'agent' ? (message.agentName || message.agentId || 'Agent') : message.role === 'user' ? 'User' : 'System'
      return `[${speaker}] ${message.content}`
    }).join('\n\n')
    : 'No public messages yet.'

  const privateMemory = agent.privateMemory.length
    ? agent.privateMemory.map(item => `- ${item}`).join('\n')
    : 'No private memory yet.'

  return [
    {
      role: 'system',
      content: [
        agent.customSystemPrompt || agent.systemPrompt,
        '',
        'You are voting on a proposed project-element change in a multi-agent story meeting.',
        `Use ${context.project?.language || 'the project Primary Language'} for any user-facing wording.`,
        'The user request is the highest-priority evaluation standard.',
        'Core policy: treat proposals as improvable drafts by default. The goal is to iteratively improve a proposal until it is good enough, not to wait for a perfect first version.',
        'Primary voting criterion: incremental improvement. Approve when the proposal clearly moves the project in a better direction, even if it does not fully complete every requirement yet.',
        'CRITICAL: For action=read proposals, you MUST vote approve unless the scope is completely unrelated to the current meeting focus. Read actions do not modify any project data — they only retrieve context. Rejecting a read wastes meeting time without protecting anything. If the scope is wrong, include an amendment with a better scope instead of rejecting.',
        'For action=create/update/delete, apply stricter scrutiny: ensure scope, purpose, and content are sufficient for the tool to execute. But still prefer amendment over rejection when the direction is right and only details are missing.',
        'Do not confuse character concepts with character entities. Vote for target characters only when the proposal clearly adds or updates concrete named cast members.',
        'After a proposal passes, wait for the project change tool result before treating the work as complete or requesting meeting end.',
        'Do not reject merely because the content is prose, bullets, or imperfect JSON. The project change tool will normalize approved proposals before execution.',
        'For action: read, content may be "N/A" and should not be treated as missing required information.',
        'Tool capability note: chapter-plan read supports scope "all chapters", "chapter N", and multi-chapter scopes like "chapter 1 and chapter 2".',
        'Vote no for format only when the proposal lacks enough information for the tool to infer the intended target, scope, purpose, or content.',
        'First infer what the user wants and what final effect would satisfy the user. Then judge the proposal against that goal.',
        'Vote yes if the proposal is coherent and improves user-fit, even if it is not your ideal or final solution.',
        'CRITICAL - Meeting phase voting rule: Only reject when the proposal has SEVERE ERRORS AND NO ROOM FOR IMPROVEMENT at the same time. Otherwise you MUST approve. Reject is the absolute last resort.',
        'When approving you SHOULD include an amendment to fix issues, add missing details, or adjust the direction — this keeps the process moving.',
        'If the proposal direction is correct but details are imperfect, vote YES with an amendment. Do not reject fixable proposals.',
         'If amendment is needed, include it in function submit_action_vote as amendment { action, scope, purpose, content }.',
        'Do not propose an amendment while voting on an amendment.',
        'If voting no due to insufficient actionable detail, your reason must explicitly name what information is missing.',
        'If voting no due to user-fit, your reason must include what alternative would better satisfy the user.',
        'Modify means agree: if you vote yes and the change is applied, you must treat the result as accepted source-of-truth in later turns.',
        'Do not later try to revert an applied change unless the user explicitly asks for a new change.',
         'You must submit the vote by calling function submit_action_vote(vote, reason, amendment?).',
        'Use vote=approve or vote=reject.',
         'IMPORTANT: Call submit_action_vote exactly ONCE. Do not call it multiple times. If you want to include an amendment, include it in the single call. Do not write "I vote approve" in text and then call submit_action_vote with vote=reject — your function call is the authoritative vote, not your text.',
         'If you intend to approve with an amendment, call submit_action_vote with vote="approve" and include the amendment object. Do not vote reject and expect the amendment to change the outcome.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        buildProjectContext(context, contextElements),
        '',
        `Current Meeting Focus:\n${focus || 'No focus set.'}`,
        '',
        `Change Request From ${session.requestedByAgentName}:`,
        `Target: ${session.request.target}`,
        `Action: ${session.request.action}`,
        `Scope: ${session.request.scope}`,
        `Purpose: ${session.request.purpose}`,
        `Proposed Content:\n${session.request.content}`,
        '',
        `Refinement round: ${session.refinementRound || 0}`,
        '',
        session.previousRoundRejections?.length
          ? [
              'Previous round rejection reasons (you MUST address these, not repeat the same rejection):',
              ...session.previousRoundRejections.map(r => `- ${r.agentName}: ${r.reason}`),
              'If the rejection was about missing detail, include an amendment. If the rejection was about read action being unnecessary, reconsider — read actions are harmless.',
            ].join('\n')
          : '',
        session.draft
          ? 'Draft proposal mode: this request is intentionally rough. Prefer adding one targeted amendment in submit_action_vote and voting approve when the amendment makes it better.'
          : '',
        '',
        session.amendmentDepth
          ? 'Amendment voting mode: vote on this amendment only. Do not propose another amendment.'
          : 'Original proposal voting mode: you may include one amendment object if a targeted modify/delete/insert would make the proposal better satisfy the user.',
        '',
        `Your Private Memory:\n${privateMemory}`,
        '',
        `Recent Public Meeting Messages:\n${visiblePublicContext}`,
      ].join('\n'),
    },
  ]
}

export function buildAskUserVoteMessages(
  agent: ReviewAgentState,
  publicMessages: ReviewPublicMessage[],
  context: MultiAgentReviewContext,
  session: ReviewAskUserSession
): ChatMessage[] {
  const recent = publicMessages.slice(-12).map(message => {
    const speaker = message.role === 'agent' ? (message.agentName || 'Agent') : message.role === 'user' ? 'User' : 'System'
    return `[${speaker}] ${message.content}`
  }).join('\n\n') || 'No public messages yet.'
  return [
    {
      role: 'system',
      content: [
        agent.customSystemPrompt || agent.systemPrompt,
        '',
        'You are voting on whether the meeting should ask the user for clarification.',
        `Use ${context.project?.language || 'the project Primary Language'} for any user-facing wording.`,
        'Vote yes only if the question is necessary to avoid a wrong edit or wrong direction.',
        'Vote no if agents can reasonably proceed from existing project context and user messages.',
        'You must submit the vote by calling function submit_ask_user_vote(vote, reason).',
        'Use vote=approve or vote=reject.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        buildProjectContext(context, ['story-config', 'master-outline', 'characters', 'knowledge-base', 'chapter-plan']),
        '',
        `Clarification request from ${session.requestedByAgentName}:`,
        `Question: ${session.request.question}`,
        `Options:\n${session.request.options.map(option => `- ${option}`).join('\n')}`,
        `Reason: ${session.request.reason}`,
        '',
        `Recent public messages:\n${recent}`,
      ].join('\n'),
    },
  ]
}

export function buildSkillAgentMessages(
  session: ReviewActionVoteSession,
  context: MultiAgentReviewContext,
  contextElements: ReviewContextElement[]
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the internal Project Change Tool skill agent.',
        'Capabilities: planning, analysis, execution preparation, and verification.',
        'Your job is to normalize an approved meeting proposal into a safe executable project change.',
        'Do not reject because of imperfect proposal format. Infer the intended structure from scope, purpose, content, and project context.',
        'Distinguish character concepts from character entities. Only output target characters when the proposal clearly intends to add or update concrete named cast members.',
        'Do not turn abstract roles, themes, relationship concepts, or outline-only mentions into character entities.',
        'For each executable change, plan the intent, analyze the affected project element, prepare normalized content, and include a verification summary.',
        'Prefer valid JSON with this shape, but if impossible return clear structured prose; the local tool will still infer from it:',
        '{ "target": "master-outline|chapter-plan|chapter-draft|characters|consensus", "action": "create|read|update|delete", "scope": "...", "purpose": "...", "content": ..., "verification": "..." }',
        'For target characters, content can be an array of character objects, bullets, or prose listing names and traits.',
        'For target chapter-plan, content must be an object with optional title and outline fields or the outline fields directly.',
        'For target chapter-draft, content must be the complete replacement draft text for the selected chapter.',
        'For target master-outline or consensus, content can be a string.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        buildProjectContext(context, contextElements),
        '',
        'Approved Proposal:',
        `Target: ${session.request.target}`,
        `Action: ${session.request.action}`,
        `Scope: ${session.request.scope}`,
        `Purpose: ${session.request.purpose}`,
        `Content:\n${session.request.content}`,
      ].join('\n'),
    },
  ]
}
