import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'path'
import { URL } from 'url'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, rmSync } from 'fs'
import http from 'http'
import https from 'https'

declare const __dirname: string

let mainWindow: BrowserWindow | null = null
let hasUnsavedChanges = false
let forceClosing = false
let updateCheckTimer: ReturnType<typeof setInterval> | null = null

type UpdaterState = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

interface UpdaterStatus {
  state: UpdaterState
  message: string
  version?: string
  progress?: number
  checkedAt?: string
}

let updaterStatus: UpdaterStatus = {
  state: 'idle',
  message: 'Update check has not run yet.',
}

const DATA_DIR = join(app.getPath('userData'), 'story-generator')
const PROJECTS_DIR = join(DATA_DIR, 'projects')
const STORAGE_DIR = join(DATA_DIR, 'storage')
const VIBE_CHAT_DIR = join(DATA_DIR, 'vibe-chat')

function normalizeFsPath(value: string | null | undefined) {
  return typeof value === 'string'
    ? value.trim().replace(/[\\/]+$/, '').toLowerCase()
    : ''
}

function ensureDirs() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true })
  if (!existsSync(PROJECTS_DIR)) mkdirSync(PROJECTS_DIR, { recursive: true })
  if (!existsSync(STORAGE_DIR)) mkdirSync(STORAGE_DIR, { recursive: true })
  if (!existsSync(VIBE_CHAT_DIR)) mkdirSync(VIBE_CHAT_DIR, { recursive: true })
}

function publishUpdaterStatus(patch: Partial<UpdaterStatus>) {
  updaterStatus = {
    ...updaterStatus,
    ...patch,
  }
  mainWindow?.webContents.send('updater:status', updaterStatus)
}

function describeUpdaterError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function promptToInstallUpdate(version?: string) {
  const options = {
    type: 'info' as const,
    buttons: hasUnsavedChanges ? ['Later'] : ['Restart and Install', 'Later'],
    defaultId: 0,
    cancelId: hasUnsavedChanges ? 0 : 1,
    title: 'Update Ready',
    message: version ? `Story Generator ${version} is ready to install.` : 'A Story Generator update is ready to install.',
    detail: hasUnsavedChanges
      ? 'You have unsaved changes. Save your work before restarting, or choose Later and install the update from Settings.'
      : 'Restart now to install the update, or choose Later to install it on next app quit.',
  }

  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)

  if (result.response === 0 && !hasUnsavedChanges) {
    forceClosing = true
    autoUpdater.quitAndInstall(false, true)
  }
}

function configureAutoUpdater() {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  if (!app.isPackaged) {
    publishUpdaterStatus({
      state: 'idle',
      message: 'Auto update checks run only in packaged builds.',
    })
    return
  }

  autoUpdater.on('checking-for-update', () => {
    publishUpdaterStatus({
      state: 'checking',
      message: 'Checking for updates...',
      checkedAt: new Date().toISOString(),
    })
  })

  autoUpdater.on('update-available', info => {
    publishUpdaterStatus({
      state: 'available',
      message: 'Update found. Downloading...',
      version: info.version,
      checkedAt: new Date().toISOString(),
    })
  })

  autoUpdater.on('update-not-available', info => {
    publishUpdaterStatus({
      state: 'not-available',
      message: 'You are running the latest version.',
      version: info.version,
      progress: undefined,
      checkedAt: new Date().toISOString(),
    })
  })

  autoUpdater.on('download-progress', progress => {
    publishUpdaterStatus({
      state: 'downloading',
      message: 'Downloading update...',
      progress: Math.round(progress.percent),
    })
  })

  autoUpdater.on('update-downloaded', info => {
    publishUpdaterStatus({
      state: 'downloaded',
      message: 'Update downloaded and ready to install.',
      version: info.version,
      progress: 100,
      checkedAt: new Date().toISOString(),
    })
    void promptToInstallUpdate(info.version)
  })

  autoUpdater.on('error', error => {
    publishUpdaterStatus({
      state: 'error',
      message: describeUpdaterError(error),
      progress: undefined,
      checkedAt: new Date().toISOString(),
    })
  })
}

async function checkForUpdates(manual = false) {
  if (!app.isPackaged) {
    publishUpdaterStatus({
      state: 'idle',
      message: 'Auto update checks run only in packaged builds.',
      checkedAt: new Date().toISOString(),
    })
    return updaterStatus
  }

  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    publishUpdaterStatus({
      state: 'error',
      message: describeUpdaterError(error),
      progress: undefined,
      checkedAt: new Date().toISOString(),
    })
    if (manual && mainWindow && !mainWindow.isDestroyed()) {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Update Check Failed',
        message: updaterStatus.message,
      })
    }
  }

  return updaterStatus
}

function sanitizeStorageKey(key: string) {
  return key.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 180) || 'storage'
}

function getStorageFilePath(key: string) {
  return join(STORAGE_DIR, `${sanitizeStorageKey(key)}.json`)
}

function createWindow() {
  forceClosing = false
  hasUnsavedChanges = false
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
    mainWindow?.webContents.send('window:close-requested')
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  ensureDirs()
  createWindow()
  configureAutoUpdater()
  setTimeout(() => {
    void checkForUpdates(false)
  }, 3000)
  updateCheckTimer = setInterval(() => {
    void checkForUpdates(false)
  }, 6 * 60 * 60 * 1000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer)
    updateCheckTimer = null
  }
})

// Window controls
ipcMain.handle('app:get-path', (_event, name: any) => {
  try {
    return app.getPath(name)
  } catch {
    return null
  }
})

ipcMain.handle('updater:get-status', () => updaterStatus)
ipcMain.handle('updater:check', () => checkForUpdates(true))
ipcMain.handle('updater:install', () => {
  if (updaterStatus.state !== 'downloaded') return false
  forceClosing = true
  autoUpdater.quitAndInstall(false, true)
  return true
})

ipcMain.on('storage:read-json', (event, key: string) => {
  try {
    ensureDirs()
    const filePath = getStorageFilePath(String(key || ''))
    if (!existsSync(filePath)) {
      event.returnValue = null
      return
    }
    event.returnValue = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    event.returnValue = null
  }
})

ipcMain.on('storage:write-json', (event, key: string, value: any) => {
  try {
    ensureDirs()
    const filePath = getStorageFilePath(String(key || ''))
    writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8')
    event.returnValue = true
  } catch {
    event.returnValue = false
  }
})

ipcMain.on('storage:remove-json', (event, key: string) => {
  try {
    const filePath = getStorageFilePath(String(key || ''))
    if (existsSync(filePath)) unlinkSync(filePath)
    event.returnValue = true
  } catch {
    event.returnValue = false
  }
})

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize()
  else mainWindow?.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.on('window:set-unsaved-changes', (_event, payload: boolean | { hasUnsavedChanges?: boolean }) => {
  hasUnsavedChanges = typeof payload === 'boolean'
    ? payload
    : Boolean(payload?.hasUnsavedChanges)
})
ipcMain.on('window:close-request-response', (_event, action: 'cancel' | 'discard') => {
  if (action !== 'discard') return
  forceClosing = true
  hasUnsavedChanges = false
  const target = mainWindow
  if (!target || target.isDestroyed()) return
  target.destroy()
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
  
  const chaptersDir = join(folder, 'chapters')
  const chapterIndexPath = join(chaptersDir, 'index.json')
  const chapters: any[] = []
  if (existsSync(chaptersDir)) {
    const chapterIds = existsSync(chapterIndexPath)
      ? (JSON.parse(readFileSync(chapterIndexPath, 'utf-8')) || []).map((item: any) => String(item?.id || '').trim()).filter(Boolean)
      : readdirSync(chaptersDir).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => f.replace(/\.json$/, ''))

    for (const chapterId of chapterIds) {
      const chapterPath = join(chaptersDir, `${chapterId}.json`)
      if (!existsSync(chapterPath)) continue
      chapters.push(JSON.parse(readFileSync(chapterPath, 'utf-8')))
    }
  }

  const charactersDir = join(folder, 'characters')
  const characterIndexPath = join(charactersDir, 'index.json')
  const characters: any[] = []
  if (existsSync(charactersDir)) {
    const characterIds = existsSync(characterIndexPath)
      ? (JSON.parse(readFileSync(characterIndexPath, 'utf-8')) || []).map((item: any) => String(item?.id || '').trim()).filter(Boolean)
      : readdirSync(charactersDir).filter(f => f.endsWith('.json') && f !== 'index.json').map(f => f.replace(/\.json$/, ''))

    for (const characterId of characterIds) {
      const characterPath = join(charactersDir, `${characterId}.json`)
      if (!existsSync(characterPath)) continue
      characters.push(JSON.parse(readFileSync(characterPath, 'utf-8')))
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

function safeVibeChatProjectFolder(projectId: string) {
  return join(VIBE_CHAT_DIR, sanitizeStorageKey(projectId))
}

ipcMain.handle('project:list', () => {
  if (!existsSync(PROJECTS_DIR)) return []
  
  const projects: any[] = []
  const seenKeys = new Set<string>()

  // Load new split projects via links
  const links = readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.link'))
  for (const link of links) {
    const id = link.replace('.link', '')
    const folder = readFileSync(join(PROJECTS_DIR, link), 'utf-8').trim()
    const project = loadFullProject(id, folder)
    if (!project) continue
    const dedupeKey = normalizeFsPath(project.directoryPath) || `id:${String(project.id || '').trim()}`
    if (seenKeys.has(dedupeKey)) continue
    seenKeys.add(dedupeKey)
    projects.push(project)
  }

  // Load legacy projects
  const files = readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'))
  for (const f of files) {
    const id = f.replace('.json', '')
    if (links.some(l => l.startsWith(id))) continue // Skip if already loaded via link
    const content = readFileSync(join(PROJECTS_DIR, f), 'utf-8')
    const project = JSON.parse(content)
    const dedupeKey = normalizeFsPath(project?.directoryPath) || `id:${String(project?.id || '').trim()}`
    if (seenKeys.has(dedupeKey)) continue
    seenKeys.add(dedupeKey)
    projects.push(project)
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
  const explicitBaseDir = typeof directoryPath === 'string' && directoryPath.trim() ? directoryPath.trim() : ''
  const linkPath = join(PROJECTS_DIR, `${project.id}.link`)
  const linkedDirectoryPath = !explicitBaseDir && existsSync(linkPath)
    ? readFileSync(linkPath, 'utf-8').trim()
    : ''
  const existingFolder = linkedDirectoryPath || project.directoryPath || ''
  const hasUsableExistingFolder = Boolean(existingFolder) && normalizeFsPath(existingFolder) !== normalizeFsPath(PROJECTS_DIR)
  const baseDir = explicitBaseDir || (hasUsableExistingFolder ? existingFolder : PROJECTS_DIR)
  
  // If there is no linked project folder yet, create a dedicated folder instead of
  // writing project.json directly into the shared projects directory.
  let projectFolder = hasUsableExistingFolder ? existingFolder : baseDir
  if (explicitBaseDir || !hasUsableExistingFolder) {
    const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_')
    const preferredFolder = join(baseDir, `${safeName}_${project.id}`)
    projectFolder = preferredFolder
    if (!explicitBaseDir && !hasUsableExistingFolder && existsSync(join(preferredFolder, 'project.json'))) {
      projectFolder = join(baseDir, `${safeName}_${project.id}_${Date.now()}`)
    }
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
  const chapterIds = new Set<string>((chapters || []).map((c: any) => String(c?.id || '').trim()).filter(Boolean))
  for (const file of readdirSync(chaptersDir).filter(f => f.endsWith('.json') && f !== 'index.json')) {
    const id = file.replace(/\.json$/, '')
    if (!chapterIds.has(id)) unlinkSync(join(chaptersDir, file))
  }
  writeFileSync(join(chaptersDir, 'index.json'), JSON.stringify((chapters || []).map((c: any) => ({ id: c.id, title: c.title })), null, 2), 'utf-8')
  for (const chapter of (chapters || [])) {
    writeFileSync(join(chaptersDir, `${chapter.id}.json`), JSON.stringify(chapter, null, 2), 'utf-8')
  }

  // Save characters
  const charactersDir = join(projectFolder, 'characters')
  if (!existsSync(charactersDir)) mkdirSync(charactersDir, { recursive: true })
  const characterIds = new Set<string>((characters || []).map((c: any) => String(c?.id || '').trim()).filter(Boolean))
  for (const file of readdirSync(charactersDir).filter(f => f.endsWith('.json') && f !== 'index.json')) {
    const id = file.replace(/\.json$/, '')
    if (!characterIds.has(id)) unlinkSync(join(charactersDir, file))
  }
  writeFileSync(join(charactersDir, 'index.json'), JSON.stringify((characters || []).map((c: any) => ({ id: c.id, name: c.name })), null, 2), 'utf-8')
  for (const char of (characters || [])) {
    writeFileSync(join(charactersDir, `${char.id}.json`), JSON.stringify(char, null, 2), 'utf-8')
  }

  // Also keep a copy in the internal PROJECTS_DIR for listing (or just store the path)
  // For now, let's keep a link file in the internal dir
  writeFileSync(linkPath, projectFolder, 'utf-8')

  return { ...metadata, chapters: chapters || [], characters: characters || [], directoryPath: projectFolder }
})

ipcMain.handle('project:delete', (_event, id: string, directoryPath?: string, deleteFiles?: boolean) => {
  const filePath = join(PROJECTS_DIR, `${id}.json`)
  if (existsSync(filePath)) unlinkSync(filePath)

  const normalizedDirectory = normalizeFsPath(directoryPath)
  const candidateFolders = new Set<string>()
  if (directoryPath && existsSync(directoryPath)) candidateFolders.add(directoryPath)
  const linkFiles = readdirSync(PROJECTS_DIR).filter(file => file.endsWith('.link'))
  for (const linkFile of linkFiles) {
    const linkId = linkFile.replace(/\.link$/, '')
    const linkPath = join(PROJECTS_DIR, linkFile)
    const linkedDirectory = existsSync(linkPath) ? readFileSync(linkPath, 'utf-8').trim() : ''
    const shouldDeleteLink = linkId === id
      || (normalizedDirectory && normalizeFsPath(linkedDirectory) === normalizedDirectory)

    if (shouldDeleteLink && existsSync(linkPath)) {
      if (linkedDirectory && existsSync(linkedDirectory)) candidateFolders.add(linkedDirectory)
      unlinkSync(linkPath)
    }
  }

  if (deleteFiles) {
    for (const folder of candidateFolders) {
      const normalizedFolder = normalizeFsPath(folder)
      if (!normalizedFolder || normalizedFolder === normalizeFsPath(PROJECTS_DIR) || normalizedFolder === normalizeFsPath(DATA_DIR)) {
        continue
      }
      const metadataPath = join(folder, 'project.json')
      if (existsSync(metadataPath)) {
        rmSync(folder, { recursive: true, force: true })
      }
    }
  }

  return true
})

ipcMain.handle('vibe-chat:load', (_event, request: { projectId: string; directoryPath?: string; key: string }) => {
  if (!request?.projectId || !request?.key) return null
  ensureDirs()

  const userDataProjectDir = safeVibeChatProjectFolder(request.projectId)
  const userDataChatPath = join(userDataProjectDir, safeVibeChatFileName(request.key))
  if (existsSync(userDataChatPath)) {
    return JSON.parse(readFileSync(userDataChatPath, 'utf-8'))
  }

  const projectFolder = resolveProjectFolder(request.projectId, request.directoryPath)
  if (!projectFolder) return null
  const legacyChatPath = join(projectFolder, 'vibe-chat', safeVibeChatFileName(request.key))
  if (!existsSync(legacyChatPath)) return null
  return JSON.parse(readFileSync(legacyChatPath, 'utf-8'))
})

ipcMain.handle('vibe-chat:save', (_event, request: { projectId: string; directoryPath?: string; key: string; payload: any }) => {
  if (!request?.projectId || !request?.key) return false
  ensureDirs()

  const chatDir = safeVibeChatProjectFolder(request.projectId)
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
