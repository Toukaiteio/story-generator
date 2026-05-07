<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { generateId } from '@/lib/id'
import { useProjectStore } from '@/stores/project'
import { useGenerationStore } from '@/stores/generation'
import { useUiStore } from '@/stores/ui'
import { useToast } from '@/composables/useToast'
import type { Character } from '@/types/character'
import type { Chapter } from '@/types/chapter'
import type { GenerationStage } from '@/types/project'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import VibeAssistantPanel from '@/components/workspace/VibeAssistantPanel.vue'
import { Check, FileText, Plus, Save, Sparkles, Trash2, Wand2, Users, BookOpen } from 'lucide-vue-next'

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

const vibeContext = computed(() => {
  const ctx: Record<string, any> = {}
  if (project.value) {
    ctx.outline = outlineDraft.value
    ctx.characters = charactersDraft.value.map(c => `${c.name} (${c.role}): ${c.personality.join(', ')}`).join('\n')
  }
  if (selectedChapter.value && (activeStage.value === 'writing' || activeStage.value === 'proofreading' || activeStage.value === 'polishing')) {
    ctx.chapter = {
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

function handleVibeApply(content: string) {
  // Apply content based on current stage
  if (activeStage.value === 'planning') {
    if (planningSubTab.value === 'outline') {
      outlineDraft.value = content
    }
  } else if (activeStage.value === 'writing' || activeStage.value === 'proofreading' || activeStage.value === 'polishing') {
    if (selectedChapter.value) {
      updateCurrentChapterText(content)
    }
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
  return value.map(chapter => ({
    ...chapter,
    outline: {
      ...chapter.outline,
      keyEvents: [...chapter.outline.keyEvents],
      characterActions: [...chapter.outline.characterActions],
      infoReveals: [...chapter.outline.infoReveals],
    },
    characterStateUpdates: { ...chapter.characterStateUpdates },
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

watch(project, syncFromProject, { immediate: true, deep: true })
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
  if (!project.value) return
  try {
    await genStore.generateChapterPlan(project.value.id)
    syncFromProject()
    toast.success('Chapter plan generated')
  } catch (error: any) {
    toast.error(error?.message || 'Chapter plan generation failed')
  }
}

async function generateCurrentChapterDraft() {
  if (!project.value || !selectedChapterId.value) return
  const chapterIndex = chaptersDraft.value.findIndex(chapter => chapter.id === selectedChapterId.value)
  if (chapterIndex === -1) return
  try {
    await genStore.generateChapterDraft(project.value.id, chapterIndex)
    syncFromProject()
    toast.success('Chapter draft generated')
  } catch (error: any) {
    toast.error(error?.message || 'Writing failed')
  }
}

async function proofreadCurrentChapter() {
  if (!project.value || !selectedChapterId.value) return
  const chapterIndex = chaptersDraft.value.findIndex(chapter => chapter.id === selectedChapterId.value)
  if (chapterIndex === -1) return
  try {
    await genStore.proofreadChapter(project.value.id, chapterIndex)
    syncFromProject()
    toast.success('Chapter proofread')
  } catch (error: any) {
    toast.error(error?.message || 'Proofreading failed')
  }
}

async function polishCurrentChapter() {
  if (!project.value || !selectedChapterId.value) return
  const chapterIndex = chaptersDraft.value.findIndex(chapter => chapter.id === selectedChapterId.value)
  if (chapterIndex === -1) return
  try {
    await genStore.polishChapter(project.value.id, chapterIndex)
    syncFromProject()
    toast.success('Chapter polished')
  } catch (error: any) {
    toast.error(error?.message || 'Polishing failed')
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
    <div class="shrink-0 border-b border-surface-4 px-6 py-4">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-base font-semibold text-text-primary">Generation Studio</h2>
          <p class="text-xs text-text-secondary mt-0.5">
            Step through each stage, edit the result, then continue to the next step.
          </p>
        </div>

        <div class="flex items-center gap-2">
      </div>

      </div>

      <div class="mt-4 flex items-center gap-2 overflow-x-auto pb-1">
        <button
          v-for="stage in stageTabs"
          :key="stage.key"
          :class="[
            'flex items-center gap-2 px-3 py-2 rounded-md border text-xs transition-colors duration-100 whitespace-nowrap',
            activeStage === stage.key
              ? 'border-accent bg-accent-subtle text-accent'
              : stageStatusMap[stage.key] === 'done'
                ? 'border-success/30 bg-success-subtle text-success'
                : 'border-surface-4 bg-surface-2 text-text-secondary hover:text-text-primary hover:border-surface-5',
          ]"
          @click="selectStage(stage.key)"
        >
          <component :is="stage.icon" :size="13" />
          <span>{{ stage.label }}</span>
          <BaseTag v-if="stageStatusMap[stage.key] === 'done'" variant="success" size="sm">Done</BaseTag>
          <BaseTag v-else-if="activeStage === stage.key" variant="accent" size="sm">Editing</BaseTag>
        </button>
      </div>

      <div class="mt-3 flex items-center justify-between gap-3 text-xs text-text-secondary">
        <div class="flex items-center gap-2">
          <BaseTag variant="default" size="sm">
            Next: {{ nextAction.stage }}
            <span v-if="'chapterIndex' in nextAction"> #{{ nextAction.chapterIndex + 1 }}</span>
          </BaseTag>
          <span v-if="genStore.progressMessage">{{ genStore.progressMessage }}</span>
        </div>
        <BaseButton
          v-if="project"
          variant="ghost"
          size="sm"
          @click="markProjectDirty"
        >
          <Save :size="14" />
          <span>Sync Drafts</span>
        </BaseButton>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto">
      <div v-if="!project" class="h-full flex items-center justify-center">
        <EmptyState
          :icon="BookOpen"
          title="No project loaded"
          description="Open a project to start the generation flow."
        />
      </div>

  <div v-else>
        <section v-if="activeStage === 'planning'" class="max-w-6xl mx-auto px-6 py-6">
          <div class="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 class="text-sm font-semibold text-text-primary">Story Planning</h3>
              <p class="text-xs text-text-secondary">Draft the outline, branch into character creation if needed, then refine the outline around the cast.</p>
            </div>
            <div class="flex items-center gap-2">
              <BaseButton variant="secondary" size="sm" :loading="genStore.isGenerating" @click="generateStoryPlanStage">
                <Wand2 :size="14" />
                <span>Generate Story Plan</span>
              </BaseButton>
              <BaseButton variant="primary" size="sm" @click="savePlanning">Save</BaseButton>
            </div>
          </div>

          <div class="flex items-center gap-1 mb-4">
            <button
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                planningSubTab === 'outline'
                  ? 'bg-accent-subtle text-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-3',
              ]"
              @click="planningSubTab = 'outline'"
            >
              <FileText :size="12" class="inline mr-1" />
              Outline
            </button>
            <button
              :class="[
                'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                planningSubTab === 'characters'
                  ? 'bg-accent-subtle text-accent'
                  : 'text-text-secondary hover:text-text-primary hover:bg-surface-3',
              ]"
              @click="planningSubTab = 'characters'"
            >
              <Users :size="12" class="inline mr-1" />
              Characters
            </button>
          </div>

          <div v-if="planningSubTab === 'outline'">
            <BaseTextarea
              v-model="outlineDraft"
              label="Story Outline"
              :rows="16"
              :auto-resize="true"
              placeholder="Generate or write the story outline here..."
            />
          </div>

          <div v-else class="grid grid-cols-12 gap-4 min-h-[520px]">
            <div class="col-span-12 md:col-span-3 rounded-lg border border-surface-4 bg-surface-2 p-3 overflow-y-auto">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-medium text-text-secondary">Characters</span>
                <BaseButton variant="ghost" size="sm" @click="addCharacter">
                  <Plus :size="12" />
                </BaseButton>
              </div>
              <div v-if="charactersDraft.length" class="space-y-2">
                <button
                  v-for="character in charactersDraft"
                  :key="character.id"
                  class="w-full text-left rounded-md border px-3 py-2 transition-colors duration-100"
                  :class="selectedCharacterId === character.id ? 'border-accent bg-accent-subtle' : 'border-surface-4 hover:border-surface-5 bg-surface-1'"
                  @click="selectedCharacterId = character.id"
                >
                  <div class="text-sm font-medium text-text-primary">{{ character.name }}</div>
                  <div class="text-2xs text-text-secondary">{{ character.role }}</div>
                </button>
              </div>
              <EmptyState
                v-else
                :icon="Users"
                title="No characters yet"
                description="Generate or add a character."
              >
                <template #action>
                  <BaseButton variant="primary" size="sm" @click="addCharacter">Add Character</BaseButton>
                </template>
              </EmptyState>
            </div>

            <div class="col-span-12 md:col-span-9 rounded-lg border border-surface-4 bg-surface-2 p-4">
              <template v-if="selectedCharacter">
                <div class="flex items-center justify-between mb-4">
                  <div>
                    <h4 class="text-sm font-semibold text-text-primary">Character Editor</h4>
                    <p class="text-xs text-text-secondary">Adjust the selected character.</p>
                  </div>
                  <BaseButton variant="danger" size="sm" @click="removeCharacter(selectedCharacter.id)">
                    <Trash2 :size="14" />
                    Delete
                  </BaseButton>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <BaseInput v-model="selectedCharacter.name" label="Name" />
                  <BaseSelect v-model="selectedCharacter.role" label="Role" :options="roleOptions" />
                </div>
                <BaseTextarea
                  :model-value="selectedCharacter.personality.join(', ')"
                  label="Personality Traits"
                  :rows="2"
                  :auto-resize="true"
                  placeholder="Comma-separated traits"
                  @update:model-value="selectedCharacter.personality = parseList($event)"
                />
                <BaseTextarea v-model="selectedCharacter.appearance" label="Appearance" :rows="3" :auto-resize="true" class="mt-3" />
                <BaseTextarea v-model="selectedCharacter.backstory" label="Backstory" :rows="4" :auto-resize="true" class="mt-3" />
                <div class="grid grid-cols-2 gap-3 mt-3">
                  <BaseTextarea v-model="selectedCharacter.motivation" label="Motivation" :rows="3" :auto-resize="true" />
                  <BaseTextarea v-model="selectedCharacter.goals" label="Goals" :rows="3" :auto-resize="true" />
                </div>
                <div class="grid grid-cols-2 gap-3 mt-3">
                  <BaseTextarea v-model="selectedCharacter.conflicts" label="Conflicts" :rows="3" :auto-resize="true" />
                  <BaseTextarea v-model="selectedCharacter.currentState" label="Current State" :rows="3" :auto-resize="true" />
                </div>
              </template>

              <EmptyState
                v-else
                :icon="Users"
                title="Select a character"
                description="Pick a character from the list to edit."
              />
            </div>
          </div>
        </section>

        <section v-else-if="activeStage === 'chapter-outline'" class="max-w-6xl mx-auto px-6 py-6">
          <div class="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 class="text-sm font-semibold text-text-primary">Chapter Plan</h3>
              <p class="text-xs text-text-secondary">Turn the outline into chapter-by-chapter beats.</p>
            </div>
            <div class="flex items-center gap-2">
              <BaseButton variant="ghost" size="sm" @click="ensureChapterCount(1)">
                <Plus :size="14" />
                <span>Add</span>
              </BaseButton>
              <BaseButton variant="secondary" size="sm" @click="generateChapterPlanStage">Generate Chapter Plan</BaseButton>
              <BaseButton variant="primary" size="sm" @click="saveChapters">Save</BaseButton>
            </div>
          </div>

          <div class="grid grid-cols-12 gap-4 min-h-[560px]">
            <div class="col-span-12 md:col-span-3 rounded-lg border border-surface-4 bg-surface-2 p-3 overflow-y-auto">
              <div v-if="chaptersDraft.length" class="space-y-2">
                <button
                  v-for="chapter in chaptersDraft"
                  :key="chapter.id"
                  class="w-full text-left rounded-md border px-3 py-2 transition-colors duration-100"
                  :class="selectedChapterId === chapter.id ? 'border-accent bg-accent-subtle' : 'border-surface-4 hover:border-surface-5 bg-surface-1'"
                  @click="selectedChapterId = chapter.id"
                >
                  <div class="text-sm font-medium text-text-primary">Ch {{ chapter.index + 1 }}</div>
                  <div class="text-2xs text-text-secondary truncate">{{ chapter.title }}</div>
                </button>
              </div>
              <EmptyState
                v-else
                :icon="BookOpen"
                title="No chapter plan yet"
                description="Generate a chapter plan to edit individual chapter beats."
              />
            </div>

            <div class="col-span-12 md:col-span-9 rounded-lg border border-surface-4 bg-surface-2 p-4">
              <template v-if="selectedChapter">
                <div class="flex items-center justify-between mb-4">
                  <div>
                    <h4 class="text-sm font-semibold text-text-primary">Chapter {{ selectedChapter.index + 1 }} Plan</h4>
                    <p class="text-xs text-text-secondary">Edit the chapter outline before drafting prose.</p>
                  </div>
                  <BaseTag variant="accent" size="sm">{{ selectedChapter.status }}</BaseTag>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <BaseInput v-model="selectedChapter.title" label="Chapter Title" />
                  <BaseInput v-model="selectedChapter.outline.objective" label="Objective" />
                </div>
                <BaseInput v-model="selectedChapter.outline.conflict" label="Conflict" class="mt-3" />
                <BaseTextarea
                  :model-value="selectedChapter.outline.keyEvents.join('\n')"
                  label="Key Events"
                  :rows="4"
                  :auto-resize="true"
                  class="mt-3"
                  @update:model-value="selectedChapter.outline.keyEvents = parseList($event)"
                />
                <BaseTextarea
                  :model-value="selectedChapter.outline.characterActions.join('\n')"
                  label="Character Actions"
                  :rows="3"
                  :auto-resize="true"
                  class="mt-3"
                  @update:model-value="selectedChapter.outline.characterActions = parseList($event)"
                />
                <BaseTextarea
                  :model-value="selectedChapter.outline.infoReveals.join('\n')"
                  label="Info Reveals"
                  :rows="3"
                  :auto-resize="true"
                  class="mt-3"
                  @update:model-value="selectedChapter.outline.infoReveals = parseList($event)"
                />
                <BaseTextarea v-model="selectedChapter.outline.endingHook" label="Ending Hook" :rows="3" :auto-resize="true" class="mt-3" />

                <div class="mt-4 flex justify-end">
                  <BaseButton variant="primary" size="sm" @click="saveChapters">Save Chapter Plan</BaseButton>
                </div>
              </template>

              <EmptyState
                v-else
                :icon="BookOpen"
                title="Select a chapter"
                description="Pick a chapter to edit its plan."
              />
            </div>
          </div>
        </section>

        <section v-else class="max-w-6xl mx-auto px-6 py-6">
          <div class="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 class="text-sm font-semibold text-text-primary">
                {{ activeStage === 'writing' ? 'Writing' : activeStage === 'proofreading' ? 'Proofreading' : 'Polishing' }}
              </h3>
              <p class="text-xs text-text-secondary">
                {{ activeStage === 'writing'
                  ? 'Draft chapter prose one step at a time.'
                  : activeStage === 'proofreading'
                    ? 'Fix structure and correctness.'
                    : 'Refine voice and rhythm without losing meaning.' }}
              </p>
            </div>
            <div class="flex items-center gap-2">
              <BaseButton variant="ghost" size="sm" @click="ensureChapterCount(1)">
                <Plus :size="14" />
                <span>Add</span>
              </BaseButton>
              <BaseButton
                v-if="activeStage === 'writing'"
                variant="secondary"
                size="sm"
                @click="generateCurrentChapterDraft"
              >
                Generate Draft
              </BaseButton>
              <BaseButton
                v-else-if="activeStage === 'proofreading'"
                variant="secondary"
                size="sm"
                @click="proofreadCurrentChapter"
              >
                Proofread
              </BaseButton>
              <BaseButton
                v-else
                variant="secondary"
                size="sm"
                @click="polishCurrentChapter"
              >
                Polish
              </BaseButton>
              <BaseButton variant="primary" size="sm" @click="saveChapters">Save</BaseButton>
            </div>
          </div>

          <div class="grid grid-cols-12 gap-4 min-h-[620px]">
            <div class="col-span-12 md:col-span-3 rounded-lg border border-surface-4 bg-surface-2 p-3 overflow-y-auto">
              <div v-if="chaptersDraft.length" class="space-y-2">
                <button
                  v-for="chapter in chaptersDraft"
                  :key="chapter.id"
                  class="w-full text-left rounded-md border px-3 py-2 transition-colors duration-100"
                  :class="selectedChapterId === chapter.id ? 'border-accent bg-accent-subtle' : 'border-surface-4 hover:border-surface-5 bg-surface-1'"
                  @click="selectedChapterId = chapter.id"
                >
                  <div class="text-sm font-medium text-text-primary">Ch {{ chapter.index + 1 }}</div>
                  <div class="text-2xs text-text-secondary">
                    {{ activeStage === 'writing'
                      ? (chapter.content ? 'Draft ready' : 'Needs draft')
                      : activeStage === 'proofreading'
                        ? (chapter.proofreadContent ? 'Proofread ready' : 'Needs proofread')
                        : (chapter.polishedContent ? 'Polished' : 'Needs polish') }}
                  </div>
                </button>
              </div>
              <EmptyState
                v-else
                :icon="BookOpen"
                title="No chapters yet"
                description="Generate a chapter plan before writing."
              />
            </div>

            <div class="col-span-12 md:col-span-9 rounded-lg border border-surface-4 bg-surface-2 p-4">
              <template v-if="selectedChapter">
                <div class="flex items-center justify-between mb-4">
                  <div>
                    <h4 class="text-sm font-semibold text-text-primary">Chapter {{ selectedChapter.index + 1 }}</h4>
                    <p class="text-xs text-text-secondary">
                      {{ activeStage === 'writing'
                        ? 'Draft the chapter using the current chapter plan.'
                        : activeStage === 'proofreading'
                          ? 'Adjust the proofread version.'
                          : 'Adjust the polished version.' }}
                    </p>
                  </div>
                  <BaseTag
                    :variant="activeStage === 'writing' ? 'warning' : activeStage === 'proofreading' ? 'accent' : 'success'"
                    size="sm"
                  >
                    {{ activeStage }}
                  </BaseTag>
                </div>

                <div v-if="activeStage === 'writing'" class="rounded-lg border border-surface-4 bg-surface-1 p-4 mb-4">
                  <h5 class="text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">Chapter Plan</h5>
                  <p class="text-sm text-text-primary mb-2">{{ selectedChapter.outline.objective || 'No objective yet.' }}</p>
                  <p class="text-xs text-text-secondary">Conflict: {{ selectedChapter.outline.conflict || '—' }}</p>
                </div>

                <BaseTextarea
                  :model-value="selectedChapterText"
                  :label="activeStage === 'writing' ? 'Draft' : activeStage === 'proofreading' ? 'Proofread Text' : 'Polished Text'"
                  :rows="22"
                  :auto-resize="true"
                  @update:model-value="updateCurrentChapterText"
                />
              </template>

              <EmptyState
                v-else
                :icon="BookOpen"
                title="Select a chapter"
                description="Choose a chapter to edit its content."
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>

  <!-- Vibe Assistant Panel -->
  <VibeAssistantPanel
    :stage="activeStage"
    :context="vibeContext"
    @apply="handleVibeApply"
  />
</template>
