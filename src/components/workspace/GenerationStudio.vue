<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { generateId } from '@/lib/id'
import { useProjectStore } from '@/stores/project'
import { useGenerationStore, type ChapterAuditIssue } from '@/stores/generation'
import { useUiStore } from '@/stores/ui'
import { useToast } from '@/composables/useToast'
import { sanitizeGeneratedChapterContent } from '@/services/writingFormat'
import { buildProofreadingSegments } from '@/services/proofreading/chunking'
import { hasAnyChapterPlanInfo, isChapterPlanComplete } from '@/services/generation/flow'
import type { Character } from '@/types/character'
import type { Chapter } from '@/types/chapter'
import type { GenerationStage } from '@/types/project'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import VibeAssistant from './VibeAssistant.vue'
import ProofreadingAssistant from './ProofreadingAssistant.vue'
import { Check, FileText, Plus, Save, Sparkles, Trash2, Wand2, Users, BookOpen, Clock, CheckCircle2, RotateCcw } from 'lucide-vue-next'

type StageKey = Exclude<GenerationStage, 'idle' | 'done'>

const stageTabs: Array<{
  key: StageKey
  label: string
  icon: any
  description: string
}> = [
  { key: 'planning', label: 'Story Planning', icon: Wand2, description: 'Design outline and characters together' },
  { key: 'chapter-outline', label: 'Chapter Plan', icon: BookOpen, description: 'Break the story into editable chapters' },
  { key: 'writing', label: 'Writing', icon: FileText, description: 'Draft chapters one by one' },
  { key: 'proofreading', label: 'Proofreading', icon: Check, description: 'Fix continuity and language issues' },
  { key: 'polishing', label: 'Polishing', icon: Sparkles, description: 'Refine voice and rhythm' },
]

const roleOptions = [
  { label: 'Protagonist', value: 'protagonist' },
  { label: 'Antagonist', value: 'antagonist' },
  { label: 'Supporting', value: 'supporting' },
  { label: 'Minor', value: 'minor' },
]

const projectStore = useProjectStore()
const genStore = useGenerationStore()
const ui = useUiStore()
const toast = useToast()

const project = computed(() => projectStore.activeProject)
const activeStage = ref<StageKey>('planning')
const planningSubTab = ref<'outline' | 'characters'>('outline')
const selectedCharacterId = ref<string | null>(null)
const selectedChapterId = ref<string | null>(null)

const outlineDraft = ref('')
const charactersDraft = ref<Character[]>([])
const chaptersDraft = ref<Chapter[]>([])

const showDeleteConfirm = ref(false)
const showDoubleDeleteConfirm = ref(false)
const chapterToDeleteId = ref<string | null>(null)
const showClearConfirm = ref(false)
const showGenerateBeyondLimitConfirm = ref(false)
const showGenerateCharactersDialog = ref(false)
const characterGenerationRequirements = ref('')
const characterGenerationCount = ref(5)

const characterContext = computed(() => {
  if (!project.value?.characters.length) return ''
  return project.value.characters
    .map(character => `- ${character.name} [id: ${character.id}] (${character.role})`)
    .join('\n')
})

const relationshipContext = computed(() => {
  if (!project.value || !selectedChapter.value) return ''
  return `Relationship context is not inlined to reduce prompt size. Use relationship query tools for specific character pairs at chapterIndex ${Math.max(-1, selectedChapter.value.index - 1)} when available.`
})

const vibeContext = computed(() => {
  const ctx: Record<string, any> = {}
  if (project.value) {
    ctx.projectId = project.value.id
    ctx.directoryPath = project.value.directoryPath
    ctx.workspaceSnapshot = buildVibeWorkspaceSnapshot()
    ctx.outline = outlineDraft.value
    ctx.characters = charactersDraft.value.map(c => `- ${c.name} [id: ${c.id}] (${c.role})`).join('\n')
    ctx.writingFormat = project.value.writingFormat
    ctx.writingStyle = project.value.style
  }
  if (selectedChapter.value && (activeStage.value === 'chapter-outline' || activeStage.value === 'writing' || activeStage.value === 'proofreading' || activeStage.value === 'polishing')) {
    ctx.chapter = {
      id: selectedChapter.value.id,
      index: selectedChapter.value.index,
      title: selectedChapter.value.title,
      content: selectedChapter.value.content,
      outline: selectedChapter.value.outline,
    }
  }
  if (selectedCharacter.value && activeStage.value === 'planning') {
    ctx.character = selectedCharacter.value
  }
  return ctx
})

const vibeAssistant = ref<InstanceType<typeof VibeAssistant> | null>(null)
const proofreadingAssistant = ref<any>(null)
const chapterTextarea = ref<HTMLTextAreaElement | null>(null)
const chapterProofreadingIssues = ref<Record<string, any[]>>({})
const isQuickSubmittingPolish = ref(false)

function handleVibeApply(content: string) {
  if (activeStage.value === 'planning') {
    if (planningSubTab.value === 'outline') {
      outlineDraft.value = content
    }
  } else if (activeStage.value === 'writing' || activeStage.value === 'proofreading' || activeStage.value === 'polishing') {
    if (selectedChapter.value) {
      updateCurrentChapterText(project.value
        ? sanitizeGeneratedChapterContent(content, {
          writingFormat: project.value.writingFormat,
          writingStyle: project.value.style,
          chapterTitle: selectedChapter.value.title,
          chapterNumber: selectedChapter.value.index + 1,
        })
        : content)
    }
  }
}

function handleVibeOutlineApply(payload: { title: string; outline: Chapter['outline'] }) {
  if (!selectedChapter.value) return
  const chapter = chaptersDraft.value.find(item => item.id === selectedChapter.value?.id)
  if (!chapter) return
  chapter.title = payload.title || chapter.title
  chapter.outline = {
    objective: payload.outline.objective || '',
    conflict: payload.outline.conflict || '',
    keyEvents: Array.isArray(payload.outline.keyEvents) ? payload.outline.keyEvents : [],
    characterActions: Array.isArray(payload.outline.characterActions) ? payload.outline.characterActions : [],
    infoReveals: Array.isArray(payload.outline.infoReveals) ? payload.outline.infoReveals : [],
    endingHook: payload.outline.endingHook || '',
  }
}

function buildVibeWorkspaceSnapshot() {
  if (activeStage.value === 'planning') {
    return {
      type: 'generation-planning',
      outline: outlineDraft.value,
      characters: cloneCharacters(charactersDraft.value),
      selectedCharacterId: selectedCharacterId.value,
      planningSubTab: planningSubTab.value,
    }
  }

  if (selectedChapter.value && (activeStage.value === 'chapter-outline' || activeStage.value === 'writing' || activeStage.value === 'proofreading' || activeStage.value === 'polishing')) {
    return {
      type: 'generation-chapter',
      stage: activeStage.value,
      chapterId: selectedChapter.value.id,
      chapter: JSON.parse(JSON.stringify(selectedChapter.value)),
    }
  }

  return {
    type: 'generation-stage',
    stage: activeStage.value,
    outline: outlineDraft.value,
    chapters: cloneChapters(chaptersDraft.value),
    selectedChapterId: selectedChapterId.value,
  }
}

function rewindVibeWorkspace(snapshot: any) {
  if (!snapshot || typeof snapshot !== 'object') return

  if (snapshot.type === 'generation-planning') {
    outlineDraft.value = typeof snapshot.outline === 'string' ? snapshot.outline : outlineDraft.value
    charactersDraft.value = Array.isArray(snapshot.characters) ? cloneCharacters(snapshot.characters) : charactersDraft.value
    selectedCharacterId.value = typeof snapshot.selectedCharacterId === 'string' ? snapshot.selectedCharacterId : selectedCharacterId.value
    planningSubTab.value = snapshot.planningSubTab === 'characters' ? 'characters' : 'outline'
    toast.success('Workspace snapshot restored')
    return
  }

  if (snapshot.type === 'generation-chapter' && snapshot.chapter?.id) {
    const index = chaptersDraft.value.findIndex(chapter => chapter.id === snapshot.chapter.id)
    const restored = JSON.parse(JSON.stringify(snapshot.chapter))
    if (index >= 0) {
      chaptersDraft.value[index] = restored
    } else {
      chaptersDraft.value.push(restored)
      chaptersDraft.value.sort((a, b) => a.index - b.index)
    }
    selectedChapterId.value = restored.id
    toast.success('Workspace snapshot restored')
    return
  }

  if (snapshot.type === 'generation-stage') {
    outlineDraft.value = typeof snapshot.outline === 'string' ? snapshot.outline : outlineDraft.value
    chaptersDraft.value = Array.isArray(snapshot.chapters) ? cloneChapters(snapshot.chapters) : chaptersDraft.value
    selectedChapterId.value = typeof snapshot.selectedChapterId === 'string' ? snapshot.selectedChapterId : selectedChapterId.value
    toast.success('Workspace snapshot restored')
  }
}

async function handleProofreadingFix(instruction: string) {
  if (vibeAssistant.value) {
    vibeAssistant.value.submitRequest(instruction)
  }
}

async function handleProofreadingIssuesFound(issues: any[]) {
  if (!selectedChapterId.value) return

  chapterProofreadingIssues.value[selectedChapterId.value] = issues
  const chapter = chaptersDraft.value.find(item => item.id === selectedChapterId.value)
  if (chapter) {
    chapter.proofreadingIssues = issues
    chapter.status = 'proofread'
  }
}

function normalizeIssueSearchText(value: string) {
  return value.toLowerCase().replace(/\s+/g, '')
}

function findIssueRangeInText(issue: any, text: string) {
  const excerpt = String(issue?.excerpt ?? '').trim()
  if (excerpt) {
    const exactIndex = text.toLowerCase().indexOf(excerpt.toLowerCase())
    if (exactIndex >= 0) return { start: exactIndex, end: exactIndex + excerpt.length }

    const normalizedExcerpt = normalizeIssueSearchText(excerpt)
    if (normalizedExcerpt) {
      let normalized = ''
      const map: number[] = []
      for (let offset = 0; offset < text.length;) {
        const char = Array.from(text.slice(offset))[0]
        if (!/\s/.test(char)) {
          normalized += char.toLowerCase()
          map.push(offset)
        }
        offset += char.length
      }
      const normalizedIndex = normalized.indexOf(normalizedExcerpt)
      if (normalizedIndex >= 0) {
        const start = map[normalizedIndex]
        const endStart = map[normalizedIndex + normalizedExcerpt.length - 1]
        return { start, end: endStart + Array.from(text.slice(endStart))[0].length }
      }
    }
  }

  const segmentIndex = Number.isInteger(issue?.segmentIndex)
    ? Number(issue.segmentIndex)
    : Number(String(issue?.id ?? '').match(/(?:^|-)part-(\d+)(?:-|$)/)?.[1] ?? 0) - 1
  if (segmentIndex >= 0) {
    const segment = buildProofreadingSegments(text)[segmentIndex]
    if (segment) return { start: segment.charStart, end: segment.charEnd }
  }

  return null
}

async function handleWorkflowIssueSelected(issue: any) {
  if (!selectedChapter.value) return
  const text = selectedChapterText.value
  const range = findIssueRangeInText(issue, text)
  await nextTick()
  const textarea = chapterTextarea.value
  if (!textarea || !range) {
    toast.warning('Could not locate this issue in the current chapter text.')
    return
  }

  textarea.focus()
  textarea.setSelectionRange(range.start, range.end)

  const before = text.slice(0, range.start)
  const line = before.split(/\r?\n/).length
  const totalLines = Math.max(1, text.split(/\r?\n/).length)
  textarea.scrollTop = Math.max(0, (line / totalLines) * textarea.scrollHeight - textarea.clientHeight / 2)
}

async function handleQuickSubmitPolish(issue?: ChapterAuditIssue) {
  if (isQuickSubmittingPolish.value || genStore.isGenerating) return
  await polishCurrentChapter(issue)
}

async function proofreadCurrentChapter() {
  if (!project.value || !selectedChapterId.value || genStore.isGenerating) return
  const chapter = selectedChapter.value
  if (!chapter || !proofreadingAssistant.value) return

  genStore.beginManualTask('proofreading', `Proofreading chapter ${chapter.index + 1}...`, chapter.index)
  try {
    await proofreadingAssistant.value.proofread()
    syncFromProject()
  } finally {
    genStore.finishManualTask()
  }
}

async function proofreadAllChapters() {
  if (!project.value || genStore.isGenerating) return

  const allChapters = chaptersDraft.value
  genStore.beginManualTask('proofreading', 'Proofreading all chapters...', allChapters[0]?.index ?? null)
  try {
    for (const chapter of allChapters) {
      selectedChapterId.value = chapter.id
      genStore.updateManualTask(`Proofreading chapter ${chapter.index + 1} of ${allChapters.length}...`, chapter.index)
      await nextTick()

      if (proofreadingAssistant.value) {
        await proofreadingAssistant.value.proofread()
        // Wait a bit between chapters to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }

    // Auto-save after scanning all chapters
    await saveChapters()

    // Mark proofreading complete and transition to Polish stage
    genStore.markCompleted('proofreading')
    activeStage.value = 'polishing'
    ui.setWorkspaceNode('generation-polishing')
    selectedChapterId.value = allChapters[0]?.id ?? null

    toast.success('All chapters proofread. Ready to polish.')
  } finally {
    genStore.finishManualTask()
  }
}

async function polishCurrentChapter(targetIssue?: ChapterAuditIssue) {
  if (!project.value || !selectedChapterId.value || genStore.isGenerating) return
  isQuickSubmittingPolish.value = true
  try {
    const chapter = chaptersDraft.value.find(item => item.id === selectedChapterId.value)
    const chapterIssues = chapter?.proofreadingIssues ?? chapterProofreadingIssues.value[selectedChapterId.value] ?? []
    const issues = targetIssue
      ? chapterIssues.map(issue => issue.id === targetIssue.id
        ? { ...issue, ignored: false, polishStatus: issue.polishStatus === 'ignored' ? 'pending' : issue.polishStatus, forcePolish: true }
        : { ...issue, skipPolishRun: true }
      )
      : chapterIssues
    // Polish with context of proofreading issues found
    const activeIssueCount = targetIssue ? 1 : issues.filter(issue => !issue.ignored && issue.polishStatus !== 'ignored' && issue.polishStatus !== 'fixed').length
    genStore.progressMessage = `Polishing chapter with ${activeIssueCount} issue${activeIssueCount !== 1 ? 's' : ''}...`

    await genStore.polishChapter(project.value.id, selectedChapterId.value, issues)
    syncFromProject()
    toast.success('Chapter polished')
  } catch (error: any) {
    toast.error(error?.message || 'Polishing failed')
  } finally {
    isQuickSubmittingPolish.value = false
  }
}

async function polishAllChapters() {
  if (!project.value || genStore.isGenerating) return
  try {
    await genStore.polishAllChapters(project.value.id)
    syncFromProject()
    toast.success('All chapters polished')
  } catch (error: any) {
    toast.error(error?.message || 'Polishing failed')
  }
}

function cloneCharacters(value: Character[]) {
  return value.map(character => ({
    ...character,
    personality: [...character.personality],
    relations: character.relations.map(rel => ({ ...rel })),
  }))
}

function cloneChapters(value: Chapter[]) {
  return [...value]
    .sort((a, b) => a.index - b.index)
    .map(chapter => ({
      ...chapter,
      outline: {
        ...chapter.outline,
        keyEvents: [...chapter.outline.keyEvents],
        characterActions: [...chapter.outline.characterActions],
        infoReveals: [...chapter.outline.infoReveals],
      },
      characterStateUpdates: { ...chapter.characterStateUpdates },
      proofreadingIssues: (chapter.proofreadingIssues || []).map(issue => ({ ...issue })),
      contentVersions: (chapter.contentVersions || []).map(version => ({
        ...version,
        proofreadingIssues: version.proofreadingIssues?.map(issue => ({ ...issue })),
      })),
    }))
}

function createEmptyCharacter(): Character {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    name: 'New Character',
    role: 'supporting',
    personality: [],
    appearance: '',
    backstory: '',
    motivation: '',
    goals: '',
    conflicts: '',
    currentState: '',
    relations: [],
    createdAt: now,
    updatedAt: now,
  }
}

function createEmptyChapter(index: number): Chapter {
  const now = new Date().toISOString()
  return {
    id: generateId(),
    index,
    title: `Chapter ${index + 1}`,
    outline: {
      objective: '',
      conflict: '',
      keyEvents: [],
      characterActions: [],
      infoReveals: [],
      endingHook: '',
    },
    content: '',
    proofreadingIssues: [],
    proofreadingIssuesStale: false,
    contentVersions: [],
    polishedContent: '',
    status: 'outline',
    summary: '',
    characterStateUpdates: {},
    createdAt: now,
    updatedAt: now,
  }
}

function parseList(text: string) {
  return text
    .split(/\n|,/)
    .map(item => item.trim())
    .filter(Boolean)
}

const selectedCharacter = computed(() =>
  charactersDraft.value.find(character => character.id === selectedCharacterId.value) ?? null
)

const selectedChapter = computed(() =>
  chaptersDraft.value.find(chapter => chapter.id === selectedChapterId.value) ?? null
)

const selectedChapterText = computed(() => {
  if (!selectedChapter.value) return ''
  if (activeStage.value === 'proofreading') return selectedChapter.value.content
  return selectedChapter.value.content
})

const editorPlaceholder = computed(() => {
  if (activeStage.value === 'writing') {
    return 'Start drafting your chapter prose here... Use the Vibe AI on the right to help with descriptions or dialogue.'
  }
  if (activeStage.value === 'proofreading') {
    return 'Review the draft used for proofreading. Editing this text marks existing issues as potentially stale.'
  }
  if (activeStage.value === 'polishing') {
    return 'Final polish and rhythm adjustments. Click "Polish Prose" to enhance the narrative flow.'
  }
  return 'Start writing...'
})

const stageStatusMap = computed<Record<StageKey, 'done' | 'todo'>>(() => {
  const chapters = chaptersDraft.value
  return {
    planning: (outlineDraft.value.trim() && charactersDraft.value.length) ? 'done' : 'todo',
    'chapter-outline': chapters.length > 0 && chapters.every(isChapterPlanComplete) ? 'done' : 'todo',
    writing: chapters.length > 0 && chapters.every(ch => ch.content.trim()) ? 'done' : 'todo',
    proofreading: chapters.length > 0 && chapters.every(ch => ['proofread', 'polishing', 'polished'].includes(ch.status)) ? 'done' : 'todo',
    polishing: chapters.length > 0 && chapters.every(ch => ch.content.trim() && ch.status === 'polished') ? 'done' : 'todo',
  }
})

const nextAction = computed(() => project.value ? genStore.getNextAction(project.value) : { stage: 'done' as const })
const nextActionChapterNumber = computed(() => {
  const chapterIndex = 'chapterIndex' in nextAction.value ? nextAction.value.chapterIndex : undefined
  if (!project.value || typeof chapterIndex !== 'number') return null
  return (project.value.chapters[chapterIndex]?.index ?? chapterIndex) + 1
})

const selectedChapterPlanComplete = computed(() =>
  selectedChapter.value ? isChapterPlanComplete(selectedChapter.value) : false
)

function chapterPlanFieldState(chapter: Chapter) {
  const fields = [
    chapter.title?.trim(),
    chapter.outline.objective?.trim(),
    chapter.outline.conflict?.trim(),
    chapter.outline.endingHook?.trim(),
    chapter.outline.keyEvents?.some(item => item.trim()),
    chapter.outline.characterActions?.some(item => item.trim()),
    chapter.outline.infoReveals?.some(item => item.trim()),
  ]
  const done = fields.filter(Boolean).length
  return {
    done,
    total: fields.length,
    percent: Math.round((done / fields.length) * 100),
    complete: done === fields.length,
  }
}

const chapterPlanStats = computed(() => {
  const total = chaptersDraft.value.length
  const complete = chaptersDraft.value.filter(isChapterPlanComplete).length
  return {
    total,
    complete,
    incomplete: Math.max(0, total - complete),
    percent: total ? Math.round((complete / total) * 100) : 0,
  }
})

const selectedChapterPlanState = computed(() =>
  selectedChapter.value ? chapterPlanFieldState(selectedChapter.value) : { done: 0, total: 7, percent: 0, complete: false }
)

const selectedChapterHasPlanInfo = computed(() =>
  selectedChapter.value ? hasAnyChapterPlanInfo(selectedChapter.value) : false
)

const shouldGenerateCurrentChapterPlan = computed(() =>
  Boolean(selectedChapter.value && !selectedChapterPlanComplete.value)
)

const currentChapterPlanActionLabel = computed(() =>
  selectedChapterHasPlanInfo.value ? 'Complete Current Chapter' : 'Generate Current Chapter'
)

const canGenerateCharactersFromOutline = computed(() => Boolean(outlineDraft.value.trim()))

function syncFromProject() {
  if (!project.value) return
  outlineDraft.value = project.value.outline
  charactersDraft.value = cloneCharacters(project.value.characters)
  chaptersDraft.value = project.value.chapters.length
    ? cloneChapters(project.value.chapters)
    : [createEmptyChapter(0)]

  if (!selectedCharacterId.value || !charactersDraft.value.some(character => character.id === selectedCharacterId.value)) {
    selectedCharacterId.value = charactersDraft.value[0]?.id ?? null
  }

  if (!selectedChapterId.value || !chaptersDraft.value.some(chapter => chapter.id === selectedChapterId.value)) {
    selectedChapterId.value = chaptersDraft.value[0]?.id ?? null
  }
}

watch(project, () => {
  if (genStore.isGenerating) syncFromProject()
}, { deep: true })

watch(() => project.value?.id, syncFromProject, { immediate: true })
watch(() => ui.activeWorkspaceNode, (node) => {
  if (!node?.startsWith('generation-')) return
  const key = node.replace('generation-', '') as StageKey
  if (stageTabs.some(tab => tab.key === key)) {
    activeStage.value = key
  }
}, { immediate: true })

function selectStage(stage: StageKey) {
  activeStage.value = stage
  ui.setWorkspaceNode(`generation-${stage}`)
}

async function markProjectDirty() {
  if (!project.value) return
  const saved = await projectStore.updateProject(project.value.id, {
    outline: outlineDraft.value,
    characters: cloneCharacters(charactersDraft.value),
    chapters: cloneChapters(chaptersDraft.value),
  })
  if (!saved) {
    toast.error('Failed to sync drafts')
  }
}

async function savePlanning() {
  if (!project.value) return
  const saved = await projectStore.updateProject(project.value.id, {
    outline: outlineDraft.value,
    characters: cloneCharacters(charactersDraft.value),
  })
  if (!saved) {
    toast.error('Failed to save story plan')
    return
  }
  toast.success('Story plan saved')
}

async function saveChapters(showToast = true) {
  if (!project.value) return
  const saved = await projectStore.updateProject(project.value.id, { chapters: cloneChapters(chaptersDraft.value) })
  if (!saved) {
    toast.error('Failed to save chapter plan')
    return
  }
  if (showToast) toast.success('Chapter plan saved')
}

async function generateStoryPlanStage() {
  if (!project.value || genStore.isGenerating) return
  try {
    await genStore.generateStoryPlan(project.value.id)
    syncFromProject()
    toast.success('Story plan generated')
  } catch (error: any) {
    toast.error(error?.message || 'Story planning failed')
  }
}

async function generateCharactersFromOutline() {
  if (!project.value || genStore.isGenerating || !outlineDraft.value.trim()) return
  const count = Math.max(1, Math.min(24, Math.trunc(Number(characterGenerationCount.value))))
  try {
    await projectStore.updateProject(project.value.id, {
      outline: outlineDraft.value,
      characters: cloneCharacters(charactersDraft.value),
    })
    const generated = await genStore.generateCharacters(project.value.id, {
      preferredCount: count,
      characterRequirements: characterGenerationRequirements.value,
    })
    charactersDraft.value = cloneCharacters(generated)
    selectedCharacterId.value = charactersDraft.value[0]?.id ?? null
    planningSubTab.value = 'characters'
    showGenerateCharactersDialog.value = false
    toast.success('Characters generated')
  } catch (error: any) {
    toast.error(error?.message || 'Character generation failed')
  }
}

async function generateChapterPlanStage() {
  if (!project.value || genStore.isGenerating) return
  try {
    await genStore.generateChapterPlan(project.value.id)
    syncFromProject()
    toast.success('Chapter plan generated')
  } catch (error: any) {
    toast.error(error?.message || 'Chapter plan generation failed')
  }
}

async function runAdditionalChapterPlanGeneration() {
  if (!project.value || genStore.isGenerating) return
  const beforeCount = project.value.chapters.length
  await genStore.generateAdditionalChapterPlan(project.value.id)
  syncFromProject()
  const addedChapter = chaptersDraft.value[beforeCount]
  selectedChapterId.value = addedChapter?.id ?? chaptersDraft.value[chaptersDraft.value.length - 1]?.id ?? selectedChapterId.value
  toast.success('Additional chapter plan generated')
}

async function requestGenerateAdditionalChapterPlan() {
  if (!project.value || genStore.isGenerating) return
  const current = project.value.chapters.length
  const max = Math.max(1, Math.min(9999, Math.trunc(Number(project.value.chapterConfig?.maxChapters ?? project.value.chapterCount ?? 1))))

  if (current >= 9999 && current >= max) {
    toast.warning('Maximum chapter limit reached')
    return
  }

  if (current >= max) {
    showGenerateBeyondLimitConfirm.value = true
    return
  }

  try {
    await runAdditionalChapterPlanGeneration()
  } catch (error: any) {
    toast.error(error?.message || 'Failed to generate additional chapter plan')
  }
}

async function requestGenerateCurrentChapterPlan() {
  if (!project.value || !selectedChapterId.value || genStore.isGenerating) return
  try {
    await saveChapters(false)
    await genStore.completeCurrentChapterPlan(project.value.id, selectedChapterId.value)
    syncFromProject()
    toast.success(selectedChapterHasPlanInfo.value ? 'Chapter plan completed' : 'Chapter plan generated')
  } catch (error: any) {
    toast.error(error?.message || 'Failed to complete chapter plan')
  }
}

async function requestSmartChapterPlanGeneration() {
  if (shouldGenerateCurrentChapterPlan.value) {
    await requestGenerateCurrentChapterPlan()
    return
  }
  await requestGenerateAdditionalChapterPlan()
}

async function reviewAndRewriteCurrentChapterPlan() {
  if (!project.value || !selectedChapterId.value || genStore.isGenerating || !selectedChapterPlanComplete.value) return
  try {
    await saveChapters(false)
    const result = await genStore.reviewAndRewriteChapterPlan(project.value.id, selectedChapterId.value)
    syncFromProject()
    toast.success(result.issues.length ? 'Chapter plan reviewed and rewritten' : 'Chapter plan reviewed. No qualifying issues found')
  } catch (error: any) {
    toast.error(error?.message || 'Failed to review chapter plan')
  }
}

async function confirmGenerateAdditionalChapterPlan() {
  if (!project.value || genStore.isGenerating) return
  const max = Math.max(1, Math.min(9999, Math.trunc(Number(project.value.chapterConfig?.maxChapters ?? project.value.chapterCount ?? 1))))
  if (max >= 9999) {
    toast.warning('Maximum chapter limit reached')
    return
  }

  const saved = await projectStore.updateProject(project.value.id, {
    chapterConfig: {
      maxChapters: max + 1,
    },
  })
  if (!saved) {
    toast.error('Failed to update chapter limit')
    return
  }

  try {
    await runAdditionalChapterPlanGeneration()
  } catch (error: any) {
    toast.error(error?.message || 'Failed to generate additional chapter plan')
  }
}

async function generateCurrentChapterDraft() {
  if (!project.value || !selectedChapterId.value || genStore.isGenerating) return
  try {
    await genStore.generateChapterDraft(project.value.id, selectedChapterId.value)
    syncFromProject()
    toast.success('Chapter draft generated')
  } catch (error: any) {
    toast.error(error?.message || 'Writing failed')
  }
}

async function generateAllChapterDrafts() {
  if (!project.value || genStore.isGenerating) return
  try {
    await genStore.generateAllChapterDrafts(project.value.id)
    syncFromProject()
    toast.success('All chapter drafts generated')
  } catch (error: any) {
    toast.error(error?.message || 'Writing failed')
  }
}

async function addCharacter() {
  const character = createEmptyCharacter()
  const previousCharacters = cloneCharacters(charactersDraft.value)
  charactersDraft.value.push(character)
  selectedCharacterId.value = character.id

  if (!project.value) {
    toast.warning('New character added. Regenerate the outline so the story blueprint matches the updated cast.')
    return
  }

  const saved = await projectStore.updateProject(project.value.id, {
    characters: cloneCharacters(charactersDraft.value),
  })
  if (!saved) {
    charactersDraft.value = previousCharacters
    selectedCharacterId.value = previousCharacters[0]?.id ?? null
    toast.error('Failed to add character')
    return
  }

  toast.warning('New character added. Regenerate the outline so the story blueprint matches the updated cast.')
}

async function removeCharacter(id: string) {
  const index = charactersDraft.value.findIndex(character => character.id === id)
  if (index === -1) return
  const removed = charactersDraft.value[index]
  const nextCharacters = charactersDraft.value
    .filter(character => character.id !== id)
    .map(character => ({
      ...character,
      relations: character.relations.filter(relation => relation.targetId !== id),
      updatedAt: new Date().toISOString(),
    }))

  const previousCharacters = cloneCharacters(charactersDraft.value)
  charactersDraft.value = nextCharacters
  if (selectedCharacterId.value === id) {
    selectedCharacterId.value = charactersDraft.value[0]?.id ?? null
  }

  if (!project.value) return

  const saved = await projectStore.updateProject(project.value.id, {
    characters: cloneCharacters(nextCharacters),
  })
  if (!saved) {
    charactersDraft.value = previousCharacters
    if (!charactersDraft.value.some(character => character.id === selectedCharacterId.value)) {
      selectedCharacterId.value = removed?.id ?? charactersDraft.value[0]?.id ?? null
    }
    toast.error('Failed to delete character')
    return
  }

  toast.warning(`Character "${removed?.name || 'Unknown'}" deleted`)
}

function handleDeleteChapter(id: string) {
  const chapter = chaptersDraft.value.find(ch => ch.id === id)
  if (!chapter) return
  chapterToDeleteId.value = id
  if (activeStage.value === 'chapter-outline') {
    const hasContent = chapter.content?.trim()
    if (hasContent) showDoubleDeleteConfirm.value = true
    else showDeleteConfirm.value = true
  } else {
    showClearConfirm.value = true
  }
}

function performClearChapter() {
  if (!chapterToDeleteId.value) return
  const chapter = chaptersDraft.value.find(ch => ch.id === chapterToDeleteId.value)
  if (chapter) {
    if (activeStage.value === 'writing') chapter.content = ''
    else if (activeStage.value === 'proofreading') {
      chapter.proofreadingIssues = []
      chapter.proofreadingIssuesStale = false
      if (chapter.status === 'proofread') chapter.status = 'draft'
      delete chapterProofreadingIssues.value[chapter.id]
    }
    else if (activeStage.value === 'polishing') {
      chapter.proofreadingIssues = []
      chapter.status = chapter.content.trim() ? 'draft' : 'outline'
    }
    saveChapters()
    toast.success('Chapter content cleared')
  }
  chapterToDeleteId.value = null
  showClearConfirm.value = false
}

function performDeleteChapter() {
  if (!chapterToDeleteId.value) return
  const id = chapterToDeleteId.value
  const index = chaptersDraft.value.findIndex(ch => ch.id === id)
  if (index !== -1) {
    chaptersDraft.value.splice(index, 1)
    chaptersDraft.value.forEach((ch, idx) => { ch.index = idx })
    if (selectedChapterId.value === id) {
      selectedChapterId.value = chaptersDraft.value[0]?.id ?? null
    }
    toast.success('Chapter deleted')
  }
  chapterToDeleteId.value = null
  showDeleteConfirm.value = false
  showDoubleDeleteConfirm.value = false
}

function ensureChapterCount(count: number) {
  if (chaptersDraft.value.length < count) {
    const start = chaptersDraft.value.length
    for (let index = start; index < count; index++) {
      chaptersDraft.value.push(createEmptyChapter(index))
    }
  }
}

function createContentVersion(label: string, versionContent: string, issues?: any[]) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    label,
    content: versionContent,
    proofreadingIssues: issues?.length ? issues.map(issue => ({ ...issue })) : undefined,
    createdAt: new Date().toISOString(),
  }
}

function markProofreadingIssuesStaleForEdit(chapter: Chapter, nextText: string) {
  if (!chapter.proofreadingIssues?.length || chapter.content === nextText || chapter.proofreadingIssuesStale) return
  chapter.contentVersions = [
    createContentVersion('Before draft edit - proofreading issues valid', chapter.content, chapter.proofreadingIssues),
    ...(chapter.contentVersions || []),
  ]
  chapter.proofreadingIssuesStale = true
  toast.warning('Draft changed after proofreading. Existing issues may no longer match; a restore snapshot was saved.')
}

function restoreLatestIssueSnapshotForSelected() {
  if (!selectedChapter.value) return
  const chapter = chaptersDraft.value.find(item => item.id === selectedChapter.value?.id)
  const version = chapter?.contentVersions?.find(item => item.proofreadingIssues?.length)
  if (!chapter || !version) return
  chapter.content = version.content
  chapter.proofreadingIssues = version.proofreadingIssues?.map(issue => ({ ...issue })) || []
  chapter.proofreadingIssuesStale = false
  chapter.status = chapter.proofreadingIssues.length ? 'proofread' : 'draft'
  toast.success('Proofreading snapshot restored')
}

function updateCurrentChapterText(text: string) {
  if (!selectedChapter.value) return
  const chapter = chaptersDraft.value.find(item => item.id === selectedChapter.value?.id)
  if (!chapter) return
  if (activeStage.value === 'proofreading') {
    markProofreadingIssuesStaleForEdit(chapter, text)
    chapter.content = text
    chapter.status = 'draft'
  } else {
    markProofreadingIssuesStaleForEdit(chapter, text)
    chapter.content = text
    chapter.status = 'draft'
  }
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden bg-surface-1">
    <div class="shrink-0 border-b border-surface-4 px-4 py-2 bg-surface-1 shadow-sm">
      <div class="flex items-center justify-between gap-4">
        <!-- Left: Stage Tabs -->
        <div class="flex items-center gap-1 overflow-x-auto no-scrollbar">
          <button
            v-for="stage in stageTabs"
            :key="stage.key"
            :class="[
              'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11px] font-medium transition-all duration-200 whitespace-nowrap border',
              activeStage === stage.key
                ? 'border-accent bg-accent-subtle text-accent shadow-sm'
                : stageStatusMap[stage.key] === 'done'
                  ? 'border-success/20 bg-success-subtle/30 text-success hover:bg-success-subtle/50'
                  : 'border-transparent text-text-secondary hover:bg-surface-3 hover:text-text-primary',
            ]"
            @click="selectStage(stage.key)"
          >
            <component :is="stage.icon" :size="12" />
            <span>{{ ui.text(stage.label) }}</span>
            <Check v-if="stageStatusMap[stage.key] === 'done'" :size="10" class="ml-0.5" />
          </button>
        </div>

        <!-- Right: Status and Actions -->
        <div class="flex items-center gap-3 shrink-0">
          <div v-if="project" class="flex items-center gap-2 px-2 py-1 rounded-full bg-surface-2 border border-surface-4">
            <div class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></div>
            <span class="text-[10px] font-bold text-text-secondary uppercase tracking-wider">{{ ui.text('Next:') }}</span>
            <span class="text-[10px] font-medium text-text-primary">
              {{ nextAction.stage }}
              <span v-if="nextActionChapterNumber" class="text-accent ml-0.5">#{{ nextActionChapterNumber }}</span>
            </span>
            <div v-if="genStore.progressMessage" class="h-3 w-px bg-surface-4 mx-1"></div>
            <span v-if="genStore.progressMessage" class="text-[10px] text-text-muted truncate max-w-[120px]">{{ ui.text(genStore.progressMessage) }}</span>
          </div>
          <div class="flex items-center gap-1 border-l border-surface-4 pl-3">
            <BaseButton v-if="project" variant="ghost" size="sm" class="!h-7 !px-2 text-text-secondary hover:text-accent" @click="markProjectDirty">
              <Save :size="12" />
              <span class="text-[11px] ml-1">{{ ui.text('Sync') }}</span>
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-hidden flex">
      <div v-if="!project" class="h-full flex-1 flex items-center justify-center">
        <EmptyState :icon="BookOpen" :title="ui.text('No project loaded')" :description="ui.text('Open a project to start the generation flow.')" />
      </div>

      <div v-else class="flex-1 flex flex-col min-w-0 overflow-hidden">
        <!-- Story Planning Stage -->
        <section v-if="activeStage === 'planning'" class="h-full flex flex-col overflow-hidden">
          <div class="shrink-0 flex items-center justify-between px-4 py-2 bg-surface-2 border-b border-surface-4">
            <div class="flex items-center gap-1">
              <button :class="['px-3 py-1.5 rounded-md text-xs font-semibold transition-all', planningSubTab === 'outline' ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3']" @click="planningSubTab = 'outline'">
                <FileText :size="14" class="inline mr-1.5" />{{ ui.text('Outline') }}
              </button>
              <button :class="['px-3 py-1.5 rounded-md text-xs font-semibold transition-all', planningSubTab === 'characters' ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3']" @click="planningSubTab = 'characters'">
                <Users :size="14" class="inline mr-1.5" />{{ ui.text('Characters') }}
              </button>
            </div>
            <div class="flex items-center gap-2">
              <BaseButton variant="secondary" size="sm" class="!h-8" :loading="genStore.isGenerating" @click="generateStoryPlanStage">
                <Wand2 :size="14" class="mr-1.5" /><span>{{ ui.text('AI Generate') }}</span>
              </BaseButton>
              <BaseButton v-if="canGenerateCharactersFromOutline" variant="secondary" size="sm" class="!h-8" :loading="genStore.isGenerating" @click="showGenerateCharactersDialog = true">
                <Users :size="14" class="mr-1.5" /><span>{{ ui.text('Generate Characters') }}</span>
              </BaseButton>
              <BaseButton variant="primary" size="sm" class="!h-8" @click="savePlanning">
                <Save :size="14" class="mr-1.5" /><span>{{ ui.text('Save Plan') }}</span>
              </BaseButton>
            </div>
          </div>

          <div class="flex-1 flex overflow-hidden">
            <!-- 1. Navigator -->
            <div class="w-64 border-r border-surface-4 bg-surface-2 flex flex-col shrink-0">
              <div class="h-[45px] px-3 border-b border-surface-4 bg-surface-1/50 flex items-center justify-between shrink-0">
                <span class="text-[10px] font-bold text-text-muted uppercase tracking-widest">{{ ui.text('Characters') }}</span>
                <BaseButton variant="ghost" size="sm" class="!p-1" @click="addCharacter"><Plus :size="14" /></BaseButton>
              </div>
              <div class="flex-1 overflow-y-auto p-2 space-y-1">
                <button v-for="character in charactersDraft" :key="character.id" class="w-full text-left rounded-lg px-3 py-2 transition-all border" :class="selectedCharacterId === character.id ? 'border-accent/30 bg-accent-subtle/50 text-accent shadow-sm' : 'border-transparent text-text-secondary hover:bg-surface-3'" @click="selectedCharacterId = character.id; planningSubTab = 'characters'">
                  <div class="text-xs font-bold truncate">{{ character.name }}</div>
                  <div class="text-[10px] opacity-70 uppercase tracking-tighter">{{ character.role }}</div>
                </button>
              </div>
              <div class="p-3 border-t border-surface-4">
                <button class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-bold transition-all" :class="planningSubTab === 'outline' ? 'bg-accent text-white shadow-md' : 'bg-surface-3 text-text-secondary hover:bg-surface-4'" @click="planningSubTab = 'outline'">
                  <FileText :size="14" />{{ ui.text('Story Outline') }}
                </button>
              </div>
            </div>

            <!-- 2. Workspace -->
            <div class="flex-1 flex flex-col min-w-0 bg-surface-0 border-r border-surface-4 overflow-hidden">
              <div class="h-[45px] px-6 border-b border-surface-4 bg-surface-1/50 flex items-center justify-between shrink-0">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold text-text-primary uppercase tracking-widest">{{ ui.text(planningSubTab === 'outline' ? 'Story Outline' : 'Character Profile') }}</span>
                  <div v-if="planningSubTab === 'characters' && selectedCharacter" class="h-1 w-1 rounded-full bg-text-muted"></div>
                  <span v-if="planningSubTab === 'characters' && selectedCharacter" class="text-xs text-accent font-medium">{{ selectedCharacter.name }}</span>
                </div>
                <BaseButton v-if="planningSubTab === 'characters' && selectedCharacter" variant="danger" size="sm" @click="removeCharacter(selectedCharacter.id)">
                  <Trash2 :size="14" />
                  <span>{{ ui.text('Delete Character') }}</span>
                </BaseButton>
              </div>

              <div class="flex-1 overflow-y-auto custom-scrollbar">
                <div v-if="planningSubTab === 'outline'" class="h-full p-8"><textarea v-model="outlineDraft" class="w-full h-full bg-transparent text-text-primary resize-none outline-none font-serif text-lg leading-relaxed" :placeholder="ui.text('Draft your master story outline...')"></textarea></div>
                <div v-else-if="selectedCharacter" class="p-6 space-y-6">
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="md:col-span-2 space-y-4">
                      <div class="grid grid-cols-2 gap-4"><BaseInput v-model="selectedCharacter.name" label="Full Name" /><BaseSelect v-model="selectedCharacter.role" label="Role" :options="roleOptions" /></div>
                      <BaseTextarea :model-value="selectedCharacter.personality.join(', ')" label="Personality" :rows="2" @update:model-value="selectedCharacter.personality = parseList($event)" />
                    </div>
                    <div class="bg-surface-2 rounded-xl p-4 flex flex-col items-center justify-center border border-surface-4">
                      <Users :size="32" class="text-accent mb-2" />
                      <p class="text-[10px] font-bold text-text-muted uppercase">{{ ui.text('Quick View') }}</p>
                      <p class="text-sm font-bold mt-1">{{ selectedCharacter.name }}</p>
                    </div>
                  </div>
                  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6"><BaseTextarea v-model="selectedCharacter.appearance" label="Appearance" :rows="4" /><BaseTextarea v-model="selectedCharacter.backstory" label="Backstory" :rows="4" /></div>
                  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div v-for="field in ['motivation', 'goals', 'conflicts', 'currentState']" :key="field" class="p-4 rounded-xl bg-surface-1 border border-surface-4 transition-colors">
                      <h5 class="text-[10px] font-bold text-accent uppercase mb-2">{{ field }}</h5>
                      <textarea v-model="(selectedCharacter as any)[field]" class="w-full bg-transparent text-xs text-text-secondary outline-none resize-none" rows="4"></textarea>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 3. Grounding -->
            <div class="w-72 bg-surface-2 overflow-y-auto hidden xl:flex flex-col">
              <div class="h-[45px] px-4 border-b border-surface-4 bg-surface-1/50 flex items-center shrink-0">
                <h5 class="text-[10px] font-bold text-text-muted uppercase flex items-center gap-2"><Sparkles :size="12" class="text-accent" />{{ ui.text('Project Grounding') }}</h5>
              </div>
              <div class="p-5 space-y-6">
                <section><label class="text-[10px] font-bold text-text-muted uppercase block mb-2">{{ ui.text('Theme') }}</label><p class="text-xs italic border-l-2 border-surface-4 pl-3">{{ project.theme }}</p></section>
                <section><label class="text-[10px] font-bold text-text-muted uppercase block mb-2">{{ ui.text('Genre & Style') }}</label><div class="flex flex-wrap gap-2"><BaseTag variant="default" size="sm">{{ project.genre }}</BaseTag><BaseTag variant="default" size="sm">{{ project.chapterCount }} {{ ui.text('chapters') }}</BaseTag></div></section>
                <section v-if="project.constraints.required.length">
                  <label class="text-[10px] font-bold text-text-muted uppercase block mb-2">{{ ui.text('Must Include') }}</label>
                  <ul class="space-y-1.5">
                    <li v-for="req in project.constraints.required" :key="req" class="text-xs text-success flex items-start gap-2">
                      <Check :size="12" class="shrink-0 mt-0.5" />
                      <span>{{ req }}</span>
                    </li>
                  </ul>
                </section>
              </div>
            </div>
          </div>
        </section>

        <!-- Chapter Plan Stage -->
        <section v-else-if="activeStage === 'chapter-outline'" class="h-full flex flex-col overflow-hidden">
          <div class="shrink-0 border-b border-surface-4 bg-surface-2 px-4 py-3">
            <div class="flex items-center justify-between gap-4">
              <div class="min-w-0">
                <div class="flex items-center gap-2">
                  <BookOpen :size="15" class="text-accent" />
                  <h3 class="text-xs font-bold uppercase tracking-widest text-text-primary">{{ ui.text('Chapter Beats') }}</h3>
                  <BaseTag variant="default" size="sm">{{ chapterPlanStats.complete }}/{{ chapterPlanStats.total }} {{ ui.text('complete') }}</BaseTag>
                </div>
                <div class="mt-2 h-1.5 w-56 overflow-hidden rounded-full bg-surface-4">
                  <div class="h-full rounded-full bg-accent transition-all" :style="{ width: `${chapterPlanStats.percent}%` }"></div>
                </div>
              </div>
              <div class="flex flex-wrap items-center justify-end gap-2">
              <BaseButton variant="ghost" size="sm" class="!h-8" @click="ensureChapterCount(1)"><Plus :size="14" class="mr-1.5" />{{ ui.text('Add Chapter') }}</BaseButton>
              <BaseButton variant="secondary" size="sm" class="!h-8" :loading="genStore.isGenerating" @click="requestSmartChapterPlanGeneration"><Sparkles :size="14" class="mr-1.5" />{{ ui.text(shouldGenerateCurrentChapterPlan ? currentChapterPlanActionLabel : 'Generate Next Chapter') }}</BaseButton>
              <BaseButton v-if="selectedChapterPlanComplete" variant="secondary" size="sm" class="!h-8" :loading="genStore.isGenerating" @click="reviewAndRewriteCurrentChapterPlan"><CheckCircle2 :size="14" class="mr-1.5" />{{ ui.text('Quick Review & Rewrite') }}</BaseButton>
              <BaseButton variant="secondary" size="sm" class="!h-8" :loading="genStore.isGenerating" @click="generateChapterPlanStage"><Wand2 :size="14" class="mr-1.5" />{{ ui.text('AI Generate') }}</BaseButton>
              <BaseButton variant="primary" size="sm" class="!h-8" @click="saveChapters"><Save :size="14" class="mr-1.5" />{{ ui.text('Save Chapters') }}</BaseButton>
              </div>
            </div>
          </div>
          <div class="flex-1 flex overflow-hidden">
            <div class="w-72 shrink-0 border-r border-surface-4 bg-surface-2">
              <div class="flex h-full flex-col">
                <div class="shrink-0 border-b border-surface-4 px-3 py-2">
                  <p class="text-[10px] font-bold uppercase tracking-widest text-text-muted">{{ ui.text('Chapters') }}</p>
                  <p class="mt-0.5 text-[10px] text-text-muted">{{ chapterPlanStats.incomplete }} {{ ui.text('need planning') }}</p>
                </div>
                <div class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                  <button
                    v-for="chapter in chaptersDraft"
                    :key="chapter.id"
                    class="group w-full rounded-lg border px-3 py-2.5 text-left transition-all"
                    :class="selectedChapterId === chapter.id ? 'border-accent/40 bg-accent-subtle/50 shadow-sm' : 'border-transparent text-text-secondary hover:border-surface-4 hover:bg-surface-3'"
                    @click="selectedChapterId = chapter.id"
                  >
                    <div class="flex items-start gap-2">
                      <div
                        class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold"
                        :class="chapterPlanFieldState(chapter).complete ? 'border-success/30 bg-success/10 text-success' : 'border-surface-4 bg-surface-1 text-text-muted'"
                      >
                        {{ chapter.index + 1 }}
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5">
                          <CheckCircle2 v-if="chapterPlanFieldState(chapter).complete" :size="12" class="shrink-0 text-success" />
                          <Clock v-else :size="12" class="shrink-0 text-warning" />
                          <p class="truncate text-xs font-semibold" :class="selectedChapterId === chapter.id ? 'text-text-primary' : 'text-text-secondary'">{{ chapter.title || ui.text('Untitled') }}</p>
                        </div>
                        <div class="mt-2 flex items-center gap-2">
                          <div class="h-1 flex-1 overflow-hidden rounded-full bg-surface-4">
                            <div
                              class="h-full rounded-full transition-all"
                              :class="chapterPlanFieldState(chapter).complete ? 'bg-success' : 'bg-warning'"
                              :style="{ width: `${chapterPlanFieldState(chapter).percent}%` }"
                            ></div>
                          </div>
                          <span class="text-[10px] font-medium text-text-muted">{{ chapterPlanFieldState(chapter).done }}/{{ chapterPlanFieldState(chapter).total }}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
            <div class="flex-1 overflow-y-auto bg-surface-0 custom-scrollbar flex flex-col min-w-0">
              <template v-if="selectedChapter">
                <div class="shrink-0 border-b border-surface-4 bg-surface-1/50 px-6 py-4">
                  <div class="flex items-start justify-between gap-4">
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-surface-4 bg-surface-2 text-xs font-bold text-text-primary">{{ selectedChapter.index + 1 }}</div>
                        <div class="min-w-0">
                          <h4 class="truncate text-sm font-semibold text-text-primary">{{ selectedChapter.title || ui.text('Untitled') }}</h4>
                          <p class="mt-0.5 text-[11px] text-text-muted">{{ selectedChapterPlanState.done }}/{{ selectedChapterPlanState.total }} {{ ui.text('planning fields complete') }}</p>
                        </div>
                        <BaseTag :variant="selectedChapterPlanComplete ? 'success' : 'warning'" size="sm">{{ ui.text(selectedChapterPlanComplete ? 'Ready' : 'Incomplete') }}</BaseTag>
                      </div>
                    </div>
                    <BaseButton variant="danger" size="sm" @click="handleDeleteChapter(selectedChapter.id)">
                      <Trash2 :size="14" />
                      <span>{{ ui.text('Delete Chapter') }}</span>
                    </BaseButton>
                  </div>
                  <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-4">
                    <div class="h-full rounded-full bg-accent transition-all" :style="{ width: `${selectedChapterPlanState.percent}%` }"></div>
                  </div>
                </div>
                <div class="flex-1 overflow-y-auto p-6">
                  <div class="mx-auto max-w-5xl space-y-5">
                    <section class="rounded-lg border border-surface-4 bg-surface-1 p-4">
                      <div class="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h5 class="text-xs font-bold uppercase tracking-widest text-text-primary">{{ ui.text('Core Direction') }}</h5>
                          <p class="mt-1 text-[11px] text-text-muted">{{ ui.text('Define what this chapter must accomplish.') }}</p>
                        </div>
                        <BaseTag variant="default" size="sm">{{ ui.text('Single line fields') }}</BaseTag>
                      </div>
                      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <BaseInput v-model="selectedChapter.title" label="Title" />
                        <BaseInput v-model="selectedChapter.outline.objective" label="Objective" />
                        <BaseInput v-model="selectedChapter.outline.conflict" label="Conflict" />
                      </div>
                    </section>

                    <section class="rounded-lg border border-surface-4 bg-surface-1 p-4">
                      <div class="mb-4">
                        <h5 class="text-xs font-bold uppercase tracking-widest text-text-primary">{{ ui.text('Chapter Structure') }}</h5>
                        <p class="mt-1 text-[11px] text-text-muted">{{ ui.text('List concrete beats the writer can follow.') }}</p>
                      </div>
                      <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
                        <BaseTextarea :model-value="selectedChapter.outline.keyEvents.join('\n')" label="Plot Beats" :rows="8" @update:model-value="selectedChapter.outline.keyEvents = parseList($event)" />
                        <BaseTextarea :model-value="selectedChapter.outline.characterActions.join('\n')" label="Character Actions" :rows="8" @update:model-value="selectedChapter.outline.characterActions = parseList($event)" />
                        <BaseTextarea :model-value="selectedChapter.outline.infoReveals.join('\n')" label="Reveals" :rows="8" @update:model-value="selectedChapter.outline.infoReveals = parseList($event)" />
                      </div>
                    </section>

                    <section class="rounded-lg border border-surface-4 bg-surface-1 p-4">
                      <div class="mb-4">
                        <h5 class="text-xs font-bold uppercase tracking-widest text-text-primary">{{ ui.text('Exit Hook') }}</h5>
                        <p class="mt-1 text-[11px] text-text-muted">{{ ui.text('Set the final turn, question, or emotional handoff.') }}</p>
                      </div>
                      <BaseTextarea v-model="selectedChapter.outline.endingHook" label="Ending Hook" :rows="4" />
                    </section>
                  </div>
                </div>
              </template>
              <div v-else class="flex h-full items-center justify-center p-8 text-center">
                <div>
                  <BookOpen :size="28" class="mx-auto mb-3 text-text-muted" />
                  <p class="text-sm font-medium text-text-primary">{{ ui.text('No chapter selected') }}</p>
                  <p class="mt-1 text-xs text-text-secondary">{{ ui.text('Select or add a chapter to edit its plan.') }}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Writing Stage -->
        <section v-else class="h-full flex flex-col overflow-hidden">
          <div class="h-[45px] shrink-0 flex items-center justify-between px-4 py-2 bg-surface-2 border-b border-surface-4">
            <h3 class="text-xs font-bold text-text-primary uppercase tracking-widest">{{ activeStage }}</h3>
            <div class="flex items-center gap-2">
              <BaseButton
                variant="secondary"
                size="sm"
                class="!h-8"
                :loading="genStore.isGenerating"
                @click="activeStage === 'writing' ? generateCurrentChapterDraft() : activeStage === 'proofreading' ? proofreadCurrentChapter() : polishCurrentChapter()"
              >
                <Sparkles :size="14" class="mr-1.5" />
                <span>{{ ui.text(activeStage === 'writing' ? 'Generate Current' : activeStage === 'proofreading' ? 'Proofread Current' : 'Polish Current') }}</span>
              </BaseButton>
              <BaseButton
                variant="secondary"
                size="sm"
                class="!h-8"
                :loading="genStore.isGenerating"
                @click="activeStage === 'writing' ? generateAllChapterDrafts() : activeStage === 'proofreading' ? proofreadAllChapters() : polishAllChapters()"
              >
                <Sparkles :size="14" class="mr-1.5" />
                <span>{{ ui.text(activeStage === 'writing' ? 'Generate All' : activeStage === 'proofreading' ? 'Proofread All' : 'Polish All') }}</span>
              </BaseButton>
              <BaseButton variant="primary" size="sm" class="!h-8" @click="saveChapters"><Save :size="14" class="mr-1.5" />{{ ui.text('Save') }}</BaseButton>
            </div>
          </div>
          <div class="flex-1 flex overflow-hidden">
            <div class="w-64 border-r border-surface-4 bg-surface-2 overflow-y-auto p-2 space-y-1 shrink-0">
              <button v-for="chapter in chaptersDraft" :key="chapter.id" class="w-full text-left rounded-lg px-3 py-3 transition-all border" :class="selectedChapterId === chapter.id ? 'border-accent/30 bg-accent-subtle/50 text-accent shadow-sm' : 'border-transparent text-text-secondary hover:bg-surface-3'" @click="selectedChapterId = chapter.id">
                <div class="text-[10px] font-bold opacity-70 mb-1">Ch {{ chapter.index + 1 }}</div>
                <div class="text-xs font-bold truncate">{{ chapter.title }}</div>
              </button>
            </div>
            <div class="flex-1 flex flex-col bg-surface-0 overflow-hidden min-w-0">
              <template v-if="selectedChapter">
                <div class="h-[45px] shrink-0 px-6 py-3 border-b border-surface-4 bg-surface-1/50 flex items-center justify-between">
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-bold">{{ selectedChapter.title }}</span>
                  </div>
                  <BaseButton variant="danger" size="sm" @click="handleDeleteChapter(selectedChapter.id)">
                    <Trash2 :size="14" />
                    <span>{{ ui.text('Clear Stage') }}</span>
                  </BaseButton>
                </div>
                <div
                  v-if="selectedChapter.proofreadingIssuesStale"
                  class="flex shrink-0 items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-6 py-2 text-xs"
                >
                  <span class="text-warning">{{ ui.text('Draft changed after proofreading. Existing issues may no longer match.') }}</span>
                  <BaseButton
                    v-if="selectedChapter.contentVersions?.some(version => version.proofreadingIssues?.length)"
                    variant="secondary"
                    size="sm"
                    @click="restoreLatestIssueSnapshotForSelected"
                  >
                    {{ ui.text('Restore issue snapshot') }}
                  </BaseButton>
                </div>
                <!-- Main Editor Area -->
                <div class="flex-1 overflow-y-auto px-8 custom-scrollbar bg-surface-0/50">
                  <div class="max-w-4xl mx-auto min-h-full flex flex-col border-l border-r border-surface-4 bg-surface-0 px-10 py-10 shadow-sm">
                    <textarea
                      ref="chapterTextarea"
                      :value="selectedChapterText"
                      class="w-full flex-1 bg-transparent text-text-primary resize-none outline-none font-serif text-lg leading-relaxed placeholder:text-text-muted/30 selection:bg-accent/20"
                      :placeholder="editorPlaceholder"
                      @input="updateCurrentChapterText(($event.target as HTMLTextAreaElement).value)"
                    ></textarea>
                  </div>
                </div>

              </template>
            </div>
          </div>
        </section>
      </div>

      <!-- Integrated Assistant Sidebar -->
      <div class="w-80 lg:w-96 border-l border-surface-4 bg-surface-1 shrink-0 hidden md:block">
        <ProofreadingAssistant
          v-if="activeStage === 'proofreading' && selectedChapter"
          ref="proofreadingAssistant"
          action-mode="workflow"
          :project-id="project?.id"
          :chapter-id="selectedChapter.id"
          :chapter-title="selectedChapter.title"
          :chapter-number="selectedChapter.index + 1"
          :content="selectedChapter.content"
          :chapter-outline="selectedChapter.outline"
          :characters="characterContext"
          :relationships="relationshipContext"
          :story-outline="project?.outline ?? ''"
          :language="project?.language ?? 'English'"
          :writing-format="project?.writingFormat ?? 'plaintext'"
          :initial-issues="selectedChapter.proofreadingIssues || []"
          :is-polishing="isQuickSubmittingPolish || (genStore.isGenerating && genStore.currentStage === 'polishing')"
          @fix="handleProofreadingFix"
          @issuesFound="handleProofreadingIssuesFound"
          @issueSelected="handleWorkflowIssueSelected"
          @quickSubmitPolish="handleQuickSubmitPolish"
        />
        <VibeAssistant
          v-else
          ref="vibeAssistant"
          :stage="activeStage"
          :context="vibeContext"
          :mode="activeStage === 'chapter-outline' ? 'outline-agent' : activeStage === 'writing' || activeStage === 'proofreading' || activeStage === 'polishing' ? 'editor-agent' : 'assistant'"
          @apply="handleVibeApply"
          @apply-outline="handleVibeOutlineApply"
          @rewind="rewindVibeWorkspace"
        />
      </div>
    </div>

    <ConfirmDialog v-model="showClearConfirm" title="Clear Content" message="Clear current stage content?" variant="danger" confirm-text="Clear" @confirm="performClearChapter" />
    <ConfirmDialog v-model="showDeleteConfirm" title="Delete" message="Delete chapter?" variant="danger" confirm-text="Delete" @confirm="performDeleteChapter" />
    <ConfirmDialog v-model="showDoubleDeleteConfirm" title="Warning" message="Chapter has content. Delete anyway?" variant="danger" confirm-text="Delete" @confirm="performDeleteChapter" />
    <ConfirmDialog
      v-model="showGenerateBeyondLimitConfirm"
      title="Chapter limit reached"
      message="Continuing beyond the configured chapter limit may reduce generation quality. Increase the chapter limit by 1 and continue?"
      variant="warning"
      confirm-text="Continue"
      @confirm="confirmGenerateAdditionalChapterPlan"
    />
    <BaseDialog v-model="showGenerateCharactersDialog" title="Generate Characters" width="520px">
      <div class="space-y-5">
        <div>
          <label class="mb-2 block text-xs font-semibold text-text-secondary">{{ ui.text('Character requirements') }}</label>
          <textarea
            v-model="characterGenerationRequirements"
            class="min-h-28 w-full resize-y rounded-lg border border-surface-4 bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent/50"
            :placeholder="ui.text('Optional requirements, roles, relationships, or constraints...')"
          ></textarea>
        </div>
        <div class="rounded-lg border border-surface-4 bg-surface-2 p-4">
          <div class="mb-3 flex items-center justify-between">
            <label class="text-xs font-semibold text-text-secondary">{{ ui.text('Character count') }}</label>
            <span class="rounded-md bg-accent/10 px-2 py-1 text-xs font-bold text-accent">{{ characterGenerationCount }}</span>
          </div>
          <input
            v-model.number="characterGenerationCount"
            type="range"
            min="1"
            max="24"
            step="1"
            class="w-full accent-accent"
          />
          <div class="mt-2 flex justify-between text-[10px] text-text-muted">
            <span>1</span>
            <span>24</span>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <BaseButton variant="ghost" size="sm" @click="showGenerateCharactersDialog = false">{{ ui.text('Cancel') }}</BaseButton>
          <BaseButton variant="primary" size="sm" :loading="genStore.isGenerating" @click="generateCharactersFromOutline">
            <Users :size="14" />
            <span>{{ ui.text('Generate') }}</span>
          </BaseButton>
        </div>
      </template>
    </BaseDialog>
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: var(--surface-4); border-radius: 10px; }
</style>
