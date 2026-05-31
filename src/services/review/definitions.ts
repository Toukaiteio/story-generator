import type { StoryProject } from '@/types/project'
import type {
  ReviewAgentDefinition,
  ReviewAgentState,
} from './types'

export const reviewAgentDefinitions: ReviewAgentDefinition[] = [
  {
    id: 'writer',
    name: 'Writer Agent',
    role: 'Creativity, emotion, narrative',
    brief: 'Focuses on creative ideas, emotional resonance, and narrative flow.',
    defaultModelRole: 'chapterPlanner',
    systemPrompt: 'You are the Writer Agent. Focus on expanding creativity, emotional depth, character voices, and narrative flow. Suggest new narrative beats, dialogue ideas, and ways to make the scenes feel more alive and compelling.',
  },
  {
    id: 'editor',
    name: 'Editor Agent',
    role: 'Logic, structure, pacing',
    brief: 'Checks logic, plot holes, structure, and consistency.',
    defaultModelRole: 'chapterPlanner',
    systemPrompt: 'You are the Editor Agent. Focus on logic, plot holes, structural pacing, and consistency. Critique the narrative critically, identify flaws in the causal chain, and ensure character motivations remain aligned with the master outline.',
  },
  {
    id: 'reader',
    name: 'Reader Agent',
    role: 'Engagement, clarity, payoff',
    brief: 'Evaluates the story from the audience perspective.',
    defaultModelRole: 'proofreader',
    systemPrompt: 'You are the Reader Agent. Evaluate the story entirely from an audience perspective. Focus on engagement, clarity, tension, and emotional payoff. Express what you find confusing, what excites you, and what you want to see happen next.',
  },
]

export const internalProposerAgentDefinition: ReviewAgentDefinition = {
  id: 'proposer',
  name: 'Proposer Agent',
  role: 'Synthesis and action',
  brief: 'Synthesizes discussion and drives concrete proposals.',
  defaultModelRole: 'proposerAgent',
  systemPrompt: 'You are the Proposer Agent. You act as the project manager and facilitator. Listen to the Writer, Editor, and Reader. Your primary job is to synthesize prior discussion into actionable concrete actions. When enough context exists, do not ask broad follow-up questions or wait for someone else to act. Publicly summarize the synthesized conclusion using function send_public_message, then immediately call one actionable function yourself: request_project_action, propose_focus, ask_user_clarification, or request_end_meeting. Do not say that the team should enter a proposal stage; you are the agent that creates the proposal stage.',
}

function getProjectAgentPrompt(project: StoryProject | null | undefined, agentId: string) {
  const value = project?.reviewAgentSettings?.agents?.[agentId]?.customSystemPrompt
  return typeof value === 'string' && value.trim() ? value : null
}

function getProjectAgentModelValue(project: StoryProject | null | undefined, agentId: string) {
  const value = project?.reviewAgentSettings?.agents?.[agentId]?.modelValue
  return typeof value === 'string' && value.trim() ? value : ''
}

function getProjectAgentSetting(project: StoryProject | null | undefined, agentId: string) {
  return project?.reviewAgentSettings?.agents?.[agentId] ?? null
}

export function getReviewAgentDefinitions(project: StoryProject | null | undefined): ReviewAgentDefinition[] {
  const settings = project?.reviewAgentSettings?.agents ?? {}
  const definitions = reviewAgentDefinitions
    .filter(definition => !settings[definition.id]?.deleted)
    .map(definition => {
      const setting = settings[definition.id]
      return {
        ...definition,
        name: setting?.name?.trim() || definition.name,
        role: setting?.role?.trim() || definition.role,
        brief: setting?.brief?.trim() || definition.brief,
        defaultModelRole: setting?.defaultModelRole === 'proposerAgent'
          ? 'proposerAgent' as const
          : setting?.defaultModelRole === 'proofreader'
            ? 'proofreader' as const
            : setting?.defaultModelRole === 'chapterPlanner'
              ? 'chapterPlanner' as const
              : definition.defaultModelRole,
        systemPrompt: setting?.systemPrompt?.trim() || definition.systemPrompt,
      }
    })

  for (const [id, setting] of Object.entries(settings)) {
    if (!setting?.custom || setting.deleted) continue
    if (definitions.some(definition => definition.id === id)) continue
    definitions.push({
      id,
      name: setting.name?.trim() || 'Custom Agent',
      role: setting.role?.trim() || 'Custom role',
      brief: setting.brief?.trim() || 'Custom meeting participant.',
      defaultModelRole: setting.defaultModelRole === 'proposerAgent'
        ? 'proposerAgent'
        : setting.defaultModelRole === 'proofreader'
          ? 'proofreader'
          : 'chapterPlanner',
      systemPrompt: setting.systemPrompt?.trim() || setting.customSystemPrompt?.trim() || 'You are a custom story meeting agent. Provide concise, useful feedback based on the selected context.',
      custom: true,
    })
  }

  return definitions
}

export function createAgentState(definition: ReviewAgentDefinition, project?: StoryProject | null): ReviewAgentState {
  const setting = getProjectAgentSetting(project, definition.id)
  return {
    ...definition,
    enabled: !setting?.disabled,
    status: 'idle',
    waitingForTurn: false,
    lastSeenMessageIndex: 0,
    privateMemory: [],
    workspaceState: {},
    modelValue: getProjectAgentModelValue(project, definition.id),
    customSystemPrompt: getProjectAgentPrompt(project, definition.id) ?? definition.systemPrompt,
    toolState: {
      requestSpeech: 'idle',
    },
  }
}

export function normalizeAgentState(raw: any, definition: ReviewAgentDefinition, project?: StoryProject | null): ReviewAgentState {
  const base = createAgentState(definition, project)
  const savedStatus = raw?.status === 'waiting' || raw?.status === 'requesting' || raw?.status === 'speaking' || raw?.status === 'blocked' ? raw.status as ReviewAgentState['status'] : base.status
  const savedWaiting = typeof raw?.waitingForTurn === 'boolean' ? raw.waitingForTurn : base.waitingForTurn
  return {
    ...base,
    enabled: base.enabled,
    status: savedStatus,
    waitingForTurn: savedWaiting,
    lastSeenMessageIndex: Number.isFinite(Number(raw?.lastSeenMessageIndex)) ? Number(raw.lastSeenMessageIndex) : 0,
    privateMemory: Array.isArray(raw?.privateMemory) ? raw.privateMemory.map(String).slice(-12) : [],
    workspaceState: raw?.workspaceState && typeof raw.workspaceState === 'object' ? raw.workspaceState : {},
    modelValue: getProjectAgentModelValue(project, definition.id) || (typeof raw?.modelValue === 'string' ? raw.modelValue : ''),
    customSystemPrompt: getProjectAgentPrompt(project, definition.id) ?? base.customSystemPrompt,
    toolState: raw?.toolState && typeof raw.toolState === 'object'
      ? { ...base.toolState, ...raw.toolState, requestSpeech: 'idle' }
      : base.toolState,
  }
}

export function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}
