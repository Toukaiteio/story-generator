import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { URL } from 'url'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs'
import http from 'http'
import https from 'https'

declare const __dirname: string

let mainWindow: BrowserWindow | null = null
let hasUnsavedChanges = false
let forceClosing = false

const DATA_DIR = join(app.getPath('userData'), 'story-generator')
const PROJECTS_DIR = join(DATA_DIR, 'projects')

function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(PROJECTS_DIR)) mkdirSync(PROJECTS_DIR, { recursive: true })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow?.webContents.openDevTools({ mode: 'detach' })
    })
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.on('close', event => {
    if (!hasUnsavedChanges || forceClosing) return
    event.preventDefault()
    const result = dialog.showMessageBoxSync(mainWindow!, {
      type: 'warning',
      buttons: ['Cancel', 'Close without saving'],
      defaultId: 0,
      cancelId: 0,
      title: 'Unsaved changes',
      message: 'You have unsaved chapter changes.',
      detail: 'Close the app without saving these chapter changes?',
      noLink: true,
    })

    if (result === 1) {
      forceClosing = true
      mainWindow?.close()
    }
  })
}

app.whenReady().then(() => {
  ensureDirs()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Window controls
ipcMain.handle('app:get-path', (_event, name: any) => {
  try {
    return app.getPath(name)
  } catch {
    return null
  }
})

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.on('window:set-unsaved-changes', (_event, value: boolean) => {
  hasUnsavedChanges = Boolean(value)
})

// Shell operations
ipcMain.handle('shell:reveal', (_event, path: string) => {
  if (!path || !existsSync(path)) return false
  shell.showItemInFolder(path)
  return true
})

// Project file operations
function loadFullProject(id: string, folder: string) {
  const metadataPath = join(folder, 'project.json')
  if (!existsSync(metadataPath)) return null
  
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf-8'))
  
  const chapters: any[] = []
  const chaptersDir = join(folder, 'chapters')
  if (existsSync(chaptersDir)) {
    const chapterFiles = readdirSync(chaptersDir).filter(f => f.endsWith('.json') && f !== 'index.json')
    for (const f of chapterFiles) {
      chapters.push(JSON.parse(readFileSync(join(chaptersDir, f), 'utf-8')))
    }
  }

  const characters: any[] = []
  const charactersDir = join(folder, 'characters')
  if (existsSync(charactersDir)) {
    const charFiles = readdirSync(charactersDir).filter(f => f.endsWith('.json') && f !== 'index.json')
    for (const f of charFiles) {
      characters.push(JSON.parse(readFileSync(join(charactersDir, f), 'utf-8')))
    }
  }

  return { ...metadata, chapters, characters, directoryPath: folder }
}

function resolveProjectFolder(id: string, directoryPath?: string) {
  if (directoryPath && existsSync(directoryPath)) return directoryPath
  const linkPath = join(PROJECTS_DIR, `${id}.link`)
  if (existsSync(linkPath)) {
    const linked = readFileSync(linkPath, 'utf-8').trim()
    if (linked && existsSync(linked)) return linked
  }
  const legacyPath = join(PROJECTS_DIR, `${id}.json`)
  return existsSync(legacyPath) ? PROJECTS_DIR : null
}

function safeVibeChatFileName(key: string) {
  return `${key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'conversation'}.json`
}

ipcMain.handle('project:list', () => {
  if (!existsSync(PROJECTS_DIR)) return []
  
  const projects: any[] = []

  // Load new split projects via links
  const links = readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.link'))
  for (const link of links) {
    const id = link.replace('.link', '')
    const folder = readFileSync(join(PROJECTS_DIR, link), 'utf-8').trim()
    const project = loadFullProject(id, folder)
    if (project) projects.push(project)
  }

  // Load legacy projects
  const files = readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'))
  for (const f of files) {
    const id = f.replace('.json', '')
    if (links.some(l => l.startsWith(id))) continue // Skip if already loaded via link
    const content = readFileSync(join(PROJECTS_DIR, f), 'utf-8')
    projects.push(JSON.parse(content))
  }

  return projects
})

ipcMain.handle('project:load', (_event, id: string, directoryPath?: string) => {
  let projectFolder = directoryPath
  if (!projectFolder) {
    const linkPath = join(PROJECTS_DIR, `${id}.link`)
    if (existsSync(linkPath)) {
      projectFolder = readFileSync(linkPath, 'utf-8').trim()
    }
  }

  if (!projectFolder || !existsSync(projectFolder)) {
    // Fallback to legacy single file
    const legacyPath = join(PROJECTS_DIR, `${id}.json`)
    if (existsSync(legacyPath)) {
      return JSON.parse(readFileSync(legacyPath, 'utf-8'))
    }
    return null
  }

  return loadFullProject(id, projectFolder)
})

ipcMain.handle('project:save', (_event, project: any, directoryPath?: string) => {
  const isNew = !!directoryPath
  const linkPath = join(PROJECTS_DIR, `${project.id}.link`)
  const linkedDirectoryPath = !isNew && existsSync(linkPath)
    ? readFileSync(linkPath, 'utf-8').trim()
    : ''
  const baseDir = directoryPath || linkedDirectoryPath || project.directoryPath || PROJECTS_DIR
  
  // If it's a new project or moving, ensure the project folder exists
  let projectFolder = baseDir
  if (isNew) {
    const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_')
    projectFolder = join(baseDir, `${safeName}_${project.id}`)
    project.directoryPath = projectFolder
  }
  if (!existsSync(projectFolder)) mkdirSync(projectFolder, { recursive: true })

  // Split data: Metadata, Chapters, Characters
  const { chapters, characters, ...metadata } = project

  // Save metadata
  const metadataPath = join(projectFolder, 'project.json')
  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8')

  // Save chapters
  const chaptersDir = join(projectFolder, 'chapters')
  if (!existsSync(chaptersDir)) mkdirSync(chaptersDir, { recursive: true })
  writeFileSync(join(chaptersDir, 'index.json'), JSON.stringify((chapters || []).map((c: any) => ({ id: c.id, title: c.title })), null, 2), 'utf-8')
  for (const chapter of (chapters || [])) {
    writeFileSync(join(chaptersDir, `${chapter.id}.json`), JSON.stringify(chapter, null, 2), 'utf-8')
  }

  // Save characters
  const charactersDir = join(projectFolder, 'characters')
  if (!existsSync(charactersDir)) mkdirSync(charactersDir, { recursive: true })
  writeFileSync(join(charactersDir, 'index.json'), JSON.stringify((characters || []).map((c: any) => ({ id: c.id, name: c.name })), null, 2), 'utf-8')
  for (const char of (characters || [])) {
    writeFileSync(join(charactersDir, `${char.id}.json`), JSON.stringify(char, null, 2), 'utf-8')
  }

  // Also keep a copy in the internal PROJECTS_DIR for listing (or just store the path)
  // For now, let's keep a link file in the internal dir
  writeFileSync(linkPath, projectFolder, 'utf-8')

  return { ...metadata, chapters: chapters || [], characters: characters || [], directoryPath: projectFolder }
})

ipcMain.handle('project:delete', (_event, id: string) => {
  const filePath = join(PROJECTS_DIR, `${id}.json`)
  if (existsSync(filePath)) unlinkSync(filePath)
  return true
})

ipcMain.handle('vibe-chat:load', (_event, request: { projectId: string; directoryPath?: string; key: string }) => {
  if (!request?.projectId || !request?.key) return null
  const projectFolder = resolveProjectFolder(request.projectId, request.directoryPath)
  if (!projectFolder) return null

  const chatPath = join(projectFolder, 'vibe-chat', safeVibeChatFileName(request.key))
  if (!existsSync(chatPath)) return null
  return JSON.parse(readFileSync(chatPath, 'utf-8'))
})

ipcMain.handle('vibe-chat:save', (_event, request: { projectId: string; directoryPath?: string; key: string; payload: any }) => {
  if (!request?.projectId || !request?.key) return false
  const projectFolder = resolveProjectFolder(request.projectId, request.directoryPath)
  if (!projectFolder) return false

  const chatDir = join(projectFolder, 'vibe-chat')
  if (!existsSync(chatDir)) mkdirSync(chatDir, { recursive: true })
  const chatPath = join(chatDir, safeVibeChatFileName(request.key))
  writeFileSync(chatPath, JSON.stringify(request.payload ?? {}, null, 2), 'utf-8')
  return true
})

// Provider operations
function buildModelListEndpoints(type: string, baseUrl: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, '')
  let endpoints: string[]

  if (type === 'anthropic') {
    endpoints = [
      normalizedBase.endsWith('/v1') ? `${normalizedBase}/models` : `${normalizedBase}/v1/models`,
      normalizedBase.endsWith('/v1') ? `${normalizedBase.replace(/\/v1$/, '')}/v1/models` : `${normalizedBase}/models`,
    ]
  } else if (type === 'google') {
    endpoints = [
      `${normalizedBase}/v1beta/models`,
      `${normalizedBase}/v1/models`,
    ]
  } else {
    endpoints = [
      `${normalizedBase}/models`,
      normalizedBase.endsWith('/v1') ? `${normalizedBase.replace(/\/v1$/, '')}/v1/models` : `${normalizedBase}/v1/models`,
    ]
  }

  return [...new Set(endpoints.filter(Boolean))]
}

function requestJson(endpoint: string, headers: Record<string, string>) {
  return new Promise<any>((resolve, reject) => {
    const url = new URL(endpoint)
    const client = url.protocol === 'https:' ? https : http

    let body = ''

    const request = client.request(
      url,
      { method: 'GET', headers },
      response => {
        response.on('data', chunk => {
          body += chunk.toString('utf8')
        })

        response.on('end', () => {
          if ((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300) {
            try {
              resolve(JSON.parse(body))
            } catch {
              reject(new Error(`Invalid JSON response from ${endpoint}`))
            }
            return
          }

          reject(new Error(`HTTP ${response.statusCode ?? 0} - ${body}`))
        })
      })

    request.on('error', error => {
      reject(error)
    })

    request.end()
  })
}

function requestJsonPost(endpoint: string, headers: Record<string, string>, body: unknown) {
  return new Promise<any>((resolve, reject) => {
    const url = new URL(endpoint)
    const client = url.protocol === 'https:' ? https : http
    const payload = JSON.stringify(body ?? {})

    const request = client.request(
      url,
      {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      response => {
        let text = ''
        response.on('data', chunk => {
          text += chunk.toString('utf8')
        })
        response.on('end', () => {
          if ((response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300) {
            try {
              resolve(JSON.parse(text))
            } catch {
              reject(new Error(`Invalid JSON response from ${endpoint}`))
            }
            return
          }

          reject(new Error(`HTTP ${response.statusCode ?? 0} - ${text}`))
        })
      }
    )

    request.on('error', error => {
      reject(error)
    })

    request.write(payload)
    request.end()
  })
}

ipcMain.handle('provider:list-models', async (_event, request: { type: string; apiKey: string; baseUrl: string }) => {
  const type = request?.type === 'anthropic' ? 'anthropic' : request?.type === 'google' ? 'google' : request?.type === 'openai-responses' ? 'openai-responses' : 'openai'
  if (!request?.baseUrl) {
    throw new Error('Invalid provider model sync request')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if ((type === 'openai' || type === 'openai-responses') && request.apiKey) {
    headers.Authorization = `Bearer ${request.apiKey}`
  } else if (type === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    if (request.apiKey) {
      headers['x-api-key'] = request.apiKey
    }
  } else if (type === 'google' && request.apiKey) {
    headers['x-goog-api-key'] = request.apiKey
  }

  const endpoints = buildModelListEndpoints(type, request.baseUrl)
  let lastError: Error | null = null

  for (const endpoint of endpoints) {
    try {
      return await requestJson(endpoint, headers)
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  const attempted = endpoints.join(' | ')
  throw new Error(
    `${type} model sync failed after trying: ${attempted}${lastError ? `; last error: ${lastError.message}` : ''}`
  )
})

ipcMain.handle('provider:create-embedding', async (_event, request: { type: string; apiKey: string; baseUrl: string; model: string; text: string }) => {
  const type = request?.type === 'anthropic' ? 'anthropic' : request?.type === 'google' ? 'google' : request?.type === 'openai-responses' ? 'openai-responses' : 'openai'
  if (!request?.baseUrl || !request?.model || typeof request?.text !== 'string') {
    throw new Error('Invalid provider embedding request')
  }

  if (type === 'anthropic') {
    throw new Error('Anthropic does not currently expose a supported embedding endpoint in this app')
  }

  const normalizedBase = request.baseUrl.replace(/\/+$/, '')
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (type === 'google') {
    if (request.apiKey) {
      headers['x-goog-api-key'] = request.apiKey
    }
    const endpoint = `${normalizedBase}/v1beta/models/${request.model}:embedContent`
    try {
      return await requestJsonPost(endpoint, headers, {
        content: { parts: [{ text: request.text }] },
      })
    } catch (error: any) {
      throw new Error(`Google embedding request failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const endpoints = [
    `${normalizedBase}/embeddings`,
    normalizedBase.endsWith('/v1') ? `${normalizedBase.replace(/\/v1$/, '')}/v1/embeddings` : `${normalizedBase}/v1/embeddings`,
  ]

  if (request.apiKey) {
    headers.Authorization = `Bearer ${request.apiKey}`
  }

  let lastError: Error | null = null
  for (const endpoint of endpoints) {
    try {
      return await requestJsonPost(endpoint, headers, {
        model: request.model,
        input: request.text,
      })
    } catch (error: any) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  throw new Error(
    `embedding request failed after trying: ${endpoints.join(' | ')}${lastError ? `; last error: ${lastError.message}` : ''}`
  )
})

// Dialog operations
ipcMain.handle('dialog:open-file', async (_event, options: any) => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: options?.filters || [],
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:open-files', async (_event, options: any) => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: options?.filters || [],
  })
  return result.canceled ? null : result.filePaths
})

ipcMain.handle('dialog:open-directory', async (_event, options: any) => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: options?.title,
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:save-file', async (_event, options: any) => {
  if (!mainWindow) return null
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: options?.filters || [],
  })
  return result.canceled ? null : result.filePath
})

// File read/write for knowledge base
ipcMain.handle('file:read', (_event, filePath: string) => {
  if (!existsSync(filePath)) return null
  return readFileSync(filePath, 'utf-8')
})

ipcMain.handle('file:read-binary', (_event, filePath: string) => {
  if (!existsSync(filePath)) return null
  return readFileSync(filePath).toString('base64')
})

ipcMain.handle('file:write', (_event, filePath: string, content: string) => {
  writeFileSync(filePath, content, 'utf-8')
  return true
})

ipcMain.handle('file:write-binary', (_event, filePath: string, base64: string) => {
  const buffer = Buffer.from(base64, 'base64')
  writeFileSync(filePath, buffer)
  return true
})
