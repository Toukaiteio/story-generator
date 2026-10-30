<script setup lang="ts">
import { computed, ref } from 'vue'
import { Loader2, Sparkles } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSegmented from '@/components/ui/BaseSegmented.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import { useStoryProject, useWorkspaceUi, useWritingStyleLibrary, useStudioActions, buildWritingStyleSnapshot, type StorySeedDraft } from '@/app'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  created: [projectId: string]
}>()
const tr = translatePhrase

const ui = useWorkspaceUi()
const projectStore = useStoryProject()
const writingStyles = useWritingStyleLibrary()
const actions = useStudioActions()
const toast = useToast()

const idea = ref('')
const length = ref('12')
const format = ref<'plaintext' | 'markdown'>('plaintext')
const language = ref('English')
const styleId = ref('default')
const drafting = ref(false)
const creating = ref(false)
const seed = ref<StorySeedDraft | null>(null)

const lengthOptions = [
  { label: 'Novella', value: '6' },
  { label: 'Novel', value: '12' },
  { label: 'Long', value: '24' },
]

const styleOptions = computed(() => [
  { label: tr('Default'), value: 'default' },
  ...writingStyles.styles.map(style => ({ label: style.name, value: style.id })),
])

async function draftSeed() {
  if (!idea.value.trim() || drafting.value) return
  drafting.value = true
  seed.value = null
  try {
    seed.value = await actions.draftStorySeed(idea.value.trim(), { language: language.value })
  } catch (error: any) {
    toast.error(error?.message || 'Draft failed')
  } finally {
    drafting.value = false
  }
}

async function create() {
  if (!seed.value || creating.value) return
  creating.value = true
  try {
    const project = await projectCreate()
    emit('update:modelValue', false)
    emit('created', project.id)
  } catch (error: any) {
    toast.error(error?.message || 'Failed to create project')
  } finally {
    creating.value = false
  }
}

async function projectCreate() {
  const draft = seed.value!
  const resolvedStyle = writingStyles.resolveStyleContent(styleId.value)
  const style = writingStyles.getStyleById(styleId.value)
  const project = await projectStore.createProject({
    name: draft.name || 'Untitled Story',
    theme: draft.theme,
    genre: draft.genre,
    targetReader: draft.targetReader,
    language: language.value,
    style: resolvedStyle || '',
    styleId: styleId.value,
    writingStyleSnapshot: buildWritingStyleSnapshot(style, resolvedStyle || ''),
    writingFormat: format.value,
    chapterCount: Number(length.value),
    constraints: { required: [], forbidden: [] },
    customRequirements: '',
    directoryPath: ui.defaultStoragePath,
  })
  if (draft.outline) {
    await projectStore.updateProject(project.id, { outline: draft.outline })
  }
  return project
}
</script>

<template>
  <div
    v-if="props.modelValue"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
    @click.self="emit('update:modelValue', false)"
  >
    <div class="w-full max-w-xl rounded-3xl border border-surface-4 bg-surface-0 p-6 shadow-2xl">
      <h2 class="text-base font-bold text-text-primary">{{ tr('New story') }}</h2>

      <template v-if="!seed">
        <textarea
          v-model="idea"
          rows="4"
          class="mt-4 w-full resize-none rounded-2xl border border-surface-4 bg-surface-1 p-4 text-sm leading-6 text-text-primary outline-none transition-colors focus:border-accent/60"
          :placeholder="tr('One paragraph: the story you want to write.')"
          @keydown.meta.enter="draftSeed"
          @keydown.ctrl.enter="draftSeed"
        />
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <BaseSegmented v-model="length" :options="lengthOptions" />
          <BaseSegmented
            v-model="format"
            :options="[
              { label: tr('Plain text'), value: 'plaintext' },
              { label: 'MD', value: 'markdown' },
            ]"
          />
          <BaseSegmented
            v-model="language"
            :options="[
              { label: 'EN', value: 'English' },
              { label: '中文', value: '中文' },
            ]"
          />
          <select
            v-model="styleId"
            class="h-7 rounded-full border border-surface-4 bg-surface-2 px-3 text-xs text-text-primary outline-none"
          >
            <option v-for="option in styleOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
        <div class="mt-5 flex justify-end">
          <BaseButton variant="primary" size="md" :loading="drafting" :disabled="!idea.trim()" @click="draftSeed">
            <Sparkles :size="15" />
            <span>{{ tr('Draft blueprint') }}</span>
          </BaseButton>
        </div>
      </template>

      <template v-else>
        <div class="mt-4 space-y-3">
          <div>
            <p class="text-lg font-bold text-text-primary">{{ seed.name }}</p>
            <p class="text-xs text-text-secondary">{{ seed.theme }}</p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <BaseTag size="sm" variant="accent">{{ seed.genre }}</BaseTag>
            <BaseTag size="sm">{{ seed.chapterCount }} {{ tr('chapters') }}</BaseTag>
            <BaseTag v-for="character in seed.characters.slice(0, 6)" :key="character.name" size="sm">
              {{ character.name }}
            </BaseTag>
          </div>
          <p class="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-surface-1 p-4 text-xs leading-relaxed text-text-secondary">{{ seed.outline }}</p>
        </div>
        <div class="mt-5 flex justify-between">
          <BaseButton variant="ghost" size="md" @click="seed = null">{{ tr('Back') }}</BaseButton>
          <BaseButton variant="primary" size="md" :loading="creating" @click="create">{{ tr('Create story') }}</BaseButton>
        </div>
      </template>

      <Loader2 v-if="drafting" class="mt-3 animate-spin text-text-muted" :size="16" />
    </div>
  </div>
</template>
