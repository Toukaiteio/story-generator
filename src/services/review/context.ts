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
  ReviewChangeVoteSession,
  ReviewAskUserSession,
} from './types'
import { elementLink } from './utils'

function buildElementContext(context: MultiAgentReviewContext, element: ReviewContextElement) {
  const project = context.project
  const chapter = context.chapter
  if (!project) return 'No active project is selected.'

  if (element === 'story-config') {
    return [
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
    ].join('\n')
  }

  if (element === 'master-outline') {
    return `${elementLink('master-outline', 'Master Outline')}\n${context.outline || project.outline || 'Not set'}`
  }

  if (element === 'characters') {
    return `${elementLink('characters', 'Characters')}\n${context.characters || 'None'}`
  }

  if (!chapter) return 'No chapter is selected.'

  if (element === 'selected-chapter') {
    return [
      `${elementLink('selected-chapter', `Chapter ${chapter.index + 1}`)}`,
      `Title: ${chapter.title || 'Untitled'}`,
      `Summary: ${chapter.summary || 'None'}`,
      `Status: ${chapter.status}`,
    ].join('\n')
  }

  if (element === 'chapter-draft') {
    return `${elementLink('chapter-draft', `Chapter ${chapter.index + 1} Draft`)}\n${chapter.content?.trim() ? chapter.content.slice(0, 5000) : 'No draft content yet.'}`
  }

  return `${elementLink('chapter-plan', `Chapter ${chapter.index + 1} Plan`)}\n${JSON.stringify(chapter.outline, null, 2)}`
}

export function buildProjectContext(context: MultiAgentReviewContext, elements: ReviewContextElement[]) {
  const selected: ReviewContextElement[] = elements.length ? elements : ['story-config', 'master-outline', 'characters', 'chapter-plan']

  return [
    'Meeting Context Elements:',
    ...selected.map(element => buildElementContext(context, element)),
    '',
    'Reference rule: cite locations using [[element:label]] markers when possible. Short-form [[element]] references are also allowed.',
  ].join('\n')
}

export function selectedContextElementsSafe(_context: MultiAgentReviewContext): ReviewContextElement[] {
  return ['story-config', 'master-outline', 'characters', 'chapter-plan']
}

export function buildAgentMessages(
  agent: ReviewAgentState,
  publicMessages: ReviewPublicMessage[],
  context: MultiAgentReviewContext,
  focus: string,
  contextElements: ReviewContextElement[],
  request?: ReviewSpeechRequest,
  options: { mandatoryBrainstorm?: boolean; openDiscussionTurnCount?: number; enabledAgentCount?: number; maxContextTurns?: number } = {}
): ChatMessage[] {
  const isFirstOpenTurn = !options.mandatoryBrainstorm && (options.openDiscussionTurnCount || 0) <= 1
  const isProposerAgent = agent.id === 'proposer'
  const isFatigued = !options.mandatoryBrainstorm && (options.openDiscussionTurnCount || 0) >= ((options.enabledAgentCount || 0) * 2)
  const maxTurns = options.maxContextTurns && options.maxContextTurns > 0 ? options.maxContextTurns : 15

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
    '- Your raw assistant output is private scratch space. It is NOT automatically sent to the public meeting.',
    '- To speak publicly, you must use the send_public_message tool by writing:\n[SEND_MESSAGE]\nyour concise public message\n[/SEND_MESSAGE]',
    '- Do not copy or reveal internal instruction labels in a public message.',
    '- Modify means agree: after a voted project change is applied, it becomes accepted source-of-truth.',
    '- Tool execution is not the end of the meeting. After a tool applies a change, review the result and only request ending through [REQUEST_END: reason].',
    '- If you believe the meeting is over, you MUST use [REQUEST_END: reason] to start a vote. The meeting continues until everyone agrees to end or the user stops it.',
    '- Do NOT use target: consensus unless absolutely no text in the project files needs updating. If you identify a flaw in the story, you MUST propose a concrete text replacement using [REQUEST_CHANGE] with target: master-outline, chapter-plan, or characters.',
    '- Proposal creation is a tool action, not a vague statement. If you conclude that the project should be edited, you MUST create the proposal yourself in the same response with [REQUEST_CHANGE].',
    '- If you want to publicly announce a proposal, combine both blocks in one response: first [SEND_MESSAGE] with a concise proposal announcement, then [REQUEST_CHANGE] with the actionable proposal payload.',
    '- Do not say "enter proposal stage", "someone should create a proposal", or "this should be voted on" without actually creating the [REQUEST_CHANGE] block when you already have enough information.',
    '- Do not end your public message with a question unless you are explicitly using [ASK_USER] or directly asking a specific other agent to respond next.',
    '- If you already have enough context to form a view, end with your concrete judgment, recommendation, or decision instead of a generic follow-up question.',
    options.mandatoryBrainstorm
      ? '- Mandatory brainstorm phase: do not emit [REQUEST_CHANGE], [REQUEST_END], or [PROPOSE_FOCUS]. Use [SEND_MESSAGE] to publish role-based analysis and directions.'
      : '- Open meeting phase: respond like a real meeting participant. Read other agents\' messages carefully. You may question, rebut, refine, combine, or support their points. Direct your message to specific agents if helpful.\n- CRITICAL: DO NOT copy, repeat, or echo the previous agent\'s message. You must add new insights, debate points, or propose a concrete action. If you agree, explain WHY from your unique perspective and push the conversation forward.',
    isFirstOpenTurn && !isProposerAgent
      ? '- THIS IS THE FIRST OPEN-DISCUSSION TURN. You may share your first reaction, but it must still be additive. Do NOT repeat earlier points verbatim. Do not use [REQUEST_CHANGE], [REQUEST_END] or [PROPOSE_FOCUS] in this turn unless the user explicitly demanded immediate action.'
      : '',
    !options.mandatoryBrainstorm && !isFirstOpenTurn
      ? '- You are responding after at least one other agent has already spoken in open discussion. You MUST build on, challenge, narrow, or refine earlier messages. Do not restate the same summary in different words.'
      : '',
    !options.mandatoryBrainstorm && !isFirstOpenTurn
      ? '- Before making your point, silently identify what is missing, weak, mistaken, or still undecided in the earlier public messages. Your response should target that gap directly.'
      : '',
    isFatigued
      ? '- SYSTEM WARNING: The discussion has been going on for a long time. You MUST now converge by doing one of the following in this response: create a [REQUEST_CHANGE], create an [ASK_USER], create a [PROPOSE_FOCUS], or create a [REQUEST_END]. Do not continue open-ended discussion.'
      : '',
    isProposerAgent && !options.mandatoryBrainstorm
      ? '- As the Proposer Agent, you have priority to synthesize earlier comments into an actionable proposal. Once the discussion contains enough information, you should be the one who creates [REQUEST_CHANGE] instead of waiting for another agent.'
      : '',
    '- Tool Usage Instruction:',
    '  - [SEND_MESSAGE]...[/SEND_MESSAGE]: Public speech.',
    '  - [CALL_AGENT: agentId]: Explicitly request another agent to speak next to respond to your points.',
    '  - [REQUEST_SPEECH]: Request another turn for yourself if you have more to add after others speak.',
    '  - [PROPOSE_FOCUS: new focus]: Suggest shifting the meeting focus.',
    '  - [REQUEST_CHANGE]: Propose a concrete edit to project data (outline, chapter plan, characters, or shared consensus).',
    '  - [ASK_USER]: Request clarification from the user.',
    '  - [REQUEST_END: reason]: Propose ending the meeting.',
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
    : publicMessages.slice(-maxTurns)

  let userBuffer: string[] = []

  if (!options.mandatoryBrainstorm && publicMessages.length > maxTurns) {
    userBuffer.push(`[System: Older conversation history has been truncated/compressed to the last ${maxTurns} turns. Focus on the current context.]`)
  }

  for (const msg of contextPublicMessages) {
    if (msg.role === 'agent' && msg.agentId === agent.id) {
      if (userBuffer.length > 0) {
        chatMessages.push({ role: 'user', content: userBuffer.join('\n\n') })
        userBuffer = []
      } else if (chatMessages.length === 1) {
        chatMessages.push({ role: 'user', content: '[System] Meeting started. Waiting for your first input.' })
      }

      let assistantContent = msg.content
      if (!msg.tool && !assistantContent.includes('[Change vote:') && !assistantContent.includes('[End vote:')) {
        assistantContent = `[SEND_MESSAGE]\n${assistantContent}\n[/SEND_MESSAGE]`
      }

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
        text += `\n[System: Tool '${msg.tool.name}' executed with status '${msg.tool.status}']`
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
    userBuffer.push('Current Phase: open meeting discussion. Be reactive and collaborative. Use [CALL_AGENT: id] to keep the conversation moving if you need a specific reply. If you already know a project edit is needed, create the [REQUEST_CHANGE] now instead of postponing it. Do not end with a vague question when you already have enough context to state your view.')
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
        'Return exactly this format:',
        '[END_VOTE: yes|no]',
        'Reason: one concise reason grounded in your agent role.',
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

export function buildChangeVoteMessages(
  agent: ReviewAgentState,
  publicMessages: ReviewPublicMessage[],
  context: MultiAgentReviewContext,
  focus: string,
  contextElements: ReviewContextElement[],
  session: ReviewChangeVoteSession
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
        'Do not confuse character concepts with character entities. Vote for target characters only when the proposal clearly adds or updates concrete named cast members.',
        'After a proposal passes, wait for the project change tool result before treating the work as complete or requesting meeting end.',
        'Do not reject merely because the content is prose, bullets, or imperfect JSON. The project change tool will normalize approved proposals before execution.',
        'Vote no for format only when the proposal lacks enough information for the tool to infer the intended target, scope, purpose, or content.',
        'First infer what the user wants and what final effect would satisfy the user. Then judge the proposal against that goal.',
        'Vote yes if the proposal is coherent and is the best available fit for the user request, even if it is not your ideal solution.',
        'Vote no only for concrete user-impacting reasons: it violates explicit user constraints, worsens the requested outcome, is unsafe to apply, is malformed, or lacks required information.',
        'Do not reject merely because you prefer another style, want more discussion, or because the proposal is outside your narrow specialty while still satisfying the user.',
        'If the proposal is mostly right but needs a targeted correction, include an amendment block after your vote. Amendment blocks can modify, delete, or insert one item.',
        'Use this exact amendment shape when needed:\n[AMENDMENT]\naction: modify|delete|insert\nscope: which proposal item changes\npurpose: why the amendment better satisfies the user\ncontent: replacement/removal/insertion content\n[/AMENDMENT]',
        'Do not propose an amendment while voting on an amendment.',
        'If voting no due to insufficient actionable detail, your reason must explicitly name what information is missing.',
        'If voting no due to user-fit, your reason must include what alternative would better satisfy the user.',
        'Modify means agree: if you vote yes and the change is applied, you must treat the result as accepted source-of-truth in later turns.',
        'Do not later try to revert an applied change unless the user explicitly asks for a new change.',
        'Return exactly this format:',
        '[CHANGE_VOTE: yes|no]',
        'Reason: one concise reason grounded in your agent role.',
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
        `Scope: ${session.request.scope}`,
        `Purpose: ${session.request.purpose}`,
        `Proposed Content:\n${session.request.content}`,
        '',
        session.amendmentDepth
          ? 'Amendment voting mode: vote on this amendment only. Do not propose another amendment.'
          : 'Original proposal voting mode: you may include one [AMENDMENT] block if a targeted modify/delete/insert would make the proposal better satisfy the user.',
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
        'Return exactly:',
        '[ASK_USER_VOTE: yes|no]',
        'Reason: one concise reason.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        buildProjectContext(context, selectedContextElementsSafe(context)),
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
  session: ReviewChangeVoteSession,
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
        '{ "target": "master-outline|chapter-plan|characters|consensus", "scope": "...", "purpose": "...", "content": ..., "verification": "..." }',
        'For target characters, content can be an array of character objects, bullets, or prose listing names and traits.',
        'For target chapter-plan, content must be an object with optional title and outline fields or the outline fields directly.',
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
        `Scope: ${session.request.scope}`,
        `Purpose: ${session.request.purpose}`,
        `Content:\n${session.request.content}`,
      ].join('\n'),
    },
  ]
}
