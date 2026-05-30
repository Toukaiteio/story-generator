import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    setUnsavedChanges: (payload: boolean | { hasUnsavedChanges: boolean; entries?: unknown[] }) => ipcRenderer.send('window:set-unsaved-changes', payload),
    onCloseRequested: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('window:close-requested', listener)
      return () => ipcRenderer.removeListener('window:close-requested', listener)
    },
    confirmCloseHandled: (action: 'cancel' | 'discard') => ipcRenderer.send('window:close-request-response', action),
  },

  // App info
  app: {
    getPath: (name: string) => ipcRenderer.invoke('app:get-path', name),
  },

  updater: {
    getStatus: () => ipcRenderer.invoke('updater:get-status'),
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (callback: (status: any) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: any) => callback(status)
      ipcRenderer.on('updater:status', listener)
      return () => ipcRenderer.removeListener('updater:status', listener)
    },
  },

  // Persistent storage in userData
  storage: {
    readJson: (key: string) => ipcRenderer.sendSync('storage:read-json', key),
    writeJson: (key: string, value: any) => ipcRenderer.sendSync('storage:write-json', key, value),
    removeJson: (key: string) => ipcRenderer.sendSync('storage:remove-json', key),
  },

  // Shell operations
  shell: {
    reveal: (path: string) => ipcRenderer.invoke('shell:reveal', path),
  },

  // Project operations
  project: {
    list: () => ipcRenderer.invoke('project:list'),
    load: (id: string, directoryPath?: string) => ipcRenderer.invoke('project:load', id, directoryPath),
    save: (project: any, directoryPath?: string) => ipcRenderer.invoke('project:save', project, directoryPath),
    delete: (id: string, directoryPath?: string, deleteFiles?: boolean) => ipcRenderer.invoke('project:delete', id, directoryPath, deleteFiles),
  },

  vibeChat: {
    load: (projectId: string, directoryPath: string | undefined, key: string) => ipcRenderer.invoke('vibe-chat:load', { projectId, directoryPath, key }),
    save: (projectId: string, directoryPath: string | undefined, key: string, payload: any) => ipcRenderer.invoke('vibe-chat:save', { projectId, directoryPath, key, payload }),
  },

  // Provider operations
  provider: {
    listModels: (request: any) => ipcRenderer.invoke('provider:list-models', request),
    createEmbedding: (request: any) => ipcRenderer.invoke('provider:create-embedding', request),
  },

  // Dialog operations
  dialog: {
    openFile: (options?: any) => ipcRenderer.invoke('dialog:open-file', options),
    openFiles: (options?: any) => ipcRenderer.invoke('dialog:open-files', options),
    openDirectory: (options?: any) => ipcRenderer.invoke('dialog:open-directory', options),
    saveFile: (options?: any) => ipcRenderer.invoke('dialog:save-file', options),
  },

  // File operations
  file: {
    read: (path: string) => ipcRenderer.invoke('file:read', path),
    readBinary: (path: string) => ipcRenderer.invoke('file:read-binary', path),
    write: (path: string, content: string) => ipcRenderer.invoke('file:write', path, content),
    writeBinary: (path: string, base64: string) => ipcRenderer.invoke('file:write-binary', path, base64),
  },
})
