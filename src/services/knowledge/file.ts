import type { KnowledgeBase } from '@/types/knowledge'
import { sanitizeFileName } from '@/services/projectFile'

export const KNOWLEDGE_BASE_FILE_TYPE = 'story-generator-knowledge-base'
export const KNOWLEDGE_BASE_FILE_VERSION = 1
export const KNOWLEDGE_BASE_FILE_EXTENSION = '.storyknowledge.json'

export interface StoryKnowledgeBaseFileV1 {
  type: typeof KNOWLEDGE_BASE_FILE_TYPE
  version: typeof KNOWLEDGE_BASE_FILE_VERSION
  exportedAt: string
  knowledgeBase: KnowledgeBase
}

export function buildKnowledgeBaseFileName(base: Pick<KnowledgeBase, 'name'>) {
  return `${sanitizeFileName(base.name)}${KNOWLEDGE_BASE_FILE_EXTENSION}`
}

export function serializeKnowledgeBaseFile(base: KnowledgeBase) {
  const payload: StoryKnowledgeBaseFileV1 = {
    type: KNOWLEDGE_BASE_FILE_TYPE,
    version: KNOWLEDGE_BASE_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    knowledgeBase: base,
  }

  return JSON.stringify(payload, null, 2)
}

export function parseKnowledgeBaseFile(content: string): any {
  const raw = JSON.parse(content)
  if (
    raw &&
    typeof raw === 'object' &&
    raw.type === KNOWLEDGE_BASE_FILE_TYPE &&
    raw.knowledgeBase
  ) {
    return raw.knowledgeBase
  }
  return raw
}
