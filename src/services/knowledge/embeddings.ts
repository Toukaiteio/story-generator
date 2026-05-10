import { providerManager } from '@/services/provider'
import type { ProviderModelRef } from '@/types/provider'

export interface EmbeddingRequest {
  text: string
  model: ProviderModelRef
}

function normalizeVector(values: number[]) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  if (!norm) return values.map(() => 0)
  return values.map(value => value / norm)
}

function hashTextToVector(text: string, dimensions = 64) {
  const vector = new Array(dimensions).fill(0)
  const normalized = text.toLowerCase()
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i)
    const index = (code + i * 31) % dimensions
    vector[index] += ((code % 37) + 1) / 37
  }
  return normalizeVector(vector)
}

export async function createTextEmbedding({ text, model }: EmbeddingRequest): Promise<number[]> {
  const provider = providerManager.getModelConfigForRef(model)
  if (!provider) {
    return hashTextToVector(text)
  }

  const providerType = provider.provider.type
  const baseUrl = provider.provider.baseUrl.replace(/\/+$/, '')
  const apiKey = provider.provider.apiKey ?? ''

  try {
    if (window.electronAPI?.provider?.createEmbedding) {
      const payload = await window.electronAPI.provider.createEmbedding({
        type: providerType,
        apiKey,
        baseUrl,
        model: model.modelId,
        text,
      })
      const embedding = payload?.data?.[0]?.embedding
      if (Array.isArray(embedding)) {
        return embedding.map((value: any) => Number(value)).filter(Number.isFinite)
      }
    }

    if (typeof window !== 'undefined') {
      const response = await fetch('/api/provider/create-embedding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: providerType,
          apiKey,
          baseUrl,
          model: model.modelId,
          text,
        }),
      })

      if (response.ok) {
        const payload = await response.json()
        const embedding = payload?.data?.[0]?.embedding
        if (Array.isArray(embedding)) {
          return embedding.map((value: any) => Number(value)).filter(Number.isFinite)
        }
      }
    }

    if (providerType === 'openai' || providerType === 'openai-responses') {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey ? `Bearer ${apiKey}` : '',
        },
        body: JSON.stringify({
          model: model.modelId,
          input: text,
        }),
      })

      if (response.ok) {
        const payload = await response.json()
        const embedding = payload?.data?.[0]?.embedding
        if (Array.isArray(embedding)) {
          return embedding.map((value: any) => Number(value)).filter(Number.isFinite)
        }
      }
    }

    if (providerType === 'google') {
      const endpoint = `${baseUrl}/v1beta/models/${model.modelId}:embedContent`
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (apiKey) {
        headers['x-goog-api-key'] = apiKey
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          content: { parts: [{ text }] },
        }),
      })
      if (response.ok) {
        const payload = await response.json()
        const values = payload?.embedding?.values
        if (Array.isArray(values)) {
          return values.map((value: any) => Number(value)).filter(Number.isFinite)
        }
      }
    }

    if (providerType === 'anthropic') {
      return hashTextToVector(text)
    }
  } catch {
    // Fall through to local fallback embedding.
  }

  return hashTextToVector(text)
}
