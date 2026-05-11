import { readJsonStorage } from '@/lib/storage'

const UI_STORAGE_KEY = 'story-generator.ui.v1'

interface UiPromptSettings {
  customSystemPrompt?: string
}

export function normalizeCustomSystemPrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function getCustomSystemPrompt(): string {
  const persisted = readJsonStorage<UiPromptSettings>(UI_STORAGE_KEY, {})
  return normalizeCustomSystemPrompt(persisted.customSystemPrompt)
}

export function injectCustomSystemPrompt(systemPrompt: string): string {
  const customPrompt = getCustomSystemPrompt()
  if (!customPrompt) return systemPrompt
  if (systemPrompt.startsWith(customPrompt)) return systemPrompt
  return `${customPrompt}\n\n${systemPrompt}`
}
