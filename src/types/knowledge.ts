import type { ID, Timestamps } from './common'
import type { ProviderModelRef } from './provider'

export type KnowledgeBaseMode = 'keyword' | 'vector' | 'hybrid'
export type KnowledgeEmbeddingStatus = 'idle' | 'indexing' | 'ready' | 'error'

export interface KnowledgeEmbeddingConfig {
  providerModelRef: ProviderModelRef | null
  dimensions?: number | null
  metric?: 'cosine' | 'dot' | 'euclidean'
}

export interface DocumentChunk {
  id: ID
  documentId: ID
  index: number
  content: string
  embedding?: number[]
  keywords: string[]
  tokenCount: number
}

export interface KnowledgeDocument extends Timestamps {
  id: ID
  name: string
  source: 'upload' | 'manual'
  fileType?: string
  sourceName?: string
  content: string
  chunks: DocumentChunk[]
  tokenCount: number
}

export interface KnowledgeBase extends Timestamps {
  id: ID
  name: string
  description: string
  mode: KnowledgeBaseMode
  embedding: KnowledgeEmbeddingConfig
  indexingStatus: KnowledgeEmbeddingStatus
  indexingError?: string | null
  lastIndexedAt?: string | null
  documents: KnowledgeDocument[]
  tags: string[]
}

export interface SearchResult {
  chunk: DocumentChunk
  score: number
  source: 'vector' | 'keyword'
  highlight: string
}
