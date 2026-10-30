<script setup lang="ts">
import { computed, ref } from 'vue'
import { RefreshCw, Trash2, UserRound, X } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import { useStoryProject, useStudioActions, type ElementStatus } from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'

const props = defineProps<{
  element: { id: string; kind: string; name: string; characterId?: string; states: Array<{ id: string; chapterIndex: number; time?: string; location?: string; status?: ElementStatus; summary: string }> }
  characterId?: string
}>()

const emit = defineEmits<{ close: []; openCharacter: [characterId: string] }>()
const tr = translatePhrase

const projectStore = useStoryProject()
const actions = useStudioActions()
const toast = useToast()

const busy = ref(false)
const syncing = ref(false)
const proposals = ref<Array<{ name: string; kind: string; summary: string; status?: string; location?: string; time?: string }>>([])

const chapters = computed(() =>
  (projectStore.activeProject?.chapters ?? [])
    .filter(chapter => chapter.content.trim())
    .map(chapter => ({ label: `${chapter.index + 1}. ${chapter.title}`, value: chapter.id })),
)
const syncChapterId = ref(chapters.value[chapters.value.length - 1]?.value ?? '')

const statusOptions: Array<{ label: string; value: ElementStatus }> = [
  { label: 'Active', value: 'active' },
  { label: 'Changed', value: 'changed' },
  { label: 'Planted', value: 'planted' },
  { label: 'Advanced', value: 'advanced' },
  { label: 'Paid', value: 'paid' },
  { label: 'Resolved', value: 'resolved' },
]

const latestStatus = computed(() => props.element.states[props.element.states.length - 1]?.status ?? 'active')

async function syncFromChapter() {
  if (!syncChapterId.value || syncing.value) return
  syncing.value = true
  proposals.value = []
  try {
    const result = await actions.proposeElementStates(syncChapterId.value)
    proposals.value = result
      .filter(item => !item.elementId || item.elementId === props.element.id || item.name === props.element.name)
      .map(item => ({
        name: item.name,
        kind: item.kind,
        summary: item.state.summary,
        status: item.state.status,
        location: item.state.location,
        time: item.state.time,
      }))
    if (!proposals.value.length) toast.info('No changes found in that chapter.')
  } catch (error: any) {
    toast.error(error?.message || 'Sync failed')
  } finally {
    syncing.value = false
  }
}

async function applyProposals() {
  if (!proposals.value.length || busy.value) return
  busy.value = true
  try {
    await actions.applyElementProposals(proposals.value.map(item => ({
      elementId: item.name === props.element.name ? props.element.id : undefined,
      name: item.name,
      kind: item.kind as any,
      state: {
        chapterIndex: projectStore.activeProject?.chapters.find(ch => ch.id === syncChapterId.value)?.index ?? 0,
        summary: item.summary,
        status: item.status as ElementStatus | undefined,
        location: item.location,
        time: item.time,
      },
    })))
    proposals.value = []
    toast.success('Element updated')
  } catch (error: any) {
    toast.error(error?.message || 'Apply failed')
  } finally {
    busy.value = false
  }
}

async function changeStatus(status: ElementStatus) {
  if (busy.value) return
  await actions.setElementStatus(props.element.id, status)
}

async function removeElement() {
  if (busy.value) return
  await actions.removeElement(props.element.id)
  emit('close')
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <header class="flex items-center justify-between gap-2 border-b border-surface-3 px-4 py-3">
      <div class="min-w-0">
        <p class="truncate text-sm font-bold text-text-primary">{{ element.name }}</p>
        <p class="text-2xs text-text-muted">{{ element.kind }}</p>
      </div>
      <div class="flex items-center gap-1">
        <BaseButton
          v-if="characterId"
          variant="ghost"
          size="sm"
          @click="emit('openCharacter', characterId)"
        >
          <UserRound :size="13" />
        </BaseButton>
        <BaseButton variant="ghost" size="sm" @click="removeElement">
          <Trash2 :size="13" />
        </BaseButton>
        <BaseButton variant="ghost" size="sm" @click="emit('close')">
          <X :size="13" />
        </BaseButton>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-4">
      <BaseSegmented
        :model-value="latestStatus"
        :options="statusOptions"
        :disabled="busy"
        @update:model-value="changeStatus($event as ElementStatus)"
      />

      <ol class="mt-4 space-y-2.5">
        <li
          v-for="state in [...element.states].reverse()"
          :key="state.id"
          class="rounded-2xl border border-surface-4 bg-surface-0 p-3"
        >
          <div class="flex items-center gap-2">
            <BaseTag size="sm" variant="default">{{ state.chapterIndex < 0 ? '—' : `Ch ${state.chapterIndex + 1}` }}</BaseTag>
            <BaseTag v-if="state.status" size="sm" variant="accent">{{ state.status }}</BaseTag>
            <span v-if="state.location" class="text-2xs text-text-muted">@{{ state.location }}</span>
            <span v-if="state.time" class="text-2xs text-text-muted">{{ state.time }}</span>
          </div>
          <p class="mt-1.5 text-xs leading-relaxed text-text-secondary">{{ state.summary }}</p>
        </li>
      </ol>

      <div v-if="proposals.length" class="mt-4 rounded-2xl border border-accent/30 bg-accent-subtle/30 p-3">
        <p class="text-2xs font-bold uppercase tracking-wider text-accent">{{ tr('Proposed') }}</p>
        <p v-for="(item, index) in proposals" :key="index" class="mt-2 text-xs leading-relaxed text-text-primary">
          <span class="font-semibold">{{ item.name }}</span>
          <template v-if="item.status"> · {{ item.status }}</template>
          <template v-if="item.location"> · @{{ item.location }}</template>
          — {{ item.summary }}
        </p>
        <div class="mt-3 flex justify-end gap-1.5">
          <BaseButton variant="ghost" size="sm" @click="proposals = []">{{ tr('Discard') }}</BaseButton>
          <BaseButton variant="primary" size="sm" :loading="busy" @click="applyProposals">{{ tr('Apply') }}</BaseButton>
        </div>
      </div>
    </div>

    <footer v-if="chapters.length" class="flex items-center gap-2 border-t border-surface-3 px-4 py-3">
      <select
        v-model="syncChapterId"
        class="h-7 min-w-0 flex-1 rounded-full border border-surface-4 bg-surface-2 px-3 text-xs text-text-primary outline-none"
      >
        <option v-for="chapter in chapters" :key="chapter.value" :value="chapter.value">{{ chapter.label }}</option>
      </select>
      <BaseButton variant="secondary" size="sm" :loading="syncing" @click="syncFromChapter">
        <RefreshCw :size="13" />
      </BaseButton>
    </footer>
  </div>
</template>
