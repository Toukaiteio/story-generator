<script setup lang="ts">
import { computed, onMounted, ref, reactive } from 'vue'
import { useUiStore } from '@/stores/ui'
import { useWritingStyleStore } from '@/stores/writingStyle'
import { useProviderStore } from '@/stores/provider'
import { useToast } from '@/composables/useToast'
import { providerManager, type ToolDefinition, type ToolCall } from '@/services/provider'
import { injectCustomSystemPrompt } from '@/services/systemPrompt'
import type { ChatMessage } from '@/types/provider'
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
  Loader2,
  Download,
  Upload,
} from 'lucide-vue-next'
import type { WritingStyle, WritingStyleSource } from '@/types/writingStyle'

const ui = useUiStore()
const styleStore = useWritingStyleStore()
const providerStore = useProviderStore()
const toast = useToast()

const fileInput = ref<HTMLInputElement | null>(null)

function exportStyle(style: WritingStyle) {
  try {
    const data = JSON.stringify(style, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `style-${style.name.toLowerCase().replace(/\s+/g, '-')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success('Style exported successfully')
  } catch (error) {
    toast.error('Failed to export style')
  }
}

function triggerImport() {
  fileInput.value?.click()
}

async function handleImport(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const data = JSON.parse(text)

    // Basic validation
    if (!data.name || !data.content) {
      throw new Error('Invalid style file format')
    }

    styleStore.createStyle({
      name: `${data.name} (Imported)`,
      description: data.description || '',
      content: data.content,
      source: 'manual',
      tags: Array.isArray(data.tags) ? data.tags : [],
    })

    toast.success('Style imported successfully')
  } catch (error: any) {
    toast.error(error.message || 'Failed to import style')
  } finally {
    target.value = ''
  }
}

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
  source: 'manual' as WritingStyleSource,
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
  resetGenerationState()
  editingId.value = null
  form.name = ''
  form.description = ''
  form.content = ''
  form.tags = ''
  form.referenceText = ''
  form.source = 'manual'
  showReferenceSection.value = false
  showDrawer.value = true
}

function openEditDrawer(style: WritingStyle) {
  resetGenerationState()
  editingId.value = style.id
  form.name = style.name
  form.description = style.description
  form.content = style.content
  form.tags = style.tags.join(', ')
  form.referenceText = ''
  form.source = style.source
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
      source: form.source,
    })
    toast.success('Style updated')
  } else {
    styleStore.createStyle({
      name: form.name.trim(),
      description: form.description.trim(),
      content: form.content,
      source: form.source,
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

type StyleDraft = {
  name: string
  description: string
  tags: string[]
  content: string
}

const STYLE_GENERATION_MAX_RETRIES = 2
const STYLE_GENERATION_MAX_TOOL_ROUNDS = 8

const generationPhase = ref('')
const generationStatus = ref('')
const generationCurrentTool = ref('')
const generationCurrentFields = ref<string[]>([])
const generationAttempt = ref(0)
const generationRound = ref(0)
const generationEvents = ref<string[]>([])
const generationAssistantText = ref('')

function normalizeStyleTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  }

  return []
}

function applyStyleDraftUpdate(draft: StyleDraft, payload: Record<string, unknown>) {
  if (typeof payload.name === 'string' && payload.name.trim()) {
    draft.name = payload.name.trim()
  }

  if (typeof payload.description === 'string' && payload.description.trim()) {
    draft.description = payload.description.trim()
  }

  if ('tags' in payload) {
    draft.tags = normalizeStyleTags(payload.tags)
  }

  if (typeof payload.content === 'string' && payload.content.trim()) {
    draft.content = payload.content.trim()
  }

  if (typeof payload.contentChunk === 'string' && payload.contentChunk.trim()) {
    const chunk = payload.contentChunk.trim()
    const sectionTitle = typeof payload.contentSectionTitle === 'string'
      ? payload.contentSectionTitle.trim()
      : ''

    const chunkText = sectionTitle
      ? '## ' + sectionTitle + '\n' + chunk
      : chunk

    draft.content = draft.content
      ? draft.content + '\n\n' + chunkText
      : chunkText
  }
}

function buildDraftSummary(draft: StyleDraft): string {
  return 'Name: ' + (draft.name || '(empty)')
    + '\nDescription: ' + (draft.description || '(empty)')
    + '\nTags: ' + (draft.tags.length ? draft.tags.join(', ') : '(empty)')
    + '\nStyle Guide Content length: ' + draft.content.length + ' chars'
}

function buildToolResponse(draft: StyleDraft, updatedFields: string[]): string {
  return JSON.stringify({
    ok: true,
    updatedFields,
    draft: {
      name: draft.name || '',
      description: draft.description || '',
      tags: draft.tags,
      contentLength: draft.content.length,
      contentTail: draft.content.slice(-300),
    },
  })
}

function resetGenerationState() {
  generationPhase.value = ''
  generationStatus.value = ''
  generationCurrentTool.value = ''
  generationCurrentFields.value = []
  generationAttempt.value = 0
  generationRound.value = 0
  generationEvents.value = []
  generationAssistantText.value = ''
}

function pushGenerationEvent(message: string) {
  const timestamp = new Date().toLocaleTimeString()
  generationEvents.value = [...generationEvents.value.slice(-7), '[' + timestamp + '] ' + message]
}

function syncDraftToForm(draft: StyleDraft) {
  form.name = draft.name
  form.description = draft.description
  form.tags = draft.tags.join(', ')
  form.content = draft.content
  form.source = 'ai-generated'
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}
async function generateFromReference() {
  if (!form.referenceText.trim()) {
    toast.warning('Please paste some reference text first')
    return
  }

  resetGenerationState()
  isGenerating.value = true
  pushGenerationEvent('Starting analysis from the reference text.')

  try {
    providerManager.setProviders(providerStore.providers)
    providerStore.ensureAgentModelBindings()

    const binding = providerStore.getAgentModelBinding('writer')
      ?? providerStore.getDefaultModelRefForRole('writer')

    if (!binding) {
      toast.warning('No available model. Please configure a provider first.')
      pushGenerationEvent('No available model found.')
      return
    }

    const match = providerStore.getModelByRef(binding)
    if (!match) {
      toast.warning('Selected model not found')
      pushGenerationEvent('Selected model not found.')
      return
    }

    const analysisTool: ToolDefinition = {
      name: 'update_style_draft',
      description: 'Update one or more fields of the writing style draft. Use this tool to set the style name, description, tags, or add a chunk of the style guide content. Multiple fields can be filled in the same call.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Style Name. Concise, specific, and suitable for reuse.',
          },
          description: {
            type: 'string',
            description: 'Brief description of the style.',
          },
          tags: {
            type: 'array',
            description: 'Tags for the style. Provide as an array of short strings.',
            items: { type: 'string' },
          },
          content: {
            type: 'string',
            description: 'Replace the full Style Guide Content with this markdown text.',
          },
          contentChunk: {
            type: 'string',
            description: 'Append a chunk of Style Guide Content. Prefer this for long guides and split the guide into multiple chunks.',
          },
          contentSectionTitle: {
            type: 'string',
            description: 'Optional markdown section title for the contentChunk. If provided, the chunk will be appended under this heading.',
          },
        },
        required: [],
      },
    }

    let finalDraft: StyleDraft = {
      name: '',
      description: '',
      tags: [],
      content: '',
    }
    let repairContext = ''

    for (let attempt = 0; attempt <= STYLE_GENERATION_MAX_RETRIES; attempt++) {
      generationAttempt.value = attempt + 1
      generationRound.value = 0
      generationCurrentTool.value = ''
      generationCurrentFields.value = []
      generationAssistantText.value = ''
      generationPhase.value = 'Analysis pass ' + (attempt + 1) + '/' + (STYLE_GENERATION_MAX_RETRIES + 1)
      generationStatus.value = repairContext
        ? 'Revising the previous draft with validation feedback...'
        : 'Reading the reference text and preparing the first draft...'
      pushGenerationEvent(repairContext
        ? 'Retrying with validation feedback.'
        : 'Analyzing the reference text.')
      await waitForPaint()

      const attemptDraft: StyleDraft = {
        name: '',
        description: '',
        tags: [],
        content: '',
      }

      const guideMessages: ChatMessage[] = [
        {
          role: 'system',
          content: injectCustomSystemPrompt('You are an expert literary analyst. Analyze the reference text and build a writing style draft. Use the provided tool to fill the style name, description, tags, and Style Guide Content. You may set multiple fields in the same tool call. For Style Guide Content, split long output into multiple smaller chunks rather than dumping everything at once. Prefer one section or subsection per chunk. Do not add meta commentary in plain text; use the tool for structured output.'),
        },
        {
          role: 'user',
          content: repairContext
            ? 'The previous style draft did not accurately capture the style of the reference text. Issues found:\n' + repairContext + '\n\nPlease revise the draft to better match the reference text\'s actual style.\n\nCurrent draft snapshot:\n' + buildDraftSummary(finalDraft) + '\n\nReference text:\n' + form.referenceText
            : 'Analyze the following reference text and produce a complete writing style draft.\n\nRequirements:\n- Fill Style Name, Description, Tags, and Style Guide Content.\n- You may fill several fields in the same tool call.\n- For Style Guide Content, split the output into multiple chunks if it is long. Use several smaller chunks instead of one large block.\n- Keep the style guide markdown clean and reusable.\n\nReference text:\n' + form.referenceText,
        },
      ]

      for (let round = 0; round < STYLE_GENERATION_MAX_TOOL_ROUNDS; round++) {
        generationRound.value = round + 1
        generationPhase.value = 'Analysis pass ' + (attempt + 1) + '/' + (STYLE_GENERATION_MAX_RETRIES + 1) + ' · Round ' + (round + 1)
        generationStatus.value = 'Streaming the model response...'
        generationAssistantText.value = ''
        let streamedResult: any = null
        let streamedContent = ''

        await providerManager.streamWithTools(
          guideMessages,
          binding,
          [analysisTool],
          {
            onToken: (token) => {
              streamedContent += token
              generationAssistantText.value = (generationAssistantText.value + token).slice(-500)
              generationStatus.value = 'AI is thinking and drafting...'
            },
            onToolCall: (toolCall) => {
              generationCurrentTool.value = toolCall.name
              generationStatus.value = 'Tool call detected: ' + toolCall.name
              pushGenerationEvent('Tool call detected: ' + toolCall.name)
            },
            onToolResult: () => {},
            onComplete: (response) => {
              streamedResult = response
            },
            onError: (error) => {
              throw error
            },
          },
          4096,
          0.45
        )

        if (!streamedResult) {
          throw new Error('Stream failed to complete')
        }

        if (!streamedResult.tool_calls.length) {
          if (!attemptDraft.content.trim()) {
            const text = streamedResult.content || streamedContent
            if (text && text.trim()) {
              attemptDraft.content = text.trim()
            }
          }
          generationStatus.value = 'Model finished without additional tool calls.'
          pushGenerationEvent('No more tool calls were requested.')
          await waitForPaint()
          break
        }

        guideMessages.push({
          role: 'assistant',
          content: streamedResult.content || null,
          reasoning_content: streamedResult.reasoning_content ?? null,
          tool_calls: streamedResult.tool_calls.map((tc: ToolCall) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        })

        for (const toolCall of streamedResult.tool_calls) {
          if (toolCall.name !== 'update_style_draft') {
            throw new Error('Unsupported tool call: ' + toolCall.name)
          }

          const before = {
            name: attemptDraft.name,
            description: attemptDraft.description,
            tags: [...attemptDraft.tags],
            content: attemptDraft.content,
          }

          applyStyleDraftUpdate(attemptDraft, toolCall.arguments ?? {})

          const updatedFields: string[] = []
          if (attemptDraft.name !== before.name) updatedFields.push('name')
          if (attemptDraft.description !== before.description) updatedFields.push('description')
          if (attemptDraft.tags.join('|') !== before.tags.join('|')) updatedFields.push('tags')
          if (attemptDraft.content !== before.content) updatedFields.push('content')

          syncDraftToForm(attemptDraft)
          generationCurrentFields.value = updatedFields
          generationStatus.value = updatedFields.length
            ? 'Live preview updated: ' + updatedFields.join(', ')
            : 'Live preview updated.'
          pushGenerationEvent(
            updatedFields.length
              ? 'Updated ' + updatedFields.join(', ') + ' · ' + attemptDraft.content.length + ' chars'
              : 'Applied a tool update to the live draft.'
          )
          await waitForPaint()

          guideMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: buildToolResponse(attemptDraft, updatedFields),
          })
        }
      }

      if (!attemptDraft.content.trim()) {
        generationPhase.value = 'Fallback generation'
        generationStatus.value = 'Using a fallback markdown response because the tool flow did not produce content.'
        pushGenerationEvent('Tool flow did not produce any content; using fallback output.')
        await waitForPaint()

        const legacyGuideMessages: ChatMessage[] = [
          {
            role: 'system',
            content: injectCustomSystemPrompt('You are an expert literary analyst. You analyze reference texts and produce detailed writing style guides. Output only the style guide in clean markdown. Do not add meta commentary.'),
          },
          {
            role: 'user',
            content: repairContext
              ? 'The previous style guide did not accurately capture the style of the reference text. Issues found:\n' + repairContext + '\n\nPlease revise the style guide to better match the reference text\'s actual style.\n\nReference text:\n' + form.referenceText
              : 'Analyze the following reference text and produce a comprehensive writing style guide.\nThe guide should cover: tone, voice, sentence structure, vocabulary level, pacing, dialogue style, description approach, narrative perspective, and any distinctive literary techniques.\n\nOutput the style guide as clean markdown with section headers.\n\nReference text:\n' + form.referenceText,
          },
        ]

        attemptDraft.content = await providerManager.chat(legacyGuideMessages, binding, 4096, 0.5)
      }

      finalDraft = {
        name: attemptDraft.name,
        description: attemptDraft.description,
        tags: [...attemptDraft.tags],
        content: attemptDraft.content,
      }

      generationPhase.value = 'Validation sample'
      generationStatus.value = 'Generating a short sample passage for validation...'
      pushGenerationEvent('Generating a validation sample passage.')
      await waitForPaint()

      const sampleMessages: ChatMessage[] = [
        {
          role: 'system',
          content: injectCustomSystemPrompt('You are a creative writer. You write strictly following the provided style guide. Output only the sample text, no meta commentary.'),
        },
        {
          role: 'user',
          content: 'Write a short sample passage (200-400 words) that demonstrates the writing style described in the following guide. The passage should be original fiction, not a copy of any reference text.\n\nStyle Guide:\n' + finalDraft.content,
        },
      ]

      const sampleText = await providerManager.chat(sampleMessages, binding, 2048, 0.7)

      generationPhase.value = 'Style comparison'
      generationStatus.value = 'Comparing the sample against the reference text...'
      pushGenerationEvent('Comparing the generated sample against the reference text.')
      await waitForPaint()

      const compareMessages: ChatMessage[] = [
        {
          role: 'system',
          content: injectCustomSystemPrompt('You are a literary style comparison expert. You compare two texts and determine if they share the same writing style. Respond ONLY with a JSON object: { "match": true/false, "feedback": "brief explanation of similarities and differences" }'),
        },
        {
          role: 'user',
          content: 'Compare the writing styles of these two texts. Do they share the same tone, voice, sentence structure, vocabulary level, pacing, and literary techniques?\n\nText A (Reference):\n' + form.referenceText + '\n\nText B (Sample generated from style guide):\n' + sampleText + '\n\nRespond with only JSON: { "match": true or false, "feedback": "explanation" }',
        },
      ]

      const comparisonResult = await providerManager.chat(compareMessages, binding, 1024, 0.2)

      let verdict: { match: boolean; feedback: string }
      try {
        const jsonStr = comparisonResult.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim()
        verdict = JSON.parse(jsonStr)
      } catch {
        verdict = { match: true, feedback: 'Could not parse comparison result, accepting style guide.' }
      }

      if (verdict.match) {
        syncDraftToForm(finalDraft)
        generationPhase.value = 'Completed'
        generationStatus.value = 'Style guide generated, validated, and applied to the form.'
        pushGenerationEvent('Validation passed successfully.')
        await waitForPaint()
        toast.success('Style guide generated and validated')
        return
      }

      if (attempt < STYLE_GENERATION_MAX_RETRIES) {
        repairContext = (verdict.feedback || 'The generated style guide does not accurately capture the reference text style.') + '\n\nCurrent draft snapshot:\n' + buildDraftSummary(finalDraft)
        generationPhase.value = 'Validation failed'
        generationStatus.value = 'Retrying with the feedback from validation...'
        pushGenerationEvent('Validation failed: ' + (verdict.feedback || 'No feedback provided.'))
        await waitForPaint()
        toast.warning('Style validation failed (attempt ' + (attempt + 1) + '/' + (STYLE_GENERATION_MAX_RETRIES + 1) + '). Retrying...')
      } else {
        syncDraftToForm(finalDraft)
        generationPhase.value = 'Completed with warning'
        generationStatus.value = 'The style guide was generated but may not fully match the reference text.'
        pushGenerationEvent('Final attempt accepted with a warning.')
        await waitForPaint()
        toast.warning('Style guide generated but may not fully match the reference text. Please review manually.')
      }
    }
  } catch (error: any) {
    generationPhase.value = 'Failed'
    generationStatus.value = error?.message || 'Failed to generate style guide'
    pushGenerationEvent('Error: ' + (error?.message || 'Failed to generate style guide'))
    toast.error(error?.message || 'Failed to generate style guide')
  } finally {
    isGenerating.value = false
    generationCurrentTool.value = ''
    generationCurrentFields.value = []
    await waitForPaint().catch(() => {})
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
        <h1 class="text-lg font-semibold text-text-primary">{{ ui.text('Writing Styles') }}</h1>
        <p class="text-xs text-text-secondary mt-0.5">
          {{ ui.text('Create and manage reusable writing style guides for story generation') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <input
          ref="fileInput"
          type="file"
          accept=".json"
          class="hidden"
          @change="handleImport"
        />
        <BaseButton variant="secondary" size="sm" @click="triggerImport">
          <Upload :size="14" />
          <span>{{ ui.text('Import') }}</span>
        </BaseButton>
        <BaseButton variant="primary" size="sm" @click="openCreateDrawer">
          <Plus :size="14" />
          <span>{{ ui.text('Create Style') }}</span>
        </BaseButton>
      </div>
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
                <h3 class="text-sm font-semibold text-text-primary">{{ ui.text('Default (No Reference)') }}</h3>
                <BaseTag variant="default" size="sm">{{ ui.text('Built-in') }}</BaseTag>
              </div>
              <p class="text-xs text-text-secondary mt-0.5">
                {{ ui.text('The AI will infer an appropriate writing style from the genre, theme, and target reader.') }}
              </p>
            </div>
          </div>
        </BaseCard>

        <EmptyState
          v-if="!styleStore.styles.length && !searchQuery"
          :icon="Palette"
          :title="ui.text('No custom styles yet')"
          :description="ui.text('Create a writing style guide to give your story a consistent voice. You can write one manually or let AI analyze a reference text.')"
        >
          <template #action>
            <BaseButton variant="primary" size="sm" @click="openCreateDrawer">
              <Plus :size="14" />
              <span>{{ ui.text('Create Style') }}</span>
            </BaseButton>
          </template>
        </EmptyState>

        <EmptyState
          v-else-if="!filteredStyles.length && searchQuery"
          :icon="Palette"
          :title="ui.text('No matching styles')"
          :description="ui.text('Try a different search term.')"
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
                    {{ ui.text(formatSource(style.source)) }}
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
                    {{ style.content.length }} {{ ui.text('characters') }} · {{ ui.text('Updated') }} {{ new Date(style.updatedAt).toLocaleDateString() }}
                  </p>
                </div>
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <button
                  class="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors duration-100"
                  :title="ui.text('Export Style')"
                  @click="exportStyle(style)"
                >
                  <Download :size="14" />
                </button>
                <button
                  class="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors duration-100"
                  :title="ui.text('Edit Style')"
                  @click="openEditDrawer(style)"
                >
                  <Pencil :size="14" />
                </button>
                <button
                  class="w-7 h-7 flex items-center justify-center rounded text-text-muted hover:text-danger hover:bg-danger-subtle transition-colors duration-100"
                  :title="ui.text('Delete Style')"
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
                {{ ui.text(editingId ? 'Edit Style' : 'Create Style') }}
              </h2>
              <button
                class="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-3 transition-colors duration-100"
                @click="showDrawer = false"
              >
                <X :size="16" />
              </button>
            </div>

            <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-4">
              <div v-if="isGenerating || generationEvents.length" class="rounded-lg border border-accent/30 bg-accent-subtle/20 p-4 space-y-3">
                <div class="flex items-start gap-3">
                  <div class="w-9 h-9 rounded-lg bg-surface-1 flex items-center justify-center shrink-0">
                    <Loader2 :size="16" class="text-accent animate-spin" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between gap-2">
                      <p class="text-sm font-semibold text-text-primary">{{ generationPhase || 'Preparing analysis' }}</p>
                      <BaseTag variant="accent" size="sm">{{ ui.text('Live') }}</BaseTag>
                    </div>
                    <p class="text-xs text-text-secondary mt-1">
                      {{ generationStatus || 'Waiting for model response...' }}
                    </p>
                    <div class="flex flex-wrap gap-1.5 mt-2">
                      <BaseTag v-if="generationCurrentTool" size="sm" variant="default">Tool: {{ generationCurrentTool }}</BaseTag>
                      <BaseTag size="sm" variant="default">Attempt {{ generationAttempt }}/{{ STYLE_GENERATION_MAX_RETRIES + 1 }}</BaseTag>
                      <BaseTag size="sm" variant="default">Round {{ generationRound }}/{{ STYLE_GENERATION_MAX_TOOL_ROUNDS }}</BaseTag>
                    </div>
                  </div>
                </div>

                <div class="grid grid-cols-3 gap-2 text-xs">
                  <div class="rounded-md border border-surface-4 bg-surface-1 px-2 py-2 min-w-0">
                    <div class="text-2xs text-text-muted">{{ ui.text('Style Name') }}</div>
                    <div class="text-text-primary truncate">{{ form.name || '—' }}</div>
                  </div>
                  <div class="rounded-md border border-surface-4 bg-surface-1 px-2 py-2 min-w-0">
                    <div class="text-2xs text-text-muted">{{ ui.text('Tags') }}</div>
                    <div class="text-text-primary truncate">{{ form.tags || '—' }}</div>
                  </div>
                  <div class="rounded-md border border-surface-4 bg-surface-1 px-2 py-2 min-w-0">
                    <div class="text-2xs text-text-muted">{{ ui.text('Content') }}</div>
                    <div class="text-text-primary">{{ form.content.length }} chars</div>
                  </div>
                </div>

                <div v-if="generationCurrentFields.length" class="flex flex-wrap gap-1.5">
                  <BaseTag v-for="field in generationCurrentFields" :key="field" size="sm" variant="accent">{{ field }}</BaseTag>
                </div>

                <div v-if="generationAssistantText" class="rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 text-[11px] leading-5 text-text-secondary max-h-28 overflow-y-auto whitespace-pre-wrap break-words">
                  {{ generationAssistantText }}
                </div>

                <div v-if="generationEvents.length" class="space-y-1">
                  <p class="text-2xs font-medium uppercase tracking-wide text-text-muted">{{ ui.text('Recent updates') }}</p>
                  <div class="max-h-28 overflow-y-auto space-y-1">
                    <p v-for="event in generationEvents" :key="event" class="text-2xs text-text-secondary">{{ event }}</p>
                  </div>
                </div>
              </div>

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
                  <label class="text-xs font-medium text-text-secondary">{{ ui.text('Style Guide Content') }}</label>
                  <span class="text-2xs text-text-muted">{{ form.content.length }} {{ ui.text('chars') }}</span>
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
                    <span class="text-sm font-medium text-text-primary">{{ ui.text('Analyze Reference Text') }}</span>
                  </div>
                  <span class="text-xs text-text-muted">
                    {{ ui.text(showReferenceSection ? 'Hide' : 'Show') }}
                  </span>
                </button>

                <div v-if="showReferenceSection" class="px-4 pb-4 space-y-3">
                  <p class="text-xs text-text-secondary">
                    {{ ui.text('Paste a sample of the writing style you want to capture. The AI will analyze it, fill Style Name / Description / Tags / Style Guide Content, and can split the guide into smaller chunks for better accuracy.') }}
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
                    <span>{{ ui.text('Generate Style Guide') }}</span>
                  </BaseButton>
                </div>
              </div>
            </div>

            <div class="px-5 py-3 border-t border-surface-4 shrink-0 flex justify-end gap-2">
              <BaseButton variant="ghost" size="sm" @click="showDrawer = false">{{ ui.text('Cancel') }}</BaseButton>
              <BaseButton
                variant="primary"
                size="sm"
                :disabled="isGenerating || !form.name.trim()"
                @click="saveStyle"
              >
                {{ ui.text(editingId ? 'Save Changes' : 'Create Style') }}
              </BaseButton>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>

    <ConfirmDialog
      v-model="showDeleteConfirm"
      :title="ui.text('Delete Style')"
      :message="ui.text('This will permanently delete this writing style. Projects using it will fall back to the default style.')"
      :confirm-text="ui.text('Delete')"
      variant="danger"
      @confirm="confirmDelete"
    />
  </div>
</template>
