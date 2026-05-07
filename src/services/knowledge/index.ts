import type { KnowledgeBase, KnowledgeDocument, SearchResult } from '@/types/knowledge'
import type { KnowledgeEmbeddingConfig } from '@/types/knowledge'
import { searchChunks } from './search'
import { searchVectorChunks, mergeSearchResults } from './vector'
import { createKnowledgeBase, createDocument } from './storage'
import { chunkText } from './chunker'
import { createTextEmbedding } from './embeddings'

function allChunks(kb: KnowledgeBase) {
  return kb.documents.flatMap(doc => doc.chunks)
}

export class KnowledgeBaseService {
  createBase(name: string, description: string): KnowledgeBase {
    return createKnowledgeBase(name, description)
  }

  search(kb: KnowledgeBase, query: string, limit = 5): SearchResult[] {
    const keywordResults = searchChunks(allChunks(kb), query, limit)
    if (kb.mode === 'keyword') return keywordResults

    const vectorResults = this.searchVector(kb, query, limit)
    if (kb.mode === 'vector') return vectorResults.length ? vectorResults : keywordResults

    return mergeSearchResults(keywordResults, vectorResults, limit)
  }

  async searchAsync(kb: KnowledgeBase, query: string, limit = 5): Promise<SearchResult[]> {
    const keywordResults = searchChunks(allChunks(kb), query, limit)
    if (kb.mode === 'keyword') return keywordResults

    const vectorResults = await this.searchVectorAsync(kb, query, limit)
    if (kb.mode === 'vector') return vectorResults.length ? vectorResults : keywordResults

    return mergeSearchResults(keywordResults, vectorResults, limit)
  }

  addDocument(
    kb: KnowledgeBase,
    name: string,
    content: string,
    source: 'upload' | 'manual',
    options: { fileType?: string; sourceName?: string } = {}
  ): KnowledgeDocument {
    const doc = createDocument(name, content, source, options)
    kb.documents.push(doc)
    kb.indexingStatus = 'idle'
    kb.indexingError = null
    kb.lastIndexedAt = null
    kb.updatedAt = new Date().toISOString()
    return doc
  }

  removeDocument(kb: KnowledgeBase, documentId: string): void {
    kb.documents = kb.documents.filter(d => d.id !== documentId)
    kb.indexingStatus = 'idle'
    kb.indexingError = null
    kb.lastIndexedAt = null
    kb.updatedAt = new Date().toISOString()
  }

  updateDocument(
    kb: KnowledgeBase,
    documentId: string,
    updates: Partial<Pick<KnowledgeDocument, 'name' | 'content' | 'fileType' | 'sourceName'>>
  ): KnowledgeDocument | null {
    const index = kb.documents.findIndex(doc => doc.id === documentId)
    if (index === -1) return null

    const current = kb.documents[index]
    const next: KnowledgeDocument = {
      ...current,
      ...updates,
      name: updates.name?.trim() || current.name,
      content: typeof updates.content === 'string' ? updates.content : current.content,
      fileType: updates.fileType ?? current.fileType,
      sourceName: updates.sourceName?.trim() || current.sourceName,
      updatedAt: new Date().toISOString(),
      tokenCount: Math.ceil((typeof updates.content === 'string' ? updates.content : current.content).length / 4),
    }

    next.chunks = chunkText(next.content, next.id)
    kb.documents[index] = next
    kb.indexingStatus = 'idle'
    kb.indexingError = null
    kb.lastIndexedAt = null
    kb.updatedAt = new Date().toISOString()
    return next
  }

  updateBase(
    base: KnowledgeBase,
    updates: Partial<Pick<KnowledgeBase, 'name' | 'description' | 'tags' | 'mode' | 'embedding'>>
  ) {
    if (typeof updates.name === 'string' && updates.name.trim()) {
      base.name = updates.name.trim()
    }
    if (typeof updates.description === 'string') {
      base.description = updates.description
    }
    if (Array.isArray(updates.tags)) {
      base.tags = updates.tags.map(tag => String(tag).trim()).filter(Boolean)
    }
    if (updates.mode === 'keyword' || updates.mode === 'vector' || updates.mode === 'hybrid') {
      base.mode = updates.mode
    }
    if (updates.embedding) {
      base.embedding = this.normalizeEmbeddingConfig(updates.embedding)
    }
    if (updates.mode || updates.embedding) {
      base.indexingStatus = 'idle'
      base.indexingError = null
      base.lastIndexedAt = null
    }
    base.updatedAt = new Date().toISOString()
    return base
  }

  normalizeEmbeddingConfig(value: Partial<KnowledgeEmbeddingConfig> | null | undefined): KnowledgeEmbeddingConfig {
    const ref = value?.providerModelRef ?? null
    return {
      providerModelRef: ref && ref.providerId && ref.modelId ? ref : null,
      dimensions: Number.isFinite(Number(value?.dimensions)) && Number(value?.dimensions) > 0
        ? Number(value?.dimensions)
        : null,
      metric: value?.metric === 'dot' || value?.metric === 'euclidean' ? value.metric : 'cosine',
    }
  }

  async reindexBase(kb: KnowledgeBase) {
    const modelRef = kb.embedding.providerModelRef
    if (!modelRef) {
      kb.indexingStatus = 'error'
      kb.indexingError = 'No embedding model configured'
      kb.updatedAt = new Date().toISOString()
      return kb
    }

    kb.indexingStatus = 'indexing'
    kb.indexingError = null
    kb.updatedAt = new Date().toISOString()

    if (typeof window !== 'undefined') {
      // Keep a fresh status on the same record before the async embedding pass completes.
    }

    for (const doc of kb.documents) {
      for (const chunk of doc.chunks) {
        chunk.embedding = await createTextEmbedding({
          text: chunk.content,
          model: modelRef,
        })
      }
    }

    kb.indexingStatus = 'ready'
    kb.lastIndexedAt = new Date().toISOString()
    kb.updatedAt = new Date().toISOString()
    return kb
  }

  async buildQueryEmbedding(kb: KnowledgeBase, query: string): Promise<number[]> {
    const modelRef = kb.embedding.providerModelRef
    if (!modelRef) return []
    return createTextEmbedding({ text: query, model: modelRef })
  }

  searchVector(kb: KnowledgeBase, query: string, limit = 5): SearchResult[] {
    if (!query.trim()) return []
    const embedding = this.computeFallbackEmbedding(query)
    return searchVectorChunks(allChunks(kb), embedding, query, limit)
  }

  async searchVectorAsync(kb: KnowledgeBase, query: string, limit = 5): Promise<SearchResult[]> {
    if (!query.trim()) return []
    const embedding = await this.buildQueryEmbedding(kb, query)
    if (!embedding.length) return []
    return searchVectorChunks(allChunks(kb), embedding, query, limit)
  }

  getContextForGeneration(kb: KnowledgeBase, query: string, maxTokens = 2000): string {
    const results = this.search(kb, query, 10)
    return this.mergeContext(results, maxTokens)
  }

  async getContextForGenerationAsync(kb: KnowledgeBase, query: string, maxTokens = 2000): Promise<string> {
    const results = await this.searchAsync(kb, query, 10)
    return this.mergeContext(results, maxTokens)
  }

  private mergeContext(results: SearchResult[], maxTokens: number) {
    let context = ''
    let tokenCount = 0

    for (const result of results) {
      const chunkTokens = result.chunk.tokenCount
      if (tokenCount + chunkTokens > maxTokens) break
      context += result.chunk.content + '\n\n'
      tokenCount += chunkTokens
    }

    return context.trim()
  }

  private computeFallbackEmbedding(query: string) {
    const normalized = query.toLowerCase()
    const vector = new Array(64).fill(0)
    for (let i = 0; i < normalized.length; i++) {
      const code = normalized.charCodeAt(i)
      vector[(code + i * 17) % 64] += ((code % 31) + 1) / 31
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
    return norm ? vector.map(value => value / norm) : vector
  }
}

export const knowledgeService = new KnowledgeBaseService()
