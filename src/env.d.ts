/// <reference types="vite/client" />

import type { ProviderType } from './types/provider'

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
    }
    app: {
      getPath: (name: 'documents' | 'downloads' | 'desktop' | 'userData') => Promise<string | null>
    }
    shell: {
      reveal: (path: string) => Promise<boolean>
    }
    project: {
      list: () => Promise<any[]>
      load: (id: string, directoryPath?: string) => Promise<any | null>
      save: (project: any, directoryPath?: string) => Promise<any>
      delete: (id: string) => Promise<boolean>
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

  interface Window {
    electronAPI?: ElectronAPI
  }
}

export {}
