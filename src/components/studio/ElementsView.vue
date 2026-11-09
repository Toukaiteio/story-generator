<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ChevronDown, Plus, Search, Shapes } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSegmented from '@/components/ui/BaseSegmented.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseDropdown from '@/components/ui/BaseDropdown.vue'
import type { DropdownItem } from '@/components/ui/dropdown'
import AliasInput from './AliasInput.vue'
import ElementDetail from './ElementDetail.vue'
import CharacterDetail from '@/components/character/CharacterDetail.vue'
import ElementConflictReview from './ElementConflictReview.vue'
import StudioViewHeader from './StudioViewHeader.vue'
import {
  useStoryProject,
  useStudioActions,
  useWorkspaceUi,
  elementStateAt,
  isStatusValidForKind,
  detectElementConflicts,
  resolveConflictKeepingLatest,
  type ElementKind,
  type ElementStateConflict,
} from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase, formatChapterLabel } from '@/i18n'
import { normalizeElementAliases } from '@/app'
import type { StoryElement } from '@/types/element'
import type { StudioView } from './StudioViewHeader.vue'

const props = defineProps<{ activeElementId: string | null; inert?: boolean }>()
const emit = defineEmits<{
  openElement: [elementId: string]
  openChapter: [chapterId: string]
  switchView: [view: StudioView]
}>()

const tr = translatePhrase
const projectStore = useStoryProject()
const actions = useStudioActions()
const ui = useWorkspaceUi()
const toast = useToast()

const kindFilter = ref<'all' | ElementKind>('all')
const search = ref('')
const adding = ref(false)
const newKind = ref<ElementKind>('character')
const newName = ref('')
const newAliases = ref<string[]>([])
const busy = ref(false)
const characterDrawerId = ref<string | null>(null)
const timelineOpen = ref(false)

const kindOptions = computed(() => [
  { label: tr('All'), value: 'all' },
  { label: tr('People'), value: 'character' },
  { label: tr('Events'), value: 'event' },
  { label: tr('Threads'), value: 'thread' },
  { label: tr('Places'), value: 'location' },
  { label: tr('Objects'), value: 'object' },
])

const kindChips: ElementKind[] = ['character', 'event', 'thread', 'location', 'object']

const project = computed(() => projectStore.activeProject)
const chapters = computed(() => project.value?.chapters ?? [])
const elements = computed(() => project.value?.elements ?? [])

const timelineIndex = computed(() => {
  const stored = ui.elementTimelineChapter
  if (typeof stored === 'number') return Math.max(0, Math.min(stored, Math.max(0, chapters.value.length - 1)))
  return Math.max(0, chapters.value.length - 1)
})

watch(() => ui.workspaceCharacterId, id => {
  characterDrawerId.value = id
}, { immediate: true })

watch(chapters, () => {
  if (ui.elementTimelineChapter === null && chapters.value.length) {
    ui.elementTimelineChapter = Math.max(0, chapters.value.length - 1)
  }
})

function openChapter(chapterId: string) {
  if (!chapterId) return
  ui.workspaceChapterId = chapterId
  ui.workspaceView = 'manuscript'
}

function setTimeline(value: number) {
  ui.elementTimelineChapter = Number(value)
}

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  return elements.value.filter(item => {
    if (kindFilter.value !== 'all' && item.kind !== kindFilter.value) return false
    if (!term) return true
    const state = elementStateAt(item, timelineIndex.value)
    return `${item.name} ${state?.summary ?? ''} ${state?.location ?? ''}`.toLowerCase().includes(term)
  })
})

const selected = computed(() =>
  elements.value.find(item => item.id === props.activeElementId) ?? null,
)

const timelineChapterLabel = computed(() => {
  const chapter = chapters.value[timelineIndex.value]
  return chapter ? `${formatChapterLabel(chapter.index)} · ${chapter.title}` : tr('No chapters')
})

const linkedCharacterId = computed(() => {
  const element = selected.value
  if (!element) return undefined
  if (element.characterId) return element.characterId
  if (element.kind !== 'character') return undefined
  return project.value?.characters.find(item => item.name === element.name)?.id
})

function stateSummary(element: { id: string; states: StoryElement['states'] }, index: number) {
  const state = elementStateAt(element as any, index)
  if (!state) return tr('Not present at this chapter')
  return state.summary
}

function statusOf(element: { kind: ElementKind; states: StoryElement['states'] }, index: number) {
  const state = elementStateAt(element as any, index)
  if (!state?.status) return null
  return isStatusValidForKind(element.kind, state.status) ? tr(state.status) : `${tr(state.status)} · ${tr('not valid for this kind')}`
}

const conflicts = computed(() =>
  detectElementConflicts(elements.value)
    .filter(conflict => !dismissedConflictIds.value.includes(conflict.id)),
)

const conflictReviewOpen = ref(false)
const dismissedConflictIds = ref<string[]>([])

async function keepLatest(conflict: ElementStateConflict) {
  if (!project.value || busy.value) return
  busy.value = true
  try {
    const next = resolveConflictKeepingLatest(elements.value, conflict)
    await projectStore.updateProject(project.value.id, { elements: next })
    dismissedConflictIds.value = [...dismissedConflictIds.value, conflict.id]
    toast.success('Timeline conflict resolved')
  } catch (error: any) {
    toast.error(error?.message || 'Failed to resolve conflict')
  } finally {
    busy.value = false
  }
}

async function addElement() {
  if (!newName.value.trim() || busy.value) return
  busy.value = true
  try {
    await actions.addElement({
      kind: newKind.value,
      name: newName.value.trim(),
      aliases: normalizeElementAliases(newAliases.value, newName.value.trim()),
      characterId: newKind.value === 'character'
        ? project.value?.characters.find(item => item.name === newName.value.trim())?.id
        : undefined,
    })
    newName.value = ''
    newAliases.value = []
    adding.value = false
  } catch (error: any) {
    toast.error(error?.message || 'Failed to add element')
  } finally {
    busy.value = false
  }
}

async function syncChapter() {
  const chapter = chapters.value[timelineIndex.value]
  if (!chapter?.content.trim() || busy.value) return
  busy.value = true
  try {
    const proposals = await actions.proposeElementStates(chapter.id)
    if (!proposals.length) {
      toast.info('No element changes found')
      return
    }
    await actions.applyElementProposals(proposals)
    toast.success(`Applied ${proposals.length} element updates`)
  } catch (error: any) {
    toast.error(error?.message || 'Element sync failed')
  } finally {
    busy.value = false
  }
}

const kindMenu = computed<DropdownItem[]>(() =>
  kindOptions.value.map(option => ({
    label: option.label,
    checked: kindFilter.value === option.value,
    action: () => { kindFilter.value = option.value as 'all' | ElementKind },
  })),
)

const headerActions = computed<DropdownItem[]>(() => [
  { heading: 'Timeline' },
  { label: 'Choose story time', checked: timelineOpen.value, action: () => { timelineOpen.value = !timelineOpen.value } },
  { label: `${timelineChapterLabel.value}`, disabled: true },
  ...(conflicts.value.length
    ? [{ label: `${conflicts.value.length} ${tr('timeline conflicts')}`, action: () => { conflictReviewOpen.value = !conflictReviewOpen.value } }]
    : []),
  { divider: true },
  { heading: 'Elements' },
  { label: 'Sync this chapter', icon: Shapes, disabled: busy.value || !chapters.value[timelineIndex.value]?.content.trim(), action: () => void syncChapter() },
])
</script>

<template>
  <div class="flex h-full min-h-0" :inert="inert">
    <div class="flex min-w-0 flex-1 flex-col pb-4">
      <StudioViewHeader
        view="elements"
        :title="kindFilter === 'all' ? tr('All elements') : tr(kindOptions.find(option => option.value === kindFilter)?.label ?? 'All elements')"
        :meta="`${filtered.length}/${elements.length}`"
        :menu-items="headerActions"
        @update:view="emit('switchView', $event)"
      >
        <template #actions>
          <div class="flex shrink-0 items-center gap-1.5">
            <BaseInput
              v-model="search"
              class="w-44"
              :icon="Search"
              :placeholder="tr('Search elements')"
            />
            <BaseDropdown :items="kindMenu" :width="180">
              <template #trigger>
                <div class="capsule h-9 gap-1.5 px-3">
                  <span>{{ kindOptions.find(option => option.value === kindFilter)?.label }}</span>
                  <ChevronDown :size="13" class="text-text-muted" />
                </div>
              </template>
            </BaseDropdown>
            <button class="app-key-action h-9 gap-1.5 px-3.5 text-caption" @click="adding = !adding">
              <Plus :size="16" />
              <span>{{ tr('New element') }}</span>
            </button>
          </div>
        </template>
      </StudioViewHeader>

      <div v-if="timelineOpen" class="mx-4 mt-3 rounded-ios bg-surface-2/70 px-4 py-2.5">
        <div class="flex items-center justify-between gap-2">
          <p class="text-meta font-medium text-text-primary">{{ timelineChapterLabel }}</p>
          <button
            v-if="conflicts.length"
            class="capsule h-7 bg-warning-subtle px-2.5 text-meta text-warning"
            @click="conflictReviewOpen = !conflictReviewOpen"
          >
            {{ conflicts.length }} {{ tr('timeline conflicts') }}
          </button>
        </div>
        <input
          type="range"
          min="0"
          :max="Math.max(0, chapters.length - 1)"
          :value="timelineIndex"
          class="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-4 accent-accent"
          @input="setTimeline(Number(($event.target as HTMLInputElement).value))"
        >
        <div class="mt-1 flex justify-between text-meta text-text-muted">
          <span>{{ chapters[0] ? formatChapterLabel(chapters[0].index) : '' }}</span>
          <span>{{ chapters.length ? formatChapterLabel(chapters[chapters.length - 1].index) : '' }}</span>
        </div>
      </div>

      <div v-if="conflictReviewOpen && conflicts.length" class="mx-4 mt-3">
        <ElementConflictReview
          :conflicts="conflicts"
          :busy="busy"
          @accept="keepLatest"
          @open-chapter="index => chapters[index] && openChapter(chapters[index].id)"
          @discard="conflictReviewOpen = false"
        />
      </div>

      <div v-if="adding" class="mt-3 flex flex-wrap items-center gap-2 px-4">
        <BaseSegmented v-model="newKind" size="sm" :options="kindChips.map(kind => ({ label: tr(kind), value: kind }))" />
        <BaseInput
          v-model="newName"
          class="max-w-60"
          :placeholder="tr('Name')"
          @keydown.enter="addElement"
        />
        <AliasInput
          v-model="newAliases"
          class="w-56"
          :name="newName"
          :placeholder="tr('Add alias')"
        />
        <BaseButton variant="primary" size="sm" :loading="busy" :disabled="!newName.trim()" @click="addElement">
          {{ tr('Add') }}
        </BaseButton>
      </div>

      <div class="mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-5">
        <div class="grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(228px,1fr))] content-start gap-2.5">
          <button
            v-for="element in filtered"
            :key="element.id"
            type="button"
            class="rounded-ios border border-transparent bg-surface-1 p-3.5 text-left shadow-ios-pill transition-colors hover:border-accent/40"
            :class="selected?.id === element.id ? 'ring-2 ring-inset ring-accent/40' : ''"
            @click="emit('openElement', element.id)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="truncate text-caption font-semibold text-text-primary">{{ element.name }}</span>
              <span class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-meta text-text-secondary">{{ tr(element.kind) }}</span>
            </div>
            <p class="mt-1.5 line-clamp-2 text-meta leading-relaxed text-text-secondary">
              {{ stateSummary(element, timelineIndex) }}
            </p>
            <p class="mt-2 flex items-center gap-1.5 text-meta text-text-muted">
              <span>{{ statusOf(element, timelineIndex) || tr('no status') }}</span>
              <span>·</span>
              <span>{{ element.states.length }} {{ tr('states') }}</span>
            </p>
          </button>

          <div v-if="!filtered.length" class="col-span-full flex flex-col items-center justify-center gap-2 py-14 text-text-muted">
            <Shapes :size="22" />
            <p class="text-caption">{{ tr('No elements at this chapter') }}</p>
          </div>
        </div>
      </div>
    </div>

    <aside v-if="selected || characterDrawerId" class="w-[380px] max-w-full shrink-0 overflow-hidden rounded-ios-lg bg-surface-2/60">
      <ElementDetail
        v-if="selected && !characterDrawerId"
        :element="selected"
        :character-id="linkedCharacterId"
        :chapter-index="timelineIndex"
        @close="emit('openElement', '')"
        @open-character="characterDrawerId = $event"
        @open-chapter="openChapter"
      />
      <CharacterDetail
        v-else-if="characterDrawerId"
        :character-id="characterDrawerId"
        :chapter-index="timelineIndex"
        @close="characterDrawerId = null; ui.workspaceCharacterId = null"
        @open-chapter="openChapter"
        @open-character="characterDrawerId = $event"
      />
    </aside>
  </div>
</template>
