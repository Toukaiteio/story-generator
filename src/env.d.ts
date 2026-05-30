/// <reference types="vite/client" />

import type { ProviderType } from './types/provider'
import type { UnsavedChapterLocation } from './services/unsaved'

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

declare global {
  interface ElectronAPI {
    window: {
      minimize: () => void
      maximize: () => void
      close: () => void
      isMaximized: () => Promise<boolean>
      setUnsavedChanges: (payload: boolean | UnsavedStatePayload) => void
      onCloseRequested: (callback: () => void) => () => void
      confirmCloseHandled: (action: 'cancel' | 'discard') => void
    }
    app: {
      getPath: (name: 'documents' | 'downloads' | 'desktop' | 'userData') => Promise<string | null>
    }
    updater: {
      getStatus: () => Promise<UpdaterStatus>
      check: () => Promise<UpdaterStatus>
      install: () => Promise<boolean>
      onStatus: (callback: (status: UpdaterStatus) => void) => () => void
    }
    storage: {
      readJson: (key: string) => unknown
      writeJson: (key: string, value: unknown) => boolean
      removeJson: (key: string) => boolean
    }
    shell: {
      reveal: (path: string) => Promise<boolean>
    }
    project: {
      list: () => Promise<any[]>
      load: (id: string, directoryPath?: string) => Promise<any | null>
      save: (project: any, directoryPath?: string) => Promise<any>
      delete: (id: string, directoryPath?: string, deleteFiles?: boolean) => Promise<boolean>
    }
    vibeChat: {
      load: (projectId: string, directoryPath: string | undefined, key: string) => Promise<any | null>
      save: (projectId: string, directoryPath: string | undefined, key: string, payload: any) => Promise<boolean>
    }
    provider: {
      listModels: (request: { type: ProviderType; apiKey: string; baseUrl: string }) => Promise<any>
      createEmbedding: (request: { type: ProviderType; apiKey: string; baseUrl: string; model: string; text: string }) => Promise<any>
    }
    dialog: {
      openFile: (options?: any) => Promise<string | null>
      openFiles: (options?: any) => Promise<string[] | null>
      openDirectory: (options?: any) => Promise<string | null>
      saveFile: (options?: any) => Promise<string | null>
    }
    file: {
      read: (path: string) => Promise<string | null>
      readBinary: (path: string) => Promise<string | null>
      write: (path: string, content: string) => Promise<boolean>
      writeBinary: (path: string, base64: string) => Promise<boolean>
    }
  }

  interface UnsavedStatePayload {
    hasUnsavedChanges: boolean
    entries?: UnsavedChapterLocation[]
  }

  interface UpdaterStatus {
    state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
    message: string
    version?: string
    progress?: number
    checkedAt?: string
  }

  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
