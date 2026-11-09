<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Eye, FolderDown, Save, Sparkles, X } from 'lucide-vue-next'
import StudioViewHeader from './StudioViewHeader.vue'
import { useStoryProject, useStudioActions, countWords, elementContextCapsules } from '@/app'
import { useToast } from '@/composables/useToast'
import { EXPORT_FORMATS, useProjectExport } from '@/composables/useProjectExport'
import { translatePhrase } from '@/i18n'
import type { DropdownItem } from '@/components/ui/dropdown'
import type { StudioView } from './StudioViewHeader.vue'

const props = defineProps<{ projectId?: string | null; inert?: boolean }>()
const emit = defineEmits<{
  openChapter: [chapterId: string]
  openCharacter: [characterId: string]
  switchView: [view: StudioView]
}>()

const tr = translatePhrase
const projectStore = useStoryProject()
const actions = useStudioActions()
const toast = useToast()
const { exportFormat } = useProjectExport()

const project = computed(() =>
  props.projectId ? projectStore.getProjectById(props.projectId) : projectStore.activeProject,
)
const outline = ref('')
const savedOutline = ref('')
const expanding = ref(false)
const savingOutline = ref(false)
const panel = ref<'cast' | 'context' | 'chapters' | null>(null)
const outlineHeight = ref('320px')
const outlineEl = ref<HTMLTextAreaElement | null>(null)
let saveTimer: ReturnType<typeof setTimeout> | null = null

function syncOutlineHeight() {
  const el = outlineEl.value
  if (!el) return
  el.style.height = 'auto'
  const height = Math.max(280, Math.min(560, el.scrollHeight))
  el.style.height = `${height}px`
  el.style.overflowY = el.scrollHeight > height ? 'auto' : 'hidden'
  outlineHeight.value = `${height}px`
}

watch(project, value => {
  outline.value = value?.outline ?? ''
  savedOutline.value = outline.value
}, { immediate: true })

watch(outline, () => {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => void saveOutline(), 900)
  nextTick(syncOutlineHeight)
})

watch(() => project.value?.id, () => nextTick(syncOutlineHeight))

async function saveOutline() {
  if (!project.value || outline.value === project.value.outline) return
  savingOutline.value = true
  try {
    const saved = await projectStore.updateProject(project.value.id, { outline: outline.value })
    if (saved) savedOutline.value = outline.value
  } finally {
    savingOutline.value = false
  }
}

async function expandOutline() {
  if (!project.value || expanding.value) return
  expanding.value = true
  try {
    outline.value = await actions.expandStoryOutline({ seed: outline.value })
    await saveOutline()
    toast.success('Outline expanded')
  } catch (error: any) {
    toast.error(error?.message || 'Outline generation failed')
  } finally {
    expanding.value = false
  }
}

const outlineDirty = computed(() => outline.value !== savedOutline.value)
const outlineWords = computed(() => countWords(outline.value))
const chapters = computed(() => project.value?.chapters ?? [])
const currentChapterId = computed(() => chapters.value[0]?.id ?? null)

const contextCapsules = computed(() =>
  elementContextCapsules(project.value?.elements, Math.max(0, chapters.value.length - 1), 6),
)

const cast = computed(() => project.value?.characters ?? [])

const relationships = computed(() => {
  const characters = project.value?.characters ?? []
  const seen = new Set<string>()
  const rows: Array<{ id: string; from: string; to: string; relation: string }> = []
  for (const character of characters) {
    for (const relation of character.relations ?? []) {
      const target = characters.find(item => item.id === relation.targetId)
      if (!target) continue
      const key = [character.id, target.id].sort().join('|')
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ id: key, from: character.name, to: target.name, relation: relation.relation })
    }
  }
  return rows
})

const chapterStructure = computed(() => chapters.value.map(chapter => ({
  id: chapter.id,
  label: `${chapter.index + 1}. ${chapter.title}`,
  action: () => emit('openChapter', chapter.id),
})))

const headerActions = computed<DropdownItem[]>(() => [
  { heading: 'Story bible' },
  { label: 'Cast', checked: panel.value === 'cast', disabled: !cast.value.length, action: () => { panel.value = panel.value === 'cast' ? null : 'cast' } },
  { label: 'In context', checked: panel.value === 'context', action: () => { panel.value = panel.value === 'context' ? null : 'context' } },
  { divider: true },
  { heading: 'Outline' },
  { label: 'Expand outline', icon: Sparkles, disabled: expanding.value, action: () => void expandOutline() },
  { label: 'Save outline', checked: !outlineDirty.value, disabled: !outlineDirty.value, action: () => void saveOutline() },
  { divider: true },
  { heading: 'Chapters' },
  { label: 'Chapter structure', icon: FolderDown, checked: panel.value === 'chapters', disabled: !chapterStructure.value.length, action: () => { panel.value = panel.value === 'chapters' ? null : 'chapters' } },
  { divider: true },
  { heading: 'Export' },
  ...EXPORT_FORMATS.map(format => ({
    label: format.label,
    icon: FolderDown,
    disabled: !project.value,
    action: () => { if (project.value) void exportFormat(project.value, format.id) },
  })),
])

onMounted(() => nextTick(syncOutlineHeight))

onBeforeUnmount(() => {
  if (saveTimer) clearTimeout(saveTimer)
  void saveOutline()
})
</script>

<template>
  <div v-if="project" class="flex h-full min-h-0 flex-col" :inert="inert">
    <StudioViewHeader
      view="story"
      :title="project.name"
      :meta="`${outlineWords} ${tr('words')} · ${savingOutline ? tr('Saving') : outlineDirty ? tr('Unsaved') : tr('Saved')}`"
      :menu-items="headerActions"
      @update:view="emit('switchView', $event)"
    >
      <template #actions>
        <button class="app-key-action h-9 gap-1.5 px-3.5 text-caption" :disabled="savingOutline || !outlineDirty" @click="saveOutline">
          <Save :size="15" />
          <span>{{ tr('Save') }}</span>
        </button>
      </template>
    </StudioViewHeader>

    <div class="relative min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
      <div
        v-if="panel"
        class="absolute right-4 top-3 z-30 w-[min(360px,calc(100%-2rem))] rounded-ios border border-line bg-surface-1 p-3 shadow-ios-lg"
      >
        <div class="mb-2 flex items-center justify-between gap-2">
          <p class="text-meta font-medium text-text-muted">
            {{ panel === 'cast' ? tr('Cast') : panel === 'context' ? tr('In context') : tr('Chapter structure') }}
          </p>
          <button class="app-icon-button h-7 w-7" :aria-label="tr('Close')" @click="panel = null">
            <X :size="15" />
          </button>
        </div>
        <div v-if="panel === 'cast'" class="flex flex-wrap items-center gap-1.5">
          <span
            v-for="character in cast"
            :key="character.id"
            class="capsule h-8 bg-surface-2 px-2.5 text-meta"
            :title="character.currentState"
            @click="emit('openCharacter', character.id)"
          >
            <span class="font-medium text-text-primary">{{ character.name }}</span>
            <span class="text-text-muted">{{ tr(character.role) }}</span>
          </span>
        </div>
        <div v-else-if="panel === 'context'" class="flex flex-wrap items-center gap-1.5">
          <button
            v-for="entry in contextCapsules.items"
            :key="entry.element.id"
            class="capsule h-8 bg-surface-2 px-2.5 text-meta"
            :title="entry.state.summary"
            @click="currentChapterId && emit('openChapter', currentChapterId)"
          >
            <span class="font-medium text-text-primary">{{ entry.element.name }}</span>
            <span v-if="entry.state.status" class="text-text-muted">{{ tr(entry.state.status) }}</span>
          </button>
          <span v-if="contextCapsules.hiddenCount" class="text-meta text-text-muted">+{{ contextCapsules.hiddenCount }}</span>
          <span v-if="!contextCapsules.items.length" class="text-meta text-text-muted">{{ tr('No element state at this chapter') }}</span>
        </div>
        <div v-else class="space-y-1">
          <button
            v-for="chapter in chapters"
            :key="chapter.id"
            class="flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-caption text-text-secondary hover:bg-surface-2"
            @click="emit('openChapter', chapter.id)"
          >
            <Eye :size="14" class="shrink-0 text-text-muted" />
            <span class="truncate">{{ chapter.index + 1 }}. {{ chapter.title }}</span>
          </button>
        </div>
      </div>

      <textarea
        ref="outlineEl"
        v-model="outline"
        class="w-full resize-none rounded-ios-lg bg-surface-1 px-6 py-5 text-base leading-[1.75] text-text-primary shadow-ios-pill outline-none transition-shadow placeholder:text-text-muted focus:ring-2 focus:ring-inset focus:ring-accent/30"
        :style="{ height: outlineHeight }"
        :placeholder="tr('Write the story blueprint. The copilot expands it on request.')"
      />

      <footer v-if="relationships.length" class="mt-3 flex flex-wrap items-center gap-1.5">
        <span class="text-meta font-medium text-text-muted">{{ tr('Relationships') }}</span>
        <span v-for="row in relationships.slice(0, 5)" :key="row.id" class="capsule h-8 bg-surface-2 px-2.5 text-meta">
          <span class="font-medium text-text-primary">{{ row.from }}</span>
          <span class="text-text-muted">{{ row.relation }}</span>
          <span class="font-medium text-text-primary">{{ row.to }}</span>
        </span>
      </footer>
    </div>
  </div>
</template>
