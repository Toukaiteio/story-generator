import type { DocumentChunk, KnowledgeBase, KnowledgeDocument } from '@/types/knowledge'
import type { KnowledgeBaseMode, KnowledgeEmbeddingConfig, KnowledgeEmbeddingStatus } from '@/types/knowledge'
import { generateId } from '@/lib/id'
import { chunkText, estimateTokens } from './chunker'
import { decodeProviderModelRef } from '@/services/provider/catalog'

function normalizeEmbeddingConfig(value: any): KnowledgeEmbeddingConfig {
  const ref = typeof value?.providerModelRef === 'string'
    ? decodeProviderModelRef(value.providerModelRef)
    : value?.providerModelRef && typeof value.providerModelRef === 'object'
      ? {
          providerId: String(value.providerModelRef.providerId ?? '').trim(),
          modelId: String(value.providerModelRef.modelId ?? '').trim(),
        }
      : null

  return {
    providerModelRef: ref && ref.providerId && ref.modelId ? ref : null,
    dimensions: Number.isFinite(Number(value?.dimensions)) && Number(value?.dimensions) > 0
      ? Number(value.dimensions)
      : null,
    metric: value?.metric === 'dot' || value?.metric === 'euclidean' ? value.metric : 'cosine',
  }
}

function normalizeMode(value: any): KnowledgeBaseMode {
  if (value === 'vector' || value === 'hybrid') return value
  return 'keyword'
}

function normalizeIndexingStatus(value: any): KnowledgeEmbeddingStatus {
  if (value === 'indexing' || value === 'ready' || value === 'error') return value
  return 'idle'
}

export function createKnowledgeBase(name: string, description: string): KnowledgeBase {
  return {
    id: generateId(),
    name,
    description,
    mode: 'keyword',
    embedding: {
      providerModelRef: null,
      dimensions: null,
      metric: 'cosine',
    },
    indexingStatus: 'idle',
    indexingError: null,
    lastIndexedAt: null,
    documents: [],
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function createDocument(
  name: string,
  content: string,
  source: 'upload' | 'manual',
  options: { fileType?: string; sourceName?: string } = {}
): KnowledgeDocument {
  const doc: KnowledgeDocument = {
    id: generateId(),
    name,
    source,
    fileType: options.fileType,
    sourceName: options.sourceName,
    content,
    chunks: [],
    tokenCount: estimateTokens(content),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  doc.chunks = chunkText(content, doc.id)
  return doc
}

function normalizeChunk(chunk: Partial<DocumentChunk>, documentId: string, index: number): DocumentChunk {
  const content = chunk.content ?? ''
  return {
    id: chunk.id?.trim() || generateId(),
    documentId: chunk.documentId?.trim() || documentId,
    index: Number.isFinite(chunk.index) ? Number(chunk.index) : index,
    content,
    keywords: Array.isArray(chunk.keywords) ? chunk.keywords.filter(Boolean) : [],
    embedding: Array.isArray(chunk.embedding) ? chunk.embedding.map(value => Number(value)).filter(Number.isFinite) : undefined,
    tokenCount: Number.isFinite(chunk.tokenCount) && Number(chunk.tokenCount) > 0
      ? Number(chunk.tokenCount)
      : estimateTokens(content),
  }
}

function normalizeDocument(document: Partial<KnowledgeDocument>): KnowledgeDocument {
  const id = document.id?.trim() || generateId()
  const content = document.content ?? ''
  const now = new Date().toISOString()
  const chunks = Array.isArray(document.chunks) && document.chunks.length
    ? document.chunks.map((chunk, index) => normalizeChunk(chunk ?? {}, id, index))
    : chunkText(content, id)

  return {
    id,
    name: document.name?.trim() || id,
    source: document.source === 'upload' ? 'upload' : 'manual',
    fileType: document.fileType,
    sourceName: document.sourceName?.trim() || undefined,
    content,
    chunks,
    tokenCount: Number.isFinite(document.tokenCount) && Number(document.tokenCount) > 0
      ? Number(document.tokenCount)
      : estimateTokens(content),
    createdAt: document.createdAt ?? now,
    updatedAt: document.updatedAt ?? now,
  }
}

export function normalizeKnowledgeBase(base: Partial<KnowledgeBase>): KnowledgeBase {
  const now = new Date().toISOString()

  return {
    id: base.id?.trim() || generateId(),
    name: base.name?.trim() || 'Knowledge Base',
    description: base.description?.trim() || '',
    mode: normalizeMode((base as any).mode),
    embedding: normalizeEmbeddingConfig((base as any).embedding),
    indexingStatus: normalizeIndexingStatus((base as any).indexingStatus),
    indexingError: typeof (base as any).indexingError === 'string' ? String((base as any).indexingError) : null,
    lastIndexedAt: typeof (base as any).lastIndexedAt === 'string' ? (base as any).lastIndexedAt : null,
    documents: Array.isArray(base.documents)
      ? base.documents.map(document => normalizeDocument(document ?? {}))
      : [],
    tags: Array.isArray(base.tags) ? base.tags.filter(Boolean) : [],
    createdAt: base.createdAt ?? now,
    updatedAt: base.updatedAt ?? now,
  }
}

export function normalizeKnowledgeBases(rawBases: Partial<KnowledgeBase>[]) {
  return rawBases.map(base => normalizeKnowledgeBase(base ?? {}))
}

export function importKnowledgeBase(base: Partial<KnowledgeBase>): KnowledgeBase {
  const source = normalizeKnowledgeBase(base)
  const now = new Date().toISOString()

  const documents = source.documents.map((document) => {
    const nextId = generateId()

    return {
      ...document,
      id: nextId,
      chunks: document.chunks.map((chunk, index) => ({
        ...chunk,
        id: generateId(),
        documentId: nextId,
        index,
      })),
      createdAt: now,
      updatedAt: now,
    }
  })

  return {
    ...source,
    id: generateId(),
    name: source.name,
    description: source.description,
    mode: source.mode,
    embedding: source.embedding,
    indexingStatus: 'idle',
    indexingError: null,
    lastIndexedAt: null,
    documents,
    createdAt: now,
    updatedAt: now,
  }
}
