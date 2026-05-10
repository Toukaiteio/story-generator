<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useGenerationStore, type ChapterAuditIssue } from '@/stores/generation'
import { useUiStore } from '@/stores/ui'
import { useProviderStore } from '@/stores/provider'
import { useToast } from '@/composables/useToast'
import { translatePhrase } from '@/i18n'
import { decodeProviderModelRef } from '@/services/provider/catalog'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTag from '@/components/ui/BaseTag.vue'
import VibeModelPicker from '@/components/workspace/VibeModelPicker.vue'
import { AlertTriangle, CheckCircle2, FileSearch, Send, ShieldCheck, Sparkles } from 'lucide-vue-next'

const props = defineProps<{
  projectId?: string
  chapterId?: string
  chapterTitle: string
  chapterNumber: number
  content: string
  chapterPlan: Record<string, any>
  characters: string
  relationships: string
  storyOutline: string
  language: string
  writingFormat: string
  initialIssues?: ChapterAuditIssue[]
  isPolishing?: boolean
}>()

const emit = defineEmits<{
  fix: [instruction: string]
  issuesFound: [issues: ChapterAuditIssue[]]
  issueSelected: [issue: ChapterAuditIssue]
  quickSubmitPolish: [issue?: ChapterAuditIssue]
}>()

const genStore = useGenerationStore()
const ui = useUiStore()
const providerStore = useProviderStore()
const toast = useToast()
const tr = translatePhrase

const issues = ref<ChapterAuditIssue[]>([])
const isAuditing = ref(false)
const selectedIssueId = ref<string | null>(null)
const currentSegment = ref<{ index: number; total: number; completed: number } | null>(null)

const hasContent = computed(() => props.content.trim().length > 0)
const selectedIssue = computed(() => issues.value.find(issue => issue.id === selectedIssueId.value) ?? null)
const auditProgressPercent = computed(() => {
  if (!currentSegment.value?.total) return 0
  return Math.round((currentSegment.value.completed / currentSegment.value.total) * 100)
})

const selectedModelValue = computed({
  get: () => ui.editingAiModelRef,
  set: value => ui.setEditingAiModelRef(value),
})

const selectedModelRef = computed(() => {
  return decodeProviderModelRef(selectedModelValue.value)
})

const severityVariant = computed(() => (severity: ChapterAuditIssue['severity']) => {
  if (severity === 'high') return 'danger'
  if (severity === 'medium') return 'warning'
  return 'default'
})

const severityRank: Record<ChapterAuditIssue['severity'], number> = {
  low: 0,
  medium: 1,
  high: 2,
}

function isIssueIgnored(issue: ChapterAuditIssue) {
  return !!issue.ignored || issue.polishStatus === 'ignored'
}

function isIssueFixed(issue: ChapterAuditIssue) {
  return !isIssueIgnored(issue) && issue.polishStatus === 'fixed'
}

function isBelowPolishThreshold(issue: ChapterAuditIssue) {
  if (isIssueIgnored(issue) || isIssueFixed(issue)) return false
  return severityRank[issue.severity] < severityRank[providerStore.toolWorkflowSettings.minIssueSeverity]
}

const openIssues = computed(() => issues.value.filter(issue => !isIssueIgnored(issue) && !isIssueFixed(issue)))

watch(
  () => [props.content, props.initialIssues] as const,
  () => {
    if (isAuditing.value) return
    issues.value = [...(props.initialIssues || [])]
    selectedIssueId.value = issues.value[0]?.id ?? null
  },
  { immediate: true }
)

function buildAuditPrompt() {
  return [
    'The application has already selected the current chapter. Proofread and edit-audit only this chapter; do not choose or request another chapter.',
    `Current Chapter: ${props.chapterNumber}. ${props.chapterTitle}`,
    `Language: ${props.language}`,
    `Format: ${props.writingFormat}`,
    `Story Outline:\n${props.storyOutline || 'None provided.'}`,
    `Chapter Plan:\n${JSON.stringify(props.chapterPlan, null, 2)}`,
    `Compact Character Directory:\n${props.characters || 'None provided.'}`,
    `Relationship Lookup:\n${props.relationships || 'Use relationship query tools when available.'}`,
    'Use relationship/character tools for specific facts instead of assuming full context is in this prompt.',
    'The chapter text will be submitted in bounded segments. Process only the current segment text while using this context for consistency checks.',
  ].join('\n\n')
}

async function audit() {
  if (!hasContent.value || isAuditing.value) return

  isAuditing.value = true
  selectedIssueId.value = null
  currentSegment.value = null
  issues.value = []
  try {
    issues.value = await genStore.proofreadChapterContentWithTool(buildAuditPrompt(), props.content, props.projectId, {
      modelRef: selectedModelValue.value ? selectedModelRef.value : null,
      onSegmentStart: ({ segmentIndex, segmentTotal }) => {
        currentSegment.value = {
          index: segmentIndex + 1,
          total: segmentTotal,
          completed: segmentIndex,
        }
      },
      onSegmentComplete: async ({ segmentIndex, segmentTotal, allIssues }) => {
        currentSegment.value = {
          index: segmentIndex + 1,
          total: segmentTotal,
          completed: segmentIndex + 1,
        }
        issues.value = allIssues
        selectedIssueId.value = selectedIssueId.value ?? issues.value[0]?.id ?? null
        emit('issuesFound', issues.value)
        if (props.projectId && props.chapterId) {
          await genStore.saveChapterProofreadingIssues(props.projectId, props.chapterId, issues.value, props.content)
        }
      },
    })
    if (props.projectId && props.chapterId) {
      await genStore.saveChapterProofreadingIssues(props.projectId, props.chapterId, issues.value, props.content)
    }
    selectedIssueId.value = issues.value[0]?.id ?? null
    emit('issuesFound', issues.value)
    if (!issues.value.length) {
      toast.success('Editing AI found no concrete issues')
    }
  } catch (error: any) {
    toast.error(error?.message || 'Editing AI audit failed')
  } finally {
    isAuditing.value = false
    currentSegment.value = null
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
    props.writingFormat === 'markdown'
      ? 'Preserve the chapter plan, characters, relationship continuity, and Markdown formatting.'
      : 'Preserve the chapter plan, characters, and relationship continuity. Output Plain Text by default; do not add Markdown headings, chapter title lines, or chapter number lines unless the Writing Style Guide explicitly requires them.',
    'Return the full revised chapter content through the replace_chapter_content tool.',
    '',
    issueText,
  ].join('\n')
}

function fixIssue(issue: ChapterAuditIssue) {
  emit('quickSubmitPolish', issue)
}

function fixAll() {
  if (!openIssues.value.length) return
  emit('quickSubmitPolish')
}

function selectIssue(issue: ChapterAuditIssue) {
  selectedIssueId.value = issue.id
  emit('issueSelected', issue)
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
            <h3 class="truncate text-xs font-semibold text-text-primary">{{ tr('Editing AI') }}</h3>
            <p class="truncate text-[9px] font-bold uppercase tracking-widest text-text-muted">{{ tr('Plan and fact audit') }}</p>
          </div>
        </div>
        <BaseButton variant="secondary" size="sm" :loading="isAuditing" :disabled="!hasContent" @click="audit">
          <FileSearch :size="13" />
          <span>{{ tr('Scan') }}</span>
        </BaseButton>
      </div>
    </div>

    <VibeModelPicker
      v-model="selectedModelValue"
      role="proofreader"
      :disabled="isAuditing"
    />

    <div class="flex-1 overflow-y-auto px-3 py-4">
      <div v-if="!hasContent" class="flex h-full flex-col items-center justify-center text-center">
        <FileSearch :size="24" class="mb-3 text-text-muted" />
        <p class="text-sm font-medium text-text-primary">{{ tr('No chapter content') }}</p>
        <p class="mt-1 max-w-[240px] text-xs text-text-secondary">{{ tr('Write or generate chapter text before running an audit.') }}</p>
      </div>

      <div v-else-if="!issues.length && !isAuditing" class="flex h-full flex-col items-center justify-center text-center">
        <CheckCircle2 :size="24" class="mb-3 text-success" />
        <p class="text-sm font-medium text-text-primary">{{ tr('Ready to audit') }}</p>
        <p class="mt-1 max-w-[260px] text-xs text-text-secondary">{{ tr('Scan checks the chapter against plan beats, character state, relationships, continuity, and story-world facts.') }}</p>
      </div>

      <div v-else class="space-y-3">
        <div v-if="isAuditing" class="rounded-lg border border-accent/20 bg-accent/10 p-3">
          <div class="flex items-center justify-between gap-3">
            <div class="flex min-w-0 items-center gap-2">
              <Sparkles :size="14" class="shrink-0 animate-pulse text-accent" />
              <div class="min-w-0">
                <p class="truncate text-xs font-semibold text-text-primary">{{ tr('Editing AI is scanning') }}</p>
                <p class="text-[10px] text-text-muted">
                  {{ tr('Segment') }} {{ currentSegment?.index ?? 1 }}/{{ currentSegment?.total ?? '?' }} - {{ issues.length }} {{ tr('issues') }}
                </p>
              </div>
            </div>
            <span class="shrink-0 text-xs font-bold text-accent">{{ auditProgressPercent }}%</span>
          </div>
          <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-4">
            <div class="h-full rounded-full bg-accent transition-all" :style="{ width: `${auditProgressPercent}%` }" />
          </div>
        </div>

        <div class="flex items-center justify-between gap-2">
          <div>
            <p class="text-xs font-semibold text-text-primary">{{ tr('{count} issues marked').replace('{count}', String(issues.length)) }}</p>
            <p class="text-[10px] text-text-muted">{{ tr('Click an issue to inspect it. Fix uses Polish AI.') }}</p>
          </div>
          <BaseButton variant="primary" size="sm" :loading="isPolishing" :disabled="!openIssues.length || isPolishing" @click="fixAll">
            <Send :size="13" />
            <span>{{ tr('Polish all') }}</span>
          </BaseButton>
        </div>

        <button
          v-for="issue in issues"
          :key="issue.id"
          class="w-full rounded-lg border p-3 text-left transition-colors"
          :class="selectedIssueId === issue.id ? 'border-warning/50 bg-warning-subtle/50' : 'border-surface-4 bg-surface-2 hover:border-surface-5'"
          @click="selectIssue(issue)"
        >
          <div class="mb-2 flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <AlertTriangle :size="13" class="text-warning" />
                <p class="truncate text-xs font-semibold text-text-primary">{{ issue.title }}</p>
              </div>
              <p class="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-muted">
                <span>{{ issue.category }}</span>
                <span
                  v-if="isBelowPolishThreshold(issue)"
                  class="rounded-full border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[9px] font-bold text-warning"
                  :title="tr('Polish All will skip this issue because it is below the minimum severity setting.')"
                >
                  {{ tr('Below polish threshold') }}
                </span>
              </p>
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
      <div
        v-if="isBelowPolishThreshold(selectedIssue)"
        class="mt-3 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-2 py-2 text-xs leading-relaxed text-warning"
      >
        <AlertTriangle :size="14" class="mt-0.5 shrink-0" />
        <span>{{ tr('Polish All will skip this issue because it is below the minimum severity setting. Submit this issue directly to force Polish.') }}</span>
      </div>
      <BaseButton class="mt-3 w-full" variant="primary" size="sm" :loading="isPolishing" :disabled="isPolishing" @click="fixIssue(selectedIssue)">
        <Send :size="13" />
        <span>{{ tr('Fix with Polish AI') }}</span>
      </BaseButton>
    </div>
  </div>
</template>
