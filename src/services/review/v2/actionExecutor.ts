/**
 * Meeting v2 — Action Executor
 *
 * Pure execution logic extracted from v1 changeVoteController.applyApprovedChange.
 * No voting, no session management — just applies a ChangeRequest to the project.
 *
 * Returns a human-readable result string on success, throws on failure.
 */

import type { StoryProject } from '@/types/project'
import type { Chapter } from '@/types/chapter'
import type { ProviderModelRef } from '@/types/provider'
import {
  parseCharacterPayload,
  normalizeReviewCharacter,
  parseLooseJson,
  normalizeChangeAction,
  normalizeChapterOutlinePatch,
  createToolMessage,
} from '@/services/review/utils'
import { createId } from '@/services/review/definitions'
import type { ChangeRequest, MeetingContext, MeetingMessage } from './types'

// ─── External deps interface ──────────────────────────────────────────────────

export interface ExecutorDeps {
  context: MeetingContext
  messages: MeetingMessage[]
  providerStore: {
    providers: any[]
    getAvailableModelRefForRole: (role: any, preferred?: ProviderModelRef | null) => ProviderModelRef | null
    getDefaultModelRefForRole: (role: any) => ProviderModelRef | null
  }
  projectStore: {
    updateProject: (id: string, patch: Partial<StoryProject>) => Promise<StoryProject | null>
  }
  onProgress: (msg: string, status?: 'running' | 'success' | 'warning' | 'error') => void
  onMessage: (content: string, tool?: ReturnType<typeof createToolMessage>) => void
}

// ─── Main entry ───────────────────────────────────────────────────────────────

export async function executeChangeRequest(
  request: ChangeRequest,
  deps: ExecutorDeps,
): Promise<string> {
  const project = deps.context.project
  if (!project) throw new Error('No active project is selected.')

  const action = normalizeChangeAction(request.action)
  // Use request directly — content is already structured JSON from the Master agent
  const normalized: ChangeRequest = { ...request, action }

  if (normalized.target === 'consensus') {
    return applyConsensus(normalized, deps)
  }
  if (normalized.target === 'master-outline') {
    return applyMasterOutline(normalized, action, project, deps)
  }
  if (normalized.target === 'characters') {
    return applyCharacters(normalized, action, project, deps)
  }
  if (normalized.target === 'chapter-draft') {
    return applyChapterDraft(normalized, action, project, deps.context.chapter, deps)
  }
  return applyChapterPlan(normalized, action, project, deps.context.chapter, deps)
}

// ─── Consensus ────────────────────────────────────────────────────────────────

function applyConsensus(request: ChangeRequest, deps: ExecutorDeps): string {
  const result = request.action === 'read'
    ? 'Returned current meeting consensus without changing project files.'
    : 'Recorded the approved meeting consensus.'
  deps.onMessage(
    `${result}\nAll agents must treat this consensus as accepted meeting guidance.`,
    createToolMessage('record_meeting_consensus', 'success', 'Meeting consensus recorded', request.scope, request.purpose, '', request.content),
  )
  return result
}

// ─── Master Outline ───────────────────────────────────────────────────────────

async function applyMasterOutline(
  request: ChangeRequest,
  action: string,
  project: StoryProject,
  deps: ExecutorDeps,
): Promise<string> {
  const before = project.outline || ''
  if (action === 'read') {
    const result = 'Returned current master outline without modifying project files.'
    deps.onMessage(result, createToolMessage('read_master_outline', 'success', 'Master outline fetched', request.scope, request.purpose, '', before))
    return result
  }
  const nextOutline = action === 'delete' ? '' : request.content
  deps.onProgress('Applying master outline update.', 'running')
  await saveWithRetry(() => deps.projectStore.updateProject(project.id, { outline: nextOutline }))
  await verifyPersistence(project.id, deps, r => (r.outline || '') === nextOutline, () => deps.projectStore.updateProject(project.id, { outline: nextOutline }))
  deps.onProgress('Master outline verified.', 'success')
  const result = 'Applied the approved change to the master outline.'
  deps.onMessage(
    `${result}\nAll agents must treat this applied change as accepted source-of-truth.`,
    createToolMessage(action === 'delete' ? 'clear_master_outline' : 'replace_master_outline', 'success', action === 'delete' ? 'Master outline cleared' : 'Master outline updated', request.scope, request.purpose, before, nextOutline),
  )
  return result
}

// ─── Characters ───────────────────────────────────────────────────────────────

async function applyCharacters(
  request: ChangeRequest,
  action: string,
  project: StoryProject,
  deps: ExecutorDeps,
): Promise<string> {
  if (action === 'read') {
    const result = 'Returned current characters without modifying project files.'
    deps.onMessage(result, createToolMessage('read_characters', 'success', 'Characters fetched', request.scope, request.purpose, '', JSON.stringify(project.characters, null, 2)))
    return result
  }
  const before = JSON.stringify(project.characters, null, 2)
  let merged = [...project.characters]
  let affectedNames: string[] = []

  if (action === 'delete') {
    deps.onProgress('Resolving character delete targets.', 'running')
    const { ids, names } = parseCharacterDeleteMatchers(request.content)
    if (!ids.size && !names.size) throw new Error('Character delete needs at least one character id or name in content.')
    merged = project.characters.filter(c => !ids.has(c.id) && !names.has(c.name.trim().toLowerCase()))
    affectedNames = project.characters.filter(c => !merged.some(m => m.id === c.id)).map(c => c.name.trim())
  } else {
    deps.onProgress('Normalizing character payload.', 'running')
    const rawChars = parseCharacterPayload(request.content)
    if (!rawChars.length) throw new Error('Character changes need at least one inferable character name and description.')
    const byName = new Map(project.characters.map(c => [c.name.trim().toLowerCase(), c]))
    const incoming = rawChars.map((item: any, i: number) => normalizeReviewCharacter(item, project.characters.length + i))
    affectedNames = incoming.map((c: any) => c.name.trim())
    for (const c of incoming) {
      const key = c.name.trim().toLowerCase()
      const existing = byName.get(key)
      if (existing) {
        if (action === 'create') continue
        const idx = merged.findIndex(m => m.id === existing.id)
        merged[idx] = { ...existing, ...c, id: existing.id, createdAt: existing.createdAt, updatedAt: new Date().toISOString() }
      } else {
        merged.push(c)
      }
    }
  }

  await saveWithRetry(() => deps.projectStore.updateProject(project.id, { characters: merged }))
  const affectedSet = new Set(affectedNames.map(n => n.toLowerCase()))
  await verifyPersistence(project.id, deps,
    r => Array.isArray(r.characters) && (action === 'delete'
      ? [...affectedSet].every(n => !r.characters.some((c: any) => c?.name?.trim?.().toLowerCase() === n))
      : [...affectedSet].every(n => r.characters.some((c: any) => c?.name?.trim?.().toLowerCase() === n))),
    () => deps.projectStore.updateProject(project.id, { characters: merged }),
  )
  deps.onProgress('Character persistence verified.', 'success')
  const after = JSON.stringify(merged, null, 2)
  const changeCount = action === 'delete' ? Math.max(0, project.characters.length - merged.length) : affectedNames.length
  const result = action === 'delete'
    ? `Removed ${changeCount} character${changeCount === 1 ? '' : 's'} from the project.`
    : `Applied character change (${affectedNames.length} character${affectedNames.length === 1 ? '' : 's'} affected).`
  deps.onMessage(
    `${result}\nAll agents must treat this applied change as accepted source-of-truth.`,
    createToolMessage(action === 'delete' ? 'delete_characters' : action === 'create' ? 'create_characters' : 'update_characters', 'success', action === 'delete' ? 'Characters removed' : action === 'create' ? 'Characters created' : 'Characters updated', request.scope, request.purpose, before, after),
  )
  return result
}

// ─── Chapter Draft ────────────────────────────────────────────────────────────

async function applyChapterDraft(
  request: ChangeRequest,
  action: string,
  project: StoryProject,
  chapter: Chapter | null | undefined,
  deps: ExecutorDeps,
): Promise<string> {
  if (!chapter) throw new Error('No chapter is selected for chapter-draft changes.')

  if (action === 'read') {
    const result = `Returned Chapter ${chapter.index + 1} draft without modifying project files.`
    deps.onMessage(
      result,
      createToolMessage('read_chapter_draft', 'success', 'Chapter draft fetched', request.scope, request.purpose, '', chapter.content || ''),
    )
    return result
  }

  deps.onProgress(`Preparing Chapter ${chapter.index + 1} draft update.`, 'running')
  const before = chapter.content || ''
  const nextContent = action === 'delete' ? '' : request.content.trim()
  if (action !== 'delete' && !nextContent) {
    throw new Error('Chapter-draft write changes need complete replacement draft content.')
  }

  const hasIssueSnapshot = Boolean(chapter.proofreadingIssues?.length && before !== nextContent)
  const updatedChapter: Chapter = {
    ...chapter,
    content: nextContent,
    polishedContent: '',
    proofreadingIssuesStale: hasIssueSnapshot ? true : chapter.proofreadingIssuesStale,
    contentVersions: hasIssueSnapshot
      ? [
          {
            id: createId('chapter-version'),
            label: 'Before meeting draft edit - proofreading issues valid',
            content: before,
            proofreadingIssues: chapter.proofreadingIssues.map(issue => ({ ...issue })),
            createdAt: new Date().toISOString(),
          },
          ...(chapter.contentVersions || []),
        ]
      : (chapter.contentVersions || []),
    status: nextContent.trim() ? 'draft' : 'outline',
    updatedAt: new Date().toISOString(),
  }

  const chapters = project.chapters.map(c => c.id === chapter.id ? updatedChapter : c)
  await saveWithRetry(() => deps.projectStore.updateProject(project.id, { chapters }))
  await verifyPersistence(project.id, deps,
    r => Array.isArray(r.chapters) && r.chapters.some(c =>
      (c?.id === chapter.id || c?.index === chapter.index)
      && String(c?.content || '') === nextContent,
    ),
    () => deps.projectStore.updateProject(project.id, { chapters }),
  )

  deps.onProgress(`Chapter ${chapter.index + 1} draft persistence verified.`, 'success')
  const result = action === 'delete'
    ? `Cleared Chapter ${chapter.index + 1} draft.`
    : `Applied the approved change to Chapter ${chapter.index + 1} draft.`
  deps.onMessage(
    `${result}\nAll agents must treat this applied draft as accepted source-of-truth.`,
    createToolMessage(action === 'delete' ? 'clear_chapter_draft' : 'replace_chapter_draft', 'success', action === 'delete' ? 'Chapter draft cleared' : 'Chapter draft updated', request.scope, request.purpose, before, nextContent),
  )
  return result
}

// ─── Chapter Plan ─────────────────────────────────────────────────────────────

async function applyChapterPlan(
  request: ChangeRequest,
  action: string,
  project: StoryProject,
  chapter: Chapter | null | undefined,
  deps: ExecutorDeps,
): Promise<string> {
  if (action === 'read') {
    return readChapterPlan(request, project, chapter, deps)
  }
  if (!chapter) throw new Error('No chapter is selected for chapter-plan write changes.')
  deps.onProgress(`Preparing Chapter ${chapter.index + 1} patch.`, 'running')

  let normalizedOutline: Chapter['outline']
  try {
    normalizedOutline = action === 'delete'
      ? applyChapterPlanDelete(chapter, request)
      : normalizeChapterOutlinePatch(chapter, request as any)
  } catch (err: any) {
    throw new Error(`Chapter-plan normalization failed: ${err?.message}. Ensure content is valid JSON with outline fields (objective, conflict, keyEvents, characterActions, infoReveals, endingHook).`)
  }

  const before = JSON.stringify({ title: chapter.title, outline: chapter.outline }, null, 2)
  const chapters = project.chapters.map(c =>
    c.id === chapter.id ? { ...c, outline: normalizedOutline, updatedAt: new Date().toISOString() } : c,
  )
  await saveWithRetry(() => deps.projectStore.updateProject(project.id, { chapters }))
  const expected = normalizeOutlineForCompare(normalizedOutline)
  await verifyPersistence(project.id, deps,
    r => Array.isArray(r.chapters) && r.chapters.some(c =>
      (c?.id === chapter.id || c?.index === chapter.index)
      && JSON.stringify(normalizeOutlineForCompare(c?.outline)) === JSON.stringify(expected),
    ),
    () => deps.projectStore.updateProject(project.id, { chapters }),
  )
  deps.onProgress(`Chapter ${chapter.index + 1} persistence verified.`, 'success')
  const after = JSON.stringify({ title: chapter.title, outline: normalizedOutline }, null, 2)
  const result = action === 'delete'
    ? `Deleted the requested fields from Chapter ${chapter.index + 1} plan.`
    : `Applied the approved change to Chapter ${chapter.index + 1} plan.`
  deps.onMessage(
    `${result}\nAll agents must treat this applied change as accepted source-of-truth.`,
    createToolMessage(action === 'delete' ? 'delete_chapter_outline_fields' : 'rewrite_chapter_outline', 'success', action === 'delete' ? 'Chapter plan fields removed' : 'Chapter plan updated', request.scope, request.purpose, before, after),
  )
  return result
}

function readChapterPlan(
  request: ChangeRequest,
  project: StoryProject,
  chapter: Chapter | null | undefined,
  deps: ExecutorDeps,
): string {
  const scope = parseChapterPlanReadScope(request.scope)
  if (scope.mode === 'all') {
    const summary = (project.chapters || []).map(summarizeChapterOutline)
    const result = 'Returned all chapter plans without modifying project files.'
    deps.onMessage(result, createToolMessage('read_all_chapter_outlines', 'success', 'All chapter plans fetched', request.scope, request.purpose, '', JSON.stringify(summary, null, 2)))
    return result
  }
  if (scope.mode === 'indices' && scope.indices?.length) {
    const matched = (project.chapters || []).filter(c => scope.indices!.includes(c.index))
    if (!matched.length) throw new Error(`None of the requested chapters were found.`)
    const result = `Returned ${matched.map(c => `Chapter ${c.index + 1}`).join(', ')} plan(s) without modifying project files.`
    deps.onMessage(result, createToolMessage('read_chapter_outline', 'success', 'Chapter plan(s) fetched', request.scope, request.purpose, '', JSON.stringify(matched.map(summarizeChapterOutline), null, 2)))
    return result
  }
  const current = chapter ?? (project.chapters || [])[0]
  if (!current) throw new Error('No chapters exist in this project.')
  const result = `Returned Chapter ${current.index + 1} plan without modifying project files.`
  deps.onMessage(result, createToolMessage('read_chapter_outline', 'success', 'Chapter plan fetched', request.scope, request.purpose, '', JSON.stringify(current.outline, null, 2)))
  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function saveWithRetry(fn: () => Promise<StoryProject | null>) {
  const result = await fn()
  if (result === null) throw new Error('Failed to save change to the project file.')
}

async function verifyPersistence(
  projectId: string,
  deps: ExecutorDeps,
  verify: (p: StoryProject) => boolean,
  retry: () => Promise<any>,
) {
  const loader = window.electronAPI?.project?.load
  if (!loader) return
  const project = deps.context.project
  const dirPath = project?.directoryPath?.trim() || undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    const reloaded = await loader(projectId, dirPath)
    if (reloaded && verify(reloaded as StoryProject)) return
    if (attempt < 2) await retry()
  }
  throw new Error('The change did not persist to the project file.')
}

function normalizeOutlineForCompare(outline: any) {
  return {
    objective: typeof outline?.objective === 'string' ? outline.objective : '',
    conflict: typeof outline?.conflict === 'string' ? outline.conflict : '',
    keyEvents: Array.isArray(outline?.keyEvents) ? outline.keyEvents.map(String) : [],
    characterActions: Array.isArray(outline?.characterActions) ? outline.characterActions.map(String) : [],
    infoReveals: Array.isArray(outline?.infoReveals) ? outline.infoReveals.map(String) : [],
    endingHook: typeof outline?.endingHook === 'string' ? outline.endingHook : '',
  }
}

function summarizeChapterOutline(chapter: Chapter) {
  const o = normalizeOutlineForCompare(chapter.outline)
  return { id: chapter.id, index: chapter.index, title: chapter.title || '', status: chapter.status, ...o }
}

function parseChapterPlanReadScope(scope: string): { mode: 'current' | 'all' | 'indices'; indices?: number[] } {
  const text = scope.trim().toLowerCase()
  if (!text) return { mode: 'current' }
  if (/(^|\b)(all|all chapters|chapter plans|overview|全章节|全部章节|所有章节)(\b|$)/i.test(text)) return { mode: 'all' }
  const indices = new Set<number>()
  for (const m of text.matchAll(/chapter\s*(\d{1,3})/gi)) {
    const n = Number(m[1]); if (n > 0) indices.add(n - 1)
  }
  for (const m of scope.matchAll(/第\s*(\d{1,3})\s*章/gi)) {
    const n = Number(m[1]); if (n > 0) indices.add(n - 1)
  }
  if (indices.size) return { mode: 'indices', indices: [...indices].sort((a, b) => a - b) }
  return { mode: 'current' }
}

function applyChapterPlanDelete(chapter: Chapter, request: ChangeRequest): Chapter['outline'] {
  const base = normalizeOutlineForCompare(chapter.outline)
  const scope = request.scope.trim()
  const content = request.content.trim()

  const indexedMatch = scope.match(/^(keyEvents|characterActions|infoReveals)\s*\[\s*(\d+)\s*\]/i)
  if (indexedMatch) {
    const field = indexedMatch[1] as 'keyEvents' | 'characterActions' | 'infoReveals'
    const idx = Number(indexedMatch[2])
    const list = [...base[field]]
    if (idx >= 0 && idx < list.length) list.splice(idx, 1)
    return { ...base, [field]: list }
  }
  const listMatch = scope.match(/^(keyEvents|characterActions|infoReveals)\b/i)
  if (listMatch) {
    const field = listMatch[1] as 'keyEvents' | 'characterActions' | 'infoReveals'
    const values = content.split(/\r?\n|[,|]/).map(s => s.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean)
    if (!values.length) return { ...base, [field]: [] }
    const lower = new Set(values.map(s => s.toLowerCase()))
    return { ...base, [field]: (base[field] as string[]).filter((s: string) => !lower.has(s.toLowerCase())) }
  }
  if (/^objective\b/i.test(scope)) return { ...base, objective: '' }
  if (/^conflict\b/i.test(scope)) return { ...base, conflict: '' }
  if (/^endingHook\b/i.test(scope)) return { ...base, endingHook: '' }
  if (/^(chapter-plan|outline|all)\b/i.test(scope)) return { objective: '', conflict: '', keyEvents: [], characterActions: [], infoReveals: [], endingHook: '' }
  throw new Error('Chapter plan delete needs a supported scope: keyEvents[N], keyEvents, characterActions, infoReveals, objective, conflict, endingHook, or chapter-plan.')
}

function parseCharacterDeleteMatchers(content: string): { ids: Set<string>; names: Set<string> } {
  const ids = new Set<string>()
  const names = new Set<string>()
  try {
    const parsed = parseLooseJson(content)
    const items = Array.isArray(parsed) ? parsed
      : Array.isArray(parsed?.characters) ? parsed.characters
      : Array.isArray(parsed?.targets) ? parsed.targets
      : [parsed]
    for (const item of items) {
      if (!item) continue
      if (typeof item === 'string') {
        const t = item.trim()
        if (/^[a-z0-9_-]{8,}$/i.test(t)) ids.add(t); else names.add(t.toLowerCase())
      } else if (typeof item === 'object') {
        const id = String((item as any).id || '').trim()
        const name = String((item as any).name || '').trim()
        if (id) ids.add(id)
        if (name) names.add(name.toLowerCase())
      }
    }
  } catch { /* fallback below */ }
  for (const token of content.split(/\r?\n|[,|]/).map(s => s.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean)) {
    if (/^[a-z0-9_-]{8,}$/i.test(token)) ids.add(token)
    else if (token.length <= 80) names.add(token.toLowerCase())
  }
  return { ids, names }
}
