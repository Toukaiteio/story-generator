import type { StoryProject } from '@/types/project'
import type { ProviderModelRef } from '@/types/provider'
import { getAgent } from '@/services/agent'
import { useProviderStore } from '@/stores/provider'
import { useKnowledgeStore } from '@/stores/knowledge'
import { providerManager } from '@/services/provider'
import { buildKnowledgeContextAsync, buildKnowledgeQuery } from '@/services/knowledge/context'

export type PipelineStage = 'planning' | 'chapter-outline' | 'chapter-outline-review' | 'writing' | 'proofreading' | 'polishing'

export interface PlanningRuntime {
  providerStore: ReturnType<typeof useProviderStore>
  planningModel: ProviderModelRef
  characterModel: ProviderModelRef | null
  outlineAgent: ReturnType<typeof getAgent>
  characterAgent: ReturnType<typeof getAgent>
  storyPlannerAgent: ReturnType<typeof getAgent>
}

export interface FullRuntime {
  providerStore: ReturnType<typeof useProviderStore>
  planningModel: ProviderModelRef
  chapterPlannerModel: ProviderModelRef
  writerModel: ProviderModelRef
  proofreaderModel: ProviderModelRef
  polisherModel: ProviderModelRef
  storyPlannerAgent: ReturnType<typeof getAgent>
  chapterTitlePlannerAgent: ReturnType<typeof getAgent>
  chapterPlannerAgent: ReturnType<typeof getAgent>
  writerAgent: ReturnType<typeof getAgent>
  proofreaderAgent: ReturnType<typeof getAgent>
  polisherAgent: ReturnType<typeof getAgent>
  relationshipTrackerAgent: ReturnType<typeof getAgent>
}

export function getModelForStage(
  providerStore: ReturnType<typeof useProviderStore>,
  stage: PipelineStage
) {
  const role = stage === 'planning'
    ? 'outline'
    : stage === 'chapter-outline' || stage === 'chapter-outline-review'
      ? 'chapterPlanner'
      : stage === 'writing'
        ? 'writer'
        : stage === 'proofreading'
          ? 'proofreader'
        : 'polisher'

  return providerStore.requireAgentModelRef(role)
}

export function getContextTokens(
  providerStore: ReturnType<typeof useProviderStore>,
  modelRef: { providerId: string; modelId: string }
): number | null {
  const match = providerStore.getModelByRef(modelRef)
  return match?.model.contextTokens ?? null
}

export function getLinkedKnowledgeBases(project: StoryProject) {
  const knowledgeStore = useKnowledgeStore()
  return knowledgeStore.knowledgeBases.filter(base => project.knowledgeBaseIds.includes(base.id))
}

export async function buildKnowledgeContextForProject(
  project: StoryProject,
  queryInput: Parameters<typeof buildKnowledgeQuery>[0],
  maxTokens = 2400
) {
  const bases = getLinkedKnowledgeBases(project)
  if (!bases.length) return ''

  const query = buildKnowledgeQuery(queryInput)
  if (!query.trim()) return ''

  const dynamicBudget = Math.max(
    maxTokens,
    Math.min(8000, 2200 + Math.max(0, bases.length - 1) * 900)
  )

  return buildKnowledgeContextAsync(bases, query, dynamicBudget)
}

export function prepareProviderRuntime() {
  const providerStore = useProviderStore()
  providerManager.setProviders(providerStore.providers)
  providerStore.ensureAgentModelBindings()
  return providerStore
}

export function preparePlanningRuntime(): PlanningRuntime {
  const providerStore = prepareProviderRuntime()
  const planningModel = getModelForStage(providerStore, 'planning')
  if (!planningModel) {
    throw new Error('At least one usable model is required for story planning.')
  }

  const outlineAgent = getAgent('outline')
  const characterAgent = getAgent('character')
  const storyPlannerAgent = getAgent('storyPlanner')

  outlineAgent.setModel(planningModel, 2048, 0.55, getContextTokens(providerStore, planningModel))
  storyPlannerAgent.setModel(planningModel, 3072, 0.6, getContextTokens(providerStore, planningModel))

  const characterModel = providerStore.getAgentModelBinding('character') ?? providerStore.getDefaultModelRefForRole('character')
  characterAgent.setModel(
    characterModel ?? null,
    4096,
    0.7,
    characterModel ? getContextTokens(providerStore, characterModel) : null
  )

  return {
    providerStore,
    planningModel,
    characterModel,
    outlineAgent,
    characterAgent,
    storyPlannerAgent,
  }
}

export function prepareRuntime(): FullRuntime {
  const providerStore = prepareProviderRuntime()

  const planningModel = getModelForStage(providerStore, 'planning')
  const chapterPlannerModel = getModelForStage(providerStore, 'chapter-outline')
  const writerModel = getModelForStage(providerStore, 'writing')
  const proofreaderModel = getModelForStage(providerStore, 'proofreading')
  const polisherModel = getModelForStage(providerStore, 'polishing')

  if (!planningModel || !chapterPlannerModel || !writerModel || !proofreaderModel || !polisherModel) {
    throw new Error('At least one usable model is required for every Agent role.')
  }

  const storyPlannerAgent = getAgent('storyPlanner')
  const chapterTitlePlannerAgent = getAgent('chapterTitlePlanner')
  const chapterPlannerAgent = getAgent('chapterPlanner')
  const writerAgent = getAgent('writer')
  const proofreaderAgent = getAgent('proofreader')
  const polisherAgent = getAgent('polisher')
  const relationshipTrackerAgent = getAgent('relationshipTracker')

  storyPlannerAgent.setModel(planningModel, 3072, 0.6, getContextTokens(providerStore, planningModel))
  chapterTitlePlannerAgent.setModel(chapterPlannerModel, 4096, 0.7, getContextTokens(providerStore, chapterPlannerModel))
  chapterPlannerAgent.setModel(chapterPlannerModel, 3072, 0.6, getContextTokens(providerStore, chapterPlannerModel))
  writerAgent.setModel(writerModel, 4096, 0.8, getContextTokens(providerStore, writerModel))
  proofreaderAgent.setModel(proofreaderModel, 4096, 0.2, getContextTokens(providerStore, proofreaderModel))
  polisherAgent.setModel(polisherModel, 2048, 0.5, getContextTokens(providerStore, polisherModel))
  /**
   * The relationship tracker reuses the proofreader model because it performs
   * a lightweight analysis pass over already-written content (character
   * interactions in finished chapters). This avoids an extra model binding
   * requirement without sacrificing inference quality.
   */
  relationshipTrackerAgent.setModel(proofreaderModel, 2048, 0.2, getContextTokens(providerStore, proofreaderModel))

  return {
    providerStore,
    planningModel,
    chapterPlannerModel,
    writerModel,
    proofreaderModel,
    polisherModel,
    storyPlannerAgent,
    chapterTitlePlannerAgent,
    chapterPlannerAgent,
    writerAgent,
    proofreaderAgent,
    polisherAgent,
    relationshipTrackerAgent,
  }
}

export function resolveChapterCount(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(9999, Math.trunc(parsed)))
    : 8
}
