<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGenerationStore, type ChapterAuditIssue } from '@/stores/generation'
import { useToast } from '@/composables/useToast'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import { AlertTriangle, CheckCircle2, FileSearch, Send, ShieldCheck, Sparkles } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  projectId?: string
  chapterId?: string
  actionMode?: 'detail' | 'workflow'
  chapterTitle: string
  chapterNumber: number
  content: string
  chapterOutline: Record<string, any>
  characters: string
  relationships: string
  storyOutline: string
  language: string
  writingFormat: string
}>(), {
  actionMode: 'detail',
})

const emit = defineEmits<{
  fix: [instruction: string]
  issuesFound: [issues: ChapterAuditIssue[]]
  quickSubmitPolish: []
}>()

const genStore = useGenerationStore()
const toast = useToast()

const issues = ref<ChapterAuditIssue[]>([])
const isProofereading = ref(false)
const selectedIssueId = ref<string | null>(null)
const proofreadingTriggered = ref(false)

const hasContent = computed(() => props.content.trim().length > 0)
const selectedIssue = computed(() => issues.value.find(issue => issue.id === selectedIssueId.value) ?? null)
const isDetailMode = computed(() => props.actionMode === 'detail')
const isWorkflowMode = computed(() => props.actionMode === 'workflow')

const severityVariant = computed(() => (severity: ChapterAuditIssue['severity']) => {
  if (severity === 'high') return 'danger'
  if (severity === 'medium') return 'warning'
  return 'default'
})

// Watch for content changes and reset issues
watch(() => props.content, () => {
  issues.value = []
  selectedIssueId.value = null
  proofreadingTriggered.value = false
})

function buildProofreadPrompt() {
  return [
    'The application has already selected the current chapter. Proofread only this chapter; do not choose or request another chapter.',
    `Current Chapter: ${props.chapterNumber}. ${props.chapterTitle}`,
    `Language: ${props.language}`,
    `Format: ${props.writingFormat}`,
    `Story Outline:\n${props.storyOutline || 'None provided.'}`,
    `Chapter Plan:\n${JSON.stringify(props.chapterOutline, null, 2)}`,
    `Compact Character Directory:\n${props.characters || 'None provided.'}`,
    `Relationship Lookup:\n${props.relationships || 'Use relationship query tools when available.'}`,
    'Use relationship/character tools for specific facts instead of assuming full context is in this prompt.',
    `Current Chapter Content:\n${props.content}`,
  ].join('\n\n')
}

async function proofread() {
  if (!hasContent.value || isProofereading.value) return

  isProofereading.value = true
  selectedIssueId.value = null
  proofreadingTriggered.value = true

  try {
    issues.value = await genStore.proofreadChapterWithToolChunked(buildProofreadPrompt(), props.projectId)
    if (props.projectId && props.chapterId) {
      await genStore.saveChapterProofreadingIssues(props.projectId, props.chapterId, issues.value, props.content)
    }
    selectedIssueId.value = issues.value[0]?.id ?? null
    emit('issuesFound', issues.value)

    if (!issues.value.length) {
      toast.success('No errors found')
    } else {
      toast.success(`Found ${issues.value.length} issue${issues.value.length === 1 ? '' : 's'}`)
    }
  } catch (error: any) {
    toast.error(error?.message || 'Proofreading failed')
  } finally {
    isProofereading.value = false
  }
}

// Expose proofread method for external calls
defineExpose({ proofread })

function buildFixInstruction(items: ChapterAuditIssue[]) {
  const issueText = items.map((issue, index) => [
    `${index + 1}. ${issue.title}`,
    `Severity: ${issue.severity}`,
    `Category: ${issue.category}`,
    issue.excerpt ? `Excerpt: ${issue.excerpt}` : '',
    `Problem: ${issue.explanation}`,
    `Fix: ${issue.suggestedFix}`,
  ].filter(Boolean).join('\n')).join('\n\n')

  return [
    'Fix the following Proofreading Expert findings in the current chapter.',
    props.writingFormat === 'markdown'
      ? 'Preserve the chapter plan, characters, relationship continuity, and Markdown formatting.'
      : 'Preserve the chapter plan, characters, and relationship continuity. Output Plain Text by default; do not add Markdown headings, chapter title lines, or chapter number lines unless the Writing Style Guide explicitly requires them.',
    'Return the full revised chapter content through the replace_chapter_content tool.',
    '',
    issueText,
  ].join('\n')
}

function fixIssue(issue: ChapterAuditIssue) {
  emit('fix', buildFixInstruction([issue]))
}

function fixAll() {
  if (!issues.value.length) return
  emit('fix', buildFixInstruction(issues.value))
}

function submitToPolish() {
  emit('quickSubmitPolish')
}
</script>

<template>
  <div class="flex h-full flex-col bg-surface-1">
    <div class="flex h-[45px] shrink-0 items-center border-b border-surface-4 bg-surface-2 px-4 py-2">
      <div class="flex items-center gap-2">
        <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/20 bg-accent/10">
          <ShieldCheck :size="13" class="text-accent" />
        </div>
        <div class="min-w-0">
          <h3 class="truncate text-xs font-semibold text-text-primary">Proofreading Expert</h3>
          <p class="truncate text-[9px] font-bold uppercase tracking-widest text-text-muted">Grammar & consistency audit</p>
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-3 py-4">
      <div v-if="!hasContent" class="flex h-full flex-col items-center justify-center text-center">
        <FileSearch :size="24" class="mb-3 text-text-muted" />
        <p class="text-sm font-medium text-text-primary">No chapter content</p>
        <p class="mt-1 max-w-[240px] text-xs text-text-secondary">Write or generate chapter text before running a proofread.</p>
      </div>

      <div v-else-if="isProofereading" class="flex h-full flex-col items-center justify-center text-center">
        <Sparkles :size="24" class="mb-3 animate-pulse text-accent" />
        <p class="text-sm font-medium text-text-primary">Proofreading chapter...</p>
        <p class="mt-1 max-w-[260px] text-xs text-text-secondary">
          Checking grammar, consistency, character facts, and pacing.
        </p>
      </div>

      <div v-else-if="!issues.length && !isProofereading" class="flex h-full flex-col items-center justify-center text-center">
        <CheckCircle2 :size="24" class="mb-3 text-success" />
        <p class="text-sm font-medium text-text-primary">No issues found</p>
        <p class="mt-1 max-w-[260px] text-xs text-text-secondary">
          This chapter has been proofread.
          <br class="mt-2" />
          Issues will appear below when detected.
        </p>
      </div>

      <div v-else class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="text-xs font-semibold text-text-primary">{{ issues.length }} issue{{ issues.length === 1 ? '' : 's' }} found</p>
            <p class="text-[10px] text-text-muted">Click an issue to inspect it.</p>
          </div>
          <BaseButton v-if="isDetailMode" variant="primary" size="sm" :disabled="!issues.length" @click="fixAll">
            <Send :size="13" />
            <span>Fix all</span>
          </BaseButton>
        </div>

        <button
          v-for="issue in issues"
          :key="issue.id"
          class="w-full rounded-lg border p-3 text-left transition-colors"
          :class="selectedIssueId === issue.id ? 'border-accent/50 bg-accent-subtle/50' : 'border-surface-4 bg-surface-2 hover:border-surface-5'"
          @click="selectedIssueId = issue.id"
        >
          <div class="mb-2 flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <AlertTriangle :size="13" class="text-accent" />
                <p class="truncate text-xs font-semibold text-text-primary">{{ issue.title }}</p>
              </div>
              <p class="mt-1 text-[10px] uppercase tracking-wider text-text-muted">{{ issue.category }}</p>
            </div>
            <BaseTag :variant="severityVariant(issue.severity)" size="sm">{{ issue.severity }}</BaseTag>
          </div>
          <p v-if="issue.excerpt" class="rounded border border-surface-4 bg-surface-1 px-2 py-1.5 text-[11px] leading-relaxed text-text-secondary">
            {{ issue.excerpt }}
          </p>
        </button>
      </div>
    </div>

    <div v-if="selectedIssue" class="shrink-0 border-t border-surface-4 bg-surface-2/60 p-3">
      <p class="text-xs font-semibold text-text-primary">{{ selectedIssue.title }}</p>
      <p class="mt-2 text-xs leading-relaxed text-text-secondary">{{ selectedIssue.explanation }}</p>
      <p class="mt-2 text-xs leading-relaxed text-text-primary">{{ selectedIssue.suggestedFix }}</p>
      <BaseButton v-if="isDetailMode" class="mt-3 w-full" variant="primary" size="sm" @click="fixIssue(selectedIssue)">
        <Send :size="13" />
        <span>Send this to Vibe AI</span>
      </BaseButton>
    </div>

    <div v-if="isWorkflowMode && issues.length" class="shrink-0 border-t border-surface-4 bg-surface-2/60 p-3">
      <p class="text-xs font-semibold text-text-primary mb-2">Ready to polish?</p>
      <BaseButton class="w-full" variant="primary" size="sm" @click="submitToPolish">
        <Sparkles :size="13" />
        <span>Quick Submit to Polish</span>
      </BaseButton>
    </div>
  </div>
</template>

