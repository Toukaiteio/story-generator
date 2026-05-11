<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useProjectStore } from '@/stores/project'
import { useGenerationStore, type ChapterAuditIssue } from '@/stores/generation'
import { useWritingStyleStore } from '@/stores/writingStyle'
import { useUiStore } from '@/stores/ui'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import { detectMarkdown, markdownToHtml } from '@/services/markdown'
import { sanitizeGeneratedChapterContent } from '@/services/writingFormat'
import { countWords } from '@/services/agent/validation'
import { buildProofreadingSegments } from '@/services/proofreading/chunking'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import VibeAssistant from '@/components/workspace/VibeAssistant.vue'
import EditingAssistant from '@/components/workspace/EditingAssistant.vue'
import { Save, Eye, EyeOff, FileText, Type, Sparkles, Clock, RotateCcw, Code2, BookOpen, Send } from 'lucide-vue-next'
import type { Chapter, ChapterContentVersion, ChapterOutline } from '@/types/chapter'

const props = defineProps<{
  chapterId: string
  active?: boolean
}>()

const projectStore = useProjectStore()
const genStore = useGenerationStore()
const writingStyleStore = useWritingStyleStore()
const ui = useUiStore()
const toast = useToast()
const tr = translatePhrase

const project = computed(() => projectStore.activeProject)
const chapter = computed(() => {
  if (!project.value) return null
  return project.value.chapters.find(ch => ch.id === props.chapterId) ?? null
})

const title = ref('')
const content = ref('')
const showVersions = ref(false)
const viewMode = ref<'edit' | 'preview'>('edit')
const assistantTab = ref<'outline' | 'vibe' | 'editing'>('outline')
const vibeAssistant = ref<InstanceType<typeof VibeAssistant> | null>(null)
const contentPreviewRef = ref<HTMLElement | null>(null)
const selectedProofreadingIssue = ref<any | null>(null)
const outlineObjective = ref('')
const outlineConflict = ref('')
const outlineKeyEvents = ref('')
const outlineCharacterActions = ref('')
const outlineInfoReveals = ref('')
const outlineEndingHook = ref('')
const selectedStyleId = ref('default')
type OutlineEditField = 'objective' | 'conflict' | 'keyEvents' | 'characterActions' | 'infoReveals' | 'endingHook'
const editingOutlineField = ref<OutlineEditField | null>(null)
let outlineSaveTimer: ReturnType<typeof setTimeout> | null = null
let syncingOutline = false
let syncingChapter = false
let loadedChapterId = ''

function createContentVersion(label: string, versionContent: string, issues?: any[]): ChapterContentVersion {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label,
    content: versionContent,
    proofreadingIssues: issues?.length ? issues.map(issue => ({ ...issue })) : undefined,
    createdAt: new Date().toISOString(),
  }
}

function buildChapterWithDraftUpdate(ch: Chapter, nextContent: string) {
  const hasIssueSnapshot = Boolean(ch.proofreadingIssues?.length && ch.content !== nextContent)
  return {
    ...ch,
    title: title.value,
    content: nextContent,
    contentVersions: hasIssueSnapshot
      ? [
          createContentVersion('Before draft edit - proofreading issues valid', ch.content, ch.proofreadingIssues),
          ...(ch.contentVersions || []),
        ]
      : (ch.contentVersions || []),
    proofreadingIssuesStale: hasIssueSnapshot ? true : ch.proofreadingIssuesStale,
    status: hasIssueSnapshot ? 'draft' as const : ch.status,
  }
}

const isDirty = computed(() => {
  const ch = loadedChapterId && project.value
    ? project.value.chapters.find(item => item.id === loadedChapterId) ?? chapter.value
    : chapter.value
  if (!ch) return false
  return title.value !== (ch.title || '') || content.value !== (ch.content || '')
})

const styleOptions = computed(() => [
  { label: 'Default (No Reference)', value: 'default' },
  ...writingStyleStore.styles.map(style => ({ label: style.name, value: style.id })),
])

function listToText(items?: string[]) {
  return Array.isArray(items) ? items.join('\n') : ''
}

function parseOutlineList(value: string) {
  return value
    .split(/\r?\n/)
    .map(item => item.replace(/^\s*[-*]\s+/, '').trim())
    .filter(Boolean)
}

function syncOutlineDraft(outline: ChapterOutline) {
  syncingOutline = true
  outlineObjective.value = outline.objective || ''
  outlineConflict.value = outline.conflict || ''
  outlineKeyEvents.value = listToText(outline.keyEvents)
  outlineCharacterActions.value = listToText(outline.characterActions)
  outlineInfoReveals.value = listToText(outline.infoReveals)
  outlineEndingHook.value = outline.endingHook || ''
  nextTick(() => {
    syncingOutline = false
  })
}

function syncChapterDraft(ch: Chapter) {
  const isNewChapter = loadedChapterId !== ch.id
  const cachedDraft = ui.getChapterEditorDraft(ch.id)
  if (isNewChapter || !isDirty.value) {
    syncingChapter = true
    title.value = cachedDraft?.title ?? ch.title ?? ''
    content.value = cachedDraft?.content ?? ch.content ?? ''
    loadedChapterId = ch.id
    nextTick(() => {
      syncingChapter = false
    })
  }
  syncOutlineDraft(ch.outline)
  selectedStyleId.value = project.value?.styleId || 'default'
}

watch(chapter, (ch) => {
  if (ch) syncChapterDraft(ch)
}, { immediate: true })

function buildOutlineDraft(): ChapterOutline {
  return {
    objective: outlineObjective.value.trim(),
    conflict: outlineConflict.value.trim(),
    keyEvents: parseOutlineList(outlineKeyEvents.value),
    characterActions: parseOutlineList(outlineCharacterActions.value),
    infoReveals: parseOutlineList(outlineInfoReveals.value),
    endingHook: outlineEndingHook.value.trim(),
  }
}

async function saveOutlineNow() {
  if (!project.value || !chapter.value) return
  if (outlineSaveTimer) {
    clearTimeout(outlineSaveTimer)
    outlineSaveTimer = null
  }
  const nextOutline = buildOutlineDraft()
  const chapters = project.value.chapters.map(ch =>
    ch.id === props.chapterId
      ? { ...ch, outline: nextOutline }
      : ch
  )
  const saved = await projectStore.updateProject(project.value.id, { chapters })
  if (!saved) {
    toast.error('Failed to save chapter outline')
  }
}

async function updateWritingStyle(styleId: string) {
  if (!project.value) return
  selectedStyleId.value = styleId
  const saved = await projectStore.updateProject(project.value.id, {
    styleId,
    style: writingStyleStore.resolveStyleContent(styleId),
  })
  if (!saved) {
    toast.error('Failed to save writing style')
  }
}

function scheduleOutlineSave() {
  if (syncingOutline) return
  if (outlineSaveTimer) clearTimeout(outlineSaveTimer)
  outlineSaveTimer = setTimeout(() => {
    void saveOutlineNow()
  }, 450)
}

function editOutlineField(field: OutlineEditField) {
  editingOutlineField.value = field
}

async function finishOutlineEdit() {
  await saveOutlineNow()
  editingOutlineField.value = null
}

function setWindowUnsavedState(value: boolean) {
  const chapterId = loadedChapterId || props.chapterId
  ui.setWorkspaceNodeUnsaved(`chapter-${chapterId}`, value)
}

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (!isDirty.value && !Object.keys(ui.chapterEditorDrafts).length) return
  event.preventDefault()
  event.returnValue = ''
}

onBeforeUnmount(() => {
  if (outlineSaveTimer) {
    void saveOutlineNow()
  }
  if (isDirty.value) {
    cacheCurrentDraft()
  }
  deactivateEditorListeners()
  if (!isDirty.value) {
    const chapterId = loadedChapterId || props.chapterId
    ui.setWorkspaceNodeUnsaved(`chapter-${chapterId}`, false)
  }
})

let editorListenersActive = false

function activateEditorListeners() {
  if (editorListenersActive) return
  editorListenersActive = true
  window.addEventListener('keydown', handleSaveShortcut)
  window.addEventListener('beforeunload', handleBeforeUnload)
}

function deactivateEditorListeners() {
  if (!editorListenersActive) return
  editorListenersActive = false
  window.removeEventListener('keydown', handleSaveShortcut)
  window.removeEventListener('beforeunload', handleBeforeUnload)
}

onMounted(() => {
  if (props.active) activateEditorListeners()
})

watch(() => props.active, active => {
  if (active) activateEditorListeners()
  else deactivateEditorListeners()
}, { immediate: true })

watch(isDirty, dirty => {
  setWindowUnsavedState(dirty)
}, { immediate: true })

function cacheCurrentDraft() {
  if (!loadedChapterId) return
  const ch = project.value?.chapters.find(item => item.id === loadedChapterId)
  if (!ch) return
  if (title.value !== (ch.title || '') || content.value !== (ch.content || '')) {
    ui.setChapterEditorDraft(loadedChapterId, {
      title: title.value,
      content: content.value,
    })
  } else {
    ui.clearChapterEditorDraft(loadedChapterId)
  }
}

watch([title, content], () => {
  if (syncingChapter) return
  cacheCurrentDraft()
})

async function save(options: { silent?: boolean } = {}) {
  if (!project.value) return
  const chapterId = loadedChapterId || props.chapterId
  const targetChapter = project.value.chapters.find(ch => ch.id === chapterId)
  if (!targetChapter) return
  const nextContent = sanitizeGeneratedChapterContent(content.value, {
    writingFormat: project.value.writingFormat,
    writingStyle: project.value.style,
    chapterTitle: title.value,
    chapterNumber: targetChapter.index + 1,
  })
  content.value = nextContent
  const willStaleIssues = Boolean(targetChapter.proofreadingIssues?.length && targetChapter.content !== nextContent)
  const chapters = project.value.chapters.map(ch =>
    ch.id === chapterId
      ? buildChapterWithDraftUpdate(ch, nextContent)
      : ch
  )
  const saved = await projectStore.updateProject(project.value.id, {
    chapters,
  })
  if (!saved) {
    if (!options.silent) toast.error('Failed to save chapter')
    return
  }
  ui.clearChapterEditorDraft(chapterId)
  ui.setWorkspaceNodeUnsaved(`chapter-${chapterId}`, false)
  if (!options.silent) {
    toast.success(willStaleIssues ? 'Chapter saved. Existing proofreading issues may be stale.' : 'Chapter saved')
  }
}

function handleSaveShortcut(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void save()
  }
}

async function restoreVersion(version: { content: string; proofreadingIssues?: any[] }) {
  if (!chapter.value || !project.value) return
  content.value = version.content
  const chapters = project.value.chapters.map(ch =>
    ch.id === props.chapterId
      ? {
          ...ch,
          content: version.content,
          proofreadingIssues: version.proofreadingIssues ? version.proofreadingIssues.map(issue => ({ ...issue })) : ch.proofreadingIssues,
          proofreadingIssuesStale: false,
          status: version.proofreadingIssues?.length ? 'proofread' as const : 'draft' as const,
        }
      : ch
  )
  const saved = await projectStore.updateProject(project.value.id, { chapters })
  if (saved) {
    showVersions.value = false
    toast.success('Version restored to editor')
  }
}

async function deleteVersion(versionId: string) {
  if (!chapter.value || !project.value) return
  const chapters = project.value.chapters.map(ch =>
    ch.id === props.chapterId
      ? { ...ch, contentVersions: (ch.contentVersions || []).filter(version => version.id !== versionId) }
      : ch
  )
  const saved = await projectStore.updateProject(project.value.id, { chapters })
  if (saved) toast.success('Version deleted')
}

async function restoreLatestIssueSnapshot() {
  const version = chapter.value?.contentVersions?.find(item => item.proofreadingIssues?.length)
  if (!version) return
  await restoreVersion(version)
}

const statusVariant = computed(() => {
  const map: Record<string, string> = {
    outline: 'default',
    writing: 'warning',
    draft: 'default',
    proofreading: 'warning',
    proofread: 'accent',
    polishing: 'warning',
    polished: 'success',
  }
  return (map[chapter.value?.status ?? ''] ?? 'default') as any
})

const wordCount = computed(() => {
  return countWords(content.value || '')
})

const isMarkdownContent = computed(() => project.value?.writingFormat === 'markdown')

interface TextMatch {
  source: string
  start: number
  end: number
}

interface ChunkMatch {
  source: string
  start: number
  end: number
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeSearchChar(char: string) {
  return /\s/.test(char) ? '' : char.toLowerCase()
}

function buildNormalizedIndex(text: string) {
  let normalized = ''
  const map: number[] = []
  for (let offset = 0; offset < text.length;) {
    const char = Array.from(text.slice(offset))[0]
    const next = normalizeSearchChar(char)
    if (next) {
      normalized += next
      map.push(offset)
    }
    offset += char.length
  }
  return { normalized, map }
}

function findTextMatch(source: string, excerpt: string): TextMatch | null {
  const exactIndex = source.toLowerCase().indexOf(excerpt.toLowerCase())
  if (exactIndex >= 0) {
    return { source, start: exactIndex, end: exactIndex + excerpt.length }
  }

  const normalizedSource = buildNormalizedIndex(source)
  const normalizedExcerpt = buildNormalizedIndex(excerpt).normalized
  if (!normalizedExcerpt) return null

  const normalizedIndex = normalizedSource.normalized.indexOf(normalizedExcerpt)
  if (normalizedIndex < 0) return null

  const start = normalizedSource.map[normalizedIndex]
  const endStart = normalizedSource.map[normalizedIndex + normalizedExcerpt.length - 1]
  const end = endStart + Array.from(source.slice(endStart))[0].length
  return { source, start, end }
}

function findIssueMatch(issue: any): TextMatch | null {
  const excerpt = String(issue?.excerpt ?? '').trim()
  if (!excerpt) return null

  const sources = [
    content.value,
    chapter.value?.content ?? '',
  ].filter(Boolean)

  for (const source of sources) {
    const match = findTextMatch(source, excerpt)
    if (match) return match
  }

  return null
}

function getIssueSegmentIndex(issue: any) {
  if (Number.isInteger(issue?.segmentIndex)) {
    return Number(issue.segmentIndex)
  }

  const idMatch = String(issue?.id ?? '').match(/(?:^|-)part-(\d+)(?:-|$)/)
  if (!idMatch) return -1

  return Number(idMatch[1]) - 1
}

function getContentSources() {
  return [
    content.value,
    chapter.value?.content ?? '',
  ].filter(Boolean)
}

function findIssueChunkMatch(issue: any): ChunkMatch | null {
  const segmentIndex = getIssueSegmentIndex(issue)
  if (segmentIndex < 0) return null

  const segmentCharStart = Number(issue?.segmentCharStart)
  const segmentCharEnd = Number(issue?.segmentCharEnd)
  const sources = getContentSources()

  for (const source of sources) {
    if (
      Number.isFinite(segmentCharStart)
      && Number.isFinite(segmentCharEnd)
      && segmentCharStart >= 0
      && segmentCharEnd > segmentCharStart
      && segmentCharEnd <= source.length
    ) {
      return { source, start: segmentCharStart, end: segmentCharEnd }
    }

    const segment = buildProofreadingSegments(source)[segmentIndex]
    if (segment) {
      return { source, start: segment.charStart, end: segment.charEnd }
    }
  }

  return null
}

const highlightedContentHtml = computed(() => {
  const issue = selectedProofreadingIssue.value
  const match = issue ? findIssueMatch(issue) : null
  const chunk = issue && !match ? findIssueChunkMatch(issue) : null
  const source = match?.source ?? chunk?.source ?? content.value ?? ''
  if (!match && !chunk) return escapeHtml(source)

  if (chunk) {
    const before = escapeHtml(source.slice(0, chunk.start))
    const target = escapeHtml(source.slice(chunk.start, chunk.end))
    const after = escapeHtml(source.slice(chunk.end))
    return `${before}<span id="proofreading-chunk-current">${target}</span>${after}`
  }

  const textMatch = match as TextMatch
  const before = escapeHtml(source.slice(0, textMatch.start))
  const target = escapeHtml(source.slice(textMatch.start, textMatch.end))
  const after = escapeHtml(source.slice(textMatch.end))
  return `${before}<mark class="proofreading-highlight" id="proofreading-highlight-current">${target}</mark>${after}`
})

const renderedContent = computed(() => {
  if (selectedProofreadingIssue.value) {
    return highlightedContentHtml.value
  }
  return markdownToHtml(content.value)
})

const vibeContext = computed(() => ({
  projectId: project.value?.id ?? '',
  directoryPath: project.value?.directoryPath ?? '',
  workspaceSnapshot: chapter.value
    ? {
        type: 'chapter-detail',
        chapterId: chapter.value.id,
        title: title.value,
        content: content.value,
        outline: buildOutlineDraft(),
        styleId: selectedStyleId.value,
      }
    : null,
  writingFormat: isMarkdownContent.value ? 'markdown' : 'plaintext',
  writingStyle: project.value?.style ?? '',
  outline: project.value?.outline ?? '',
  chapter: chapter.value
    ? {
        id: chapter.value.id,
        index: chapter.value.index,
        title: title.value,
        outline: buildOutlineDraft(),
        content: content.value,
      }
    : null,
}))

const characterContext = computed(() => {
  if (!project.value?.characters.length) return ''
  return project.value.characters
    .map(character => `- ${character.name} [id: ${character.id}] (${character.role})`)
    .join('\n')
})

const relationshipContext = computed(() => {
  if (!project.value || !chapter.value) return ''
  return `Relationship context is not inlined to reduce prompt size. Use relationship query tools for specific character pairs at chapterIndex ${Math.max(-1, chapter.value.index - 1)} when available.`
})

function applyVibeContent(nextContent: string) {
  if (!project.value || !chapter.value) {
    content.value = nextContent
    return
  }
  content.value = sanitizeGeneratedChapterContent(nextContent, {
    writingFormat: project.value.writingFormat,
    writingStyle: project.value.style,
    chapterTitle: title.value,
    chapterNumber: chapter.value.index + 1,
  })
  if (project.value.writingFormat === 'markdown' && detectMarkdown(content.value)) viewMode.value = 'preview'
}

function rewindVibeWorkspace(snapshot: any) {
  if (!snapshot || snapshot.type !== 'chapter-detail') return
  if (snapshot.chapterId && snapshot.chapterId !== props.chapterId) return
  title.value = typeof snapshot.title === 'string' ? snapshot.title : title.value
  content.value = typeof snapshot.content === 'string' ? snapshot.content : content.value
  if (snapshot.outline) syncOutlineDraft(snapshot.outline)
  if (typeof snapshot.styleId === 'string') selectedStyleId.value = snapshot.styleId
  viewMode.value = 'edit'
  toast.success('Workspace snapshot restored')
}

async function sendToVibe(instruction: string) {
  assistantTab.value = 'vibe'
  await nextTick()
  vibeAssistant.value?.submitRequest(instruction)
}

function formatList(items?: string[]) {
  return Array.isArray(items) && items.length
    ? items.map(item => `- ${item}`).join('\n')
    : ''
}

const chapterOutlineText = computed(() => {
  const outline = buildOutlineDraft()
  if (!outline) return ''
  return [
    outline.objective ? `Objective:\n${outline.objective}` : '',
    outline.conflict ? `Conflict:\n${outline.conflict}` : '',
    formatList(outline.keyEvents) ? `Plot Beats:\n${formatList(outline.keyEvents)}` : '',
    formatList(outline.characterActions) ? `Character Actions:\n${formatList(outline.characterActions)}` : '',
    formatList(outline.infoReveals) ? `Reveals:\n${formatList(outline.infoReveals)}` : '',
    outline.endingHook ? `Ending Hook:\n${outline.endingHook}` : '',
  ].filter(Boolean).join('\n\n')
})

const selectedWritingStyleForVibe = computed(() => {
  const styleId = selectedStyleId.value || project.value?.styleId || 'default'
  const content = writingStyleStore.resolveStyleContent(styleId).trim()
  if (!content) return ''
  const style = writingStyleStore.getStyleById(styleId)
  return [
    style?.name ? `Style Name: ${style.name}` : '',
    style?.description ? `Style Description: ${style.description}` : '',
    `Style Guide:\n${content}`,
  ].filter(Boolean).join('\n\n')
})

function draftFromOutlineWithVibe() {
  if (!chapter.value) return
  const prompt = [
    `Draft Chapter ${chapter.value.index + 1}: ${title.value || chapter.value.title || 'Untitled'} from the chapter outline.`,
    'Use the outline as the primary source of truth and create a complete first draft for this chapter.',
    'Preserve the project language, writing format, writing style, characters, and continuity.',
    selectedWritingStyleForVibe.value
      ? `Writing Style to follow:\n${selectedWritingStyleForVibe.value}`
      : 'Writing Style to follow: use the project default style.',
    content.value.trim()
      ? 'The editor already contains text. Rewrite or expand it only where needed to align with the outline.'
      : 'The editor is empty. Create the initial draft directly from the outline.',
    `Chapter Outline:\n${chapterOutlineText.value || JSON.stringify(chapter.value.outline, null, 2)}`,
  ].join('\n\n')
  void sendToVibe(prompt)
}

async function saveProofreadingIssues(issues: ChapterAuditIssue[]) {
  if (!project.value || !chapter.value) return
  const chapters = project.value.chapters.map(ch =>
    ch.id === props.chapterId
      ? {
          ...ch,
          proofreadingIssues: issues,
          proofreadingIssuesStale: false,
          status: 'proofread' as const,
        }
      : ch
  )
  const saved = await projectStore.updateProject(project.value.id, { chapters })
  if (!saved) {
    toast.error('Failed to save proofreading issues')
  }
}

async function handleProofreadingIssueSelected(issue: ChapterAuditIssue) {
  selectedProofreadingIssue.value = issue
  viewMode.value = 'preview'
  await nextTick()
  const target = contentPreviewRef.value?.querySelector('#proofreading-highlight-current')
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }

  const chunkTarget = contentPreviewRef.value?.querySelector('#proofreading-chunk-current')
  if (chunkTarget) {
    chunkTarget.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return
  }

  toast.warning('Could not locate this excerpt in the current chapter text. It may come from an older proofreading run.')
}

async function polishProofreadingIssue(issue?: ChapterAuditIssue) {
  if (!project.value || !chapter.value || genStore.isGenerating) return
  const issues = issue
    ? [issue]
    : (chapter.value.proofreadingIssues || []).filter(item => !item.ignored && item.polishStatus !== 'fixed')
  if (!issues.length) {
    toast.warning('No available issues to polish')
    return
  }

  try {
    await saveProofreadingIssues(chapter.value.proofreadingIssues || issues)
    await genStore.polishChapter(project.value.id, chapter.value.id, issues)
    const latest = projectStore.getProjectById(project.value.id)?.chapters.find(item => item.id === chapter.value?.id)
    if (latest) {
      content.value = latest.content || content.value
    }
    toast.success(issue ? 'Issue sent to Polish AI' : 'Issues sent to Polish AI')
  } catch (error: any) {
    toast.error(error?.message || 'Polish AI failed')
  }
}
</script>

<template>
  <div v-if="chapter" class="h-full flex flex-col overflow-hidden bg-surface-0">
    <!-- Header Toolbar -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center justify-between px-6 py-5 border-b border-surface-4 shrink-0 bg-surface-1 shadow-sm">
      <div class="flex items-center gap-4 flex-1 min-w-0">
        <div class="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center border border-surface-3 shrink-0 shadow-sm">
          <FileText :size="22" class="text-accent" />
        </div>
        <div class="flex-1 flex flex-col gap-1 min-w-0">
          <div class="flex items-center gap-3">
            <span class="text-xs font-semibold text-text-muted uppercase tracking-wider">{{ tr('Chapter') }} {{ chapter.index + 1 }}</span>
            <BaseTag :variant="statusVariant" size="sm" class="uppercase tracking-wider font-semibold text-[10px] px-2">{{ chapter.status }}</BaseTag>
            <BaseTag v-if="isDirty" variant="warning" size="sm" class="uppercase tracking-wider font-semibold text-[10px] px-2">
              {{ tr('Unsaved changes') }}
            </BaseTag>
          </div>
          <input 
            v-model="title" 
            class="text-xl font-bold text-text-primary bg-transparent outline-none placeholder:text-text-muted/50 truncate w-full transition-colors focus:text-accent"
            :placeholder="tr('Enter Chapter Title...')"
          />
        </div>
      </div>

      <div class="flex items-center gap-3 shrink-0 sm:ml-4">
        <BaseTag :variant="isMarkdownContent ? 'accent' : 'default'" size="sm" class="hidden md:inline-flex">
          {{ tr(isMarkdownContent ? 'Markdown' : 'Plain Text') }}
        </BaseTag>
        <div class="px-2.5 py-1.5 rounded-md bg-surface-2 border border-surface-3 text-xs text-text-secondary flex items-center gap-1.5 hidden md:flex">
          <Type :size="14" class="text-text-muted" />
          <span class="text-text-muted">{{ tr('Words:') }}</span>
          <span class="text-text-primary font-medium">{{ wordCount }}</span>
        </div>
        <BaseButton variant="secondary" size="md" @click="showVersions = !showVersions" class="hover:border-surface-4">
          <Eye v-if="!showVersions" :size="16" />
          <EyeOff v-else :size="16" />
          <span>{{ tr(showVersions ? 'Editor' : 'Versions') }}</span>
        </BaseButton>
        <div v-if="!showVersions" class="hidden lg:flex rounded-md border border-surface-4 bg-surface-2 p-0.5">
          <button
            :class="[
              'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors',
              viewMode === 'edit' ? 'bg-surface-4 text-text-primary' : 'text-text-secondary hover:text-text-primary',
            ]"
            @click="viewMode = 'edit'"
          >
            <Code2 :size="13" />
            {{ tr('Edit') }}
          </button>
          <button
            :class="[
              'inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors',
              viewMode === 'preview' ? 'bg-surface-4 text-text-primary' : 'text-text-secondary hover:text-text-primary',
            ]"
            @click="viewMode = 'preview'"
          >
            <BookOpen :size="13" />
            {{ tr('Preview') }}
          </button>
        </div>
        <BaseButton variant="primary" size="md" @click="save">
          <Save :size="16" />
          <span>{{ tr('Save Changes') }}</span>
          <span class="hidden text-[10px] opacity-70 xl:inline">Ctrl+S</span>
        </BaseButton>
      </div>
    </div>

    <div
      v-if="chapter.proofreadingIssuesStale"
      class="flex shrink-0 items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-6 py-2 text-xs"
    >
      <span class="text-warning">{{ tr('Draft changed after proofreading. Existing issues may no longer match this text.') }}</span>
      <BaseButton
        v-if="chapter.contentVersions?.some(version => version.proofreadingIssues?.length)"
        variant="secondary"
        size="sm"
        @click="restoreLatestIssueSnapshot"
      >
        {{ tr('Restore issue snapshot') }}
      </BaseButton>
    </div>

    <!-- Main Content Area -->
    <div class="flex-1 min-h-0 flex overflow-hidden bg-surface-0">
      <div class="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
        <div class="max-w-4xl mx-auto px-4 sm:px-6 py-10 min-h-full flex flex-col border-l border-r border-surface-4 bg-surface-0 shadow-sm">
          <div v-if="!showVersions" class="flex-1 flex flex-col">
            <textarea
              v-if="viewMode === 'edit'"
              v-model="content"
              class="w-full flex-1 min-h-[60vh] bg-transparent text-text-primary resize-none outline-none font-serif selection:bg-accent/30 selection:text-text-primary"
              :placeholder="tr('Start writing your chapter here...')"
              style="font-size: 1.125rem; line-height: 1.8; letter-spacing: 0.01em;"
            />

            <article
              v-else
              ref="contentPreviewRef"
              class="markdown-preview min-h-[60vh] text-text-primary"
              v-html="renderedContent || `<p class=&quot;text-text-muted&quot;>${tr('No content to preview.')}</p>`"
            />
          </div>

          <div v-else class="flex-1 flex flex-col">
            <div class="flex items-center justify-between mb-10 pb-4 border-b border-surface-4">
              <div>
                <h3 class="text-xl font-bold text-text-primary">{{ tr('Generation History') }}</h3>
                <p class="text-xs text-text-secondary mt-1">{{ tr('Review and restore content from different generation stages.') }}</p>
              </div>
            </div>

            <div class="space-y-16">
              <div v-if="chapter.content" class="group relative">
                <div class="flex items-center gap-3 mb-6">
                  <div class="w-8 h-8 rounded-full bg-surface-3 text-text-muted flex items-center justify-center shrink-0">
                    <Clock :size="16" />
                  </div>
                  <span class="text-xs font-black uppercase tracking-widest text-text-muted">{{ tr('Current Text') }}</span>
                  <div class="h-px flex-1 bg-surface-4"></div>
                  <span class="text-[10px] font-bold text-text-muted uppercase">{{ countWords(chapter.content) }} {{ tr('words') }}</span>
                  <BaseButton variant="secondary" size="sm" @click="restoreVersion({ content: chapter.content })" class="ml-4">
                    <RotateCcw :size="14" class="mr-1.5" />
                    {{ tr('Restore') }}
                  </BaseButton>
                </div>
                <div class="text-text-primary font-serif text-lg leading-relaxed whitespace-pre-wrap px-2">
                  {{ chapter.content }}
                </div>
              </div>

              <div v-if="chapter.contentVersions?.length" class="group relative">
                <div class="flex items-center gap-3 mb-6">
                  <div class="w-8 h-8 rounded-full bg-surface-3 text-text-muted flex items-center justify-center shrink-0">
                    <Clock :size="16" />
                  </div>
                  <span class="text-xs font-black uppercase tracking-widest text-text-muted">{{ tr('Saved Draft Versions') }}</span>
                  <div class="h-px flex-1 bg-surface-4"></div>
                </div>
                <div class="space-y-4">
                  <div
                    v-for="version in chapter.contentVersions"
                    :key="version.id"
                    class="rounded-lg border border-surface-4 bg-surface-1 p-4"
                  >
                    <div class="mb-3 flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <p class="truncate text-xs font-semibold text-text-primary">{{ version.label }}</p>
                        <p class="text-[10px] text-text-muted">
                          {{ new Date(version.createdAt).toLocaleString() }}
                          <span v-if="version.proofreadingIssues?.length"> · {{ tr('includes proofreading issues') }}</span>
                        </p>
                      </div>
                      <div class="flex shrink-0 gap-2">
                        <BaseButton variant="secondary" size="sm" @click="restoreVersion(version)">
                          <RotateCcw :size="14" />
                          {{ tr('Restore') }}
                        </BaseButton>
                        <BaseButton variant="danger" size="sm" @click="deleteVersion(version.id)">
                          {{ tr('Delete') }}
                        </BaseButton>
                      </div>
                    </div>
                    <p class="line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">{{ version.content }}</p>
                  </div>
                </div>
              </div>

              <div v-if="!chapter.content" class="h-[40vh] flex flex-col items-center justify-center text-center">
                <div class="w-16 h-16 rounded-full bg-surface-2 flex items-center justify-center mb-4 border border-surface-3">
                  <FileText :size="24" class="text-text-muted" />
                </div>
                <p class="text-base font-medium text-text-primary">{{ tr('No content generated yet') }}</p>
                <p class="text-sm text-text-secondary mt-1 max-w-sm">{{ tr('Use the generation tools to create content for this chapter.') }}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside class="hidden xl:flex w-[390px] shrink-0 flex-col border-l border-surface-4 bg-surface-1">
        <div class="flex h-8 shrink-0 border-b border-surface-4 bg-surface-2/60 p-1">
          <button
            :class="[
              'flex-1 rounded text-[11px] font-medium transition-colors',
              assistantTab === 'outline' ? 'bg-surface-4 text-text-primary' : 'text-text-secondary hover:text-text-primary',
            ]"
            @click="assistantTab = 'outline'"
          >
            {{ tr('Outline') }}
          </button>
          <button
            :class="[
              'flex-1 rounded text-[11px] font-medium transition-colors',
              assistantTab === 'vibe' ? 'bg-surface-4 text-text-primary' : 'text-text-secondary hover:text-text-primary',
            ]"
            @click="assistantTab = 'vibe'"
          >
            {{ tr('Vibe AI') }}
          </button>
          <button
            :class="[
              'flex-1 rounded text-[11px] font-medium transition-colors',
              assistantTab === 'editing' ? 'bg-surface-4 text-text-primary' : 'text-text-secondary hover:text-text-primary',
            ]"
            @click="assistantTab = 'editing'"
          >
            {{ tr('Editing AI') }}
          </button>
        </div>

        <div v-if="assistantTab === 'outline'" class="flex min-h-0 flex-1 flex-col">
          <div class="shrink-0 border-b border-surface-4 px-4 py-3">
            <div class="flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs font-semibold text-text-primary">{{ tr('Chapter Outline') }}</p>
                <p class="mt-0.5 text-[10px] text-text-muted">{{ tr('Use this as an assisted drafting brief.') }}</p>
              </div>
              <BaseButton
                variant="primary"
                size="sm"
                :disabled="!chapterOutlineText.trim()"
                @click="draftFromOutlineWithVibe"
              >
                <Send :size="13" />
                <span>{{ tr('Send to Vibe') }}</span>
              </BaseButton>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
            <div v-if="chapterOutlineText.trim() || chapter" class="space-y-4 text-xs leading-relaxed text-text-secondary">
              <section class="outline-display-card cursor-default">
                <p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-muted">{{ tr('Writing Style') }}</p>
                <BaseSelect
                  :model-value="selectedStyleId"
                  :options="styleOptions"
                  placeholder="Select style"
                  @update:model-value="updateWritingStyle"
                  @click.stop
                />
              </section>
              <section class="outline-display-card" @click="editOutlineField('objective')">
                <p class="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">{{ tr('Objective') }}</p>
                <textarea
                  v-if="editingOutlineField === 'objective'"
                  v-model="outlineObjective"
                  rows="3"
                  class="outline-edit-field"
                  :placeholder="tr('What this chapter must accomplish...')"
                  autofocus
                  @click.stop
                  @input="scheduleOutlineSave"
                  @blur="finishOutlineEdit"
                  @keydown.esc.prevent="editingOutlineField = null"
                />
                <p v-else class="text-text-primary">
                  {{ outlineObjective || tr('Click to add an objective...') }}
                </p>
              </section>
              <section class="outline-display-card" @click="editOutlineField('conflict')">
                <p class="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">{{ tr('Conflict') }}</p>
                <textarea
                  v-if="editingOutlineField === 'conflict'"
                  v-model="outlineConflict"
                  rows="3"
                  class="outline-edit-field"
                  :placeholder="tr('Core tension, obstacle, or dilemma...')"
                  autofocus
                  @click.stop
                  @input="scheduleOutlineSave"
                  @blur="finishOutlineEdit"
                  @keydown.esc.prevent="editingOutlineField = null"
                />
                <p v-else class="text-text-primary">
                  {{ outlineConflict || tr('Click to add a conflict...') }}
                </p>
              </section>
              <section class="outline-display-card" @click="editOutlineField('keyEvents')">
                <p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-muted">{{ tr('Plot Beats') }}</p>
                <textarea
                  v-if="editingOutlineField === 'keyEvents'"
                  v-model="outlineKeyEvents"
                  rows="5"
                  class="outline-edit-field"
                  :placeholder="tr('One plot beat per line...')"
                  autofocus
                  @click.stop
                  @input="scheduleOutlineSave"
                  @blur="finishOutlineEdit"
                  @keydown.esc.prevent="editingOutlineField = null"
                />
                <ul v-else-if="parseOutlineList(outlineKeyEvents).length" class="space-y-1.5">
                  <li v-for="item in parseOutlineList(outlineKeyEvents)" :key="item" class="flex gap-2">
                    <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent"></span>
                    <span>{{ item }}</span>
                  </li>
                </ul>
                <p v-else class="text-text-muted">{{ tr('Click to add plot beats...') }}</p>
              </section>
              <section class="outline-display-card" @click="editOutlineField('characterActions')">
                <p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-muted">{{ tr('Character Actions') }}</p>
                <textarea
                  v-if="editingOutlineField === 'characterActions'"
                  v-model="outlineCharacterActions"
                  rows="5"
                  class="outline-edit-field"
                  :placeholder="tr('One character action per line...')"
                  autofocus
                  @click.stop
                  @input="scheduleOutlineSave"
                  @blur="finishOutlineEdit"
                  @keydown.esc.prevent="editingOutlineField = null"
                />
                <ul v-else-if="parseOutlineList(outlineCharacterActions).length" class="space-y-1.5">
                  <li v-for="item in parseOutlineList(outlineCharacterActions)" :key="item" class="flex gap-2">
                    <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-warning"></span>
                    <span>{{ item }}</span>
                  </li>
                </ul>
                <p v-else class="text-text-muted">{{ tr('Click to add character actions...') }}</p>
              </section>
              <section class="outline-display-card" @click="editOutlineField('infoReveals')">
                <p class="mb-2 text-[10px] font-bold uppercase tracking-wider text-text-muted">{{ tr('Reveals') }}</p>
                <textarea
                  v-if="editingOutlineField === 'infoReveals'"
                  v-model="outlineInfoReveals"
                  rows="4"
                  class="outline-edit-field"
                  :placeholder="tr('One reveal per line...')"
                  autofocus
                  @click.stop
                  @input="scheduleOutlineSave"
                  @blur="finishOutlineEdit"
                  @keydown.esc.prevent="editingOutlineField = null"
                />
                <ul v-else-if="parseOutlineList(outlineInfoReveals).length" class="space-y-1.5">
                  <li v-for="item in parseOutlineList(outlineInfoReveals)" :key="item" class="flex gap-2">
                    <span class="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-success"></span>
                    <span>{{ item }}</span>
                  </li>
                </ul>
                <p v-else class="text-text-muted">{{ tr('Click to add reveals...') }}</p>
              </section>
              <section class="outline-display-card" @click="editOutlineField('endingHook')">
                <p class="mb-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">{{ tr('Ending Hook') }}</p>
                <textarea
                  v-if="editingOutlineField === 'endingHook'"
                  v-model="outlineEndingHook"
                  rows="3"
                  class="outline-edit-field"
                  :placeholder="tr('Final hook, turn, or question...')"
                  autofocus
                  @click.stop
                  @input="scheduleOutlineSave"
                  @blur="finishOutlineEdit"
                  @keydown.esc.prevent="editingOutlineField = null"
                />
                <p v-else class="text-text-primary">
                  {{ outlineEndingHook || tr('Click to add an ending hook...') }}
                </p>
              </section>
            </div>

            <div v-else class="flex h-full flex-col items-center justify-center px-8 text-center">
              <Sparkles :size="24" class="mb-3 text-text-muted" />
              <p class="text-sm font-medium text-text-primary">{{ tr('No chapter outline yet') }}</p>
              <p class="mt-1 text-xs text-text-secondary">{{ tr('Create or generate a chapter outline before sending it to Vibe AI.') }}</p>
            </div>
          </div>
        </div>

        <div v-else-if="assistantTab === 'vibe'" class="min-h-0 flex-1">
          <VibeAssistant
            ref="vibeAssistant"
            stage="chapter-detail"
            mode="editor-agent"
            :context="vibeContext"
            @apply="applyVibeContent"
            @rewind="rewindVibeWorkspace"
          />
        </div>
        <div v-else-if="assistantTab === 'editing'" class="min-h-0 flex-1">
          <EditingAssistant
            :project-id="project?.id"
            :chapter-title="title"
            :chapter-number="chapter.index + 1"
            :content="content"
            :chapter-plan="chapter.outline"
            :characters="characterContext"
            :relationships="relationshipContext"
            :story-outline="project?.outline ?? ''"
            :language="project?.language ?? 'English'"
            :writing-format="isMarkdownContent ? 'markdown' : 'plaintext'"
            :chapter-id="chapter.id"
            :initial-issues="chapter.proofreadingIssues || []"
            :is-polishing="genStore.isGenerating && genStore.currentStage === 'polishing'"
            @fix="sendToVibe"
            @issuesFound="saveProofreadingIssues"
            @issueSelected="handleProofreadingIssueSelected"
            @quickSubmitPolish="polishProofreadingIssue"
          />
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.markdown-preview {
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 1.0625rem;
  line-height: 1.78;
}

.markdown-preview :deep(h1),
.markdown-preview :deep(h2),
.markdown-preview :deep(h3),
.markdown-preview :deep(h4),
.markdown-preview :deep(h5),
.markdown-preview :deep(h6) {
  color: #e6edf3;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif;
  font-weight: 700;
  line-height: 1.25;
  margin: 1.6em 0 0.65em;
}

.markdown-preview :deep(h1) { font-size: 1.8rem; }
.markdown-preview :deep(h2) { font-size: 1.45rem; }
.markdown-preview :deep(h3) { font-size: 1.2rem; }

.markdown-preview :deep(p) {
  margin: 0 0 1.1em;
}

.markdown-preview :deep(.proofreading-highlight) {
  background: rgba(245, 158, 11, 0.35);
  color: inherit;
  border-radius: 0.2rem;
  padding: 0.05rem 0.12rem;
  box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.45);
}

.markdown-preview :deep(blockquote) {
  border-left: 3px solid #58a6ff;
  color: #b7c1cc;
  margin: 1.2em 0;
  padding: 0.1em 0 0.1em 1em;
}

.markdown-preview :deep(ul),
.markdown-preview :deep(ol) {
  margin: 0 0 1.2em 1.3em;
  padding: 0;
}

.markdown-preview :deep(li) {
  margin: 0.35em 0;
}

.markdown-preview :deep(code) {
  background: #21262d;
  border: 1px solid #2d333b;
  border-radius: 4px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace;
  font-size: 0.85em;
  padding: 0.1em 0.35em;
}

.markdown-preview :deep(pre) {
  background: #0d1117;
  border: 1px solid #2d333b;
  border-radius: 8px;
  margin: 1.25em 0;
  overflow-x: auto;
  padding: 1em;
}

.markdown-preview :deep(pre code) {
  background: transparent;
  border: 0;
  padding: 0;
}

.markdown-preview :deep(a) {
  color: #58a6ff;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.markdown-preview :deep(hr) {
  border: 0;
  border-top: 1px solid #373e47;
  margin: 2em 0;
}

.markdown-preview :deep(table) {
  border-collapse: collapse;
  display: block;
  margin: 1.25em 0;
  overflow-x: auto;
  width: 100%;
}

.markdown-preview :deep(th),
.markdown-preview :deep(td) {
  border: 1px solid #2d333b;
  padding: 0.45em 0.65em;
  text-align: left;
}

.markdown-preview :deep(th) {
  background: #1c2128;
}

.outline-display-card {
  cursor: text;
  border-radius: 0.5rem;
  border: 1px solid var(--color-surface-4, #30363d);
  background: rgba(255, 255, 255, 0.025);
  padding: 0.75rem;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.outline-display-card:hover {
  border-color: rgba(88, 166, 255, 0.35);
  background: rgba(88, 166, 255, 0.04);
}

.outline-display-card.cursor-default {
  cursor: default;
}

.outline-edit-field {
  min-height: 2.5rem;
  width: 100%;
  resize: vertical;
  border: 1px solid transparent;
  border-radius: 0.375rem;
  background: rgba(255, 255, 255, 0.02);
  padding: 0.45rem 0.5rem;
  color: #e6edf3;
  font-size: 0.75rem;
  line-height: 1.55;
  transition: border-color 0.12s ease, background-color 0.12s ease;
}

.outline-edit-field::placeholder {
  color: #6b7280;
}

.outline-edit-field:focus {
  border-color: rgba(88, 166, 255, 0.45);
  background: rgba(88, 166, 255, 0.06);
  outline: none;
}
</style>
