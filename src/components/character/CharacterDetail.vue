<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  ArrowLeftRight,
  CalendarClock,
  Check,
  Sparkles,
  Trash2,
  UserRound,
  Wand2,
  X,
} from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import SuggestionCard from '@/components/studio/SuggestionCard.vue'
import { useStoryProject, useStudioActions, useWorkspaceUi, elementStateAt } from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase, formatChapterLabel } from '@/i18n'
import type { Character } from '@/types/character'

const props = defineProps<{ characterId: string; chapterIndex: number }>()
const emit = defineEmits<{
  close: []
  openChapter: [chapterId: string]
  openCharacter: [characterId: string]
}>()

const tr = translatePhrase
const projectStore = useStoryProject()
const actions = useStudioActions()
const ui = useWorkspaceUi()
const toast = useToast()

const showDeleteConfirm = ref(false)
const busy = ref(false)
const drafting = ref(false)
const suggestion = ref<{ field: NoteField; original: string; revised: string } | null>(null)

type NoteField = 'currentState' | 'personality' | 'appearance' | 'backstory' | 'motivation' | 'goals' | 'conflicts'

const noteFields: Array<{ key: NoteField; label: string }> = [
  { key: 'currentState', label: 'Current state' },
  { key: 'personality', label: 'Personality' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'backstory', label: 'Backstory' },
  { key: 'motivation', label: 'Motivation' },
  { key: 'goals', label: 'Goals' },
  { key: 'conflicts', label: 'Conflicts' },
]

const activeField = ref<NoteField>('currentState')
const draft = ref('')

const project = computed(() => projectStore.activeProject)
const character = computed<Character | null>(() =>
  project.value?.characters.find(item => item.id === props.characterId) ?? null,
)
const chapters = computed(() => project.value?.chapters ?? [])
const element = computed(() =>
  (project.value?.elements ?? []).find(item =>
    item.characterId === props.characterId
    || (item.kind === 'character' && item.name === character.value?.name),
  ) ?? null,
)
const currentState = computed(() => element.value ? elementStateAt(element.value, props.chapterIndex) : null)

const relationships = computed(() =>
  (character.value?.relations ?? []).map(relation => ({
    ...relation,
    target: project.value?.characters.find(item => item.id === relation.targetId) ?? null,
  })),
)

const stateTimeline = computed(() =>
  [...(element.value?.states ?? [])].sort((a, b) => a.chapterIndex - b.chapterIndex),
)

watch(
  character,
  value => {
    if (!value) {
      draft.value = ''
      return
    }
    draft.value = fieldValue(value, activeField.value)
  },
  { immediate: true },
)

watch(activeField, () => {
  if (character.value) draft.value = fieldValue(character.value, activeField.value)
})

function fieldValue(value: Character, field: NoteField): string {
  if (field === 'personality') return value.personality.join(', ')
  return value[field] ?? ''
}

const dirty = computed(() => {
  if (!character.value) return false
  return draft.value !== fieldValue(character.value, activeField.value)
})

async function saveNotes() {
  const current = character.value
  if (!current || !project.value) return
  const characters = project.value.characters.map(item => {
    if (item.id !== current.id) return item
    const next = { ...item, updatedAt: new Date().toISOString() }
    if (activeField.value === 'personality') {
      next.personality = draft.value.split(',').map(part => part.trim()).filter(Boolean)
    } else {
      next[activeField.value] = draft.value
    }
    return next
  })
  await projectStore.updateProject(project.value.id, { characters })
  toast.success('Character saved')
}

async function draftWithAI() {
  const current = character.value
  if (!current || drafting.value) return
  drafting.value = true
  try {
    const label = noteFields.find(field => field.key === activeField.value)?.label ?? 'Notes'
    const reply = await actions.askCopilot(
      [
        `Rewrite the "${label}" note for ${current.name} as concise, concrete character notes.`,
        'Keep every established fact. Return only the note text, no heading, no commentary.',
        `Current note:\n${draft.value || '(empty)'}`,
        current.appearance ? `Appearance: ${current.appearance}` : '',
        current.backstory ? `Backstory: ${current.backstory}` : '',
        current.motivation ? `Motivation: ${current.motivation}` : '',
      ].filter(Boolean).join('\n\n'),
      { chapterId: null },
    )
    suggestion.value = { field: activeField.value, original: draft.value, revised: reply.trim() }
  } catch (error: any) {
    toast.error(error?.message || 'Drafting failed')
  } finally {
    drafting.value = false
  }
}

function acceptSuggestion() {
  if (!suggestion.value) return
  draft.value = suggestion.value.revised
  suggestion.value = null
}

async function removeCharacter() {
  const current = character.value
  if (!current || !project.value || busy.value) return
  busy.value = true
  try {
    const remaining = project.value.characters
      .filter(item => item.id !== current.id)
      .map(item => ({
        ...item,
        relations: item.relations.filter(relation => relation.targetId !== current.id),
      }))
    await projectStore.updateProject(project.value.id, { characters: remaining })
    toast.success('Character deleted')
    emit('close')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div v-if="character" class="flex h-full min-h-0 flex-col">
    <header class="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
      <div class="flex min-w-0 items-center gap-2">
        <span class="flex h-9 w-9 items-center justify-center rounded-full bg-surface-1 text-accent shadow-ios-pill">
          <UserRound :size="18" />
        </span>
        <div class="min-w-0">
          <p class="truncate text-body font-semibold text-text-primary">{{ character.name }}</p>
          <p class="text-meta text-text-muted">{{ tr(character.role) }}</p>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-0.5">
        <button class="app-icon-button app-icon-button--danger" :aria-label="tr('Delete character')" @click="showDeleteConfirm = true">
          <Trash2 :size="17" />
        </button>
        <button class="app-icon-button" :aria-label="tr('Close')" @click="emit('close')">
          <X :size="17" />
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-6 pt-5">
      <div class="rounded-ios bg-surface-1 p-4 shadow-ios-pill">
        <div class="flex items-center justify-between gap-2">
          <p class="text-meta font-medium text-text-muted">{{ formatChapterLabel(chapterIndex) }}</p>
          <BaseTag v-if="currentState?.status" variant="accent" size="sm">{{ tr(currentState.status) }}</BaseTag>
        </div>
        <p class="mt-1 text-caption leading-relaxed text-text-primary">
          {{ currentState?.summary || character.currentState || tr('No state recorded yet') }}
        </p>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <span v-if="currentState?.location" class="rounded-full bg-surface-2 px-2.5 py-1 text-meta text-text-secondary">{{ currentState.location }}</span>
          <span v-if="currentState?.time" class="rounded-full bg-surface-2 px-2.5 py-1 text-meta text-text-secondary">{{ currentState.time }}</span>
          <span v-for="trait in character.personality.slice(0, 4)" :key="trait" class="rounded-full bg-surface-2 px-2.5 py-1 text-meta text-text-secondary">{{ trait }}</span>
        </div>
      </div>

      <div>
        <p class="mb-2 flex items-center gap-1.5 text-meta font-medium text-text-muted">
          <ArrowLeftRight :size="13" />
          {{ tr('Relationships') }}
        </p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="relation in relationships"
            :key="relation.targetId"
            type="button"
            class="capsule h-8 gap-1.5 bg-surface-1 px-3 text-meta shadow-ios-pill"
            :title="relation.description"
            @click="emit('openCharacter', relation.targetId)"
          >
            <span class="font-medium text-text-primary">{{ relation.target?.name || tr('Unknown') }}</span>
            <span class="text-text-muted">{{ relation.relation }}</span>
          </button>
          <p v-if="!relationships.length" class="text-meta text-text-muted">{{ tr('No relationships yet') }}</p>
        </div>
      </div>

      <div v-if="stateTimeline.length">
        <p class="mb-2 flex items-center gap-1.5 text-meta font-medium text-text-muted">
          <CalendarClock :size="13" />
          {{ tr('State timeline') }}
        </p>
        <ol class="space-y-2">
          <li
            v-for="state in stateTimeline"
            :key="state.id"
            class="rounded-ios bg-surface-1 p-3 shadow-ios-pill"
            :class="state.chapterIndex === currentState?.chapterIndex ? 'ring-2 ring-inset ring-accent/30' : ''"
          >
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                class="rounded-full bg-surface-2 px-2.5 py-0.5 text-meta font-medium text-text-secondary hover:bg-accent-subtle hover:text-accent"
                @click="chapters[Math.max(0, state.chapterIndex)] && emit('openChapter', chapters[Math.max(0, state.chapterIndex)].id)"
              >
                {{ state.chapterIndex < 0 ? tr('Before story') : formatChapterLabel(state.chapterIndex) }}
              </button>
              <span v-if="state.status" class="rounded-full bg-accent-subtle px-2 py-0.5 text-meta text-accent">{{ tr(state.status) }}</span>
              <span v-if="state.location" class="text-meta text-text-muted">@{{ state.location }}</span>
            </div>
            <p class="mt-1.5 text-meta leading-relaxed text-text-secondary">{{ state.summary }}</p>
          </li>
        </ol>
      </div>

      <div class="rounded-ios bg-surface-1 p-4 shadow-ios-pill">
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            v-for="field in noteFields"
            :key="field.key"
            type="button"
            class="capsule h-8 px-3 text-meta"
            :class="activeField === field.key ? 'capsule--active' : 'bg-surface-2'"
            @click="activeField = field.key"
          >
            {{ tr(field.label) }}
          </button>
        </div>

        <textarea
          v-model="draft"
          rows="5"
          class="mt-2 w-full resize-y rounded-ios bg-surface-2 px-3.5 py-2.5 text-caption leading-relaxed text-text-primary outline-none focus:ring-2 focus:ring-inset focus:ring-accent/40"
          :placeholder="tr('Notes for this aspect of the character')"
        />

        <div class="mt-2 flex justify-end gap-1.5">
          <BaseButton variant="secondary" size="sm" :loading="drafting" @click="draftWithAI">
            <Sparkles :size="14" />
            <span>{{ tr('Draft with AI') }}</span>
          </BaseButton>
          <button class="capsule h-9 gap-1 bg-accent-subtle px-3.5 text-caption text-accent disabled:opacity-40" :disabled="!dirty" @click="saveNotes">
            <Check :size="14" />
            <span>{{ tr('Save') }}</span>
          </button>
        </div>
      </div>

      <SuggestionCard
        v-if="suggestion"
        :original="suggestion.original"
        :revised="suggestion.revised"
        kind="rewrite"
        :label="tr('Drafted') + ' ' + tr(noteFields.find(field => field.key === suggestion!.field)?.label || '')"
        @accept="acceptSuggestion"
        @discard="suggestion = null"
      />
    </div>

    <ConfirmDialog
      v-model="showDeleteConfirm"
      :title="tr('Delete character')"
      :message="tr('This removes the character and the relationships that point to it.')"
      :confirm-text="tr('Delete')"
      :cancel-text="tr('Cancel')"
      variant="danger"
      @confirm="removeCharacter"
    />
  </div>
</template>
