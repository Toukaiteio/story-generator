import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project'
import type { KnowledgeBase, KnowledgeDocument, SearchResult } from '@/types/knowledge'
import { knowledgeService } from '@/services/knowledge'
import { importKnowledgeBase as importKnowledgeBaseRecord, normalizeKnowledgeBases } from '@/services/knowledge/storage'
import { readJsonStorage, writeJsonStorage } from '@/lib/storage'

const KNOWLEDGE_STORAGE_KEY = 'story-generator.knowledge.v1'
const ACTIVE_KB_STORAGE_KEY = 'story-generator.knowledge.active.v1'

export const useKnowledgeStore = defineStore('knowledge', () => {
  const knowledgeBases = ref<KnowledgeBase[]>(normalizeKnowledgeBases(readJsonStorage<Partial<KnowledgeBase>[]>(KNOWLEDGE_STORAGE_KEY, [])))
  const activeKbId = ref<string | null>(readJsonStorage<string | null>(ACTIVE_KB_STORAGE_KEY, null))
  const searchResults = ref<SearchResult[]>([])

  const activeKnowledgeBase = computed(() =>
    knowledgeBases.value.find(kb => kb.id === activeKbId.value) ?? null
  )

  const sortedKnowledgeBases = computed(() =>
    [...knowledgeBases.value].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  )

  function persistState() {
    writeJsonStorage(KNOWLEDGE_STORAGE_KEY, knowledgeBases.value)
    writeJsonStorage(ACTIVE_KB_STORAGE_KEY, activeKbId.value)
  }

  function reconcileActiveKnowledgeBase() {
    if (activeKbId.value && !knowledgeBases.value.some(kb => kb.id === activeKbId.value)) {
      activeKbId.value = knowledgeBases.value[0]?.id ?? null
    } else if (!activeKbId.value && knowledgeBases.value.length) {
      activeKbId.value = knowledgeBases.value[0].id
    }
  }

  function createKnowledgeBase(name: string, description: string) {
    const kb = knowledgeService.createBase(name, description)
    knowledgeBases.value.push(kb)
    if (!activeKbId.value) {
      activeKbId.value = kb.id
    }
    return kb
  }

  function getKnowledgeBaseById(kbId: string) {
    return knowledgeBases.value.find(k => k.id === kbId) ?? null
  }

  function updateKnowledgeBase(kbId: string, updates: Partial<Pick<KnowledgeBase, 'name' | 'description' | 'tags' | 'mode' | 'embedding'>>) {
    const kb = getKnowledgeBaseById(kbId)
    if (!kb) return null
    return knowledgeService.updateBase(kb, updates)
  }

  function setKnowledgeBaseMode(kbId: string, mode: KnowledgeBase['mode']) {
    const kb = getKnowledgeBaseById(kbId)
    if (!kb) return null
    return knowledgeService.updateBase(kb, { mode })
  }

  function setKnowledgeBaseEmbedding(kbId: string, providerModelRef: KnowledgeBase['embedding']['providerModelRef'], dimensions?: number | null) {
    const kb = getKnowledgeBaseById(kbId)
    if (!kb) return null
    return knowledgeService.updateBase(kb, { embedding: { providerModelRef, dimensions } })
  }

  async function reindexKnowledgeBase(kbId: string) {
    const kb = getKnowledgeBaseById(kbId)
    if (!kb) return null
    return knowledgeService.reindexBase(kb)
  }

  async function removeKnowledgeBase(kbId: string) {
    const index = knowledgeBases.value.findIndex(k => k.id === kbId)
    if (index === -1) return
    knowledgeBases.value.splice(index, 1)
    if (activeKbId.value === kbId) {
      activeKbId.value = knowledgeBases.value[0]?.id ?? null
    }

    const projectStore = useProjectStore()
    await Promise.all(
      projectStore.projects
        .filter(project => Array.isArray(project.knowledgeBaseIds) && project.knowledgeBaseIds.includes(kbId))
        .map(project =>
          projectStore.updateProject(project.id, {
            knowledgeBaseIds: project.knowledgeBaseIds.filter(id => id !== kbId),
          })
        )
    )
  }

  function addDocument(
    kbId: string,
    name: string,
    content: string,
    source: 'upload' | 'manual',
    options: { fileType?: string; sourceName?: string } = {}
  ) {
    const kb = getKnowledgeBaseById(kbId)
    if (!kb) return null
    return knowledgeService.addDocument(kb, name, content, source, options)
  }

  function updateDocument(
    kbId: string,
    documentId: string,
    updates: Partial<Pick<KnowledgeDocument, 'name' | 'content' | 'fileType' | 'sourceName'>>
  ) {
    const kb = getKnowledgeBaseById(kbId)
    if (!kb) return null
    return knowledgeService.updateDocument(kb, documentId, updates)
  }

  function removeDocument(kbId: string, documentId: string) {
    const kb = getKnowledgeBaseById(kbId)
    if (!kb) return
    knowledgeService.removeDocument(kb, documentId)
  }

  function search(kbId: string, query: string) {
    const kb = getKnowledgeBaseById(kbId)
    if (!kb) {
      searchResults.value = []
      return
    }
    searchResults.value = knowledgeService.search(kb, query)
  }

  async function searchAsync(kbId: string, query: string) {
    const kb = getKnowledgeBaseById(kbId)
    if (!kb) {
      searchResults.value = []
      return
    }
    searchResults.value = await knowledgeService.searchAsync(kb, query)
  }

  function importKnowledgeBase(data: any) {
    const kb = importKnowledgeBaseRecord(data)
    knowledgeBases.value.push(kb)
    activeKbId.value = kb.id
    return kb
  }

  function setActiveKnowledgeBase(kbId: string | null) {
    if (!kbId) {
      activeKbId.value = null
      return
    }

    activeKbId.value = knowledgeBases.value.some(kb => kb.id === kbId) ? kbId : null
  }

  reconcileActiveKnowledgeBase()
  persistState()
  watch(knowledgeBases, persistState, { deep: true })
  watch(knowledgeBases, reconcileActiveKnowledgeBase, { deep: true })
  watch(activeKbId, persistState)

  return {
    knowledgeBases,
    sortedKnowledgeBases,
    activeKbId,
    activeKnowledgeBase,
    searchResults,
    createKnowledgeBase,
    getKnowledgeBaseById,
    updateKnowledgeBase,
    setKnowledgeBaseMode,
    setKnowledgeBaseEmbedding,
    reindexKnowledgeBase,
    removeKnowledgeBase,
    addDocument,
    updateDocument,
    removeDocument,
    search,
    searchAsync,
    importKnowledgeBase,
    setActiveKnowledgeBase,
  }
})
