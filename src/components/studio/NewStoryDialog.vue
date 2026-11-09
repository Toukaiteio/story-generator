<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, Loader2, Sparkles } from 'lucide-vue-next'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import BaseSegmented from '@/components/ui/BaseSegmented.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import {
  useStoryProject,
  useWorkspaceUi,
  useWritingStyleLibrary,
  useStudioActions,
  buildWritingStyleSnapshot,
  type StorySeedDraft,
} from '@/app'
import { useToast } from '@/composables/useToast'
import { generateId } from '@/lib/id'
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
const language = ref(translatePhrase('English') === 'English' ? 'English' : '中文')
const styleId = ref('default')
const drafting = ref(false)
const creating = ref(false)
const seed = ref<StorySeedDraft | null>(null)

const lengthOptions = [
  { label: tr('Novella'), value: '6' },
  { label: tr('Novel'), value: '12' },
  { label: tr('Long'), value: '24' },
]

const styleOptions = computed(() => [
  { label: tr('Default'), value: 'default' },
  ...writingStyles.styles.map(style => ({ label: style.name, value: style.id })),
])

watch(() => props.modelValue, value => {
  if (!value) {
    seed.value = null
    drafting.value = false
    creating.value = false
  }
})

async function draftSeed() {
  if (!idea.value.trim() || drafting.value) return
  drafting.value = true
  seed.value = null
  try {
    seed.value = await actions.draftStorySeed(idea.value.trim(), { language: language.value })
    if (seed.value.chapterCount) length.value = String(Math.min(32, Math.max(1, seed.value.chapterCount)))
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
    const project = await projectCreate(seed.value)
    emit('update:modelValue', false)
    emit('created', project.id)
  } catch (error: any) {
    toast.error(error?.message || 'Failed to create project')
  } finally {
    creating.value = false
  }
}

async function projectCreate(draft: StorySeedDraft) {
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
  const characters = draft.characters.map((item, index) => ({
    id: generateId(),
    name: item.name || `Character ${index + 1}`,
    role: item.role as 'protagonist' | 'antagonist' | 'supporting' | 'minor',
    personality: item.personality,
    appearance: item.appearance,
    backstory: '',
    motivation: item.motivation,
    goals: item.goals,
    conflicts: item.conflicts,
    currentState: '',
    relations: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }))

  await projectStore.updateProject(project.id, {
    outline: draft.outline || '',
    chapterCount: Number(length.value),
    theme: draft.theme || '',
    genre: draft.genre || '',
    targetReader: draft.targetReader || '',
    characters,
  })

  return project
}
</script>

<template>
  <Teleport to="body">
    <Transition name="backdrop">
      <div
        v-if="props.modelValue"
        class="fixed inset-0 z-[160] flex items-center justify-center bg-black/20 p-5 backdrop-blur-sm"
        @click.self="emit('update:modelValue', false)"
      >
        <div class="w-full max-w-2xl overflow-hidden rounded-ios-lg bg-surface-1 shadow-ios-lg">
          <div class="flex items-center justify-between px-6 pb-2 pt-5">
            <h2 class="text-title font-semibold text-text-primary">{{ tr('New story') }}</h2>
            <span class="text-meta text-text-muted">{{ seed ? tr('Review') : tr('Seed') }}</span>
          </div>

          <template v-if="!seed">
            <div class="space-y-3 px-6 pb-5">
              <BaseTextarea
                v-model="idea"
                :rows="4"
                :placeholder="tr(tr('One paragraph: the story you want to write.'))"
                @keydown.meta.enter="draftSeed"
                @keydown.ctrl.enter="draftSeed"
              />
              <div class="flex flex-wrap items-center gap-2">
                <BaseSegmented v-model="length" :options="lengthOptions" />
                <BaseSegmented
                  v-model="format"
                  :options="[
                    { label: tr('Plain text'), value: 'plaintext' },
                    { label: 'Markdown', value: 'markdown' },
                  ]"
                />
                <BaseSegmented
                  v-model="language"
                  :options="[
                    { label: '中文', value: '中文' },
                    { label: 'EN', value: 'English' },
                  ]"
                />
                <BaseSelect v-model="styleId" :options="styleOptions" class="min-w-[150px]" />
              </div>
            </div>
            <div class="flex justify-end gap-2 px-6 pb-5">
              <BaseButton variant="secondary" size="sm" @click="emit('update:modelValue', false)">
                {{ tr('Cancel') }}
              </BaseButton>
              <BaseButton variant="primary" size="sm" :loading="drafting" :disabled="!idea.trim()" @click="draftSeed">
                <Sparkles :size="15" />
                <span>{{ tr('Draft blueprint') }}</span>
              </BaseButton>
            </div>
          </template>

          <template v-else>
            <div class="space-y-3 px-6 pb-4">
              <div>
                <p class="text-display font-semibold text-text-primary">{{ seed.name }}</p>
                <p class="mt-0.5 text-caption text-text-secondary">{{ seed.theme }}</p>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <BaseTag variant="accent">{{ seed.genre }}</BaseTag>
                <BaseTag>{{ seed.chapterCount }} {{ tr('chapters') }}</BaseTag>
                <BaseTag>{{ language }}</BaseTag>
                <BaseTag v-for="characterName in seed.characters.slice(0, 6)" :key="characterName.name">
                  {{ characterName.name }}
                </BaseTag>
              </div>
              <p class="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-ios bg-surface-2 px-4 py-3 text-caption leading-relaxed text-text-secondary">{{ seed.outline }}</p>
            </div>
            <div class="flex items-center justify-between gap-2 px-6 pb-5">
              <BaseButton variant="ghost" size="sm" @click="seed = null">
                {{ tr('Back') }}
              </BaseButton>
              <BaseButton variant="primary" size="sm" :loading="creating" @click="create">
                <Check :size="15" />
                <span>{{ tr('Create story') }}</span>
              </BaseButton>
            </div>
          </template>

          <div v-if="drafting" class="flex items-center justify-center gap-2 pb-4 text-caption text-text-muted">
            <Loader2 :size="15" class="animate-spin" />
            {{ tr('Drafting the blueprint') }}
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
