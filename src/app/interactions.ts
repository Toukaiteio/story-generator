import { useStoryProject, useModelCatalog } from './data'
import { useStoryEngine } from './engine'
import { providerManager } from '@/services/provider'
import { runAgentLoop, runStructuredLoop } from '@/services/agent/loop'
import { extractElementProposals } from '@/services/elements/extract'
import {
  appendElementState,
  buildElementContextForChapter,
  createElement,
  elementStateAt,
  latestElementState,
} from '@/services/elements'
import { buildCharacterContextForTask, buildPreviousSummary } from '@/services/pipeline/context'
import { buildProjectStylePrompt } from '@/services/writingStyle/skill'
import {
  auditHumanText,
  chunkForHumanize,
  formatAuditForPrompt,
  type HumanizerAudit,
} from '@/services/humanizer'
import { getUsableAgentModelRef } from '@/stores/generation/helpers'
import { generateId } from '@/lib/id'
import type { ElementKind, ElementState, ElementStateProposal, StoryElement } from '@/types/element'
import type { ChapterOutline } from '@/types/chapter'
import type { StoryProject } from '@/types/project'
import type { AgentType } from '@/types/agent'

export type SelectionAction = 'deepen' | 'trim' | 'show' | 'dialogue' | 'fix' | 'custom'

const SELECTION_DIRECTIVES: Record<Exclude<SelectionAction, 'custom'>, string> = {
  deepen: 'Deepen the selected prose: add sensory grounding, subtext, and interiority. Keep the events and meaning identical.',
  trim: 'Tighten the selected prose. Cut filler, redundancy, and over-explaining. Preserve voice and all story facts.',
  show: 'Convert telling into showing: play the moment out in action, gesture, and dialogue. Keep length proportional.',
  dialogue: 'Re-express the selected prose as or with natural dialogue where it earns its place. Keep narration minimal.',
  fix: 'Fix grammar, punctuation, and clarity in the selected prose. Change nothing else.',
}

const EDITOR_SYSTEM = 'You are a line editor for a novel. You return only replacement prose, no commentary, no quotes around the result, no explanation.'

export interface SelectionContext {
  chapterTitle: string
  chapterNumber: number
  before: string
  after: string
}

export interface ElementDraft {
  kind: ElementKind
  name: string
  characterId?: string
}

export interface ChapterPlanDraft {
  title: string
  outline: ChapterOutline
}

export interface StorySeedDraft {
  name: string
  theme: string
  genre: string
  targetReader: string
  chapterCount: number
  outline: string
  characters: Array<{
    name: string
    role: string
    personality: string[]
    appearance: string
    motivation: string
    goals: string
    conflicts: string
  }>
}

function resolveModel(role: AgentType) {
  const catalog = useModelCatalog()
  providerManager.setProviders(catalog.providers)
  const modelRef = catalog.getAvailableModelRefForRole(role)
  if (!modelRef) {
    throw new Error('No model available. Configure an active provider first.')
  }
  const model = catalog.getModelByRef(modelRef)
  return { modelRef, contextTokens: model?.model.contextTokens ?? null }
}

function buildStudioContext(project: StoryProject, chapterIndex: number): string[] {
  const style = buildProjectStylePrompt(project)
  const blocks = [
    `Project: ${project.name}. Genre: ${project.genre}. Reader: ${project.targetReader}. Language: ${project.language}.`,
    project.outline ? `Story outline:\n${project.outline}` : '',
    style ? `Writing style:\n${style.slice(0, 6000)}` : '',
    `Characters:\n${buildCharacterContextForTask(project.characters, 'writing')}`,
    buildElementContextForChapter(project.elements, chapterIndex),
    buildPreviousSummary(project, chapterIndex),
  ]
  return blocks.filter(Boolean)
}

export function useStudioActions() {
  const projectStore = useStoryProject()

  function requireProject(projectId?: string): StoryProject {
    const project = projectId
      ? projectStore.getProjectById(projectId)
      : projectStore.activeProject
    if (!project) throw new Error('No active project.')
    return project
  }

  async function improveSelection(
    action: SelectionAction,
    selection: string,
    context: SelectionContext,
    options: { instruction?: string; signal?: AbortSignal } = {},
  ): Promise<string> {
    const project = requireProject()
    const { modelRef, contextTokens } = resolveModel('editingAI')
    const directive = action === 'custom'
      ? options.instruction?.trim()
      : SELECTION_DIRECTIVES[action]
    if (!directive) throw new Error('No instruction given.')

    const result = await runAgentLoop({
      modelRef,
      contextTokens,
      system: EDITOR_SYSTEM,
      contextBlocks: buildStudioContext(project, Math.max(0, context.chapterNumber - 1)),
      prompt: [
        `Chapter ${context.chapterNumber}: ${context.chapterTitle}`,
        'Text before the selection (do not rewrite it):',
        context.before || '(chapter start)',
        'Text after the selection (do not rewrite it):',
        context.after || '(chapter end)',
        `Selection to rewrite:\n${selection}`,
        directive,
      ].join('\n\n'),
      temperature: 0.6,
      maxTokens: 3072,
      signal: options.signal,
    })
    return result.content.trim()
  }

  async function continueChapter(
    chapterId: string,
    options: { onToken?: (token: string) => void; signal?: AbortSignal } = {},
  ): Promise<string> {
    const project = requireProject()
    const chapterIndex = project.chapters.findIndex(item => item.id === chapterId)
    const chapter = project.chapters[chapterIndex]
    if (!chapter) throw new Error('Chapter not found.')
    const { modelRef, contextTokens } = resolveModel('writer')

    const anchor = chapter.content.trim().slice(-1500)
    const result = await runAgentLoop(
      {
        modelRef,
        contextTokens,
        system: 'You are the author writing this novel. Continue the chapter seamlessly from the anchor. Return only story prose that directly continues the last sentence. Match the established voice, tense, and person. Do not repeat the anchor, add headings, or summarize.',
        contextBlocks: buildStudioContext(project, chapterIndex),
        prompt: [
          `Chapter ${chapter.index + 1}: ${chapter.title}`,
          chapter.outline.objective ? `Chapter goal: ${chapter.outline.objective}` : '',
          'Chapter so far (anchor):\n' + (anchor || '(empty — begin the chapter from its outline)'),
        ].filter(Boolean).join('\n\n'),
        temperature: 0.8,
        maxTokens: 4096,
        signal: options.signal,
      },
      { onToken: options.onToken },
    )
    return result.content.trim()
  }

  async function humanizeText(
    text: string,
    options: {
      chapterId?: string
      voiceSample?: string
      maxPasses?: number
      onToken?: (token: string) => void
      signal?: AbortSignal
    } = {},
  ): Promise<{ text: string; audit: HumanizerAudit }> {
    const project = requireProject()
    const chapterIndex = options.chapterId
      ? project.chapters.findIndex(item => item.id === options.chapterId)
      : Math.max(0, project.chapters.length - 1)
    const { modelRef, contextTokens } = resolveModel('polisher')
    const voiceSample = (options.voiceSample ?? text).slice(0, 900)
    const maxPasses = options.maxPasses ?? 2

    let current = text.trim()
    let audit = auditHumanText(current)

    for (let pass = 0; pass < maxPasses; pass++) {
      const findings = formatAuditForPrompt(audit)
      if (!findings && pass > 0) break
      const result = await runAgentLoop({
        modelRef,
        contextTokens,
        system: 'You are a line editor. Rewrite the prose to remove the listed AI-writing tells. Return only the rewritten prose, with no commentary, labels, or quotation marks around the result.',
        contextBlocks: [
          ...buildStudioContext(project, Math.max(0, chapterIndex)),
          `Voice sample to match (rhythm, diction, punctuation):\n${voiceSample}`,
        ],
        prompt: [
          findings || 'Remove any remaining AI-writing tells.',
          'Text to rewrite:',
          current,
          'Keep every fact, story beat, and character voice. Do not shorten the scene or add new events.',
        ].join('\n\n'),
        temperature: 0.5,
        maxTokens: 4096,
        signal: options.signal,
      }, { onToken: options.onToken })
      current = result.content.trim()
      audit = auditHumanText(current)
      if (!audit.blocking) break
    }

    return { text: current, audit }
  }

  async function humanizeChapter(
    chapterId: string,
    options: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {},
  ): Promise<{ text: string; audit: HumanizerAudit }> {
    const project = requireProject()
    const chapter = project.chapters.find(item => item.id === chapterId)
    if (!chapter?.content.trim()) throw new Error('Chapter has no content to humanize.')

    const chunks = chunkForHumanize(chapter.content)
    const parts: string[] = []
    for (let index = 0; index < chunks.length; index++) {
      options.onProgress?.(index, chunks.length)
      const result = await humanizeText(chunks[index], {
        chapterId,
        voiceSample: chapter.content,
        maxPasses: 1,
        signal: options.signal,
      })
      parts.push(result.text)
    }
    options.onProgress?.(chunks.length, chunks.length)

    const text = parts.join('\n\n')
    return { text, audit: auditHumanText(text) }
  }

  async function recap(projectId?: string, chapterId?: string): Promise<string> {    const project = requireProject(projectId)
    const chapterIndex = chapterId
      ? project.chapters.findIndex(item => item.id === chapterId)
      : project.chapters.length - 1
    const { modelRef, contextTokens } = resolveModel('editingAI')
    const result = await runAgentLoop({
      modelRef,
      contextTokens,
      system: 'You brief the author, not the reader. Summarize the story so far in plain prose: where the plot stands, what each main character wants right now, open promises and unresolved threads, and the immediate situation at the end of the latest chapter. At most 150 words. No headings.',
      contextBlocks: buildStudioContext(project, Math.max(0, chapterIndex)),
      prompt: `Brief me as of the end of chapter ${(chapterIndex >= 0 ? chapterIndex : project.chapters.length - 1) + 1}.`,
      temperature: 0.4,
      maxTokens: 1024,
    })
    return result.content.trim()
  }

  async function proposeChapterPlan(
    options: { chapterId?: string; afterChapterId?: string } = {},
  ): Promise<ChapterPlanDraft> {
    const project = requireProject()
    const target = options.chapterId
      ? project.chapters.find(item => item.id === options.chapterId) ?? null
      : null
    const anchorIndex = target
      ? target.index - 1
      : options.afterChapterId
        ? project.chapters.findIndex(item => item.id === options.afterChapterId)
        : project.chapters.length - 1
    const anchor = anchorIndex >= 0 ? project.chapters[anchorIndex] : null
    const nextIndex = target ? target.index : (anchor?.index ?? -1) + 1
    const { modelRef, contextTokens } = resolveModel('chapterPlanner')

    const payload = await runStructuredLoop({
      modelRef,
      contextTokens,
      system: `You are a story architect. Propose a chapter plan that follows the outline and the current state of the world. Respond with JSON only: {"title":"...","outline":{"objective":"...","conflict":"...","keyEvents":["..."],"characterActions":["..."],"infoReveals":["..."],"endingHook":"..."}}. keyEvents: 3-5 concrete beats. characterActions: what each involved character does. infoReveals: what the reader learns. endingHook: the pull into the next chapter.`,
      contextBlocks: [
        `Story outline:\n${project.outline || '(none yet)'}`,
        `Characters:\n${buildCharacterContextForTask(project.characters, 'outlining')}`,
        buildElementContextForChapter(project.elements, nextIndex),
        anchor?.summary ? `Previous chapter summary (ch ${anchor.index + 1}): ${anchor.summary}` : '',
        anchor ? `Previous chapter plan: ${JSON.stringify(anchor.outline)}` : '',
        target?.summary ? `Current chapter summary: ${target.summary}` : '',
        target ? `Current plan to rework: ${JSON.stringify(target.outline)}` : '',
      ].filter(Boolean),
      prompt: target
        ? `Rework the plan for chapter ${target.index + 1}.`
        : `Propose chapter ${nextIndex + 1} of ${project.chapterConfig?.maxChapters ?? project.chapterCount}.`,
      temperature: 0.7,
      maxTokens: 2048,
    })

    return {
      title: String(payload.title ?? `Chapter ${nextIndex + 1}`).trim(),
      outline: {
        objective: String(payload.outline?.objective ?? '').trim(),
        conflict: String(payload.outline?.conflict ?? '').trim(),
        keyEvents: (Array.isArray(payload.outline?.keyEvents) ? payload.outline.keyEvents : []).map(String),
        characterActions: (Array.isArray(payload.outline?.characterActions) ? payload.outline.characterActions : []).map(String),
        infoReveals: (Array.isArray(payload.outline?.infoReveals) ? payload.outline.infoReveals : []).map(String),
        endingHook: String(payload.outline?.endingHook ?? '').trim(),
      },
    }
  }

  async function applyChapterPlan(chapterId: string, draft: ChapterPlanDraft): Promise<void> {
    const project = requireProject()
    const chapters = project.chapters.map(item => item.id === chapterId
      ? {
          ...item,
          title: draft.title.trim() || item.title,
          outline: draft.outline,
          updatedAt: new Date().toISOString(),
        }
      : item)
    await projectStore.updateProject(project.id, { chapters })
  }

  async function acceptChapterPlan(draft: ChapterPlanDraft): Promise<void> {
    const project = requireProject()
    const now = new Date().toISOString()
    const chapter = {
      id: generateId(),
      index: project.chapters.length,
      title: draft.title || `Chapter ${project.chapters.length + 1}`,
      outline: draft.outline,
      content: '',
      proofreadingIssues: [],
      contentVersions: [],
      polishedContent: '',
      status: 'outline' as const,
      summary: '',
      characterStateUpdates: {},
      createdAt: now,
      updatedAt: now,
    }
    await projectStore.updateProject(project.id, {
      chapters: [...project.chapters, chapter],
    })
  }

  async function proposeElementStates(chapterId: string, signal?: AbortSignal): Promise<ElementStateProposal[]> {
    const project = requireProject()
    const chapterIndex = project.chapters.findIndex(item => item.id === chapterId)
    const chapter = project.chapters[chapterIndex]
    if (!chapter || !chapter.content.trim()) throw new Error('Chapter has no content to analyze.')
    const { modelRef } = resolveModel('relationshipTracker')
    return extractElementProposals(project, chapter.content, chapterIndex, modelRef, signal)
  }

  async function applyElementProposals(proposals: ElementStateProposal[]): Promise<void> {
    const project = requireProject()
    const elements = [...(project.elements ?? [])]

    for (const proposal of proposals) {
      const targetIndex = proposal.elementId
        ? elements.findIndex(item => item.id === proposal.elementId)
        : elements.findIndex(item => item.name === proposal.name && item.kind === proposal.kind)
      if (targetIndex >= 0) {
        elements[targetIndex] = appendElementState(elements[targetIndex], {
          chapterIndex: proposal.state.chapterIndex,
          summary: proposal.state.summary,
          time: proposal.state.time,
          location: proposal.state.location,
          status: proposal.state.status,
        })
      } else {
        elements.push(createElement({
          kind: proposal.kind,
          name: proposal.name,
          states: [{
            id: generateId(),
            chapterIndex: proposal.state.chapterIndex,
            time: proposal.state.time,
            location: proposal.state.location,
            status: proposal.state.status,
            summary: proposal.state.summary,
            createdAt: new Date().toISOString(),
          }],
        }))
      }
    }

    await projectStore.updateProject(project.id, { elements })
  }

  async function addElement(draft: ElementDraft): Promise<void> {
    const project = requireProject()
    const element = createElement({ kind: draft.kind, name: draft.name, characterId: draft.characterId })
    await projectStore.updateProject(project.id, {
      elements: [...(project.elements ?? []), element],
    })
  }

  async function removeElement(elementId: string): Promise<void> {
    const project = requireProject()
    await projectStore.updateProject(project.id, {
      elements: (project.elements ?? []).filter(item => item.id !== elementId),
    })
  }

  async function setElementStatus(elementId: string, status: ElementState['status']): Promise<void> {
    const project = requireProject()
    const elements = (project.elements ?? []).map(element =>
      element.id === elementId && latestElementState(element)
        ? {
            ...element,
            states: element.states.map((state, index) =>
              index === element.states.length - 1 ? { ...state, status } : state),
          }
        : element
    )
    await projectStore.updateProject(project.id, { elements })
  }

  async function askCopilot(
    prompt: string,
    options: {
      history?: Array<{ role: 'user' | 'assistant'; content: string }>
      chapterId?: string | null
      onToken?: (token: string) => void
      signal?: AbortSignal
    } = {},
  ): Promise<string> {
    const project = requireProject()
    const chapterIndex = options.chapterId
      ? project.chapters.findIndex(item => item.id === options.chapterId)
      : Math.max(0, project.chapters.length - 1)
    const { modelRef, contextTokens } = resolveModel('editingAI')
    const result = await runAgentLoop(
      {
        modelRef,
        contextTokens,
        system: 'You are the author’s writing partner. Answer briefly and concretely about this story. When asked to change the story, propose the smallest concrete change. No preamble.',
        contextBlocks: buildStudioContext(project, chapterIndex),
        history: options.history,
        prompt,
        temperature: 0.7,
        maxTokens: 3072,
        signal: options.signal,
      },
      { onToken: options.onToken },
    )
    return result.content.trim()
  }

  async function proofreadChapter(chapterId: string): Promise<void> {
    const project = requireProject()
    const chapter = project.chapters.find(item => item.id === chapterId)
    if (!chapter) throw new Error('Chapter not found.')
    const engine = useStoryEngine()
    engine.beginTask('proofreading', `Proofreading ${chapter.title}`, chapter.index)
    try {
      const prompt = [
        'The application has already selected the chapter. Proofread only this chapter.',
        `Chapter ${chapter.index + 1}: ${chapter.title}`,
        `Language: ${project.language}`,
        `Format: ${project.writingFormat}`,
        chapter.outline.objective ? `Chapter plan: ${JSON.stringify(chapter.outline)}` : '',
        `Compact characters:\n${buildCharacterContextForTask(project.characters, 'proofreading')}`,
        buildPreviousSummary(project, chapter.index),
      ].filter(Boolean).join('\n\n')
      const issues = await engine.proofreadContent(prompt, chapter.content, project.id)
      await engine.saveProofreadingIssues(project.id, chapter.id, issues, chapter.content)
    } finally {
      engine.finishTask()
    }
  }

  async function polishChapter(chapterId: string): Promise<void> {
    const project = requireProject()
    const chapter = project.chapters.find(item => item.id === chapterId)
    if (!chapter) throw new Error('Chapter not found.')
    const engine = useStoryEngine()
    await engine.polishChapter(project.id, chapterId, chapter.proofreadingIssues)
  }

  async function draftStorySeed(
    idea: string,
    options: { language?: string; signal?: AbortSignal } = {},
  ): Promise<StorySeedDraft> {
    const { modelRef, contextTokens } = resolveModel('storyPlanner')
    const payload = await runStructuredLoop({
      modelRef,
      contextTokens,
      system: `You are a story architect. Expand a seed idea into a novel blueprint. Respond with JSON only: {"name","theme","genre","targetReader","chapterCount","outline","characters":[{"name","role":"protagonist|antagonist|supporting|minor","personality":[],"appearance","motivation","goals","conflicts"}]}. The outline is the complete chapter-by-chapter master outline as plain text. 4-8 characters. Never invent real-world brands or real people.`,
      contextBlocks: options.language ? [`Language: ${options.language}`] : [],
      prompt: `Seed idea: ${idea}`,
      temperature: 0.8,
      maxTokens: 4096,
      signal: options.signal,
    })

    return {
      name: String(payload.name ?? '').trim(),
      theme: String(payload.theme ?? '').trim(),
      genre: String(payload.genre ?? '').trim(),
      targetReader: String(payload.targetReader ?? '').trim(),
      chapterCount: Math.max(1, Math.min(99, Number(payload.chapterCount) || 8)),
      outline: String(payload.outline ?? '').trim(),
      characters: Array.isArray(payload.characters)
        ? payload.characters.map((item: any) => ({
            name: String(item?.name ?? '').trim(),
            role: ['protagonist', 'antagonist', 'supporting', 'minor'].includes(item?.role) ? item.role : 'supporting',
            personality: Array.isArray(item?.personality) ? item.personality.map(String) : [],
            appearance: String(item?.appearance ?? '').trim(),
            motivation: String(item?.motivation ?? '').trim(),
            goals: String(item?.goals ?? '').trim(),
            conflicts: String(item?.conflicts ?? '').trim(),
          }))
        : [],
    }
  }

  return {
    improveSelection,
    humanizeText,
    humanizeChapter,
    continueChapter,
    recap,
    askCopilot,
    proposeChapterPlan,
    acceptChapterPlan,
    applyChapterPlan,
    proofreadChapter,
    polishChapter,
    proposeElementStates,
    applyElementProposals,
    addElement,
    removeElement,
    setElementStatus,
    draftStorySeed,
  }
}

export type StudioActions = ReturnType<typeof useStudioActions>

export function describeElement(element: StoryElement): string {
  const state = latestElementState(element)
  if (!state) return ''
  return [state.status, state.summary].filter(Boolean).join(' — ')
}

export function elementSummaryAt(element: StoryElement, chapterIndex: number): string {
  const state = elementStateAt(element, chapterIndex)
  return state?.summary ?? ''
}
