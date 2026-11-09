<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSegmented from '@/components/ui/BaseSegmented.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { useStoryProject, useWritingStyleLibrary, buildWritingStyleSnapshot } from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const tr = translatePhrase
const projectStore = useStoryProject()
const styles = useWritingStyleLibrary()
const toast = useToast()

const saving = ref(false)
const project = computed(() => projectStore.activeProject)

const form = reactive({
  genre: 'literary',
  chapterCount: 8,
  writingFormat: 'plaintext' as 'plaintext' | 'markdown',
  language: 'English',
  styleId: 'default',
})

const genreOptions = ['fantasy', 'sci-fi', 'romance', 'mystery', 'thriller', 'historical', 'literary', 'horror', 'adventure']
  .map(genre => ({ label: genre, value: genre }))

const chapterOptions = [4, 8, 12, 16, 24, 32].map(count => ({ label: String(count), value: String(count) }))

const languageOptions = [
  { label: '中文', value: '中文' },
  { label: 'English', value: 'English' },
]

const styleOptions = computed(() => [
  { label: tr('Default (No Reference)'), value: 'default' },
  ...styles.styles.map(style => ({ label: style.name, value: style.id })),
])

function hydrate() {
  const value = project.value
  if (!value) return
  form.genre = value.genre || 'literary'
  form.chapterCount = value.chapterConfig?.maxChapters ?? value.chapterCount ?? 8
  form.writingFormat = value.writingFormat ?? 'plaintext'
  form.language = value.language || '中文'
  form.styleId = value.styleId || 'default'
}

watch(() => props.modelValue, open => { if (open) hydrate() })
watch(project, () => { if (props.modelValue) hydrate() })

async function save() {
  const value = project.value
  if (!value || saving.value) return
  saving.value = true
  try {
    const style = styles.getStyleById(form.styleId)
    const resolvedStyle = styles.resolveStyleContent(form.styleId) || value.style
    await projectStore.updateProject(value.id, {
      genre: form.genre,
      chapterCount: form.chapterCount,
      chapterConfig: { maxChapters: form.chapterCount },
      writingFormat: form.writingFormat,
      language: form.language,
      styleId: form.styleId,
      style: resolvedStyle,
      writingStyleSnapshot: buildWritingStyleSnapshot(style, resolvedStyle),
    })
    toast.success('Story settings saved')
    emit('update:modelValue', false)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="tr('Story settings')"
    width="560px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="project" class="space-y-4">
      <div>
        <p class="mb-1.5 text-caption font-medium text-text-secondary">{{ tr('Genre') }}</p>
        <BaseSegmented
          :model-value="form.genre"
          :options="genreOptions"
          @update:model-value="form.genre = $event"
        />
      </div>

      <div>
        <p class="mb-1.5 text-caption font-medium text-text-secondary">{{ tr('Chapters') }}</p>
        <BaseSegmented
          :model-value="String(form.chapterCount)"
          :options="chapterOptions"
          @update:model-value="form.chapterCount = Number($event)"
        />
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <BaseSelect v-model="form.styleId" :options="styleOptions" :label="tr('Writing style')" />
        <BaseSelect v-model="form.language" :options="languageOptions" :label="tr('Language')" />
      </div>

      <div>
        <p class="mb-1.5 text-caption font-medium text-text-secondary">{{ tr('Writing format') }}</p>
        <BaseSegmented
          :model-value="form.writingFormat"
          :options="[
            { label: tr('Plain text'), value: 'plaintext' },
            { label: 'Markdown', value: 'markdown' },
          ]"
          @update:model-value="form.writingFormat = $event as 'plaintext' | 'markdown'"
        />
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <BaseButton variant="secondary" size="sm" @click="emit('update:modelValue', false)">
          {{ tr('Cancel') }}
        </BaseButton>
        <BaseButton variant="primary" size="sm" :loading="saving" @click="save">
          {{ tr('Save') }}
        </BaseButton>
      </div>
    </template>
  </BaseDialog>
</template>
