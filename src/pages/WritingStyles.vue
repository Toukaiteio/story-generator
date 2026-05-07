<script setup lang="ts">
import { computed, onMounted, ref, reactive } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useWritingStyleStore } from '@/stores/writingStyle'
import { useProviderStore } from '@/stores/provider'
import { useToast } from '@/composables/useToast'
import { providerManager } from '@/services/provider'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import {
  Palette,
  Plus,
  X,
  Trash2,
  Pencil,
  Sparkles,
  FileText,
  Tag,
  BookOpen,
} from 'lucide-vue-next'
import type { WritingStyle } from '@/types/writingStyle'

const ui = useUiStore()
const styleStore = useWritingStyleStore()
const providerStore = useProviderStore()
const toast = useToast()

onMounted(() => {
  ui.navigateTo('writingStyles')
})

const showDrawer = ref(false)
const showDeleteConfirm = ref(false)
const editingId = ref<string | null>(null)
const pendingDeleteId = ref<string | null>(null)
const isGenerating = ref(false)
const showReferenceSection = ref(false)
const searchQuery = ref('')

const form = reactive({
  name: '',
  description: '',
  content: '',
  tags: '',
  referenceText: '',
})

const filteredStyles = computed(() => {
  if (!searchQuery.value.trim()) return styleStore.styles
  const q = searchQuery.value.toLowerCase()
  return styleStore.styles.filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    s.tags.some(t => t.toLowerCase().includes(q))
  )
})

function openCreateDrawer() {
  editingId.value = null
  form.name = ''
  form.description = ''
  form.content = ''
  form.tags = ''
  form.referenceText = ''
  showReferenceSection.value = false
  showDrawer.value = true
}

function openEditDrawer(style: WritingStyle) {
  editingId.value = style.id
  form.name = style.name
  form.description = style.description
  form.content = style.content
  form.tags = style.tags.join(', ')
  form.referenceText = ''
  showReferenceSection.value = false
  showDrawer.value = true
}

function saveStyle() {
  if (!form.name.trim()) {
    toast.warning('Style name is required')
    return
  }

  const tags = form.tags
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)

  if (editingId.value) {
    styleStore.updateStyle(editingId.value, {
      name: form.name.trim(),
      description: form.description.trim(),
      content: form.content,
      tags,
    })
    toast.success('Style updated')
  } else {
    styleStore.createStyle({
      name: form.name.trim(),
      description: form.description.trim(),
      content: form.content,
      source: 'manual',
      tags,
    })
    toast.success('Style created')
  }

  showDrawer.value = false
}

function requestDelete(id: string) {
  pendingDeleteId.value = id
  showDeleteConfirm.value = true
}

function confirmDelete() {
  if (pendingDeleteId.value) {
    styleStore.deleteStyle(pendingDeleteId.value)
    pendingDeleteId.value = null
    toast.success('Style deleted')
  }
}

async function generateFromReference() {
  if (!form.referenceText.trim()) {
    toast.warning('Please paste some reference text first')
    return
  }

  const MAX_RETRIES = 2
  isGenerating.value = true
  try {
    providerManager.setProviders(providerStore.providers)
    providerStore.ensureAgentModelBindings()

    const binding = providerStore.getAgentModelBinding('writer')
      ?? providerStore.getDefaultModelRefForRole('writer')

    if (!binding) {
      toast.warning('No available model. Please configure a provider first.')
      return
    }

    const match = providerStore.getModelByRef(binding)
    if (!match) {
      toast.warning('Selected model not found')
      return
    }

    let styleGuide = ''
    let repairContext = ''

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Step 1: Generate or refine the style guide
      const guideMessages = [
        {
          role: 'system' as const,
          content: 'You are an expert literary analyst. You analyze reference texts and produce detailed writing style guides. Output only the style guide in clean markdown. Do not add meta commentary.',
        },
        {
          role: 'user' as const,
          content: repairContext
            ? `The previous style guide did not accurately capture the style of the reference text. Issues found:\n${repairContext}\n\nPlease revise the style guide to better match the reference text's actual style.\n\nReference text:\n${form.referenceText}`
            : `Analyze the following reference text and produce a comprehensive writing style guide.\nThe guide should cover: tone, voice, sentence structure, vocabulary level, pacing, dialogue style, description approach, narrative perspective, and any distinctive literary techniques.\n\nOutput the style guide as clean markdown with section headers.\n\nReference text:\n${form.referenceText}`,
        },
      ]

      styleGuide = await providerManager.chat(guideMessages, binding, 4096, 0.5)

      // Step 2: Generate a sample text using the style guide
      const sampleMessages = [
        {
          role: 'system' as const,
          content: 'You are a creative writer. You write strictly following the provided style guide. Output only the sample text, no meta commentary.',
        },
        {
          role: 'user' as const,
          content: `Write a short sample passage (200-400 words) that demonstrates the writing style described in the following guide. The passage should be original fiction, not a copy of any reference text.\n\nStyle Guide:\n${styleGuide}`,
        },
      ]

      const sampleText = await providerManager.chat(sampleMessages, binding, 2048, 0.7)

      // Step 3: Compare sample text against reference text
      const compareMessages = [
        {
          role: 'system' as const,
          content: 'You are a literary style comparison expert. You compare two texts and determine if they share the same writing style. Respond ONLY with a JSON object: { "match": true/false, "feedback": "brief explanation of similarities and differences" }',
        },
        {
          role: 'user' as const,
          content: `Compare the writing styles of these two texts. Do they share the same tone, voice, sentence structure, vocabulary level, pacing, and literary techniques?

Text A (Reference):
${form.referenceText}

Text B (Sample generated from style guide):
${sampleText}

Respond with only JSON: { "match": true or false, "feedback": "explanation" }`,
        },
      ]

      const comparisonResult = await providerManager.chat(compareMessages, binding, 1024, 0.2)

      let verdict: { match: boolean; feedback: string }
      try {
        const jsonStr = comparisonResult.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim()
        verdict = JSON.parse(jsonStr)
      } catch {
        // If parsing fails, assume match to avoid infinite retries on malformed responses
        verdict = { match: true, feedback: 'Could not parse comparison result, accepting style guide.' }
      }

      if (verdict.match) {
        form.content = styleGuide
        toast.success('Style guide generated and validated')
        return
      }

      // Not matched — prepare repair context for next attempt
      if (attempt < MAX_RETRIES) {
        repairContext = verdict.feedback || 'The generated style guide does not accurately capture the reference text style.'
        toast.warning(`Style validation failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}). Retrying...`)
      } else {
        // Exhausted retries — accept the last result with a warning
        form.content = styleGuide
        toast.warning('Style guide generated but may not fully match the reference text. Please review manually.')
      }
    }
  } catch (error: any) {
    toast.error(error?.message || 'Failed to generate style guide')
  } finally {
    isGenerating.value = false
  }
}

function formatSource(source: string): string {
  return source === 'ai-generated' ? 'AI Generated' : 'Manual'
}

function sourceVariant(source: string): 'accent' | 'default' {
  return source === 'ai-generated' ? 'accent' : 'default'
}
</script>

<template>
  <div class="h-full flex flex-col overflow-hidden">
    <div class="flex items-center justify-between px-6 py-4 border-b border-surface-4 shrink-0">
      <div>
        <h1 class="text-lg font-semibold text-text-primary">Writing Styles</h1>
        <p class="text-xs text-text-secondary mt-0.5">
          Create and manage reusable writing style guides for story generation
        </p>
      </div>
      <BaseButton variant="primary" size="sm" @click="openCreateDrawer">
        <Plus :size="14" />
        <span>Create Style</span>
      </BaseButton>
    </div>

    <div class="flex-1 overflow-y-auto p-6">
      <div class="max-w-4xl mx-auto space-y-4">
        <div class="mb-4">
          <BaseInput
            v-model="searchQuery"
            placeholder="Search styles by name, description, or tags..."
          />
        </div>

        <BaseCard padding="md">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-surface-3 flex items-center justify-center">
              <BookOpen :size="18" class="text-text-muted" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-semibold text-text-primary">Default (No Reference)</h3>
                <BaseTag variant="default" size="sm">Built-in</BaseTag>
              </div>
              <p class="text-xs text-text-secondary mt-0.5">
                The AI will infer an appropriate writing style from the genre, theme, and target reader.
              </p>
            </div>
          </div>
        </BaseCard>

        <EmptyState
          v-if="!styleStore.styles.length && !searchQuery"
          :icon="Palette"
          title="No custom styles yet"
          description="Create a writing style guide to give your story a consistent voice. You can write one manually or let AI analyze a reference text."
        >
          <template #action>
            <BaseButton variant="primary" size="sm" @click="openCreateDrawer">
              <Plus :size="14" />
              <span>Create Style</span>
            </BaseButton>
          </template>
        </EmptyState>

        <EmptyState
          v-else-if="!filteredStyles.length && searchQuery"
          :icon="Palette"
          title="No matching styles"
          description="Try a different search term."
        />

        <div v-else class="space-y-3">
          <BaseCard
            v-for="style in filteredStyles"
            :key="style.id"
            padding="md"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-start gap-3 flex-1 min-w-0">
                <div class="w-10 h-10 rounded-lg bg-accent-subtle flex items-center justify-center shrink-0">
                  <FileText :size="18" class="text-accent" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <h3 class="text-sm font-semibold text-text-primary">{{ style.name }}</h3>
                    <BaseTag :variant="sourceVariant(style.source)" size="sm">
                      {{ formatSource(style.source) }}
                    </BaseTag>
                  </div>
                  <p v-if="style.description" class="text-xs text-text-secondary mt-1">
                    {{ style.description }}
                  </p>
                  <div v-if="style.tags.length" class="flex flex-wrap gap-1.5 mt-2">
                    <BaseTag v-for="tag in style.tags" :key="tag" size="sm" variant="default">
                      {{ tag }}
                    </BaseTag>
                  </div>
                  <p class="text-2xs text-text-muted mt-2">
                    {{ style.content.length }} characters · Updated {{ new Date(style.updatedAt).toLocaleDateString() }}
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <button
                  class="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors duration-100"
                  @click="openEditDrawer(style)"
                >
                  <Pencil :size="14" />
                </button>
                <button
                  class="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-danger hover:bg-danger-subtle transition-colors duration-100"
                  @click="requestDelete(style.id)"
                >
                  <Trash2 :size="14" />
                </button>
              </div>
            </div>
          </BaseCard>
        </div>
      </div>
    </div>

    <!-- Create/Edit Drawer -->
    <Transition name="backdrop">
      <div
        v-if="showDrawer"
        class="fixed inset-0 z-[100] bg-black/60"
        @mousedown.self="showDrawer = false"
      >
        <Transition name="slide-right" appear>
          <div
            v-if="showDrawer"
            class="absolute right-0 top-0 h-full w-[480px] bg-surface-1 border-l border-surface-4 shadow-2xl flex flex-col"
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-surface-4 shrink-0">
              <h2 class="text-base font-semibold text-text-primary">
                {{ editingId ? 'Edit Style' : 'Create Style' }}
              </h2>
              <button
                class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors duration-100"
                @click="showDrawer = false"
              >
                <X :size="16" />
              </button>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
              <BaseInput
                v-model="form.name"
                label="Style Name"
                placeholder="e.g. Hemingway Minimalist"
              />

              <BaseInput
                v-model="form.description"
                label="Description"
                placeholder="Brief description of this writing style"
              />

              <BaseInput
                v-model="form.tags"
                label="Tags"
                placeholder="Comma-separated: literary, formal, concise"
                :icon="Tag"
              />

              <div class="flex-1 flex flex-col gap-2">
                <div class="flex items-center justify-between">
                  <label class="text-xs font-medium text-text-secondary">Style Guide Content</label>
                  <span class="text-2xs text-text-muted">{{ form.content.length }} chars</span>
                </div>
                <textarea
                  v-model="form.content"
                  class="flex-1 min-h-[200px] w-full rounded-lg border border-surface-4 bg-surface-2 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent resize-y"
                  placeholder="Write your style guide here in markdown...

Example:
## Tone & Voice
Write in a spare, direct style. Short sentences. Minimal adjectives.

## Dialogue
Natural, understated. Characters speak in fragments.

## Description
Focus on concrete sensory details. Avoid abstraction."
                />
              </div>

              <!-- Analyze Reference Text Section -->
              <div class="rounded-lg border border-surface-4 bg-surface-2">
                <button
                  class="w-full flex items-center justify-between px-4 py-3 text-left"
                  @click="showReferenceSection = !showReferenceSection"
                >
                  <div class="flex items-center gap-2">
                    <Sparkles :size="14" class="text-accent" />
                    <span class="text-sm font-medium text-text-primary">Analyze Reference Text</span>
                  </div>
                  <span class="text-xs text-text-muted">
                    {{ showReferenceSection ? 'Hide' : 'Show' }}
                  </span>
                </button>

                <div v-if="showReferenceSection" class="px-4 pb-4 space-y-3">
                  <p class="text-xs text-text-secondary">
                    Paste a sample of the writing style you want to capture. The AI will analyze it and generate a style guide.
                  </p>
                  <textarea
                    v-model="form.referenceText"
                    class="w-full h-40 rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent resize-y"
                    placeholder="Paste reference text here..."
                  />
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    :loading="isGenerating"
                    :disabled="!form.referenceText.trim()"
                    class="w-full"
                    @click="generateFromReference"
                  >
                    <Sparkles :size="14" />
                    <span>Generate Style Guide</span>
                  </BaseButton>
                </div>
              </div>
            </div>

            <div class="px-5 py-3 border-t border-surface-4 shrink-0 flex justify-end gap-2">
              <BaseButton variant="ghost" size="sm" @click="showDrawer = false">Cancel</BaseButton>
              <BaseButton
                variant="primary"
                size="sm"
                :disabled="!form.name.trim()"
                @click="saveStyle"
              >
                {{ editingId ? 'Save Changes' : 'Create Style' }}
              </BaseButton>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <ConfirmDialog
      v-model="showDeleteConfirm"
      title="Delete Style"
      message="This will permanently delete this writing style. Projects using it will fall back to the default style."
      confirm-text="Delete"
      variant="danger"
      @confirm="confirmDelete"
    />
  </div>
</template>
