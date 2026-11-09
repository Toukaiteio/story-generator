<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { CalendarClock, RefreshCw, Trash2, UserRound, X } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import ElementProposalList from './ElementProposalList.vue'
import ElementConflictReview from './ElementConflictReview.vue'
import AliasInput from './AliasInput.vue'
import {
  useStoryProject,
  useStudioActions,
  elementStateAt,
  statusesForKind,
  isStatusValidForKind,
  detectProposalConflicts,
  type ElementStateProposal,
  type ElementStateConflict,
  type ElementStatus,
} from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase, formatChapterLabel } from '@/i18n'
import { normalizeElementAliases } from '@/app'
import type { ElementState, StoryElement } from '@/types/element'

const props = defineProps<{
  element: StoryElement
  chapterIndex: number
  characterId?: string
}>()

const emit = defineEmits<{
  close: []
  openChapter: [chapterId: string]
  openCharacter: [characterId: string]
}>()

const tr = translatePhrase
const projectStore = useStoryProject()
const actions = useStudioActions()
const toast = useToast()

const busy = ref(false)
const syncing = ref(false)
const aliases = ref<string[]>(normalizeElementAliases(props.element.aliases, props.element.name))
const proposals = ref<ElementStateProposal[]>([])
const proposalConflicts = ref<ElementStateConflict[]>([])
const syncChapterId = ref('')

const chapters = computed(() => projectStore.activeProject?.chapters ?? [])
const characters = computed(() => projectStore.activeProject?.characters ?? [])
const linkedCharacter = computed(() => characters.value.find(item => item.id === props.characterId) ?? null)

watch(
  () => [props.element.id, props.element.aliases, props.element.name] as const,
  () => {
    aliases.value = normalizeElementAliases(props.element.aliases, props.element.name)
  },
  { immediate: true },
)

async function saveAliases(next: string[]) {
  const previous = aliases.value
  aliases.value = next
  try {
    await actions.setElementAliases(props.element.id, next)
    toast.success('Aliases saved')
  } catch (error: any) {
    toast.error(error?.message || 'Failed to save aliases')
    aliases.value = previous
  }
}

const characterOptions = computed(() => [
  { label: tr('Unlinked'), value: '' },
  ...characters.value.map(item => ({ label: item.name, value: item.id })),
])

async function setCharacter(value: string) {
  if (busy.value) return
  await actions.linkElementCharacter(props.element.id, value || null)
}

const chapterAtTimeline = computed(() => chapters.value[props.chapterIndex] ?? null)
const currentState = computed(() => elementStateAt(props.element, props.chapterIndex))
const latest = computed(() => props.element.states[props.element.states.length - 1])

const validStatuses = computed(() => statusesForKind(props.element.kind))
const statusOptions = computed<Array<{ label: string; value: ElementStatus }>>(() =>
  validStatuses.value.map(status => ({ label: tr(status.charAt(0).toUpperCase() + status.slice(1)), value: status })),
)

const currentStatus = computed(() => currentState.value?.status)

const statusIsStoredButInvalid = computed(() =>
  Boolean(currentStatus.value && !isStatusValidForKind(props.element.kind, currentStatus.value)),
)

const sortedStates = computed(() =>
  [...props.element.states].sort((a, b) => a.chapterIndex - b.chapterIndex),
)

watch(
  () => [props.element.id, props.chapterIndex],
  () => {
    syncChapterId.value = chapterAtTimeline.value?.id ?? ''
  },
  { immediate: true },
)

watch(chapters, () => {
  syncChapterId.value = chapterAtTimeline.value?.id ?? chapters.value[chapters.value.length - 1]?.id ?? ''
}, { immediate: true })

watch(() => props.element.id, () => {
  proposals.value = []
  proposalConflicts.value = []
})

async function syncFromChapter() {
  if (!syncChapterId.value || syncing.value) return
  syncing.value = true
  proposals.value = []
  proposalConflicts.value = []
  try {
    const result = await actions.proposeElementStates(syncChapterId.value)
    const chapter = chapters.value.find(item => item.id === syncChapterId.value)
    const mine = result
      .filter(item => item.elementId === props.element.id || item.name.trim() === props.element.name.trim())
      .map(item => ({
        ...item,
        state: { ...item.state, chapterIndex: item.state.chapterIndex ?? chapter?.index ?? props.chapterIndex },
      }))
    proposals.value = mine
    proposalConflicts.value = detectProposalConflicts([props.element], mine)
    if (!mine.length) toast.info('No changes for this element in that chapter')
  } catch (error: any) {
    toast.error(error?.message || 'Sync failed')
  } finally {
    syncing.value = false
  }
}

async function applyProposals(selected: ElementStateProposal[]) {
  if (!selected.length || busy.value) return
  busy.value = true
  try {
    await actions.applyElementProposals(selected)
    proposals.value = []
    proposalConflicts.value = []
    toast.success('Element updated')
  } catch (error: any) {
    toast.error(error?.message || 'Apply failed')
  } finally {
    busy.value = false
  }
}

async function changeStatus(next: ElementStatus) {
  if (busy.value || !isStatusValidForKind(props.element.kind, next)) return
  await actions.setElementStatus(props.element.id, next)
}

async function removeElement() {
  if (busy.value) return
  await actions.removeElement(props.element.id)
  emit('close')
}

function openStateChapter(state: ElementState) {
  const target = chapters.value[Math.max(0, state.chapterIndex)]
  if (target) emit('openChapter', target.id)
}

function retargetToTimeline() {
  const state = currentState.value ?? latest.value
  if (!state) return
  moveStateTo(state, props.chapterIndex)
}

function moveStateTo(state: ElementState, index: number) {
  if (busy.value) return
  const clamped = Math.max(0, Math.min(index, Math.max(0, chapters.value.length - 1)))
  if (clamped === state.chapterIndex) return
  const next = props.element.states.map(item =>
    item.id === state.id ? { ...item, chapterIndex: clamped } : item,
  )
  void actions.updateElementStates(props.element.id, next)
    .then(() => toast.success(`${tr('Moved to')} ${formatChapterLabel(clamped)}`))
    .catch((error: any) => toast.error(error?.message || 'Failed to move state'))
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
      <div class="min-w-0">
        <p class="truncate text-body font-semibold text-text-primary">{{ element.name }}</p>
        <p class="text-meta text-text-muted">{{ tr(element.kind) }} · {{ formatChapterLabel(props.chapterIndex) }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-0.5">
        <button
          v-if="characterId"
          class="app-icon-button"
          :aria-label="tr('Open character profile')"
          @click="emit('openCharacter', characterId)"
        >
          <UserRound :size="17" />
        </button>
        <button class="app-icon-button app-icon-button--danger" :aria-label="tr('Delete element')" :disabled="busy" @click="removeElement">
          <Trash2 :size="17" />
        </button>
        <button class="app-icon-button" :aria-label="tr('Close')" @click="emit('close')">
          <X :size="17" />
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-6 pt-5">
      <div class="rounded-ios bg-surface-1 p-4 shadow-ios-pill">
        <p class="mb-2 text-meta font-medium text-text-muted">{{ tr('Aliases') }}</p>
        <AliasInput
          :model-value="aliases"
          :name="element.name"
          @update:model-value="saveAliases"
        />
        <p v-if="!aliases.length" class="mt-1.5 text-meta text-text-muted">{{ tr('No aliases yet') }}</p>
      </div>

      <div class="rounded-ios bg-surface-1 p-4 shadow-ios-pill">
        <p class="text-meta font-medium text-text-muted">{{ tr('Current state') }}</p>
        <p class="mt-1 text-caption leading-relaxed text-text-primary">
          {{ currentState?.summary || tr('No state recorded at this chapter yet') }}
        </p>
        <div class="mt-2 flex flex-wrap gap-1.5">
          <span v-if="currentState?.location" class="rounded-full bg-surface-2 px-2.5 py-1 text-meta text-text-secondary">{{ currentState.location }}</span>
          <span v-if="currentState?.time" class="rounded-full bg-surface-2 px-2.5 py-1 text-meta text-text-secondary">{{ currentState.time }}</span>
          <span v-if="latest && latest.chapterIndex !== props.chapterIndex" class="rounded-full bg-warning-subtle px-2.5 py-1 text-meta text-warning">
            {{ tr('Latest state') }} · {{ formatChapterLabel(latest.chapterIndex) }}
          </span>
        </div>
      </div>

      <div v-if="props.element.kind === 'character'" class="rounded-ios bg-surface-1 p-4 shadow-ios-pill">
        <p class="mb-2 text-meta font-medium text-text-muted">{{ tr('Character profile') }}</p>
        <div class="flex flex-wrap items-center gap-1.5">
          <button
            v-for="option in characterOptions"
            :key="option.value"
            type="button"
            class="capsule h-8 px-3 text-meta"
            :class="(linkedCharacter?.id ?? '') === option.value ? 'bg-accent-subtle text-accent' : 'bg-surface-2'"
            :disabled="busy"
            @click="setCharacter(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div class="rounded-ios bg-surface-1 p-4 shadow-ios-pill">
        <p class="mb-2 text-meta font-medium text-text-muted">{{ tr('Status') }}</p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="option in statusOptions"
            :key="option.value"
            type="button"
            class="capsule h-8 px-3 text-meta"
            :class="currentStatus === option.value ? 'bg-accent-subtle text-accent' : 'bg-surface-2'"
            :disabled="busy"
            @click="changeStatus(option.value)"
          >
            {{ option.label }}
          </button>
          <span
            v-if="statusIsStoredButInvalid"
            class="capsule h-8 cursor-default bg-warning-subtle px-3 text-meta text-warning"
            :title="tr('Stored status is not valid for this element kind')"
          >
            {{ tr(currentStatus || '') }}
          </span>
        </div>
      </div>

      <div>
        <p class="mb-2 flex items-center justify-between gap-1.5 text-meta font-medium text-text-muted">
          <span class="flex items-center gap-1.5">
            <CalendarClock :size="13" />
            {{ tr('State timeline') }}
          </span>
          <button class="text-meta text-accent disabled:opacity-40" :disabled="busy" @click="retargetToTimeline">
            {{ tr('Move here') }}
          </button>
        </p>
        <ol class="space-y-2">
          <li
            v-for="state in sortedStates"
            :key="state.id"
            class="rounded-ios bg-surface-1 p-3 shadow-ios-pill transition-colors"
            :class="state.chapterIndex === currentState?.chapterIndex ? 'ring-2 ring-inset ring-accent/30' : ''"
          >
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                class="rounded-full bg-surface-2 px-2.5 py-0.5 text-meta font-medium text-text-secondary transition-colors hover:bg-accent-subtle hover:text-accent"
                @click="openStateChapter(state)"
              >
                {{ state.chapterIndex < 0 ? tr('Before story') : formatChapterLabel(state.chapterIndex) }}
              </button>
              <span v-if="state.status" class="rounded-full bg-accent-subtle px-2 py-0.5 text-meta text-accent">{{ tr(state.status) }}</span>
              <span v-if="state.location" class="text-meta text-text-muted">@{{ state.location }}</span>
              <span v-if="state.time" class="text-meta text-text-muted">{{ state.time }}</span>
              <span v-if="!isStatusValidForKind(element.kind, state.status)" class="text-meta text-warning">{{ tr('status not valid for this kind') }}</span>
            </div>
            <p class="mt-1.5 text-meta leading-relaxed text-text-secondary">{{ state.summary }}</p>
            <div class="mt-1.5 flex flex-wrap items-center gap-1">
              <span class="mr-1 text-meta text-text-muted">{{ tr('Move to') }}</span>
              <button
                v-for="(chapter, index) in chapters"
                :key="`${state.id}-${chapter.id}`"
                class="h-6 min-w-6 rounded-full px-1.5 text-meta font-semibold transition-colors"
                :class="index === state.chapterIndex ? 'bg-accent text-text-inverse' : 'bg-surface-2 text-text-muted hover:bg-accent-subtle hover:text-accent'"
                :title="formatChapterLabel(index)"
                @click="moveStateTo(state, index)"
              >
                {{ index + 1 }}
              </button>
            </div>
          </li>
        </ol>
      </div>

      <ElementConflictReview
        v-if="proposalConflicts.length"
        :conflicts="proposalConflicts"
        :busy="busy"
        @accept="conflict => proposalConflicts = proposalConflicts.filter(item => item.id !== conflict.id)"
        @discard="proposalConflicts = []"
      />

      <ElementProposalList
        v-if="proposals.length"
        :proposals="proposals"
        :busy="busy"
        @apply="applyProposals"
        @discard="proposals = []"
      />
    </div>

    <footer v-if="chapters.length" class="flex shrink-0 items-center gap-2 px-4 pb-3">
      <select
        v-model="syncChapterId"
        class="h-9 min-w-0 flex-1 rounded-full bg-surface-2 px-3.5 text-meta text-text-primary outline-none"
      >
        <option v-for="chapter in chapters" :key="chapter.id" :value="chapter.id">{{ chapter.index + 1 }}. {{ chapter.title }}</option>
      </select>
      <BaseButton variant="secondary" size="sm" :loading="syncing" @click="syncFromChapter">
        <RefreshCw :size="15" />
        <span>{{ tr('Check chapter') }}</span>
      </BaseButton>
    </footer>
  </div>
</template>
