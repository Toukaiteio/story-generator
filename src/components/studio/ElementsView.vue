<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus, UserRound } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSegmented from '@/components/ui/BaseSegmented.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import ElementDetail from './ElementDetail.vue'
import { useStoryProject, useStudioActions, describeElement, type ElementKind } from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'

const emit = defineEmits<{ openCharacter: [characterId: string] }>()
const tr = translatePhrase

const projectStore = useStoryProject()
const actions = useStudioActions()
const toast = useToast()

const kindFilter = ref('all')
const selectedId = ref<string | null>(null)
const adding = ref(false)
const newKind = ref<ElementKind>('character')
const newName = ref('')
const busy = ref(false)

const kindOptions = [
  { label: 'All', value: 'all' },
  { label: 'People', value: 'character' },
  { label: 'Events', value: 'event' },
  { label: 'Threads', value: 'thread' },
  { label: 'Places', value: 'location' },
  { label: 'Things', value: 'object' },
]

const kindChips: ElementKind[] = ['character', 'event', 'thread', 'location', 'object']

const elements = computed(() => projectStore.activeProject?.elements ?? [])
const filtered = computed(() =>
  kindFilter.value === 'all'
    ? elements.value
    : elements.value.filter(item => item.kind === kindFilter.value),
)
const selected = computed(() => elements.value.find(item => item.id === selectedId.value) ?? null)

function linkedCharacterId(kind: ElementKind, name: string, characterId?: string) {
  if (characterId) return characterId
  if (kind !== 'character') return undefined
  return projectStore.activeProject?.characters.find(item => item.name === name)?.id
}

async function addElement() {
  if (!newName.value.trim() || busy.value) return
  busy.value = true
  try {
    await actions.addElement({
      kind: newKind.value,
      name: newName.value.trim(),
      characterId: newKind.value === 'character'
        ? projectStore.activeProject?.characters.find(item => item.name === newName.value.trim())?.id
        : undefined,
    })
    newName.value = ''
    adding.value = false
  } catch (error: any) {
    toast.error(error?.message || 'Failed to add element')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex h-full min-h-0">
    <div class="flex min-w-0 flex-1 flex-col p-4">
      <div class="flex items-center justify-between gap-3">
        <BaseSegmented v-model="kindFilter" :options="kindOptions" />
        <BaseButton variant="secondary" size="sm" @click="adding = !adding">
          <Plus :size="13" />
        </BaseButton>
      </div>

      <div v-if="adding" class="mt-3 flex items-center gap-2">
        <BaseSegmented v-model="newKind" size="sm" :options="kindChips.map(kind => ({ label: kind, value: kind }))" />
        <BaseInput
          v-model="newName"
          class="max-w-56"
          :placeholder="tr('Name')"
          @keydown.enter="addElement"
        />
        <BaseButton variant="primary" size="sm" :loading="busy" @click="addElement">
          {{ tr('Add') }}
        </BaseButton>
      </div>

      <div class="mt-3 grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(210px,1fr))] content-start gap-2.5 overflow-y-auto pr-1">
        <button
          v-for="element in filtered"
          :key="element.id"
          type="button"
          class="rounded-2xl border p-3 text-left transition-colors"
          :class="selectedId === element.id
            ? 'border-accent/60 bg-accent-subtle/40'
            : 'border-surface-4 bg-surface-1 hover:border-surface-5'"
          @click="selectedId = element.id"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="truncate text-sm font-semibold text-text-primary">{{ element.name }}</span>
            <BaseTag size="sm" :variant="element.kind === 'character' ? 'accent' : element.kind === 'thread' ? 'warning' : 'default'">
              {{ element.kind }}
            </BaseTag>
          </div>
          <p class="mt-1 line-clamp-2 text-xs leading-relaxed text-text-secondary">{{ describeElement(element) || tr('No state yet') }}</p>
        </button>

        <div v-if="!filtered.length" class="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-surface-4 py-14 text-text-muted">
          <UserRound :size="22" />
          <p class="mt-2 text-xs">{{ tr('Nothing tracked yet') }}</p>
        </div>
      </div>
    </div>

    <aside v-if="selected" class="w-96 shrink-0 border-l border-surface-3 bg-surface-1">
      <ElementDetail
        :element="selected"
        :character-id="linkedCharacterId(selected.kind, selected.name, selected.characterId)"
        @close="selectedId = null"
        @open-character="emit('openCharacter', $event)"
      />
    </aside>
  </div>
</template>
