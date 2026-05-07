export type ID = string

export interface Timestamps {
  createdAt: string
  updatedAt: string
}

export type SidebarItem = 'projects' | 'workspace' | 'knowledge' | 'writingStyles' | 'providers' | 'settings'

export interface ModalState {
  id: string
  component: string
  props?: Record<string, any>
}

export interface Toast {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  message: string
  duration?: number
}
