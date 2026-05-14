<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useWritingStyleStore } from '@/stores/writingStyle'
import { useProviderStore } from '@/stores/provider'
import { useUiStore } from '@/stores/ui'
import { getAgent } from '@/services/agent'
import { PenLine, Tag, Users, Palette, Ruler, ShieldAlert, FolderOpen, Sparkles, Loader2 } from 'lucide-vue-next'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  create: [data: any]
}>()

const writingStyleStore = useWritingStyleStore()
const providerStore = useProviderStore()
const ui = useUiStore()

const form = reactive({
  name: '',
  theme: '',
  genre: '',
  customGenre: '',
  targetReader: '',
  language: 'English',
  styleId: 'default',
  writingFormat: 'plaintext' as const,
  chapterCount: '8',
  requiredElements: '',
  forbiddenElements: '',
  customRequirements: '',
  directoryPath: ui.defaultStoragePath,
})

const fastFilling = ref(false)

async function handleSelectDirectory() {
  if (!window.electronAPI?.dialog?.openDirectory) return
  const path = await window.electronAPI.dialog.openDirectory({
    title: ui.text('Select Project Storage Directory'),
  })
  if (path) {
    form.directoryPath = path
  }
}

async function handleFastFill() {
  if (!form.name.trim() || !form.theme.trim() || fastFilling.value) return

  fastFilling.value = true
  try {
    const agent = getAgent('detailer')
    const modelRef = providerStore.getAgentModelBinding('outline') || providerStore.getDefaultModelRefForRole('outline')
    
    if (!modelRef) {
      throw new Error('No AI model configured. Please set up a provider first.')
    }

    const model = providerStore.getModelByRef(modelRef)
    agent.setModel(modelRef, 4096, 0.7, model?.model.contextTokens ?? null)

    const result = await agent.execute({
      name: form.name,
      theme: form.theme,
      genre: form.genre,
      targetReader: form.targetReader,
      language: form.language,
      chapterCount: normalizedChapterCount(),
      customRequirements: form.customRequirements,
      constraints: {
        required: form.requiredElements.split(',').map(s => s.trim()).filter(Boolean),
        forbidden: form.forbiddenElements.split(',').map(s => s.trim()).filter(Boolean),
      }
    })

    const parsed = result.data && typeof result.data === 'object'
      ? result.data
      : agent.parseResponse(result.content)
    
    if (parsed.name) form.name = parsed.name
    if (parsed.theme) form.theme = parsed.theme
    if (parsed.genre) setGenreValue(parsed.genre)
    if (parsed.targetReader) form.targetReader = parsed.targetReader
    if (parsed.language) form.language = parsed.language
    if (parsed.chapterCount) form.chapterCount = String(parsed.chapterCount)
    if (parsed.customRequirements) form.customRequirements = parsed.customRequirements
    if (parsed.constraints?.required) form.requiredElements = parsed.constraints.required.join(', ')
    if (parsed.constraints?.forbidden) form.forbiddenElements = parsed.constraints.forbidden.join(', ')
    
  } catch (error: any) {
    console.error('Fast Fill failed:', error)
  } finally {
    fastFilling.value = false
  }
}

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
const resolvedGenre = computed(() =>
  form.genre === 'custom'
    ? form.customGenre.trim()
    : form.genre
)

function setGenreValue(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    form.genre = ''
    form.customGenre = ''
    return
  }

  const trimmed = value.trim()
  const normalized = trimmed.toLowerCase()
  if (genreValues.has(normalized) && normalized !== 'custom') {
    form.genre = normalized
    form.customGenre = ''
    return
  }

  form.genre = 'custom'
  form.customGenre = trimmed
}

const styleOptions = computed(() => [
  { label: 'Default (No Reference)', value: 'default' },
  ...writingStyleStore.styles.map(s => ({ label: s.name, value: s.id })),
])

const writingFormatOptions = [
  { label: 'Plain Text', value: 'plaintext' },
  { label: 'Markdown', value: 'markdown' },
]

function handleCreate() {
  const selectedStyle = writingStyleStore.getStyleById(form.styleId)
  const resolvedStyle = writingStyleStore.resolveStyleContent(form.styleId)
  const resolvedLanguage = form.language.trim() || 'English'
  emit('create', {
    name: form.name,
    theme: form.theme,
    genre: resolvedGenre.value,
    targetReader: form.targetReader,
    language: resolvedLanguage,
    style: resolvedStyle,
    styleId: form.styleId,
    writingStyleSnapshot: selectedStyle
      ? {
        id: selectedStyle.id,
        name: selectedStyle.name,
        description: selectedStyle.description,
        content: selectedStyle.content,
        tags: [...selectedStyle.tags],
        capturedAt: new Date().toISOString(),
      }
      : null,
    writingFormat: form.writingFormat,
    chapterCount: normalizedChapterCount(),
    constraints: {
      required: form.requiredElements.split(',').map(s => s.trim()).filter(Boolean),
      forbidden: form.forbiddenElements.split(',').map(s => s.trim()).filter(Boolean),
    },
    customRequirements: form.customRequirements,
    directoryPath: form.directoryPath,
  })
  resetForm()
  emit('update:modelValue', false)
}

function resetForm() {
  form.name = ''
  form.theme = ''
  form.genre = ''
  form.customGenre = ''
  form.targetReader = ''
  form.language = 'English'
  form.styleId = 'default'
  form.writingFormat = 'plaintext'
  form.chapterCount = '8'
  form.requiredElements = ''
  form.forbiddenElements = ''
  form.customRequirements = ''
  form.directoryPath = ui.defaultStoragePath
}

watch(() => props.modelValue, (val) => {
  if (val) resetForm()
})

const isValid = () => form.name.trim() && form.theme.trim() && form.directoryPath.trim()
const canFastFill = computed(() => form.name.trim() && form.theme.trim() && !fastFilling.value)

function normalizedChapterCount() {
  const parsed = Number(form.chapterCount)
  return Number.isFinite(parsed) ? Math.max(1, Math.min(9999, Math.trunc(parsed))) : 8
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    @update:model-value="emit('update:modelValue', $event)"
    :title="ui.text('New Story Project')"
    width="560px"
  >
    <div class="flex flex-col gap-4">
      <BaseInput
        v-model="form.name"
        label="Project Name"
        placeholder="My Story"
        :icon="PenLine"
      />

      <div class="flex flex-col gap-1.5">
        <label class="text-xs font-medium text-text-secondary">{{ ui.text('Storage Directory') }}</label>
        <div class="flex gap-2">
          <div class="flex-1 min-w-0 h-9 flex items-center px-3 bg-surface-2 border border-surface-4 rounded-md text-sm text-text-primary truncate">
            {{ form.directoryPath || ui.text('Select a directory...') }}
          </div>
          <BaseButton variant="secondary" class="!h-9" @click="handleSelectDirectory">
            <FolderOpen :size="14" />
            <span>{{ ui.text('Browse') }}</span>
          </BaseButton>
        </div>
        <p class="text-[10px] text-text-muted">{{ ui.text('A folder with the project name will be created inside this directory.') }}</p>
      </div>

      <BaseTextarea
        v-model="form.theme"
        label="Story Theme"
        placeholder="Describe the core theme or premise of your story..."
        :rows="2"
        :auto-resize="true"
      />

      <div class="grid grid-cols-2 gap-3">
        <BaseSelect
          v-model="form.genre"
          label="Genre"
          placeholder="Select genre"
          :options="genreOptions"
        />
        <BaseInput
          v-model="form.chapterCount"
          label="Chapters"
          type="number"
          placeholder="8"
          min="1"
          max="9999"
          step="1"
          :icon="Ruler"
        />
      </div>

      <BaseInput
        v-show="form.genre === 'custom'"
        v-model="form.customGenre"
        label="Custom Genre"
        placeholder="e.g., crossover fan fiction / esports drama"
        :icon="Tag"
      />

      <div class="grid grid-cols-2 gap-3">
        <BaseInput
          v-model="form.targetReader"
          label="Target Reader"
          placeholder="e.g., Young Adults"
          :icon="Users"
        />
        <BaseInput
          v-model="form.language"
          label="Primary Language"
          placeholder="e.g., English"
        />
      </div>

      <div class="grid grid-cols-2 gap-3">
        <BaseSelect
          v-model="form.styleId"
          label="Writing Style"
          placeholder="Select style"
          :options="styleOptions"
        />
      </div>

      <BaseInput
        v-model="form.requiredElements"
        label="Required Elements"
        placeholder="Comma-separated: magic system, love triangle, etc."
        :icon="Tag"
      />

      <BaseInput
        v-model="form.forbiddenElements"
        label="Forbidden Elements"
        placeholder="Comma-separated: violence, explicit content, etc."
        :icon="ShieldAlert"
      />

      <BaseTextarea
        v-model="form.customRequirements"
        label="Additional Requirements"
        placeholder="Any other creative constraints or directions..."
        :rows="2"
      />
    </div>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <div>
          <BaseButton
            v-if="canFastFill || fastFilling"
            variant="ghost"
            size="sm"
            :loading="fastFilling"
            @click="handleFastFill"
            class="text-accent hover:bg-accent/10"
          >
            <Sparkles :size="14" class="mr-1.5" />
            <span>{{ ui.text('Fast Fill with AI') }}</span>
          </BaseButton>
        </div>
        <div class="flex items-center gap-2">
          <BaseButton variant="ghost" size="sm" @click="emit('update:modelValue', false)">
            {{ ui.text('Cancel') }}
          </BaseButton>
          <BaseButton variant="primary" size="sm" :disabled="!isValid() || fastFilling" @click="handleCreate">
            {{ ui.text('Create Project') }}
          </BaseButton>
        </div>
      </div>
    </template>
  </BaseDialog>
</template>
