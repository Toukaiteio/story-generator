import { readJsonStorage } from '@/lib/storage'
import { withHumanizer } from '@/services/humanizer'

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
  const base = withHumanizer(systemPrompt)
  const customPrompt = getCustomSystemPrompt()
  if (!customPrompt) return base
  if (base.startsWith(customPrompt)) return base
  return `${customPrompt}\n\n${base}`
}
