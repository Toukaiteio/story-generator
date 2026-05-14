import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { generateId } from '@/lib/id'
import { readJsonStorage, writeJsonStorage } from '@/lib/storage'
import {
  buildBoundProjectFileName,
  buildBoundProjectFilePath,
  readProjectExportBindings,
  readProjectExportBuffers,
  serializeProjectExport,
  writeProjectExportBindings,
  writeProjectExportBuffers,
  type ProjectExportBinding,
  type ProjectExportBuffer,
  PROJECT_EXPORT_SYNC_DELAY_MS,
} from '@/services/projectExportSync'
import type { ChapterConfig, ProjectReviewAgentSettings, StoryProject, WritingFormat } from '@/types/project'
import type { Chapter } from '@/types/chapter'
import type { Character, CharacterRole } from '@/types/character'

const PROJECT_STORAGE_KEY = 'story-generator.projects.v1'
const ACTIVE_PROJECT_STORAGE_KEY = 'story-generator.active-project.v1'
const MAX_CHAPTER_COUNT = 9999

function normalizeChapterCount(value: any, fallbackLength?: any, chapters?: any[]): number {
  const parsed = Number(value)
  if (Number.isFinite(parsed)) return Math.max(1, Math.min(MAX_CHAPTER_COUNT, Math.trunc(parsed)))
  if (Array.isArray(chapters) && chapters.length > 0) {
    const uniqueIndexes = new Set(chapters.map(chapter => Number(chapter?.index)).filter(Number.isFinite))
    return Math.min(uniqueIndexes.size || chapters.length, MAX_CHAPTER_COUNT)
  }
  if (fallbackLength === 'short') return 4
  if (fallbackLength === 'long') return 15
  return 8
}

function normalizeChapterConfig(value: any, fallbackCount: any, fallbackLength?: any, chapters?: any[]): ChapterConfig {
  const configuredMax = Number(value?.maxChapters)
  return {
    maxChapters: Number.isFinite(configuredMax)
      ? Math.max(1, Math.min(MAX_CHAPTER_COUNT, Math.trunc(configuredMax)))
      : normalizeChapterCount(fallbackCount, fallbackLength, chapters),
  }
}

function normalizeChapterOutline(value: any): Chapter['outline'] {
  return {
    objective: typeof value?.objective === 'string' ? value.objective : '',
    conflict: typeof value?.conflict === 'string' ? value.conflict : '',
    keyEvents: Array.isArray(value?.keyEvents) ? value.keyEvents.map((item: any) => String(item).trim()).filter(Boolean) : [],
    characterActions: Array.isArray(value?.characterActions) ? value.characterActions.map((item: any) => String(item).trim()).filter(Boolean) : [],
    infoReveals: Array.isArray(value?.infoReveals) ? value.infoReveals.map((item: any) => String(item).trim()).filter(Boolean) : [],
    endingHook: typeof value?.endingHook === 'string' ? value.endingHook : '',
  }
}

function normalizeReviewAgentSettings(value: any): ProjectReviewAgentSettings | undefined {
  if (!value || typeof value !== 'object') return undefined
  const agents = value.agents && typeof value.agents === 'object' ? value.agents : {}
  const normalizedAgents = Object.fromEntries(
    Object.entries(agents)
      .filter(([, settings]: any) => settings && typeof settings === 'object')
      .map(([agentId, settings]: any) => [
        agentId,
        {
          name: typeof settings.name === 'string' ? settings.name : undefined,
          role: typeof settings.role === 'string' ? settings.role : undefined,
          brief: typeof settings.brief === 'string' ? settings.brief : undefined,
          defaultModelRole: settings.defaultModelRole === 'proofreader' ? 'proofreader' : settings.defaultModelRole === 'chapterPlanner' ? 'chapterPlanner' : undefined,
          modelValue: typeof settings.modelValue === 'string' ? settings.modelValue : undefined,
          systemPrompt: typeof settings.systemPrompt === 'string' ? settings.systemPrompt : undefined,
          customSystemPrompt: typeof settings.customSystemPrompt === 'string'
            ? settings.customSystemPrompt
            : undefined,
          disabled: Boolean(settings.disabled),
          deleted: Boolean(settings.deleted),
          custom: Boolean(settings.custom),
        },
      ])
  )
  return { agents: normalizedAgents }
}

function chapterQualityScore(chapter: Chapter) {
  const outline = chapter.outline
  const statusRank: Record<string, number> = {
    outline: 0,
    writing: 1,
    draft: 2,
    proofreading: 3,
    proofread: 4,
    polishing: 5,
    polished: 6,
  }
  return [
    (statusRank[chapter.status] ?? 0) * 1_000_000,
    Math.max(chapter.content.trim().length, chapter.polishedContent.trim().length) * 100,
    chapter.summary.trim().length * 10,
    chapter.title.trim() && !/^chapter\s+\d+$/i.test(chapter.title.trim()) ? 500 : 0,
    outline.objective.trim() ? 80 : 0,
    outline.conflict.trim() ? 80 : 0,
    outline.endingHook.trim() ? 80 : 0,
    outline.keyEvents.length * 20,
    outline.characterActions.length * 20,
    outline.infoReveals.length * 20,
    new Date(chapter.updatedAt || chapter.createdAt || 0).getTime() / 1_000_000_000,
  ].reduce((sum, item) => sum + item, 0)
}

function normalizeChapter(raw: any, fallbackIndex: number, usedIds: Set<string>): Chapter {
  const now = new Date().toISOString()
  const parsedIndex = Number(raw?.index)
  const id = typeof raw?.id === 'string' && raw.id.trim() && !usedIds.has(raw.id)
    ? raw.id
    : generateId()
  usedIds.add(id)

  const content = typeof raw?.content === 'string' ? raw.content : ''
  const polishedContent = typeof raw?.polishedContent === 'string' ? raw.polishedContent : ''

  const status = ['outline', 'writing', 'draft', 'proofreading', 'proofread', 'polishing', 'polished'].includes(raw?.status)
    ? raw.status
    : (content.trim() || polishedContent.trim())
      ? 'draft'
      : 'outline'

  return {
    id,
    index: Number.isFinite(parsedIndex) ? Math.max(0, Math.trunc(parsedIndex)) : fallbackIndex,
    title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim() : `Chapter ${fallbackIndex + 1}`,
    outline: normalizeChapterOutline(raw?.outline),
    content,
    proofreadingIssues: Array.isArray(raw?.proofreadingIssues) ? raw.proofreadingIssues : [],
    proofreadingIssuesStale: Boolean(raw?.proofreadingIssuesStale),
    contentVersions: Array.isArray(raw?.contentVersions) ? raw.contentVersions : [],
    polishedContent,
    status,
    summary: typeof raw?.summary === 'string' ? raw.summary : '',
    characterStateUpdates: raw?.characterStateUpdates && typeof raw.characterStateUpdates === 'object' ? raw.characterStateUpdates : {},
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : now,
  }
}

function normalizeChapters(chapters: any[]): Chapter[] {
  if (!Array.isArray(chapters) || !chapters.length) return []

  const usedIds = new Set<string>()
  const normalized = chapters.map((chapter, index) => normalizeChapter(chapter, index, usedIds))
  const bestByIndex = new Map<number, Chapter>()
  for (const chapter of normalized) {
    const current = bestByIndex.get(chapter.index)
    if (!current || chapterQualityScore(chapter) >= chapterQualityScore(current)) {
      bestByIndex.set(chapter.index, chapter)
    }
  }

  return [...bestByIndex.values()]
    .sort((a, b) => a.index - b.index)
    .map((chapter, index) => ({
      ...chapter,
      index,
      title: chapter.title.trim() || `Chapter ${index + 1}`,
    }))
}

function normalizeCharacterRole(value: any): CharacterRole {
  const role = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return role === 'protagonist' || role === 'antagonist' || role === 'minor' ? role : 'supporting'
}

function normalizeCharacter(raw: any, fallbackIndex: number, usedIds: Set<string>): Character {
  const now = new Date().toISOString()
  const id = typeof raw?.id === 'string' && raw.id.trim() && !usedIds.has(raw.id)
    ? raw.id
    : generateId()
  usedIds.add(id)

  return {
    id,
    name: typeof raw?.name === 'string' && raw.name.trim() ? raw.name.trim() : `Character ${fallbackIndex + 1}`,
    role: normalizeCharacterRole(raw?.role),
    personality: Array.isArray(raw?.personality) ? raw.personality.map((item: any) => String(item).trim()).filter(Boolean) : [],
    appearance: typeof raw?.appearance === 'string' ? raw.appearance.trim() : '',
    backstory: typeof raw?.backstory === 'string' ? raw.backstory.trim() : '',
    motivation: typeof raw?.motivation === 'string' ? raw.motivation.trim() : '',
    goals: typeof raw?.goals === 'string' ? raw.goals.trim() : '',
    conflicts: typeof raw?.conflicts === 'string' ? raw.conflicts.trim() : '',
    currentState: typeof raw?.currentState === 'string' ? raw.currentState.trim() : '',
    relations: Array.isArray(raw?.relations)
      ? raw.relations.map((relation: any) => ({
        targetId: typeof relation?.targetId === 'string' ? relation.targetId : '',
        relation: typeof relation?.relation === 'string' ? relation.relation.trim() : '',
        description: typeof relation?.description === 'string' ? relation.description.trim() : '',
      })).filter((relation: any) => relation.targetId && relation.relation && relation.description)
      : [],
    createdAt: typeof raw?.createdAt === 'string' ? raw.createdAt : now,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : now,
  }
}

function characterQualityScore(character: Character) {
  const roleRank: Record<CharacterRole, number> = {
    protagonist: 4,
    antagonist: 3,
    supporting: 2,
    minor: 1,
  }
  return [
    roleRank[character.role] * 1000,
    character.appearance.length,
    character.backstory.length,
    character.motivation.length,
    character.goals.length,
    character.conflicts.length,
    character.currentState.length,
    character.personality.length * 80,
    character.relations.length * 120,
    new Date(character.updatedAt || character.createdAt || 0).getTime() / 1_000_000_000,
  ].reduce((sum, item) => sum + item, 0)
}

function normalizeCharacters(characters: any[]): Character[] {
  if (!Array.isArray(characters) || !characters.length) return []
  const usedIds = new Set<string>()
  const normalized = characters.map((character, index) => normalizeCharacter(character, index, usedIds))
  const bestByName = new Map<string, Character>()

  for (const character of normalized) {
    const key = character.name.trim().toLowerCase()
    const current = bestByName.get(key)
    if (!current || characterQualityScore(character) >= characterQualityScore(current)) {
      bestByName.set(key, character)
    }
  }

  const keptIds = new Set([...bestByName.values()].map(character => character.id))
  return [...bestByName.values()].map(character => ({
    ...character,
    relations: character.relations.filter(relation => keptIds.has(relation.targetId) && relation.targetId !== character.id),
  }))
}

function hasDuplicateChapterIndexes(chapters: any[]) {
  const seen = new Set<number>()
  for (const chapter of chapters) {
    const parsed = Number(chapter?.index)
    if (!Number.isFinite(parsed)) continue
    const index = Math.trunc(parsed)
    if (seen.has(index)) return true
    seen.add(index)
  }
  return false
}

function migrateProjectStyle(project: any): StoryProject {
  if (!('styleId' in project)) {
    project.styleId = 'default'
    project.style = ''
  }
  if (!('language' in project) || typeof project.language !== 'string' || !project.language.trim()) {
    project.language = 'English'
  }
  const rawChapterCount = Array.isArray(project.chapters) ? project.chapters.length : 0
  const hadDuplicateChapters = Array.isArray(project.chapters) && hasDuplicateChapterIndexes(project.chapters)
  if (Array.isArray(project.chapters)) {
    project.chapters = normalizeChapters(project.chapters)
  }
  if (hadDuplicateChapters && Number(project.chapterCount) === rawChapterCount) {
    project.chapterCount = project.chapters.length
  }
  project.chapterCount = normalizeChapterCount(project.chapterCount, project.length, project.chapters)
  project.chapterConfig = normalizeChapterConfig(project.chapterConfig, project.chapterCount, project.length, project.chapters)
  if (!Array.isArray(project.knowledgeBaseIds)) {
    project.knowledgeBaseIds = []
  }
  if (!Array.isArray(project.relationshipEvents)) {
    project.relationshipEvents = []
  }
  if (Array.isArray(project.characters)) {
    project.characters = normalizeCharacters(project.characters)
  }
  return project as StoryProject
}

function migrateProjects(raw: any[]): StoryProject[] {
  return raw.map(p => migrateProjectStyle(p))
}

function normalizeStringList(value: any): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : []
}

function normalizeIdList(value: any): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item).trim()).filter(Boolean)
    : []
}

function normalizeProjectDirectoryPath(value: any): string {
  return typeof value === 'string'
    ? value.trim().replace(/[\\/]+$/, '').toLowerCase()
    : ''
}

function normalizeWritingStyleSnapshot(value: any, styleId: string, style: string): StoryProject['writingStyleSnapshot'] {
  if (value && typeof value === 'object') {
    const snapshotId = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : styleId
    const content = typeof value.content === 'string' ? value.content : style
    if (snapshotId && snapshotId !== 'default' && content.trim()) {
      return {
        id: snapshotId,
        name: typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Project Writing Style',
        description: typeof value.description === 'string' ? value.description : '',
        content,
        tags: Array.isArray(value.tags) ? value.tags.map((item: any) => String(item).trim()).filter(Boolean) : [],
        capturedAt: typeof value.capturedAt === 'string' ? value.capturedAt : new Date().toISOString(),
      }
    }
  }

  if (styleId && styleId !== 'default' && style.trim()) {
    return {
      id: styleId,
      name: 'Project Writing Style',
      description: '',
      content: style,
      tags: [],
      capturedAt: new Date().toISOString(),
    }
  }

  return null
}

function getImportedProjectId(data: any): string {
  return typeof data?.id === 'string' && data.id.trim() ? data.id.trim() : generateId()
}

function normalizeImportedProject(data: any, id = getImportedProjectId(data), options: { preserveDirectoryPath?: boolean } = {}): StoryProject {
  const now = new Date().toISOString()
  const migrated = migrateProjectStyle(data ?? {})
  const style = typeof migrated.style === 'string' ? migrated.style : ''
  const styleId = typeof migrated.styleId === 'string' && migrated.styleId.trim() ? migrated.styleId : 'default'

  return {
    id,
    name: typeof migrated.name === 'string' && migrated.name.trim() ? migrated.name.trim() : 'Imported Project',
    directoryPath: options.preserveDirectoryPath && typeof migrated.directoryPath === 'string' ? migrated.directoryPath : '',
    theme: typeof migrated.theme === 'string' ? migrated.theme : '',
    genre: typeof migrated.genre === 'string' ? migrated.genre : '',
    targetReader: typeof migrated.targetReader === 'string' ? migrated.targetReader : '',
    language: typeof migrated.language === 'string' && migrated.language.trim() ? migrated.language.trim() : 'English',
    style,
    styleId,
    writingStyleSnapshot: normalizeWritingStyleSnapshot(migrated.writingStyleSnapshot, styleId, style),
    writingFormat: migrated.writingFormat === 'markdown' ? 'markdown' : 'plaintext',
    chapterCount: normalizeChapterCount(migrated.chapterCount, migrated.length, migrated.chapters),
    chapterConfig: normalizeChapterConfig(migrated.chapterConfig, migrated.chapterCount, migrated.length, migrated.chapters),
    length: migrated.length === 'short' || migrated.length === 'medium' || migrated.length === 'long'
      ? migrated.length
      : undefined,
    constraints: {
      required: normalizeStringList(migrated.constraints?.required),
      forbidden: normalizeStringList(migrated.constraints?.forbidden),
    },
    customRequirements: typeof migrated.customRequirements === 'string' ? migrated.customRequirements : '',
    chapters: Array.isArray(migrated.chapters) ? migrated.chapters : [],
    characters: Array.isArray(migrated.characters) ? normalizeCharacters(migrated.characters) : [],
    relationshipEvents: Array.isArray(migrated.relationshipEvents) ? migrated.relationshipEvents : [],
    knowledgeBaseIds: normalizeIdList(migrated.knowledgeBaseIds),
    status: migrated.status === 'generating' || migrated.status === 'completed' || migrated.status === 'error'
      ? migrated.status
      : 'draft',
    generationStage: migrated.generationStage || 'idle',
    outline: typeof migrated.outline === 'string' ? migrated.outline : '',
    summary: typeof migrated.summary === 'string' ? migrated.summary : '',
    reviewAgentSettings: normalizeReviewAgentSettings(migrated.reviewAgentSettings),
    createdAt: typeof migrated.createdAt === 'string' ? migrated.createdAt : now,
    updatedAt: now,
  }
}

export const useProjectStore = defineStore('project', () => {
  const projects = ref<StoryProject[]>(migrateProjects(readJsonStorage<any[]>(PROJECT_STORAGE_KEY, [])))
  const activeProjectId = ref<string | null>(readJsonStorage<string | null>(ACTIVE_PROJECT_STORAGE_KEY, null))
  const isLoading = ref(false)
  const exportBindings = ref<Record<string, ProjectExportBinding>>(readProjectExportBindings())
  const exportBuffers = ref<Record<string, ProjectExportBuffer>>(readProjectExportBuffers())
  const exportSyncingProjectIds = ref<string[]>([])
  const exportSyncTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const projectSaveQueues = new Map<string, Promise<StoryProject | null>>()

  const activeProject = computed(() =>
    projects.value.find(p => p.id === activeProjectId.value) ?? null
  )

  const sortedProjects = computed(() =>
    [...projects.value].sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  )

  function persistLocalCache() {
    writeJsonStorage(PROJECT_STORAGE_KEY, projects.value)
    writeJsonStorage(ACTIVE_PROJECT_STORAGE_KEY, activeProjectId.value)
  }

  function persistExportBindings() {
    writeProjectExportBindings(exportBindings.value)
  }

  function persistExportBuffers() {
    writeProjectExportBuffers(exportBuffers.value)
  }

  function reconcileActiveProject() {
    if (activeProjectId.value && !projects.value.some(project => project.id === activeProjectId.value)) {
      activeProjectId.value = null
    }
  }

  function getProjectById(id: string) {
    return projects.value.find(project => project.id === id) ?? null
  }

  function cloneProjectSnapshot(project: StoryProject): StoryProject {
    try {
      return typeof structuredClone === 'function'
        ? structuredClone(project)
        : JSON.parse(JSON.stringify(project)) as StoryProject
    } catch {
      return JSON.parse(JSON.stringify(project)) as StoryProject
    }
  }

  function clearProjectExportSyncTimer(projectId: string) {
    const timer = exportSyncTimers.get(projectId)
    if (timer) {
      clearTimeout(timer)
      exportSyncTimers.delete(projectId)
    }
  }

  function setProjectExportBuffer(project: StoryProject) {
    exportBuffers.value[project.id] = {
      serialized: serializeProjectExport(project),
      projectUpdatedAt: project.updatedAt,
      bufferedAt: new Date().toISOString(),
    }
    persistExportBuffers()
  }

  function getProjectExportBinding(projectId: string) {
    const binding = exportBindings.value[projectId]
    if (!binding) return null
    return {
      ...binding,
      filePath: buildBoundProjectFilePath(binding),
    }
  }

  function buildExportBinding(project: StoryProject, directoryPath: string): ProjectExportBinding {
    return {
      directoryPath: directoryPath.trim(),
      fileName: buildBoundProjectFileName(project),
      linkedAt: new Date().toISOString(),
      lastSyncedAt: null,
      lastSyncedProjectUpdatedAt: null,
      lastError: null,
    }
  }

  function shouldSyncProjectExport(projectId: string) {
    const binding = exportBindings.value[projectId]
    const buffer = exportBuffers.value[projectId]
    if (!binding || !buffer) return false
    return binding.lastSyncedProjectUpdatedAt !== buffer.projectUpdatedAt
  }

  async function flushProjectExportBuffer(projectId: string) {
    const project = getProjectById(projectId)
    const binding = exportBindings.value[projectId]
    const buffer = exportBuffers.value[projectId]

    if (!project || !binding || !buffer) return false
    if (!shouldSyncProjectExport(projectId)) return false

    if (!window.electronAPI?.file?.write) {
      binding.lastError = 'Export sync is only available in the Electron desktop app'
      persistExportBindings()
      return false
    }

    const filePath = buildBoundProjectFilePath(binding)
    try {
      await window.electronAPI.file.write(filePath, buffer.serialized)
      binding.lastSyncedAt = new Date().toISOString()
      binding.lastSyncedProjectUpdatedAt = buffer.projectUpdatedAt
      binding.lastError = null
      delete exportBuffers.value[projectId]
      persistExportBindings()
      persistExportBuffers()
      return true
    } catch (error: any) {
      binding.lastError = error?.message || 'Failed to sync project export'
      persistExportBindings()
      return false
    }
  }

  function scheduleProjectExportSync(projectId: string, immediate = false) {
    if (!exportBindings.value[projectId] || !shouldSyncProjectExport(projectId)) return

    clearProjectExportSyncTimer(projectId)

    const run = () => {
      exportSyncingProjectIds.value = Array.from(new Set([...exportSyncingProjectIds.value, projectId]))
      void flushProjectExportBuffer(projectId).finally(() => {
        exportSyncingProjectIds.value = exportSyncingProjectIds.value.filter(id => id !== projectId)
      })
    }

    if (immediate) {
      run()
      return
    }

    const timer = setTimeout(run, PROJECT_EXPORT_SYNC_DELAY_MS)
    exportSyncTimers.set(projectId, timer)
  }

  function scheduleProjectExportSyncForProject(project: StoryProject, immediate = false) {
    if (!exportBindings.value[project.id]) return
    setProjectExportBuffer(project)
    scheduleProjectExportSync(project.id, immediate)
  }

  function flushPendingProjectExportSyncs() {
    for (const project of projects.value) {
      if (!exportBindings.value[project.id]) continue
      const buffer = exportBuffers.value[project.id]
      if (!buffer) continue
      scheduleProjectExportSync(project.id, true)
    }
  }

  function cleanupDanglingExportState() {
    const knownIds = new Set(projects.value.map(project => project.id))
    let changed = false

    for (const projectId of Object.keys(exportBindings.value)) {
      if (knownIds.has(projectId)) continue
      delete exportBindings.value[projectId]
      changed = true
    }

    for (const projectId of Object.keys(exportBuffers.value)) {
      if (knownIds.has(projectId)) continue
      delete exportBuffers.value[projectId]
      changed = true
    }

    if (changed) {
      persistExportBindings()
      persistExportBuffers()
    }
  }

  async function createProject(data: {
    name: string
    theme: string
    genre: string
    targetReader: string
    language: string
    style: string
    styleId: string
    writingStyleSnapshot?: StoryProject['writingStyleSnapshot']
    writingFormat: WritingFormat
    chapterCount: number
    constraints: { required: string[]; forbidden: string[] }
    customRequirements: string
    directoryPath: string
  }): Promise<StoryProject> {
    const now = new Date().toISOString()
    const project: StoryProject = {
      id: generateId(),
      ...data,
      chapterCount: normalizeChapterCount(data.chapterCount),
      chapterConfig: normalizeChapterConfig(null, data.chapterCount),
      chapters: [],
      characters: [],
      relationshipEvents: [],
      knowledgeBaseIds: [],
      writingStyleSnapshot: normalizeWritingStyleSnapshot(data.writingStyleSnapshot, data.styleId, data.style),
      status: 'draft',
      generationStage: 'idle',
      outline: '',
      summary: '',
      reviewAgentSettings: { agents: {} },
      createdAt: now,
      updatedAt: now,
    }
    projects.value.push(project)
    const saved = await saveToDisk(project, data.directoryPath)
    if (!saved) {
      projects.value = projects.value.filter(item => item.id !== project.id)
      persistLocalCache()
      throw new Error('Failed to persist project')
    }
    return project
  }

  async function importProject(data: any) {
    const sourceId = typeof data?.id === 'string' ? data.id.trim() : ''
    const sourceDirectory = normalizeProjectDirectoryPath(data?.directoryPath)
    const existingIndex = projects.value.findIndex(project =>
      (sourceId && project.id === sourceId)
      || (sourceDirectory && normalizeProjectDirectoryPath(project.directoryPath) === sourceDirectory)
    )

    if (existingIndex >= 0) {
      return projects.value[existingIndex]
    }

    const project = normalizeImportedProject(data)
    projects.value.push(project)
    const saved = await saveToDisk(project)
    if (!saved) {
      projects.value = projects.value.filter(item => item.id !== project.id)
      persistLocalCache()
      throw new Error('Failed to persist imported project')
    }
    return project
  }

  async function updateProject(id: string, updates: Partial<StoryProject>) {
    const index = projects.value.findIndex(p => p.id === id)
    if (index === -1) return null
    const previousProject = cloneProjectSnapshot(projects.value[index])
    const normalizedUpdates = {
      ...updates,
      ...(Array.isArray(updates.chapters) ? { chapters: normalizeChapters(updates.chapters) } : {}),
      ...(Array.isArray(updates.characters) ? { characters: normalizeCharacters(updates.characters) } : {}),
    }
    projects.value[index] = {
      ...projects.value[index],
      ...normalizedUpdates,
      updatedAt: new Date().toISOString(),
    }
    const saved = await saveToDisk(projects.value[index])
    if (!saved) {
      projects.value[index] = previousProject
      persistLocalCache()
      return null
    }
    return projects.value[index]
  }

  async function deleteProject(id: string, options: { deleteFiles?: boolean } = {}) {
    const index = projects.value.findIndex(p => p.id === id)
    if (index === -1) return false
    const project = projects.value[index]
    const previousProjects = [...projects.value]
    const previousActiveProjectId = activeProjectId.value
    const previousBinding = exportBindings.value[id]
    const previousBuffer = exportBuffers.value[id]
    clearProjectExportSyncTimer(id)
    delete exportBindings.value[id]
    delete exportBuffers.value[id]
    projects.value.splice(index, 1)
    if (activeProjectId.value === id) activeProjectId.value = null
    let deleted: boolean | undefined
    try {
      deleted = await window.electronAPI?.project?.delete(id, project.directoryPath, options.deleteFiles)
    } catch (error) {
      console.error('Failed to delete project:', error)
      deleted = false
    }
    if (deleted === false) {
      projects.value = previousProjects
      activeProjectId.value = previousActiveProjectId
      if (previousBinding) exportBindings.value[id] = previousBinding
      if (previousBuffer) exportBuffers.value[id] = previousBuffer
      persistExportBindings()
      persistExportBuffers()
      persistLocalCache()
      return false
    }
    persistExportBindings()
    persistExportBuffers()
    persistLocalCache()
    return deleted ?? true
  }

  function setActiveProject(id: string | null) {
    if (!id) {
      activeProjectId.value = null
      return
    }

    activeProjectId.value = projects.value.some(project => project.id === id) ? id : null
  }

  async function loadProjects() {
    isLoading.value = true
    try {
      const data = await window.electronAPI?.project?.list?.()
      if (Array.isArray(data)) {
        projects.value = migrateProjects(data)
        reconcileActiveProject()
        cleanupDanglingExportState()
        flushPendingProjectExportSyncs()
        persistLocalCache()
        return
      }

      projects.value = migrateProjects(readJsonStorage<any[]>(PROJECT_STORAGE_KEY, []))
      reconcileActiveProject()
      cleanupDanglingExportState()
      flushPendingProjectExportSyncs()
      persistLocalCache()
    } catch (e) {
      console.error('Failed to load projects:', e)
      projects.value = migrateProjects(readJsonStorage<any[]>(PROJECT_STORAGE_KEY, []))
      reconcileActiveProject()
      cleanupDanglingExportState()
      flushPendingProjectExportSyncs()
      persistLocalCache()
    } finally {
      isLoading.value = false
    }
  }

  async function saveToDisk(project: StoryProject, directoryPath?: string) {
    const snapshot = cloneProjectSnapshot(project)
    if (typeof directoryPath === 'string' && directoryPath.trim()) {
      snapshot.directoryPath = directoryPath.trim()
    }

    const previousSave = projectSaveQueues.get(snapshot.id) ?? Promise.resolve(null)
    const queuedSave = previousSave
      .catch(() => null)
      .then(async () => {
        try {
          if (window.electronAPI?.project?.save) {
            const savedProject = await window.electronAPI.project.save(snapshot, directoryPath)
            if (savedProject && typeof savedProject === 'object' && typeof savedProject.directoryPath === 'string' && savedProject.directoryPath.trim()) {
              const savedDirectoryPath = savedProject.directoryPath.trim()
              const currentIndex = projects.value.findIndex(item => item.id === snapshot.id)
              if (currentIndex >= 0) {
                projects.value[currentIndex] = {
                  ...projects.value[currentIndex],
                  directoryPath: savedDirectoryPath,
                }
              } else {
                project.directoryPath = savedDirectoryPath
              }
            }
          }
          const currentProject = getProjectById(snapshot.id) ?? project
          scheduleProjectExportSyncForProject(currentProject)
          persistLocalCache()
          return currentProject
        } catch (e) {
          console.error('Failed to save project:', e)
          return null
        }
      })
      .finally(() => {
        if (projectSaveQueues.get(snapshot.id) === queuedSave) {
          projectSaveQueues.delete(snapshot.id)
        }
      })

    projectSaveQueues.set(snapshot.id, queuedSave)
    return queuedSave
  }

  function bindProjectExportDirectory(projectId: string, directoryPath: string) {
    const project = getProjectById(projectId)
    if (!project) throw new Error('Project not found')

    const trimmedDirectory = directoryPath.trim()
    if (!trimmedDirectory) throw new Error('Export directory is required')

    exportBindings.value[projectId] = buildExportBinding(project, trimmedDirectory)
    setProjectExportBuffer(project)
    persistExportBindings()
    return getProjectExportBinding(projectId)
  }

  function unbindProjectExportDirectory(projectId: string) {
    clearProjectExportSyncTimer(projectId)
    delete exportBindings.value[projectId]
    delete exportBuffers.value[projectId]
    persistExportBindings()
    persistExportBuffers()
  }

  async function syncProjectExportNow(projectId: string) {
    const project = getProjectById(projectId)
    if (!project) throw new Error('Project not found')
    if (!exportBindings.value[projectId]) throw new Error('Export directory is not linked')

    clearProjectExportSyncTimer(projectId)
    setProjectExportBuffer(project)
    exportSyncingProjectIds.value = Array.from(new Set([...exportSyncingProjectIds.value, projectId]))

    try {
      const synced = await flushProjectExportBuffer(projectId)
      if (!synced) {
        const binding = exportBindings.value[projectId]
        if (binding?.lastError) {
          throw new Error(binding.lastError)
        }
        throw new Error('Failed to sync project export')
      }
      return getProjectExportBinding(projectId)
    } finally {
      exportSyncingProjectIds.value = exportSyncingProjectIds.value.filter(id => id !== projectId)
    }
  }

  watch(projects, persistLocalCache, { deep: true })
  watch(activeProjectId, persistLocalCache)

  return {
    projects,
    activeProjectId,
    isLoading,
    exportSyncingProjectIds,
    activeProject,
    sortedProjects,
    createProject,
    importProject,
    updateProject,
    deleteProject,
    setActiveProject,
    loadProjects,
    getProjectById,
    getProjectExportBinding,
    bindProjectExportDirectory,
    unbindProjectExportDirectory,
    syncProjectExportNow,
  }
})
