<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { Save, Wand2 } from 'lucide-vue-next'
import { useProjectStore } from '@/stores/project'
import { useProviderStore } from '@/stores/provider'
import { useWritingStyleStore } from '@/stores/writingStyle'
import { useUiStore } from '@/stores/ui'
import { providerManager } from '@/services/provider'
import { getAgent } from '@/services/agent'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import type { WritingFormat } from '@/types/project'

const projectStore = useProjectStore()
const providerStore = useProviderStore()
const writingStyleStore = useWritingStyleStore()
const ui = useUiStore()
const toast = useToast()
const tr = translatePhrase

const project = computed(() => projectStore.activeProject)
const isOptimizing = ref(false)

const form = reactive({
  name: '',
  theme: '',
  genre: '',
  customGenre: '',
  targetReader: '',
  language: 'English',
  styleId: 'default',
  writingFormat: 'plaintext' as WritingFormat,
  chapterCount: '8',
  customRequirements: '',
})

const requiredElementsText = ref('')
const forbiddenElementsText = ref('')
const requiredElementsPreview = computed(() => splitListInput(requiredElementsText.value))
const forbiddenElementsPreview = computed(() => splitListInput(forbiddenElementsText.value))
const configUnsavedNodeKey = computed(() => project.value ? `config-${project.value.id}` : '')

const genreOptions = [
  { label: 'Fantasy', value: 'fantasy' },
  { label: 'Sci-Fi', value: 'sci-fi' },
  { label: 'Romance', value: 'romance' },
  { label: 'Mystery', value: 'mystery' },
  { label: 'Thriller', value: 'thriller' },
  { label: 'Historical', value: 'historical' },
  { label: 'Literary', value: 'literary' },
  { label: 'Horror', value: 'horror' },
  { label: 'Adventure', value: 'adventure' },
  { label: 'Custom', value: 'custom' },
]

const genreValues = new Set(genreOptions.map(option => option.value))

const writingFormatOptions = [
  { label: 'Plain Text', value: 'plaintext' },
  { label: 'Markdown', value: 'markdown' },
]

const projectStyleOption = computed(() => {
  const snapshot = project.value?.writingStyleSnapshot
  if (!snapshot || !snapshot.id || snapshot.id === 'default') return null
  if (writingStyleStore.styles.some(style => style.id === snapshot.id)) return null
  return {
    label: `${snapshot.name || 'Project Writing Style'} (Project)`,
    value: snapshot.id,
  }
})

watch(
  project,
  (p) => {
    if (p) {
      form.name = p.name
      form.theme = p.theme
      setGenreValue(p.genre)
      form.targetReader = p.targetReader
      form.language = p.language || 'English'
      form.styleId = p.styleId || 'default'
      form.writingFormat = p.writingFormat || 'plaintext'
      form.chapterCount = String(p.chapterCount || 8)
      form.customRequirements = p.customRequirements
      requiredElementsText.value = p.constraints.required.join('\n')
      forbiddenElementsText.value = p.constraints.forbidden.join('\n')
      return
    }

    form.name = ''
    form.theme = ''
    form.genre = ''
    form.customGenre = ''
    form.targetReader = ''
    form.language = 'English'
    form.styleId = 'default'
    form.chapterCount = '8'
    form.customRequirements = ''
    requiredElementsText.value = ''
    forbiddenElementsText.value = ''
  },
  { immediate: true }
)

const styleOptions = computed(() => [
  { label: 'Default (No Reference)', value: 'default' },
  ...(projectStyleOption.value ? [projectStyleOption.value] : []),
  ...writingStyleStore.styles.map(s => ({ label: s.name, value: s.id })),
])

function buildWritingStyleSnapshot(styleId: string, content: string) {
  const selectedStyle = writingStyleStore.getStyleById(styleId)
  if (selectedStyle) {
    return {
      id: selectedStyle.id,
      name: selectedStyle.name,
      description: selectedStyle.description,
      content: selectedStyle.content,
      tags: [...selectedStyle.tags],
      capturedAt: new Date().toISOString(),
    }
  }

  const existingSnapshot = project.value?.writingStyleSnapshot
  if (existingSnapshot?.id === styleId && content.trim()) {
    return {
      ...existingSnapshot,
      content,
      capturedAt: existingSnapshot.capturedAt || new Date().toISOString(),
    }
  }

  return null
}

const resolvedGenre = computed(() =>
  form.genre === 'custom'
    ? form.customGenre.trim()
    : form.genre
)

function splitListInput(value: string) {
  return value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean)
}

function normalizeTextValue(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function normalizedChapterCount() {
  const parsed = Number(form.chapterCount)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(9999, Math.trunc(parsed))) : 8
}

function setGenreValue(value: unknown) {
  const next = normalizeTextValue(value)
  if (!next) {
    form.genre = ''
    form.customGenre = ''
    return
  }

  const normalized = next.toLowerCase()
  if (genreValues.has(normalized) && normalized !== 'custom') {
    form.genre = normalized
    form.customGenre = ''
    return
  }

  form.genre = 'custom'
  form.customGenre = next
}

function normalizePersonalityListText(value: string) {
  return splitListInput(value)
}

const isConfigDirty = computed(() => {
  if (!project.value) return false
  const chapterCount = normalizedChapterCount()
  const projectChapterCount = Number(project.value.chapterCount || 8)
  const projectMaxChapters = Number(project.value.chapterConfig?.maxChapters || projectChapterCount || 8)
  const currentLanguage = normalizeTextValue(form.language) || 'English'
  const projectLanguage = normalizeTextValue(project.value.language) || 'English'
  const currentRequirements = normalizeTextValue(form.customRequirements)
  const projectRequirements = normalizeTextValue(project.value.customRequirements)
  return (
    normalizeTextValue(form.name) !== normalizeTextValue(project.value.name)
    || normalizeTextValue(form.theme) !== normalizeTextValue(project.value.theme)
    || normalizeTextValue(resolvedGenre.value) !== normalizeTextValue(project.value.genre)
    || normalizeTextValue(form.targetReader) !== normalizeTextValue(project.value.targetReader)
    || currentLanguage !== projectLanguage
    || form.styleId !== (project.value.styleId || 'default')
    || form.writingFormat !== (project.value.writingFormat || 'plaintext')
    || chapterCount !== projectChapterCount
    || chapterCount !== projectMaxChapters
    || currentRequirements !== projectRequirements
    || JSON.stringify(normalizePersonalityListText(requiredElementsText.value)) !== JSON.stringify(project.value.constraints.required || [])
    || JSON.stringify(normalizePersonalityListText(forbiddenElementsText.value)) !== JSON.stringify(project.value.constraints.forbidden || [])
  )
})

function stripCodeFence(content: string) {
  const trimmed = content.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
}

function extractJsonObject(content: string) {
  const stripped = stripCodeFence(content)
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('Detailer returned invalid JSON')
  }
  return stripped.slice(start, end + 1)
}

function applyConfigPatch(payload: Record<string, any>) {
  const nextName = normalizeTextValue(payload.name)
  const nextTheme = normalizeTextValue(payload.theme)
  const nextGenre = normalizeTextValue(payload.genre)
  const nextTargetReader = normalizeTextValue(payload.targetReader)
  const nextLanguage = normalizeTextValue(payload.language)
  const nextChapterCount = Number(payload.chapterCount)
  const nextCustomRequirements = normalizeTextValue(payload.customRequirements)

  if (nextName) form.name = nextName
  if (nextTheme) form.theme = nextTheme
  if (nextGenre) setGenreValue(nextGenre)
  if (nextTargetReader) form.targetReader = nextTargetReader
  if (nextLanguage) form.language = nextLanguage
  if (Number.isFinite(nextChapterCount)) form.chapterCount = String(Math.max(1, Math.min(9999, Math.trunc(nextChapterCount))))
  if (nextCustomRequirements) form.customRequirements = nextCustomRequirements

  if (payload.constraints && typeof payload.constraints === 'object') {
    if (Array.isArray(payload.constraints.required)) {
      requiredElementsText.value = payload.constraints.required.filter(Boolean).join('\n')
    }
    if (Array.isArray(payload.constraints.forbidden)) {
      forbiddenElementsText.value = payload.constraints.forbidden.filter(Boolean).join('\n')
    }
  }
}

async function save(showToast = true) {
  if (!project.value) return
  const fallbackProjectStyle = project.value.writingStyleSnapshot?.id === form.styleId
    ? project.value.writingStyleSnapshot.content
    : ''
  const resolvedStyle = writingStyleStore.resolveStyleContent(form.styleId) || fallbackProjectStyle
  const resolvedLanguage = form.language.trim() || 'English'
  const saved = await projectStore.updateProject(project.value.id, {
    name: form.name,
    theme: form.theme,
    genre: resolvedGenre.value,
    targetReader: form.targetReader,
    language: resolvedLanguage,
    style: resolvedStyle,
    styleId: form.styleId,
    writingStyleSnapshot: buildWritingStyleSnapshot(form.styleId, resolvedStyle),
    writingFormat: form.writingFormat,
    chapterCount: normalizedChapterCount(),
    chapterConfig: {
      maxChapters: normalizedChapterCount(),
    },
    constraints: {
      required: splitListInput(requiredElementsText.value),
      forbidden: splitListInput(forbiddenElementsText.value),
    },
    customRequirements: form.customRequirements,
  })
  if (!saved) {
    if (showToast) {
      toast.error('Failed to save configuration')
    }
    return false
  }
  if (showToast) {
    toast.success('Configuration saved')
  }
  return true
}

watch(isConfigDirty, dirty => {
  const nodeKey = configUnsavedNodeKey.value
  if (!nodeKey) return
  ui.setWorkspaceNodeUnsaved(nodeKey, dirty)
}, { immediate: true })

watch(configUnsavedNodeKey, (next, previous) => {
  if (previous && previous !== next) {
    ui.setWorkspaceNodeUnsaved(previous, false)
  }
  if (next) {
    ui.setWorkspaceNodeUnsaved(next, isConfigDirty.value)
  }
})

onBeforeUnmount(() => {
  const nodeKey = configUnsavedNodeKey.value
  if (nodeKey && !isConfigDirty.value) {
    ui.setWorkspaceNodeUnsaved(nodeKey, false)
  }
})

async function saveFromShortcut() {
  await save()
}

defineExpose({
  saveFromShortcut,
})

async function optimizeWithDetailer() {
  if (!project.value || isOptimizing.value) return

  isOptimizing.value = true
  try {
    providerManager.setProviders(providerStore.providers)
    providerStore.ensureAgentModelBindings()

    const detailerBinding = providerStore.getAgentModelBinding('detailer')
      ?? providerStore.getDefaultModelRefForRole('detailer')

    if (!detailerBinding) {
      toast.warning('No available model for Detailer')
      return
    }

    const detailer = getAgent('detailer')
    detailer.setModel(detailerBinding, 4096, 0.35)

    const payload = {
      name: form.name,
      theme: form.theme,
      genre: resolvedGenre.value,
      targetReader: form.targetReader,
      language: form.language.trim() || 'English',
      chapterCount: normalizedChapterCount(),
      customRequirements: form.customRequirements,
      constraints: {
        required: splitListInput(requiredElementsText.value),
        forbidden: splitListInput(forbiddenElementsText.value),
      },
    }

    const result = await detailer.execute(payload)
    const parsed = result.data && typeof result.data === 'object'
      ? result.data
      : JSON.parse(extractJsonObject(result.content))
    applyConfigPatch(parsed)
    const saved = await save(false)
    if (!saved) {
      throw new Error('Failed to save optimized configuration')
    }
    toast.success('Story configuration optimized')
  } catch (error: any) {
    toast.error(error?.message || 'Detailer optimization failed')
  } finally {
    isOptimizing.value = false
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="px-6 py-6">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-base font-semibold text-text-primary">{{ tr('Story Configuration') }}</h2>
          <p class="text-xs text-text-secondary mt-1">
            {{ tr('Edit your configuration directly, then use Detailer to refine it for generation.') }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <BaseButton variant="secondary" size="sm" :loading="isOptimizing" @click="optimizeWithDetailer">
            <Wand2 :size="14" />
            <span>{{ tr('Detailer') }}</span>
          </BaseButton>
          <BaseButton variant="primary" size="sm" @click="save">
            <Save :size="14" />
            <span>{{ tr('Save') }}</span>
          </BaseButton>
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <BaseInput v-model="form.name" label="Project Name" />

        <BaseTextarea
          v-model="form.theme"
          label="Story Theme / Premise"
          :rows="3"
          :auto-resize="true"
        />

        <div class="grid grid-cols-2 gap-3">
          <BaseSelect v-model="form.genre" label="Genre" :options="genreOptions" />
          <BaseInput v-model="form.chapterCount" label="Chapters" type="number" placeholder="8" min="1" max="9999" step="1" />
        </div>

        <BaseInput
          v-show="form.genre === 'custom'"
          v-model="form.customGenre"
          label="Custom Genre"
          placeholder="e.g., crossover fan fiction / esports drama"
        />

        <div class="grid grid-cols-2 gap-3">
          <BaseInput v-model="form.targetReader" label="Target Reader" />
          <BaseInput v-model="form.language" label="Primary Language" placeholder="English" />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <BaseSelect v-model="form.styleId" label="Writing Style" :options="styleOptions" />
          <BaseSelect v-model="form.writingFormat" label="Writing Format" :options="writingFormatOptions" />
        </div>

        <BaseTextarea
          v-model="form.customRequirements"
          label="Additional Requirements"
          :rows="4"
          :auto-resize="true"
        />

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BaseTextarea
            v-model="requiredElementsText"
            label="Required Elements"
            placeholder="One per line or comma separated"
            :rows="5"
            :auto-resize="true"
          />
          <BaseTextarea
            v-model="forbiddenElementsText"
            label="Forbidden Elements"
            placeholder="One per line or comma separated"
            :rows="5"
            :auto-resize="true"
          />
        </div>

        <div v-if="requiredElementsPreview.length" class="mt-2">
          <p class="text-xs font-medium text-text-secondary mb-2">{{ tr('Required Elements Preview') }}</p>
          <div class="flex flex-wrap gap-1.5">
            <BaseTag v-for="el in requiredElementsPreview" :key="el" variant="success">
              {{ el }}
            </BaseTag>
          </div>
        </div>

        <div v-if="forbiddenElementsPreview.length" class="mt-2">
          <p class="text-xs font-medium text-text-secondary mb-2">{{ tr('Forbidden Elements Preview') }}</p>
          <div class="flex flex-wrap gap-1.5">
            <BaseTag v-for="el in forbiddenElementsPreview" :key="el" variant="danger">
              {{ el }}
            </BaseTag>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
