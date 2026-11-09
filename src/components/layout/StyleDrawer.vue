<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Check, Download, Pencil, Plus, Search, Sparkles, Trash2, Upload } from 'lucide-vue-next'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import {
  useStoryProject,
  useWritingStyleLibrary,
  countStyleLibrary,
  buildWritingStyleSnapshot,
} from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import type { WritingStyle } from '@/types/writingStyle'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const tr = translatePhrase
const styles = useWritingStyleLibrary()
const projectStore = useStoryProject()
const toast = useToast()

const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})

const search = ref('')
const editorOpen = ref(false)
const editingId = ref<string | null>(null)
const pendingDeleteId = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const form = reactive({ name: '', content: '' })
const isBuiltIn = ref(false)

const counts = computed(() => countStyleLibrary(styles.styles))

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return styles.styles
  return styles.styles.filter(style =>
    `${style.name} ${style.description} ${style.tags.join(' ')}`.toLowerCase().includes(term),
  )
})

const activeProject = computed(() => projectStore.activeProject)
const activeStyleId = computed(() => activeProject.value?.styleId || 'default')

function openCreate() {
  editingId.value = null
  isBuiltIn.value = false
  form.name = ''
  form.content = ''
  editorOpen.value = true
}

function openEdit(style: WritingStyle) {
  editingId.value = style.id
  isBuiltIn.value = style.isBuiltIn
  form.name = style.name
  form.content = style.content
  editorOpen.value = true
}

function saveStyle() {
  if (!form.name.trim()) {
    toast.warning('Style name is required')
    return
  }
  if (editingId.value) {
    styles.updateStyle(editingId.value, { name: form.name.trim(), content: form.content })
    toast.success('Style updated')
  } else {
    styles.createStyle({
      name: form.name.trim(),
      description: '',
      content: form.content,
      source: 'manual',
      tags: [],
    })
    toast.success('Style created')
  }
  editorOpen.value = false
}

async function useStyle(styleId: string) {
  const project = activeProject.value
  if (!project) {
    toast.warning('Open a project first')
    return
  }
  const style = styles.getStyleById(styleId)
  const content = styles.resolveStyleContent(styleId) || project.style
  await projectStore.updateProject(project.id, {
    styleId,
    style: content,
    writingStyleSnapshot: buildWritingStyleSnapshot(style, content),
  })
  toast.success('Writing style applied')
}

function confirmDelete() {
  if (!pendingDeleteId.value) return
  const project = activeProject.value
  if (project && project.styleId === pendingDeleteId.value) {
    void projectStore.updateProject(project.id, { styleId: 'default', style: '', writingStyleSnapshot: null })
  }
  styles.deleteStyle(pendingDeleteId.value)
  pendingDeleteId.value = null
  toast.success('Style deleted')
}

function exportStyle(style: WritingStyle) {
  const blob = new Blob([JSON.stringify(style, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `style-${style.name.toLowerCase().replace(/\s+/g, '-')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function importStyle(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  try {
    const data = JSON.parse(await file.text())
    if (!data?.name || !data?.content) throw new Error('Invalid style file')
    createStyleFromFile(data)
    toast.success('Style imported')
  } catch (error: any) {
    toast.error(error?.message || 'Import failed')
  } finally {
    target.value = ''
  }
}

function createStyleFromFile(data: any) {
  styles.createStyle({
    name: `${data.name}`,
    description: data.description || '',
    content: data.content,
    source: 'manual',
    tags: Array.isArray(data.tags) ? data.tags : [],
  })
}
</script>

<template>
  <BaseDrawer v-model="open" :title="tr('Writing styles')" width="480px" flush>
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex shrink-0 items-center gap-2 px-5 pb-2">
        <BaseInput v-model="search" class="flex-1" :icon="Search" :placeholder="tr('Search styles')" />
        <button class="app-icon-button" :aria-label="tr('Import')" @click="fileInput?.click()">
          <Upload :size="17" />
        </button>
        <button class="app-key-action h-9 gap-1.5 px-3.5 text-caption" @click="openCreate">
          <Plus :size="15" />
          <span>{{ tr('Create') }}</span>
        </button>
        <input ref="fileInput" type="file" accept=".json" class="hidden" @change="importStyle">
      </div>

      <p class="shrink-0 px-5 pb-1 text-meta text-text-muted">
        {{ counts.builtIn }} {{ tr('built-in') }} · {{ counts.custom }} {{ tr('custom') }}
      </p>

      <div class="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5 pb-6 pt-4">
        <div
          class="flex items-center gap-2 rounded-ios bg-surface-1 px-3 py-2.5 shadow-ios-pill"
          :class="activeStyleId === 'default' ? 'ring-1 ring-inset ring-accent/40' : ''"
        >
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-accent">
            <Sparkles :size="15" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-caption font-semibold text-text-primary">{{ tr('Default (No Reference)') }}</p>
            <span class="text-meta text-text-muted">{{ tr('Built-in') }}</span>
          </div>
          <button
            class="capsule h-8 px-3 text-meta"
            :class="activeStyleId === 'default' ? 'bg-surface-2 text-text-secondary' : 'bg-surface-2'"
            @click="useStyle('default')"
          >
            {{ activeStyleId === 'default' ? tr('In use') : tr('Use') }}
          </button>
        </div>

        <div
          v-for="style in filtered"
          :key="style.id"
          class="flex items-center gap-2 rounded-ios bg-surface-1 px-3 py-2.5 shadow-ios-pill"
          :class="activeStyleId === style.id ? 'ring-1 ring-inset ring-accent/40' : ''"
        >
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-accent">
            <Check v-if="activeStyleId === style.id" :size="15" />
            <Pencil v-else :size="15" />
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-caption font-semibold text-text-primary">{{ style.name }}</p>
            <span class="text-meta text-text-muted">{{ style.content.length }} {{ tr('characters') }}</span>
          </div>
          <button
            class="capsule h-8 px-3 text-meta"
            :class="activeStyleId === style.id ? 'bg-surface-2 text-text-secondary' : 'bg-surface-2'"
            @click="useStyle(style.id)"
          >
            {{ activeStyleId === style.id ? tr('In use') : tr('Use') }}
          </button>
          <button class="app-icon-button" :aria-label="tr('Edit')" @click="openEdit(style)">
            <Pencil :size="15" />
          </button>
          <button class="app-icon-button" :aria-label="tr('Export')" @click="exportStyle(style)">
            <Download :size="15" />
          </button>
          <button class="app-icon-button app-icon-button--danger" :aria-label="tr('Delete')" @click="pendingDeleteId = style.id">
            <Trash2 :size="15" />
          </button>
        </div>

        <p v-if="!filtered.length" class="px-5 py-6 text-center text-caption text-text-muted">
          {{ search ? tr('No matching styles') : tr('No custom styles yet') }}
        </p>
      </div>

      <div v-if="editorOpen" class="shrink-0 border-t border-line bg-surface-1 px-5 py-3">
        <BaseInput v-model="form.name" class="mb-2" :placeholder="tr('Style name')" />
        <template v-if="!isBuiltIn">
          <textarea
            v-model="form.content"
            class="app-textarea h-40 resize-none text-caption leading-relaxed"
            :placeholder="tr('Style guide')"
          />
        </template>
        <div class="mt-2 flex justify-end gap-1.5">
          <BaseButton variant="ghost" size="sm" @click="editorOpen = false">{{ tr('Cancel') }}</BaseButton>
          <BaseButton variant="primary" size="sm" :disabled="!form.name.trim()" @click="saveStyle">
            {{ tr(isBuiltIn ? 'Rename' : 'Save') }}
          </BaseButton>
        </div>
      </div>
    </div>

    <ConfirmDialog
      :model-value="!!pendingDeleteId"
      :title="tr('Delete style')"
      :message="tr('Projects using this style fall back to the default.')"
      :confirm-text="tr('Delete')"
      variant="danger"
      @update:model-value="value => { if (!value) pendingDeleteId = null }"
      @confirm="confirmDelete"
    />
  </BaseDrawer>
</template>
