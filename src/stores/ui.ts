import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { SidebarItem, Toast } from '@/types/common'
import { readJsonStorage, writeJsonStorage } from '@/lib/storage'
import en from '@/i18n/en'
import zh from '@/i18n/zh'

const messages = { en, zh }
type Language = 'en' | 'zh'

const UI_STORAGE_KEY = 'story-generator.ui.v1'

interface PersistedUiState {
  activeSidebarItem: SidebarItem
  activeWorkspaceNode: string | null
  language: Language
  defaultStoragePath: string
}

function isSidebarItem(value: unknown): value is SidebarItem {
  return value === 'projects' || value === 'workspace' || value === 'knowledge' || value === 'providers' || value === 'settings'
}

export const useUiStore = defineStore('ui', () => {
  const persisted = readJsonStorage<Partial<PersistedUiState>>(UI_STORAGE_KEY, {})
  const activeSidebarItem = ref<SidebarItem>(isSidebarItem(persisted.activeSidebarItem) ? persisted.activeSidebarItem : 'projects')
  const activeWorkspaceNode = ref<string | null>(persisted.activeWorkspaceNode ?? null)
  const language = ref<Language>(persisted.language === 'zh' ? 'zh' : 'en')
  const defaultStoragePath = ref<string>(persisted.defaultStoragePath ?? '')
  const toasts = ref<Toast[]>([])

  // Initialize default path if empty
  if (!defaultStoragePath.value && window.electronAPI?.app?.getPath) {
    window.electronAPI.app.getPath('documents').then(path => {
      if (path) {
        defaultStoragePath.value = path
        persistState()
      }
    })
  }

  let toastIdCounter = 0

  function persistState() {
    const nextState: PersistedUiState = {
      activeSidebarItem: activeSidebarItem.value,
      activeWorkspaceNode: activeWorkspaceNode.value,
      language: language.value,
      defaultStoragePath: defaultStoragePath.value,
    }
    writeJsonStorage(UI_STORAGE_KEY, nextState)
  }

  function setDefaultStoragePath(path: string) {
    defaultStoragePath.value = path
  }

  function setLanguage(lang: Language) {
    language.value = lang
  }

  function t(path: string): string {
    const keys = path.split('.')
    let current: any = messages[language.value]

    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key]
      } else {
        return path
      }
    }

    return typeof current === 'string' ? current : path
  }

  function navigateTo(item: SidebarItem) {
    activeSidebarItem.value = item
  }

  function setWorkspaceNode(node: string | null) {
    activeWorkspaceNode.value = node
  }

  function addToast(toast: Omit<Toast, 'id'>) {
    const id = `toast-${++toastIdCounter}`
    const duration = toast.duration ?? 4000
    toasts.value.push({ ...toast, id })

    if (duration > 0) {
      setTimeout(() => removeToast(id), duration)
    }
  }

  function removeToast(id: string) {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index !== -1) toasts.value.splice(index, 1)
  }

  persistState()
  watch(activeSidebarItem, persistState)
  watch(activeWorkspaceNode, persistState)
  watch(language, persistState)
  watch(defaultStoragePath, persistState)

  return {
    activeSidebarItem,
    activeWorkspaceNode,
    language,
    defaultStoragePath,
    toasts,
    navigateTo,
    setWorkspaceNode,
    setLanguage,
    setDefaultStoragePath,
    t,
    addToast,
    removeToast,
  }
})
