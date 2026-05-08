import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
  },

  // App info
  app: {
    getPath: (name: string) => ipcRenderer.invoke('app:get-path', name),
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
    delete: (id: string) => ipcRenderer.invoke('project:delete', id),
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
