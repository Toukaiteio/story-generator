import { useProjectStore } from '@/stores/project'
import { useProviderStore } from '@/stores/provider'
import { useKnowledgeStore } from '@/stores/knowledge'
import { useWritingStyleStore } from '@/stores/writingStyle'
import { useUiStore } from '@/stores/ui'
import { providerManager } from '@/services/provider'

/**
 * Read/command ports for the data the UI renders. These are intentionally thin:
 * the UI depends on the port, while the concrete Pinia store stays an engine
 * implementation detail that can be swapped later.
 */
export function useStoryProject() {
  return useProjectStore()
}

export type StoryProjectPort = ReturnType<typeof useStoryProject>

export function useModelCatalog() {
  return useProviderStore()
}

export type ModelCatalogPort = ReturnType<typeof useModelCatalog>

/** Low-level provider runtime, reserved for advanced tool/streaming workflows. */
export function useProviderRuntime() {
  return providerManager
}

export function useKnowledgeLibrary() {
  return useKnowledgeStore()
}

export type KnowledgeLibraryPort = ReturnType<typeof useKnowledgeLibrary>

export function useWritingStyleLibrary() {
  return useWritingStyleStore()
}

export type WritingStyleLibraryPort = ReturnType<typeof useWritingStyleLibrary>

export function useWorkspaceUi() {
  return useUiStore()
}
