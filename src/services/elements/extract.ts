import type { StoryElement, ElementStateProposal } from '@/types/element'
import type { StoryProject } from '@/types/project'
import type { ProviderModelRef } from '@/types/provider'
import { buildElementContextForChapter } from './index'
import { runStructuredLoop } from '@/services/agent/loop'

const MAX_ANALYSIS_CHARS = 8000

function currentStateLines(elements: StoryElement[]): string {
  if (!elements.length) return 'None tracked yet.'
  return elements
    .map(element => {
      const state = element.states[element.states.length - 1]
      const anchor = state ? ` (since ch ${state.chapterIndex + 1})` : ''
      return `- [${element.id}] ${element.name} (${element.kind})${anchor}: ${state?.summary ?? ''}`
    })
    .join('\n')
}

const SYSTEM = `You maintain the living state of a novel: characters, events, threads, locations, and objects.
Given a finished chapter and the current element states, extract what changed IN THIS CHAPTER ONLY.
Rules:
- One proposed state per element that materially changed. Summaries state what is true NOW.
- Threads use the lifecycle planted -> advanced -> paid. Locations/objects may use moved.
- Do not invent elements that never appear in the chapter text.
- chapterIndex is the 0-based index of this chapter.
- Respond with JSON only, shape:
{"updates":[{"elementId":"existing id or empty","name":"...","kind":"character|event|thread|location|object","state":{"chapterIndex":0,"time":"","location":"","status":"active","summary":"..."}}]}`

export async function extractElementProposals(
  project: StoryProject,
  chapterContent: string,
  chapterIndex: number,
  modelRef: ProviderModelRef,
  signal?: AbortSignal,
): Promise<ElementStateProposal[]> {
  const elements = project.elements ?? []
  const analysis = chapterContent.length > MAX_ANALYSIS_CHARS
    ? `${chapterContent.slice(0, MAX_ANALYSIS_CHARS)}\n[...truncated]`
    : chapterContent

  const payload = await runStructuredLoop({
    modelRef,
    system: SYSTEM,
    contextBlocks: [
      `Current element states:\n${currentStateLines(elements)}`,
      buildElementContextForChapter(elements, chapterIndex),
    ],
    prompt: [
      `Chapter index: ${chapterIndex} (chapter ${chapterIndex + 1}).`,
      `Title: ${project.chapters[chapterIndex]?.title ?? ''}`,
      'Chapter content:',
      analysis,
    ].join('\n\n'),
    temperature: 0.2,
    maxTokens: 3072,
    signal,
  })

  const updates = Array.isArray(payload.updates) ? payload.updates : []
  return updates
    .filter((update: any) => update && typeof update.name === 'string' && typeof update.state?.summary === 'string')
    .map((update: any) => ({
      elementId: typeof update.elementId === 'string' && update.elementId ? update.elementId : undefined,
      name: String(update.name).trim(),
      kind: update.kind,
      state: {
        chapterIndex: Number(update.state?.chapterIndex ?? chapterIndex),
        time: update.state?.time,
        location: update.state?.location,
        status: update.state?.status,
        summary: String(update.state.summary).trim(),
      },
    }))
}
