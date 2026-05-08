<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { generateId } from '@/lib/id'
import { useProjectStore } from '@/stores/project'
import { useGenerationStore } from '@/stores/generation'
import { useUiStore } from '@/stores/ui'
import { useToast } from '@/composables/useToast'
import { sanitizeGeneratedChapterContent } from '@/services/writingFormat'
import type { Character } from '@/types/character'
import type { Chapter } from '@/types/chapter'
import type { GenerationStage } from '@/types/project'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
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
    ctx.outline = outlineDraft.value
    ctx.characters = charactersDraft.value.map(c => `- ${c.name} [id: ${c.id}] (${c.role})`).join('\n')
    ctx.writingFormat = project.value.writingFormat
    ctx.writingStyle = project.value.style
  }
  if (selectedChapter.value && (activeStage.value === 'writing' || activeStage.value === 'proofreading' || activeStage.value === 'polishing')) {
    ctx.chapter = {
      index: selectedChapter.value.index,
      title: selectedChapter.value.title,
      content: selectedChapter.value.content,
      proofreadContent: selectedChapter.value.proofreadContent,
      polishedContent: selectedChapter.value.polishedContent,
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
const chapterProofreadingIssues = ref<Record<string, any[]>>({})

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
    chapter.proofreadContent = chapter.proofreadContent || chapter.content
    chapter.status = 'proofread'
  }

  await saveChapters()

  if (issues.length > 0) {
    toast.info(`Found ${issues.length} issue(s)`)
  }
}

async function handleQuickSubmitPolish() {
  await polishCurrentChapter()
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

async function polishCurrentChapter() {
  if (!project.value || !selectedChapterId.value || genStore.isGenerating) return
  try {
    const chapter = chaptersDraft.value.find(item => item.id === selectedChapterId.value)
    const issues = chapter?.proofreadingIssues || chapterProofreadingIssues.value[selectedChapterId.value] || []
    // Polish with context of proofreading issues found
    genStore.progressMessage = `Polishing chapter with ${issues.length} issue${issues.length !== 1 ? 's' : ''}...`

    await genStore.polishChapter(project.value.id, selectedChapterId.value, issues)
    syncFromProject()
    toast.success('Chapter polished')
  } catch (error: any) {
    toast.error(error?.message || 'Polishing failed')
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
      proofreadingIssues: [...(chapter.proofreadingIssues || [])],
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
    proofreadContent: '',
    proofreadingIssues: [],
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
  if (activeStage.value === 'proofreading') return selectedChapter.value.proofreadContent || selectedChapter.value.content
  if (activeStage.value === 'polishing') return selectedChapter.value.polishedContent || selectedChapter.value.proofreadContent || selectedChapter.value.content
  return selectedChapter.value.content
})

const editorPlaceholder = computed(() => {
  if (activeStage.value === 'writing') {
    return 'Start drafting your chapter prose here... Use the Vibe AI on the right to help with descriptions or dialogue.'
  }
  if (activeStage.value === 'proofreading') {
    return 'Review and correct the proofread version. Click "Run Proofread" to start the AI analysis.'
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
    'chapter-outline': chapters.length > 0 && chapters.every(ch => ch.outline.objective.trim() || ch.outline.endingHook.trim()) ? 'done' : 'todo',
    writing: chapters.length > 0 && chapters.every(ch => ch.content.trim()) ? 'done' : 'todo',
    proofreading: chapters.length > 0 && chapters.every(ch => ch.proofreadContent.trim()) ? 'done' : 'todo',
    polishing: chapters.length > 0 && chapters.every(ch => ch.polishedContent.trim()) ? 'done' : 'todo',
  }
})

const nextAction = computed(() => project.value ? genStore.getNextAction(project.value) : { stage: 'done' as const })
const nextActionChapterNumber = computed(() => {
  if (!project.value || !('chapterIndex' in nextAction.value)) return null
  return (project.value.chapters[nextAction.value.chapterIndex]?.index ?? nextAction.value.chapterIndex) + 1
})

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

async function saveChapters() {
  if (!project.value) return
  const saved = await projectStore.updateProject(project.value.id, { chapters: cloneChapters(chaptersDraft.value) })
  if (!saved) {
    toast.error('Failed to save chapter plan')
    return
  }
  toast.success('Chapter plan saved')
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

function addCharacter() {
  charactersDraft.value.push(createEmptyCharacter())
  selectedCharacterId.value = charactersDraft.value.at(-1)?.id ?? null
}

function removeCharacter(id: string) {
  const index = charactersDraft.value.findIndex(character => character.id === id)
  if (index === -1) return
  charactersDraft.value.splice(index, 1)
  if (selectedCharacterId.value === id) {
    selectedCharacterId.value = charactersDraft.value[0]?.id ?? null
  }
}

function handleDeleteChapter(id: string) {
  const chapter = chaptersDraft.value.find(ch => ch.id === id)
  if (!chapter) return
  chapterToDeleteId.value = id
  if (activeStage.value === 'chapter-outline') {
    const hasContent = chapter.content?.trim() || chapter.proofreadContent?.trim() || chapter.polishedContent?.trim()
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
      chapter.proofreadContent = ''
      chapter.proofreadingIssues = []
      delete chapterProofreadingIssues.value[chapter.id]
    }
    else if (activeStage.value === 'polishing') chapter.polishedContent = ''
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

function updateCurrentChapterText(text: string) {
  if (!selectedChapter.value) return
  const chapter = chaptersDraft.value.find(item => item.id === selectedChapter.value?.id)
  if (!chapter) return
  if (activeStage.value === 'proofreading') {
    chapter.proofreadContent = text
    chapter.status = 'proofread'
  } else if (activeStage.value === 'polishing') {
    chapter.polishedContent = text
    chapter.status = 'polished'
  } else {
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
            <span>{{ stage.label }}</span>
            <Check v-if="stageStatusMap[stage.key] === 'done'" :size="10" class="ml-0.5" />
          </button>
        </div>

        <!-- Right: Status and Actions -->
        <div class="flex items-center gap-3 shrink-0">
          <div v-if="project" class="flex items-center gap-2 px-2 py-1 rounded-full bg-surface-2 border border-surface-4">
            <div class="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></div>
            <span class="text-[10px] font-bold text-text-secondary uppercase tracking-wider">Next:</span>
            <span class="text-[10px] font-medium text-text-primary">
              {{ nextAction.stage }}
              <span v-if="nextActionChapterNumber" class="text-accent ml-0.5">#{{ nextActionChapterNumber }}</span>
            </span>
            <div v-if="genStore.progressMessage" class="h-3 w-px bg-surface-4 mx-1"></div>
            <span v-if="genStore.progressMessage" class="text-[10px] text-text-muted truncate max-w-[120px]">{{ genStore.progressMessage }}</span>
          </div>
          <div class="flex items-center gap-1 border-l border-surface-4 pl-3">
            <BaseButton v-if="project" variant="ghost" size="sm" class="!h-7 !px-2 text-text-secondary hover:text-accent" @click="markProjectDirty">
              <Save :size="12" />
              <span class="text-[11px] ml-1">Sync</span>
            </BaseButton>
          </div>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-hidden flex">
      <div v-if="!project" class="h-full flex-1 flex items-center justify-center">
        <EmptyState :icon="BookOpen" title="No project loaded" description="Open a project to start the generation flow." />
      </div>

      <div v-else class="flex-1 flex flex-col min-w-0 overflow-hidden">
        <!-- Story Planning Stage -->
        <section v-if="activeStage === 'planning'" class="h-full flex flex-col overflow-hidden">
          <div class="shrink-0 flex items-center justify-between px-4 py-2 bg-surface-2 border-b border-surface-4">
            <div class="flex items-center gap-1">
              <button :class="['px-3 py-1.5 rounded-md text-xs font-semibold transition-all', planningSubTab === 'outline' ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3']" @click="planningSubTab = 'outline'">
                <FileText :size="14" class="inline mr-1.5" />Outline
              </button>
              <button :class="['px-3 py-1.5 rounded-md text-xs font-semibold transition-all', planningSubTab === 'characters' ? 'bg-accent text-white shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-surface-3']" @click="planningSubTab = 'characters'">
                <Users :size="14" class="inline mr-1.5" />Characters
              </button>
            </div>
            <div class="flex items-center gap-2">
              <BaseButton variant="secondary" size="sm" class="!h-8" :loading="genStore.isGenerating" @click="generateStoryPlanStage">
                <Wand2 :size="14" class="mr-1.5" /><span>AI Generate</span>
              </BaseButton>
              <BaseButton variant="primary" size="sm" class="!h-8" @click="savePlanning">
                <Save :size="14" class="mr-1.5" /><span>Save Plan</span>
              </BaseButton>
            </div>
          </div>

          <div class="flex-1 flex overflow-hidden">
            <!-- 1. Navigator -->
            <div class="w-64 border-r border-surface-4 bg-surface-2 flex flex-col shrink-0">
              <div class="h-[45px] px-3 border-b border-surface-4 bg-surface-1/50 flex items-center justify-between shrink-0">
                <span class="text-[10px] font-bold text-text-muted uppercase tracking-widest">Characters</span>
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
                  <FileText :size="14" />Story Outline
                </button>
              </div>
            </div>

            <!-- 2. Workspace -->
            <div class="flex-1 flex flex-col min-w-0 bg-surface-0 border-r border-surface-4 overflow-hidden">
              <div class="h-[45px] px-6 border-b border-surface-4 bg-surface-1/50 flex items-center justify-between shrink-0">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-bold text-text-primary uppercase tracking-widest">{{ planningSubTab === 'outline' ? 'Story Outline' : 'Character Profile' }}</span>
                  <div v-if="planningSubTab === 'characters' && selectedCharacter" class="h-1 w-1 rounded-full bg-text-muted"></div>
                  <span v-if="planningSubTab === 'characters' && selectedCharacter" class="text-xs text-accent font-medium">{{ selectedCharacter.name }}</span>
                </div>
                <BaseButton v-if="planningSubTab === 'characters' && selectedCharacter" variant="danger" size="sm" @click="removeCharacter(selectedCharacter.id)">
                  <Trash2 :size="14" />
                  <span>Delete Character</span>
                </BaseButton>
              </div>

              <div class="flex-1 overflow-y-auto custom-scrollbar">
                <div v-if="planningSubTab === 'outline'" class="h-full p-8"><textarea v-model="outlineDraft" class="w-full h-full bg-transparent text-text-primary resize-none outline-none font-serif text-lg leading-relaxed" placeholder="Draft your master story outline..."></textarea></div>
                <div v-else-if="selectedCharacter" class="p-6 space-y-6">
                  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="md:col-span-2 space-y-4">
                      <div class="grid grid-cols-2 gap-4"><BaseInput v-model="selectedCharacter.name" label="Full Name" /><BaseSelect v-model="selectedCharacter.role" label="Role" :options="roleOptions" /></div>
                      <BaseTextarea :model-value="selectedCharacter.personality.join(', ')" label="Personality" :rows="2" @update:model-value="selectedCharacter.personality = parseList($event)" />
                    </div>
                    <div class="bg-surface-2 rounded-xl p-4 flex flex-col items-center justify-center border border-surface-4">
                      <Users :size="32" class="text-accent mb-2" />
                      <p class="text-[10px] font-bold text-text-muted uppercase">Quick View</p>
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
                <h5 class="text-[10px] font-bold text-text-muted uppercase flex items-center gap-2"><Sparkles :size="12" class="text-accent" />Project Grounding</h5>
              </div>
              <div class="p-5 space-y-6">
                <section><label class="text-[10px] font-bold text-text-muted uppercase block mb-2">Theme</label><p class="text-xs italic border-l-2 border-surface-4 pl-3">{{ project.theme }}</p></section>
                <section><label class="text-[10px] font-bold text-text-muted uppercase block mb-2">Genre & Style</label><div class="flex flex-wrap gap-2"><BaseTag variant="default" size="sm">{{ project.genre }}</BaseTag><BaseTag variant="default" size="sm" class="capitalize">{{ project.length }}</BaseTag></div></section>
                <section v-if="project.constraints.required.length">
                  <label class="text-[10px] font-bold text-text-muted uppercase block mb-2">Must Include</label>
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
          <div class="h-[45px] shrink-0 flex items-center justify-between px-4 py-2 bg-surface-2 border-b border-surface-4">
            <h3 class="text-xs font-bold text-text-primary uppercase tracking-widest">Chapter Beats</h3>
            <div class="flex items-center gap-2">
              <BaseButton variant="ghost" size="sm" class="!h-8" @click="ensureChapterCount(1)"><Plus :size="14" class="mr-1.5" />Add Chapter</BaseButton>
              <BaseButton variant="secondary" size="sm" class="!h-8" :loading="genStore.isGenerating" @click="generateChapterPlanStage"><Wand2 :size="14" class="mr-1.5" />AI Generate</BaseButton>
              <BaseButton variant="primary" size="sm" class="!h-8" @click="saveChapters"><Save :size="14" class="mr-1.5" />Save Chapters</BaseButton>
            </div>
          </div>
          <div class="flex-1 flex overflow-hidden">
            <div class="w-64 border-r border-surface-4 bg-surface-2 overflow-y-auto p-2 space-y-1 shrink-0">
              <button v-for="chapter in chaptersDraft" :key="chapter.id" class="w-full text-left rounded-lg px-3 py-3 transition-all border relative" :class="selectedChapterId === chapter.id ? 'border-accent/30 bg-accent-subtle/50 text-accent shadow-sm' : 'border-transparent text-text-secondary hover:bg-surface-3'" @click="selectedChapterId = chapter.id">
                <div class="text-[10px] font-bold opacity-70 uppercase mb-1">Chapter {{ chapter.index + 1 }}</div>
                <div class="text-xs font-bold truncate">{{ chapter.title || 'Untitled' }}</div>
              </button>
            </div>
            <div class="flex-1 overflow-y-auto bg-surface-0 custom-scrollbar flex flex-col min-w-0">
              <template v-if="selectedChapter">
                <div class="h-[45px] px-6 border-b border-surface-4 bg-surface-1/50 flex items-center justify-between shrink-0">
                  <div class="flex items-center gap-3">
                    <div class="w-6 h-6 rounded bg-surface-2 border border-surface-4 flex items-center justify-center font-bold text-[10px]">{{ selectedChapter.index + 1 }}</div>
                    <h4 class="text-xs font-bold truncate max-w-[200px]">{{ selectedChapter.title || 'Untitled' }}</h4>
                  </div>
                  <BaseButton variant="danger" size="sm" @click="handleDeleteChapter(selectedChapter.id)">
                    <Trash2 :size="14" />
                    <span>Delete Chapter</span>
                  </BaseButton>
                </div>
                <div class="p-6 overflow-y-auto flex-1">
                  <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div class="space-y-4">
                      <BaseInput v-model="selectedChapter.title" label="Title" />
                      <BaseInput v-model="selectedChapter.outline.objective" label="Objective" />
                      <BaseInput v-model="selectedChapter.outline.conflict" label="Conflict" />
                      <BaseTextarea v-model="selectedChapter.outline.endingHook" label="Ending Hook" :rows="3" />
                    </div>
                    <div class="space-y-4">
                      <BaseTextarea :model-value="selectedChapter.outline.keyEvents.join('\n')" label="Plot Beats" :rows="4" @update:model-value="selectedChapter.outline.keyEvents = parseList($event)" />
                      <BaseTextarea :model-value="selectedChapter.outline.characterActions.join('\n')" label="Character Actions" :rows="4" @update:model-value="selectedChapter.outline.characterActions = parseList($event)" />
                      <BaseTextarea :model-value="selectedChapter.outline.infoReveals.join('\n')" label="Reveals" :rows="4" @update:model-value="selectedChapter.outline.infoReveals = parseList($event)" />
                    </div>
                  </div>
                </div>
              </template>
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
                <span>{{ activeStage === 'writing' ? 'Generate' : activeStage === 'proofreading' ? 'Proofread' : 'Polish' }} Current</span>
              </BaseButton>
              <BaseButton
                variant="secondary"
                size="sm"
                class="!h-8"
                :loading="genStore.isGenerating"
                @click="activeStage === 'writing' ? generateAllChapterDrafts() : activeStage === 'proofreading' ? proofreadAllChapters() : polishAllChapters()"
              >
                <Sparkles :size="14" class="mr-1.5" />
                <span>{{ activeStage === 'writing' ? 'Generate' : activeStage === 'proofreading' ? 'Proofread' : 'Polish' }} All</span>
              </BaseButton>
              <BaseButton variant="primary" size="sm" class="!h-8" @click="saveChapters"><Save :size="14" class="mr-1.5" />Save</BaseButton>
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
                    <span>Clear Stage</span>
                  </BaseButton>
                </div>
                <!-- Main Editor Area -->
                <div class="flex-1 overflow-y-auto px-8 custom-scrollbar bg-surface-0/50">
                  <div class="max-w-4xl mx-auto min-h-full flex flex-col border-l border-r border-surface-4 bg-surface-0 px-10 py-10 shadow-sm">
                    <textarea
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
          :content="selectedChapter.proofreadContent || selectedChapter.content"
          :chapter-outline="selectedChapter.outline"
          :characters="characterContext"
          :relationships="relationshipContext"
          :story-outline="project?.outline ?? ''"
          :language="project?.language ?? 'English'"
          :writing-format="project?.writingFormat ?? 'plaintext'"
          @fix="handleProofreadingFix"
          @issuesFound="handleProofreadingIssuesFound"
          @quickSubmitPolish="handleQuickSubmitPolish"
        />
        <VibeAssistant
          v-else
          ref="vibeAssistant"
          :stage="activeStage"
          :context="vibeContext"
          :mode="activeStage === 'writing' || activeStage === 'proofreading' || activeStage === 'polishing' ? 'editor-agent' : 'assistant'"
          @apply="handleVibeApply"
        />
      </div>
    </div>

    <ConfirmDialog v-model="showClearConfirm" title="Clear Content" message="Clear current stage content?" variant="danger" confirm-text="Clear" @confirm="performClearChapter" />
    <ConfirmDialog v-model="showDeleteConfirm" title="Delete" message="Delete chapter?" variant="danger" confirm-text="Delete" @confirm="performDeleteChapter" />
    <ConfirmDialog v-model="showDoubleDeleteConfirm" title="Warning" message="Chapter has content. Delete anyway?" variant="danger" confirm-text="Delete" @confirm="performDeleteChapter" />
  </div>
</template>

<style scoped>
.no-scrollbar::-webkit-scrollbar { display: none; }
.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
.custom-scrollbar::-webkit-scrollbar { width: 6px; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: var(--surface-4); border-radius: 10px; }
</style>
