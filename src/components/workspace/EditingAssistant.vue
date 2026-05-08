<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGenerationStore, type ChapterAuditIssue } from '@/stores/generation'
import { useToast } from '@/composables/useToast'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import { AlertTriangle, CheckCircle2, FileSearch, Send, ShieldCheck } from 'lucide-vue-next'

const props = defineProps<{
  chapterTitle: string
  chapterNumber: number
  content: string
  chapterPlan: Record<string, any>
  characters: string
  relationships: string
  storyOutline: string
  writingFormat: string
}>()

const emit = defineEmits<{
  fix: [instruction: string]
}>()

const genStore = useGenerationStore()
const toast = useToast()

const issues = ref<ChapterAuditIssue[]>([])
const isAuditing = ref(false)
const selectedIssueId = ref<string | null>(null)

const hasContent = computed(() => props.content.trim().length > 0)
const selectedIssue = computed(() => issues.value.find(issue => issue.id === selectedIssueId.value) ?? null)

const severityVariant = computed(() => (severity: ChapterAuditIssue['severity']) => {
  if (severity === 'high') return 'danger'
  if (severity === 'medium') return 'warning'
  return 'default'
})

function buildAuditPrompt() {
  return [
    'The application has already selected the current chapter. Audit only this chapter; do not choose or request another chapter.',
    `Current Chapter: ${props.chapterNumber}. ${props.chapterTitle}`,
    `Format: ${props.writingFormat}`,
    `Story Outline:\n${props.storyOutline || 'None provided.'}`,
    `Chapter Plan:\n${JSON.stringify(props.chapterPlan, null, 2)}`,
    `Characters:\n${props.characters || 'None provided.'}`,
    `Relationship Context:\n${props.relationships || 'No relationship context available.'}`,
    `Current Chapter Content:\n${props.content}`,
  ].join('\n\n')
}

async function audit() {
  if (!hasContent.value || isAuditing.value) return

  isAuditing.value = true
  selectedIssueId.value = null
  try {
    issues.value = await genStore.auditChapterWithTool(buildAuditPrompt())
    selectedIssueId.value = issues.value[0]?.id ?? null
    if (!issues.value.length) {
      toast.success('Editing AI found no concrete issues')
    }
  } catch (error: any) {
    toast.error(error?.message || 'Editing AI audit failed')
  } finally {
    isAuditing.value = false
  }
}

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
    'Fix the following Editing AI findings in the current chapter.',
    'Preserve the chapter plan, characters, relationship continuity, and Markdown formatting.',
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
</script>

<template>
  <div class="flex h-full flex-col bg-surface-1">
    <div class="shrink-0 border-b border-surface-4 px-3 py-2">
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-warning/20 bg-warning/10">
            <ShieldCheck :size="13" class="text-warning" />
          </div>
          <div class="min-w-0">
            <h3 class="truncate text-xs font-semibold text-text-primary">Editing AI</h3>
            <p class="truncate text-[9px] font-bold uppercase tracking-widest text-text-muted">Plan and fact audit</p>
          </div>
        </div>
        <BaseButton variant="secondary" size="sm" :loading="isAuditing" :disabled="!hasContent" @click="audit">
          <FileSearch :size="13" />
          <span>Scan</span>
        </BaseButton>
      </div>
    </div>

    <div class="flex-1 overflow-y-auto px-3 py-4">
      <div v-if="!hasContent" class="flex h-full flex-col items-center justify-center text-center">
        <FileSearch :size="24" class="mb-3 text-text-muted" />
        <p class="text-sm font-medium text-text-primary">No chapter content</p>
        <p class="mt-1 max-w-[240px] text-xs text-text-secondary">Write or generate chapter text before running an audit.</p>
      </div>

      <div v-else-if="!issues.length && !isAuditing" class="flex h-full flex-col items-center justify-center text-center">
        <CheckCircle2 :size="24" class="mb-3 text-success" />
        <p class="text-sm font-medium text-text-primary">Ready to audit</p>
        <p class="mt-1 max-w-[260px] text-xs text-text-secondary">Scan checks the chapter against plan beats, character state, relationships, continuity, and story-world facts.</p>
      </div>

      <div v-else class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="text-xs font-semibold text-text-primary">{{ issues.length }} issue{{ issues.length === 1 ? '' : 's' }} marked</p>
            <p class="text-[10px] text-text-muted">Click an issue to inspect it.</p>
          </div>
          <BaseButton variant="primary" size="sm" :disabled="!issues.length" @click="fixAll">
            <Send :size="13" />
            <span>Fix all</span>
          </BaseButton>
        </div>

        <button
          v-for="issue in issues"
          :key="issue.id"
          class="w-full rounded-lg border p-3 text-left transition-colors"
          :class="selectedIssueId === issue.id ? 'border-warning/50 bg-warning-subtle/50' : 'border-surface-4 bg-surface-2 hover:border-surface-5'"
          @click="selectedIssueId = issue.id"
        >
          <div class="mb-2 flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <AlertTriangle :size="13" class="text-warning" />
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
      <BaseButton class="mt-3 w-full" variant="primary" size="sm" @click="fixIssue(selectedIssue)">
        <Send :size="13" />
        <span>Send this to Vibe AI</span>
      </BaseButton>
    </div>
  </div>
</template>
